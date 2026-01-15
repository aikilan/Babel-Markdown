package com.babelmarkdown.aikilan.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(
  name = "BabelMarkdownSettings",
  storages = [Storage("BabelMarkdown.xml")],
)
@Service(Service.Level.APP)
class BabelMarkdownSettings : PersistentStateComponent<BabelMarkdownSettings.State> {
  data class State(
    var apiBaseUrl: String = "https://api.openai.com/v1",
    var model: String = "gpt-4o-mini",
    var targetLanguage: String = "en",
    var timeoutMs: Int = 30000,
    var concurrencyLimit: Int = 2,
    var retryMaxAttempts: Int = 3,
    var promptTemplate: String = DEFAULT_TRANSLATION_PROMPT,
  )

  private var state = State()

  override fun getState(): State = state

  override fun loadState(state: State) {
    this.state = state
  }

  companion object {
    fun getInstance(): BabelMarkdownSettings =
      ApplicationManager.getApplication().getService(BabelMarkdownSettings::class.java)
  }
}

const val DEFAULT_TRANSLATION_PROMPT =
  "You are an expert technical translator. Translate Markdown documents into {{targetLanguage}} while preserving the original Markdown structure, code blocks, inline formatting, tables, and metadata. Output only the translation. If the input is entirely in {{targetLanguage}}, return it unchanged without paraphrasing or normalization. If the input is mixed-language, translate only the parts not already in {{targetLanguage}} and keep existing {{targetLanguage}} text exactly as-is. Do not translate language labels or navigation text such as \"English\", \"中文\", or \"English | 中文\"; keep them exactly as-is. Do not add commentary."
