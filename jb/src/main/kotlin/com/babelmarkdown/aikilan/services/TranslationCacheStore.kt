package com.babelmarkdown.aikilan.services

import com.babelmarkdown.aikilan.util.sha256Hex
import com.google.gson.Gson
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import java.nio.file.Files
import java.nio.file.Path
import java.util.Comparator

data class CachedTranslation(
  val filePath: String,
  val documentLabel: String,
  val contentHash: String,
  val targetLanguage: String,
  val model: String,
  val promptFingerprint: String,
  val markdown: String,
  val html: String,
  val providerId: String,
  val latencyMs: Long,
  val recoveries: List<SegmentRecovery> = emptyList(),
  val updatedAt: Long,
)

class TranslationCacheStore(
  project: Project,
  private val logger: Logger,
) {
  private val gson = Gson()
  private val cacheRoot = buildCacheRoot(project)

  fun load(
    file: VirtualFile,
    documentText: String,
    config: ResolvedTranslationConfig,
    prompt: TranslationPrompt,
  ): CachedTranslation? {
    val entryPath = resolveEntryPath(file, config, prompt)
    if (!Files.exists(entryPath)) {
      return null
    }

    val entry = runCatching {
      gson.fromJson(Files.readString(entryPath), CachedTranslation::class.java)
    }.getOrNull()

    if (entry == null) {
      logger.warn("Failed to parse cached translation at ${entryPath.toAbsolutePath()}.")
      return null
    }

    val contentHash = sha256Hex(documentText)
    if (
      entry.filePath != file.path ||
      entry.contentHash != contentHash ||
      entry.targetLanguage != config.targetLanguage ||
      entry.model != config.model ||
      entry.promptFingerprint != prompt.fingerprint
    ) {
      return null
    }

    return entry
  }

  fun save(
    file: VirtualFile,
    documentLabel: String,
    documentText: String,
    config: ResolvedTranslationConfig,
    prompt: TranslationPrompt,
    result: TranslationResult,
  ) {
    val entryPath = resolveEntryPath(file, config, prompt)
    try {
      Files.createDirectories(entryPath.parent)
      val entry = CachedTranslation(
        filePath = file.path,
        documentLabel = documentLabel,
        contentHash = sha256Hex(documentText),
        targetLanguage = config.targetLanguage,
        model = config.model,
        promptFingerprint = prompt.fingerprint,
        markdown = result.markdown,
        html = result.html,
        providerId = result.providerId,
        latencyMs = result.latencyMs,
        recoveries = result.recoveries,
        updatedAt = System.currentTimeMillis(),
      )
      Files.writeString(entryPath, gson.toJson(entry))
    } catch (error: Exception) {
      logger.warn("Failed to persist translation cache at ${entryPath.toAbsolutePath()}.", error)
    }
  }

  fun clearForFile(file: VirtualFile) {
    val fileDir = cacheRoot.resolve(sha256Hex(file.path))
    if (!Files.exists(fileDir)) {
      return
    }
    try {
      Files.walk(fileDir)
        .sorted(Comparator.reverseOrder())
        .forEach { path -> Files.deleteIfExists(path) }
    } catch (error: Exception) {
      logger.warn("Failed to clear translation cache for ${file.path}.", error)
    }
  }

  private fun resolveEntryPath(
    file: VirtualFile,
    config: ResolvedTranslationConfig,
    prompt: TranslationPrompt,
  ): Path {
    val fileDir = cacheRoot.resolve(sha256Hex(file.path))
    val configKey = sha256Hex(
      listOf(
        config.targetLanguage.trim(),
        config.model.trim(),
        prompt.fingerprint.trim(),
      ).joinToString("|"),
    )
    return fileDir.resolve("$configKey.json")
  }

  private fun buildCacheRoot(project: Project): Path {
    val projectKey = project.basePath?.takeIf { it.isNotBlank() } ?: project.name
    val projectHash = sha256Hex(projectKey)
    return Path.of(PathManager.getSystemPath(), "babelmarkdown", "translation-cache", projectHash)
  }
}
