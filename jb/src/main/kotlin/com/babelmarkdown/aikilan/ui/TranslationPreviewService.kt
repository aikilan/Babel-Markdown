package com.babelmarkdown.aikilan.ui

import com.babelmarkdown.aikilan.services.MarkdownSegmenter
import com.babelmarkdown.aikilan.services.OpenAITranslationClient
import com.babelmarkdown.aikilan.services.PromptResolver
import com.babelmarkdown.aikilan.services.TranslationRequest
import com.babelmarkdown.aikilan.services.TranslationService
import com.babelmarkdown.aikilan.services.TranslationSegmentUpdate
import com.babelmarkdown.aikilan.util.MarkdownRenderer
import com.babelmarkdown.aikilan.util.isMarkdownFile
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.babelmarkdown.aikilan.settings.ApiKeyStore
import com.babelmarkdown.aikilan.settings.BabelMarkdownSettings
import com.intellij.openapi.wm.ToolWindowManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean

@Service(Service.Level.PROJECT)
class TranslationPreviewService(private val project: Project) : Disposable, WebviewMessageHandler {
  private val logger = Logger.getInstance(TranslationPreviewService::class.java)
  private val settings = BabelMarkdownSettings.getInstance()
  private val apiKeyStore = ApplicationManager.getApplication().getService(ApiKeyStore::class.java)
  private val promptResolver = PromptResolver(logger)
  private val renderer = MarkdownRenderer()
  private val segmenter = MarkdownSegmenter()
  private val client = OpenAITranslationClient(logger)
  private val translationService = TranslationService(logger, client, renderer, segmenter)
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private var panel: TranslationPreviewPanel? = null
  private var currentEditor: Editor? = null
  private var currentFile: VirtualFile? = null
  private var translationJob: Job? = null
  private val isDisposed = AtomicBoolean(false)

  init {
    project.messageBus.connect(this).subscribe(
      FileEditorManagerListener.FILE_EDITOR_MANAGER,
      object : FileEditorManagerListener {
        override fun fileClosed(source: FileEditorManager, file: VirtualFile) {
          if (file == currentFile) {
            closePreview()
          }
        }
      },
    )
  }

  fun attachPanel(panel: TranslationPreviewPanel) {
    this.panel = panel
    if (currentEditor != null && currentFile != null) {
      refreshPreview()
    }
  }

  fun openPreview(editor: Editor, file: VirtualFile) {
    if (!isMarkdownFile(file)) {
      notify("BabelMarkdown only supports Markdown files.", NotificationType.WARNING)
      return
    }

    currentEditor = editor
    currentFile = file
    refreshPreview()
  }

  fun refreshPreview() {
    val editor = currentEditor
    val file = currentFile
    val panel = panel

    if (editor == null || file == null || panel == null) {
      notify("Open a Markdown file and retry BabelMarkdown preview.", NotificationType.WARNING)
      return
    }

    val apiKey = apiKeyStore.getApiKey()
    if (apiKey.isNullOrBlank()) {
      notify("Set an API key in BabelMarkdown settings before translating.", NotificationType.WARNING)
      postError("Missing API key.", file, settings.state.targetLanguage, "Configure settings")
      return
    }

    val state = settings.state
    if (state.apiBaseUrl.isBlank()) {
      notify("Set an API base URL in BabelMarkdown settings before translating.", NotificationType.WARNING)
      postError("Missing API base URL.", file, state.targetLanguage, "Configure settings")
      return
    }
    if (state.model.isBlank()) {
      notify("Set a model name in BabelMarkdown settings before translating.", NotificationType.WARNING)
      postError("Missing model name.", file, state.targetLanguage, "Configure settings")
      return
    }
    if (state.targetLanguage.isBlank()) {
      notify("Set a target language in BabelMarkdown settings before translating.", NotificationType.WARNING)
      postError("Missing target language.", file, state.targetLanguage, "Configure settings")
      return
    }

    val document = FileDocumentManager.getInstance().getDocument(file)
    if (document == null) {
      notify("Unable to read the current document.", NotificationType.ERROR)
      return
    }

    val resolvedConfig = com.babelmarkdown.aikilan.services.ResolvedTranslationConfig(
      apiBaseUrl = state.apiBaseUrl,
      apiKey = apiKey,
      model = state.model,
      targetLanguage = state.targetLanguage,
      timeoutMs = state.timeoutMs,
      concurrencyLimit = state.concurrencyLimit,
      retryMaxAttempts = state.retryMaxAttempts,
      promptTemplate = state.promptTemplate,
    )

    val prompt = promptResolver.resolve(project, resolvedConfig.promptTemplate)
    val documentLabel = buildDocumentLabel(file)
    val request = TranslationRequest(
      documentText = document.text,
      fileName = file.name,
      documentLabel = documentLabel,
      config = resolvedConfig,
      prompt = prompt,
    )

    translationJob?.cancel()

    panel.postMessage(
      mapOf(
        "type" to "setLoading",
        "payload" to mapOf(
          "isLoading" to true,
          "documentPath" to documentLabel,
          "targetLanguage" to resolvedConfig.targetLanguage,
          "totalSegments" to null,
        ),
      ),
    )

    translationJob = scope.launch {
      try {
        val result = translationService.translateDocument(
          request,
          onPlan = { segments ->
            panel.postMessage(
              mapOf(
                "type" to "translationSource",
                "payload" to mapOf(
                  "documentPath" to documentLabel,
                  "targetLanguage" to resolvedConfig.targetLanguage,
                  "segments" to segments.mapIndexed { index, segment ->
                    mapOf(
                      "segmentIndex" to index,
                      "markdown" to segment,
                    )
                  },
                ),
              ),
            )
            panel.postMessage(
              mapOf(
                "type" to "setLoading",
                "payload" to mapOf(
                  "isLoading" to true,
                  "documentPath" to documentLabel,
                  "targetLanguage" to resolvedConfig.targetLanguage,
                  "totalSegments" to segments.size,
                ),
              ),
            )
          },
          onSegment = { update ->
            postSegmentUpdate(update, documentLabel, resolvedConfig.targetLanguage)
          },
        )

        panel.postMessage(
          mapOf(
            "type" to "translationResult",
            "payload" to mapOf(
              "markdown" to result.markdown,
              "html" to result.html,
              "providerId" to result.providerId,
              "latencyMs" to result.latencyMs,
              "targetLanguage" to resolvedConfig.targetLanguage,
              "documentPath" to documentLabel,
              "sourceVersion" to document.modificationStamp,
              "wasCached" to false,
              "recoveries" to result.recoveries.map {
                mapOf(
                  "type" to it.type,
                  "code" to toWireCode(it.code),
                  "attempts" to it.attempts,
                  "message" to it.message,
                )
              },
            ),
          ),
        )
      } catch (error: Exception) {
        if (error is CancellationException) {
          return@launch
        }
        logger.warn("Translation failed.", error)
        postError(error.message ?: "Translation failed.", file, resolvedConfig.targetLanguage, null)
      } finally {
        panel.postMessage(
          mapOf(
            "type" to "setLoading",
            "payload" to mapOf(
              "isLoading" to false,
              "documentPath" to documentLabel,
              "targetLanguage" to resolvedConfig.targetLanguage,
              "totalSegments" to null,
            ),
          ),
        )
      }
    }
  }

