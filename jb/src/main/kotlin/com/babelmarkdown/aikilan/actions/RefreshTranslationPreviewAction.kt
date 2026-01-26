package com.babelmarkdown.aikilan.actions

import com.babelmarkdown.aikilan.ui.TranslationPreviewService
import com.babelmarkdown.aikilan.util.isMarkdownFile
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager

class RefreshTranslationPreviewAction : AnAction(), DumbAware {
  override fun actionPerformed(event: AnActionEvent) {
    val project = event.project ?: return
    val service = project.service<TranslationPreviewService>()
    val editor = event.getData(CommonDataKeys.EDITOR)
    val file = event.getData(CommonDataKeys.VIRTUAL_FILE)
      ?: editor?.let { FileDocumentManager.getInstance().getFile(it.document) }

    val toolWindow = ToolWindowManager.getInstance(project)
      .getToolWindow("BabelMarkdown Preview")

    if (editor != null && file != null && isMarkdownFile(file)) {
      if (toolWindow != null) {
        toolWindow.activate { service.openPreview(editor, file, true) }
      } else {
        service.openPreview(editor, file, true)
      }
      return
    }

    service.refreshPreview(true)
  }

  override fun update(event: AnActionEvent) {
    event.presentation.isEnabledAndVisible = true
  }
}
