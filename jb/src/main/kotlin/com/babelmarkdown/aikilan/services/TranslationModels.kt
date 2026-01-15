package com.babelmarkdown.aikilan.services

data class ResolvedTranslationConfig(
  val apiBaseUrl: String,
  val apiKey: String,
  val model: String,
  val targetLanguage: String,
  val timeoutMs: Int,
  val concurrencyLimit: Int,
  val retryMaxAttempts: Int,
  val promptTemplate: String,
)

data class TranslationPrompt(
  val instructions: String,
  val source: String,
  val fingerprint: String,
  val path: String? = null,
)

data class RawTranslationResult(
  val markdown: String,
  val providerId: String,
  val latencyMs: Long,
)

data class TranslationResult(
  val markdown: String,
  val html: String,
  val providerId: String,
  val latencyMs: Long,
  val recoveries: List<SegmentRecovery> = emptyList(),
)

data class TranslationSegmentUpdate(
  val segmentIndex: Int,
  val totalSegments: Int,
  val markdown: String,
  val html: String,
  val latencyMs: Long,
  val providerId: String,
  val wasCached: Boolean,
  val recovery: SegmentRecovery?,
)

enum class TranslationErrorCode {
  AUTHENTICATION,
  TIMEOUT,
  RATE_LIMIT,
  NETWORK,
  SERVER,
  INVALID_RESPONSE,
  UNKNOWN,
}

data class SegmentRecovery(
  val segmentIndex: Int,
  val code: TranslationErrorCode,
  val type: String,
  val attempts: Int,
  val message: String,
)