  override fun onRequestRetry() {
    refreshPreview()
  }

  private fun closePreview() {
    translationJob?.cancel()
    translationJob = null
    currentEditor = null
    currentFile = null
    panel?.clear()
    ApplicationManager.getApplication().invokeLater {
      ToolWindowManager.getInstance(project)
        .getToolWindow("BabelMarkdown Preview")
        ?.hide(null)
    }
  }

  override fun dispose() {
    isDisposed.set(true)
    translationJob?.cancel()
    scope.coroutineContext.cancel()
  }

  private fun postSegmentUpdate(
    update: TranslationSegmentUpdate,
    documentLabel: String,
    targetLanguage: String,
  ) {
    panel?.postMessage(
      mapOf(
        "type" to "translationChunk",
        "payload" to mapOf(
          "segmentIndex" to update.segmentIndex,
          "totalSegments" to update.totalSegments,
          "markdown" to update.markdown,
          "html" to update.html,
          "providerId" to update.providerId,
          "latencyMs" to update.latencyMs,
          "documentPath" to documentLabel,
          "targetLanguage" to targetLanguage,
          "wasCached" to update.wasCached,
          "recovery" to update.recovery?.let {
            mapOf(
              "type" to it.type,
              "code" to toWireCode(it.code),
              "attempts" to it.attempts,
              "message" to it.message,
            )
          },
        ),
      ),
    )
  }

  private fun postError(message: String, file: VirtualFile, targetLanguage: String, hint: String?) {
    panel?.postMessage(
      mapOf(
        "type" to "translationError",
        "payload" to mapOf(
          "message" to message,
          "documentPath" to buildDocumentLabel(file),
          "targetLanguage" to targetLanguage,
          "hint" to hint,
        ),
      ),
    )
  }

  private fun buildDocumentLabel(file: VirtualFile): String {
    val baseDir = project.baseDir
    if (baseDir != null) {
      val relative = VfsUtilCore.getRelativePath(file, baseDir)
      if (!relative.isNullOrBlank()) {
        return relative
      }
    }
    return file.name
  }

  private fun notify(message: String, type: NotificationType) {
    if (isDisposed.get()) {
      return
    }
    NotificationGroupManager.getInstance()
      .getNotificationGroup("BabelMarkdown")
      .createNotification(message, type)
      .notify(project)
  }

  private fun toWireCode(code: com.babelmarkdown.aikilan.services.TranslationErrorCode): String {
    return when (code) {
      com.babelmarkdown.aikilan.services.TranslationErrorCode.AUTHENTICATION -> "authentication"
      com.babelmarkdown.aikilan.services.TranslationErrorCode.TIMEOUT -> "timeout"
      com.babelmarkdown.aikilan.services.TranslationErrorCode.RATE_LIMIT -> "rateLimit"
      com.babelmarkdown.aikilan.services.TranslationErrorCode.NETWORK -> "network"
      com.babelmarkdown.aikilan.services.TranslationErrorCode.SERVER -> "server"
      com.babelmarkdown.aikilan.services.TranslationErrorCode.INVALID_RESPONSE -> "invalidResponse"
      com.babelmarkdown.aikilan.services.TranslationErrorCode.UNKNOWN -> "unknown"
    }
  }
}
