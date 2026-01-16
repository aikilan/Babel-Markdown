package com.babelmarkdown.aikilan.settings

import com.intellij.openapi.components.service
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.project.ProjectManager
import com.babelmarkdown.aikilan.ui.TranslationPreviewService
import com.intellij.openapi.util.NlsContexts
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JSpinner
import javax.swing.SpinnerNumberModel

class BabelMarkdownSettingsConfigurable : Configurable {
  private val settings = BabelMarkdownSettings.getInstance()
  private val apiKeyStore = com.intellij.openapi.application.ApplicationManager.getApplication()
    .getService(ApiKeyStore::class.java)

  private val apiBaseUrlField = JBTextField()
  private val apiKeyField = JBPasswordField()
  private val modelField = JBTextField()
  private val targetLanguageField = JBTextField()
  private val timeoutField = intSpinner(30000, 1000, 600000, 1000)
  private val concurrencyField = intSpinner(2, 1, 8, 1)
  private val retryField = intSpinner(3, 1, 6, 1)
  private val debugPanelEnabledCheckbox = JBCheckBox("Enable Debug Panel")

  private var component: JPanel? = null

  override fun getDisplayName(): @NlsContexts.ConfigurableName String = "BabelMarkdown"

  override fun createComponent(): JComponent {
    if (component == null) {
      val form = FormBuilder.createFormBuilder()
        .addLabeledComponent("API Base URL", apiBaseUrlField, 1, false)
        .addLabeledComponent("API Key", apiKeyField, 1, false)
        .addLabeledComponent("Model", modelField, 1, false)
        .addLabeledComponent("Target Language", targetLanguageField, 1, false)
        .addLabeledComponent("Timeout (ms)", timeoutField, 1, false)
        .addLabeledComponent("Concurrency Limit", concurrencyField, 1, false)
        .addLabeledComponent("Retry Attempts", retryField, 1, false)
        .addComponent(debugPanelEnabledCheckbox, 1)
        .panel

      component = JPanel(BorderLayout()).apply {
        add(form, BorderLayout.NORTH)
      }

      reset()
    }

    return component as JPanel
  }

  override fun isModified(): Boolean {
    val state = settings.state
    val apiKey = String(apiKeyField.password)

    return apiBaseUrlField.text.trim() != state.apiBaseUrl ||
      apiKeyStore.getApiKey().orEmpty() != apiKey ||
      modelField.text.trim() != state.model ||
      targetLanguageField.text.trim() != state.targetLanguage ||
      spinnerValue(timeoutField) != state.timeoutMs ||
      spinnerValue(concurrencyField) != state.concurrencyLimit ||
      spinnerValue(retryField) != state.retryMaxAttempts ||
      debugPanelEnabledCheckbox.isSelected != state.debugPanelEnabled
  }

  override fun apply() {
    val state = settings.state
    state.apiBaseUrl = apiBaseUrlField.text.trim()
    state.model = modelField.text.trim()
    state.targetLanguage = targetLanguageField.text.trim()
    state.timeoutMs = spinnerValue(timeoutField)
    state.concurrencyLimit = spinnerValue(concurrencyField)
    state.retryMaxAttempts = spinnerValue(retryField)
    state.debugPanelEnabled = debugPanelEnabledCheckbox.isSelected

    val apiKey = String(apiKeyField.password)
    apiKeyStore.setApiKey(apiKey)

    ProjectManager.getInstance().openProjects.forEach { project ->
      project.service<TranslationPreviewService>().updateDebugPanelVisibility()
    }
  }

  override fun reset() {
    val state = settings.state
    apiBaseUrlField.text = state.apiBaseUrl
    modelField.text = state.model
    targetLanguageField.text = state.targetLanguage
    timeoutField.value = state.timeoutMs
    concurrencyField.value = state.concurrencyLimit
    retryField.value = state.retryMaxAttempts
    debugPanelEnabledCheckbox.isSelected = state.debugPanelEnabled

    apiKeyField.text = apiKeyStore.getApiKey().orEmpty()
  }

  override fun disposeUIResources() {
    component = null
  }

  private fun intSpinner(value: Int, min: Int, max: Int, step: Int): JSpinner {
    return JSpinner(SpinnerNumberModel(value, min, max, step))
  }

  private fun spinnerValue(spinner: JSpinner): Int {
    val number = spinner.value as? Number ?: return 0
    return number.toInt()
  }
}
