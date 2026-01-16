package com.babelmarkdown.aikilan.services

data class TranslationDebugEvent(
  val timestamp: Long,
  val documentLabel: String,
  val fileName: String,
  val endpoint: String,
  val model: String,
  val targetLanguage: String,
  val requestBody: String,
  val responseBody: String?,
  val status: Int?,
  val errorMessage: String?,
  val latencyMs: Long?,
)

interface TranslationDebugListener {
  fun onDebugEvent(event: TranslationDebugEvent)
}
