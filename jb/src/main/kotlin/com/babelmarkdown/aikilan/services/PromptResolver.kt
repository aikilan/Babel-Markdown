package com.babelmarkdown.aikilan.services

import com.babelmarkdown.aikilan.settings.DEFAULT_TRANSLATION_PROMPT
import com.babelmarkdown.aikilan.util.sha256Hex
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.Project
import java.nio.file.Files
import java.nio.file.Path

class PromptResolver(private val logger: Logger) {
  fun resolve(project: Project, promptTemplate: String): TranslationPrompt {
    val workspacePrompt = readWorkspacePrompt(project)
    if (workspacePrompt != null) {
      return workspacePrompt
    }

    val trimmed = promptTemplate.trim()
    if (trimmed.isNotEmpty() && trimmed != DEFAULT_TRANSLATION_PROMPT) {
      return buildPrompt(trimmed, "configuration", null)
    }

    return buildPrompt(DEFAULT_TRANSLATION_PROMPT, "default", null)
  }

  private fun readWorkspacePrompt(project: Project): TranslationPrompt? {
    val basePath = project.basePath ?: return null
    val promptPath = Path.of(basePath, ".babelmd", "translation-prompt.md")
    if (!Files.exists(promptPath)) {
      return null
    }

    return try {
      val content = Files.readString(promptPath).trim()
      if (content.isEmpty()) {
        null
      } else {
        buildPrompt(content, "workspace", promptPath)
      }
    } catch (error: Exception) {
      logger.warn("Failed to read workspace translation prompt from ${promptPath.toAbsolutePath()}.", error)
      null
    }
  }

  private fun buildPrompt(raw: String, source: String, path: Path?): TranslationPrompt {
    val instructions = raw.trim()
    return TranslationPrompt(
      instructions = instructions,
      source = source,
      fingerprint = sha256Hex(instructions),
      path = path?.toAbsolutePath()?.toString(),
    )
  }
}
