package com.babelmarkdown.aikilan.ui

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel

interface WebviewMessageHandler {
  fun onRequestRetry()
}

class TranslationPreviewPanel(
  private val project: Project,
  private val logger: Logger,
  private val handler: WebviewMessageHandler,
) {
  private val gson = Gson()
  private var browser: JBCefBrowser? = null
  val component: JComponent

  init {
    component = createComponent()
  }

  fun postMessage(message: Any) {
    val json = gson.toJson(message)
    val script = "window.dispatchEvent(new MessageEvent('message', { data: $json }));"
    ApplicationManager.getApplication().invokeLater {
      browser?.cefBrowser?.executeJavaScript(script, browser?.cefBrowser?.url ?: "about:blank", 0)
    }
  }

  fun clear() {
    val script = """
      (function() {
        const status = document.getElementById('preview-status');
        const error = document.getElementById('preview-error');
        const warning = document.getElementById('preview-warning');
        const retry = document.getElementById('preview-retry');
        const content = document.getElementById('preview-content');

        if (status) {
          status.textContent = '';
          status.setAttribute('data-state', 'idle');
        }
        if (error) {
          error.hidden = true;
          error.textContent = '';
        }
        if (warning) {
          warning.hidden = true;
          warning.textContent = '';
        }
        if (retry) {
          retry.hidden = true;
          retry.disabled = true;
        }
        if (content) {
          content.innerHTML = '';
        }
      })();
    """.trimIndent()
    ApplicationManager.getApplication().invokeLater {
      browser?.cefBrowser?.executeJavaScript(script, browser?.cefBrowser?.url ?: "about:blank", 0)
    }
  }

  private fun createComponent(): JComponent {
    if (!JBCefApp.isSupported()) {
      return JPanel(BorderLayout()).apply {
        add(JLabel("BabelMarkdown preview requires JCEF support."), BorderLayout.CENTER)
      }
    }

    val browser = JBCefBrowser()
    val query = JBCefJSQuery.create(browser)

    query.addHandler { request ->
      handleMessage(request)
      null
    }

    val html = buildHtml(query)
    browser.loadHTML(html)

    this.browser = browser

    Disposer.register(project, browser)
    Disposer.register(project, query)

    return browser.component
  }

  private fun handleMessage(request: String) {
    val json = runCatching { gson.fromJson(request, JsonObject::class.java) }.getOrNull()
    if (json == null) {
      logger.warn("Received malformed message from preview webview.")
      return
    }

    val type = json.get("type")?.asString ?: return
    when (type) {
      "requestRetry" -> handler.onRequestRetry()
      else -> {
        logger.debug("Ignoring webview message of type $type")
      }
    }
  }

  private fun buildHtml(query: JBCefJSQuery): String {
    val isDark = UIUtil.isUnderDarcula()
    val background = if (isDark) "#1e1e1e" else "#ffffff"
    val foreground = if (isDark) "#d4d4d4" else "#1e1e1e"
    val subtle = if (isDark) "#9aa0a6" else "#555555"
    val border = if (isDark) "#2d2d2d" else "#e5e5e5"
    val warnBg = if (isDark) "rgba(255, 152, 0, 0.1)" else "#fff3cd"
    val warnFg = if (isDark) "#f6c343" else "#856404"
    val errorBg = if (isDark) "rgba(244, 67, 54, 0.2)" else "#f8d7da"
    val errorFg = if (isDark) "#f28b82" else "#721c24"

    val bridgeScript = """
      function __jbPostMessage(payload) {
        ${query.inject("payload")}
      }
      window.acquireVsCodeApi = function() {
        return {
          postMessage: function(message) { __jbPostMessage(JSON.stringify(message)); },
          getState: function() { return null; },
          setState: function() {}
        };
      };
    """.trimIndent()

    val localeJson = gson.toJson(mapOf(
      "languageTag" to "en",
      "pageTitle" to "Translation Preview",
      "retryButtonLabel" to "Retry translation",
      "ariaContentLabel" to "Translated Markdown",
      "placeholders" to mapOf(
        "currentDocument" to "current document",
        "configuredLanguage" to "configured language",
      ),
      "translations" to mapOf(
        "statusInProgress" to "Translating {document} -> {language}{progress}...",
        "progressTemplate" to " ({current}/{total})",
        "statusCompleted" to "Translated {document} -> {language} - {meta}",
        "statusCompletedWithWarnings" to "Translated {document} -> {language} - {meta} (warnings)",
        "statusLastAttempt" to "Last attempt - {document} -> {language}",
        "errorMessage" to "Failed to translate {document} -> {language}: {message}{hint}",
        "warningCacheFallback" to "Reused cached translations for {count} segment(s) after errors.",
        "warningPlaceholder" to "Showing original text for {count} segment(s) because translation failed.",
      ),
      "meta" to mapOf(
        "cachedLabel" to "cached",
        "recoveredLabel" to "warnings",
      ),
      "exportControls" to mapOf(
        "imageButtonLabel" to "Save as PNG",
        "pdfButtonLabel" to "Save as PDF",
        "failureMessage" to "Unable to capture the preview for export.",
        "inProgressMessage" to "Preparing export...",
      ),
    ))

    val previewScript = readResource("/webview/translationPreview.js")

    return """
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Translation Preview</title>
        <style>
          :root {
            color-scheme: ${if (isDark) "dark" else "light"};
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            margin: 0;
            padding: 0;
            background: $background;
            color: $foreground;
          }

          main {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px 20px 48px;
            min-height: 100vh;
            box-sizing: border-box;
          }

          .preview__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            flex-wrap: wrap;
          }

          .preview__status {
            flex: 1 1 auto;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin: 0;
            font-size: 0.85rem;
            color: $subtle;
            min-height: 1.25rem;
          }

          .preview__status[data-state='loading']::before {
            content: '';
            width: 12px;
            height: 12px;
            border-radius: 50%;
            border: 2px solid $border;
            border-top-color: $foreground;
            border-right-color: $foreground;
            animation: preview-spin 0.8s linear infinite;
          }

          .preview__retry {
            flex: 0 0 auto;
            padding: 6px 14px;
            font-size: 0.85rem;
            border-radius: 4px;
            border: 1px solid $border;
            background: transparent;
            color: $foreground;
            cursor: pointer;
            transition: background 150ms ease;
          }

          .preview__retry:hover {
            background: $border;
          }

          .preview__retry[disabled] {
            opacity: 0.6;
            cursor: not-allowed;
          }

          .preview__error {
            margin: 0;
            padding: 12px 16px;
            border-radius: 6px;
            background: $errorBg;
            color: $errorFg;
            border: 1px solid $border;
          }

          .preview__warning {
            margin: 0 0 12px;
            padding: 10px 14px;
            border-radius: 6px;
            background: $warnBg;
            color: $warnFg;
            border: 1px solid $border;
          }

          .preview__content {
            line-height: 1.6;
            white-space: normal;
            word-break: break-word;
          }

          .preview__content img {
            max-width: 100%;
            height: auto;
          }

          .preview__chunk {
            margin: 0 0 16px;
          }

          .preview__chunk--source {
            opacity: 0.65;
          }

          .preview__chunk--cached {
            border-left: 3px solid #4caf50;
            padding-left: 12px;
          }

          .preview__chunk--placeholder {
            border-left: 3px solid #ff9800;
            padding-left: 12px;
            background: rgba(255, 152, 0, 0.08);
          }

          a {
            color: #3b82f6;
          }

          code, pre {
            font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
          }

          pre {
            background: rgba(128, 128, 128, 0.1);
            padding: 12px;
            border-radius: 6px;
            overflow-x: auto;
          }

          table {
            border-collapse: collapse;
            width: 100%;
          }

          th,
          td {
            border: 1px solid $border;
            padding: 6px 10px;
            text-align: left;
          }

          @keyframes preview-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <main>
          <header class="preview__header">
            <p id="preview-status" class="preview__status" role="status" aria-live="polite" data-state="idle"></p>
            <button id="preview-retry" class="preview__retry" type="button" hidden>Retry translation</button>
          </header>
          <div id="preview-error" class="preview__error" role="alert" hidden></div>
          <div id="preview-warning" class="preview__warning" role="note" hidden></div>
          <article id="preview-content" class="preview__content" aria-label="Translated Markdown"></article>
        </main>
        <script>
          $bridgeScript
        </script>
        <script>
          window.__babelMdViewerLocale = $localeJson;
        </script>
        <script>
          $previewScript
        </script>
      </body>
      </html>
    """.trimIndent()
  }

  private fun readResource(path: String): String {
    val stream = TranslationPreviewPanel::class.java.getResourceAsStream(path)
      ?: run {
        logger.warn("Missing webview resource: $path")
        return ""
      }
    return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
  }
}
