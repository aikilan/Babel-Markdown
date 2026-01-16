package com.babelmarkdown.aikilan.ui

import com.babelmarkdown.aikilan.services.TranslationDebugEvent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Font
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import javax.swing.JComponent
import javax.swing.JPanel

class TranslationDebugPanel {
  private val entries = ArrayDeque<TranslationDebugEvent>()
  private val maxEntries = 50

  private val contentPanel = JPanel(BorderLayout())
  private val disabledPanel = JPanel(BorderLayout())
  private val cardLayout = CardLayout()
  private val rootPanel = JPanel(cardLayout)

  private val statusLabel = JBLabel("No debug events yet.")
  private val textArea = JBTextArea()
  val component: JComponent = rootPanel

  private val formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
    .withZone(ZoneId.systemDefault())

  init {
    textArea.isEditable = false
    textArea.lineWrap = false
    textArea.wrapStyleWord = false
    textArea.font = Font(Font.MONOSPACED, Font.PLAIN, 12)

    contentPanel.add(statusLabel, BorderLayout.NORTH)
    contentPanel.add(JBScrollPane(textArea), BorderLayout.CENTER)

    disabledPanel.add(
      JBLabel("Debug panel is disabled. Enable it in Settings | BabelMarkdown."),
      BorderLayout.CENTER,
    )

    rootPanel.add(contentPanel, "content")
    rootPanel.add(disabledPanel, "disabled")
    setEnabled(false)
  }

  fun setEnabled(enabled: Boolean) {
    cardLayout.show(rootPanel, if (enabled) "content" else "disabled")
  }

  fun clear() {
    entries.clear()
    statusLabel.text = "No debug events yet."
    textArea.text = ""
  }

  fun addEntry(event: TranslationDebugEvent) {
    entries.addLast(event)
    while (entries.size > maxEntries) {
      entries.removeFirst()
    }
    render()
  }

  private fun render() {
    if (entries.isEmpty()) {
      statusLabel.text = "No debug events yet."
      textArea.text = ""
      return
    }

    statusLabel.text = "Showing last ${entries.size} request(s)."
    val builder = StringBuilder()
    entries.forEachIndexed { index, entry ->
      if (index > 0) {
        builder.append("\n\n")
      }
      builder.append(formatEntry(entry))
    }
    textArea.text = builder.toString()
    textArea.caretPosition = textArea.document.length
  }

  private fun formatEntry(entry: TranslationDebugEvent): String {
    val timestamp = formatter.format(Instant.ofEpochMilli(entry.timestamp))
    val status = entry.status?.toString() ?: "n/a"
    val latency = entry.latencyMs?.let { "${it}ms" } ?: "n/a"
    val responseBody = entry.responseBody?.ifBlank { "<empty response>" } ?: "<no response>"
    val errorLine = entry.errorMessage?.let { "Error: $it\n" } ?: ""

    return buildString {
      append("Time: $timestamp\n")
      append("Document: ${entry.documentLabel}\n")
      append("File: ${entry.fileName}\n")
      append("Endpoint: ${entry.endpoint}\n")
      append("Model: ${entry.model}\n")
      append("Target Language: ${entry.targetLanguage}\n")
      append("Status: $status\n")
      append("Latency: $latency\n")
      if (errorLine.isNotEmpty()) {
        append(errorLine)
      }
      append("\nRequest:\n")
      append(entry.requestBody)
      append("\n\nResponse:\n")
      append(responseBody)
    }
  }
}
