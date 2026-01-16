package com.babelmarkdown.aikilan.ui

import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

class TranslationPreviewToolWindowFactory : ToolWindowFactory, DumbAware {
  override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
    val service = project.service<TranslationPreviewService>()
    val panel = TranslationPreviewPanel(project, Logger.getInstance(TranslationPreviewPanel::class.java), service)
    service.attachPanel(panel)

    val previewContent = ContentFactory.getInstance().createContent(panel.component, "Preview", false)
    toolWindow.contentManager.addContent(previewContent)

    val debugPanel = TranslationDebugPanel()
    service.attachDebugPanel(debugPanel)
    val debugContent = ContentFactory.getInstance().createContent(debugPanel.component, "Debug", false)
    toolWindow.contentManager.addContent(debugContent)

    toolWindow.contentManager.setSelectedContent(previewContent, true)
  }
}
