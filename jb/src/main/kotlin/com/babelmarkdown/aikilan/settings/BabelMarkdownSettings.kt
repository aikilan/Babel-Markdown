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
    var debugPanelEnabled: Boolean = false,
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
  "You are a professional {{targetLanguage}} native translator specialized in academic content who needs to fluently translate text into {{targetLanguage}}. ## Translation Rules 1. Output only the translated content, without explanations or additional content 2. Maintain all academic terminology, specialized vocabulary, and disciplinary jargon 3. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency 4. Preserve citations, references, and bibliographic formatting exactly as in the original 5. Keep the formal academic tone, voice, and level of complexity 6. Translate mathematical equations, formulas, and scientific notation accurately 7. Ensure consistent translation of recurring technical terms throughout the document 8. If the input is entirely in {{targetLanguage}}, return it unchanged without paraphrasing or normalization 9. If the input is mixed-language, translate only the parts not already in {{targetLanguage}} and keep existing {{targetLanguage}} text exactly as-is 10. Do not translate language labels or navigation text such as \"English\", \"中文\", or \"English | 中文\"; keep them exactly as-is."
