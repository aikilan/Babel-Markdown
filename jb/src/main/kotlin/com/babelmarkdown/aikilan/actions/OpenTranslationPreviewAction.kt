package com.babelmarkdown.aikilan.actions

import com.babelmarkdown.aikilan.ui.TranslationPreviewService
import com.babelmarkdown.aikilan.util.isMarkdownFile
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager

class OpenTranslationPreviewAction : AnAction(), DumbAware {
  override fun actionPerformed(event: AnActionEvent) {
    val project = event.project ?: return
    val editor = event.getData(CommonDataKeys.EDITOR) ?: return
    val file = event.getData(CommonDataKeys.VIRTUAL_FILE) ?: return

    val toolWindow = ToolWindowManager.getInstance(project)
      .getToolWindow("BabelMarkdown Preview")

    val service = project.service<TranslationPreviewService>()

    if (toolWindow != null) {
      toolWindow.activate { service.openPreview(editor, file) }
    } else {
      service.openPreview(editor, file)
    }
  }

  override fun update(event: AnActionEvent) {
    val file = event.getData(CommonDataKeys.VIRTUAL_FILE)
    val enabled = file != null && isMarkdownFile(file)
    event.presentation.isEnabled = enabled
    event.presentation.isVisible = true
  }
}
