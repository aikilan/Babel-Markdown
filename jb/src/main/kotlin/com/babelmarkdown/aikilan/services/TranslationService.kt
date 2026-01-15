package com.babelmarkdown.aikilan.services

import com.babelmarkdown.aikilan.util.MarkdownRenderer
import com.intellij.openapi.diagnostic.Logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

class TranslationService(
  private val logger: Logger,
  private val client: OpenAITranslationClient,
  private val renderer: MarkdownRenderer,
  private val segmenter: MarkdownSegmenter,
) {
  suspend fun translateDocument(
    request: TranslationRequest,
    onPlan: (List<String>) -> Unit,
    onSegment: (TranslationSegmentUpdate) -> Unit,
  ): TranslationResult = withContext(Dispatchers.IO) {
    val text = request.documentText
    if (text.trim().isEmpty()) {
      val fallbackMarkdown = "_The source document is empty; nothing to translate._"
      return@withContext TranslationResult(
        markdown = fallbackMarkdown,
        html = renderer.render(fallbackMarkdown),
        providerId = "noop",
        latencyMs = 0,
      )
    }

    val segments = segmenter.split(text)
    if (segments.isEmpty()) {
      val fallbackMarkdown = "_The source document is empty; nothing to translate._"
      return@withContext TranslationResult(
        markdown = fallbackMarkdown,
        html = renderer.render(fallbackMarkdown),
        providerId = "noop",
        latencyMs = 0,
      )
    }

    onPlan(segments)

    val totalSegments = segments.size
    val concurrency = normalizeConcurrency(request.config.concurrencyLimit, totalSegments)
    val results = Array<RawTranslationResult?>(totalSegments) { null }
    val recoveries = java.util.Collections.synchronizedList(mutableListOf<SegmentRecovery>())

    coroutineScope {
      val semaphore = Semaphore(concurrency)
      val jobs = segments.mapIndexed { index, segment ->
        async {
          semaphore.withPermit {
            val outcome = translateSegmentWithRetry(request, segment, index)
            results[index] = outcome.result

            if (outcome.recovery != null) {
              recoveries.add(outcome.recovery)
            }

            val html = renderer.render(outcome.result.markdown)
            onSegment(
              TranslationSegmentUpdate(
                segmentIndex = index,
                totalSegments = totalSegments,
                markdown = outcome.result.markdown,
                html = html,
                latencyMs = outcome.result.latencyMs,
                providerId = outcome.result.providerId,
                wasCached = false,
                recovery = outcome.recovery,
              ),
            )
          }
        }
      }
      jobs.awaitAll()
    }

    val finalMarkdown = results.filterNotNull().joinToString("\n\n") { it.markdown }
    val finalHtml = renderer.render(finalMarkdown)
    val totalLatency = results.filterNotNull().sumOf { it.latencyMs }
    val providerId = results.firstOrNull()?.providerId ?: request.config.model

    TranslationResult(
      markdown = finalMarkdown,
      html = finalHtml,
      providerId = providerId,
      latencyMs = totalLatency,
      recoveries = recoveries.sortedBy { it.segmentIndex },
    )
  }

  private suspend fun translateSegmentWithRetry(
    request: TranslationRequest,
    segmentMarkdown: String,
    segmentIndex: Int,
  ): SegmentOutcome {
    var attempts = 0
    var lastError: TranslationProviderException? = null

    while (attempts < request.config.retryMaxAttempts) {
      attempts += 1
      try {
        val result = client.translate(
          TranslateRequest(
            documentText = segmentMarkdown,
            fileName = "${request.fileName}#segment-${segmentIndex + 1}",
            documentLabel = request.documentLabel,
            config = request.config,
            prompt = request.prompt,
          ),
        )
        currentCoroutineContext().ensureActive()
        return SegmentOutcome(result = result, recovery = null)
      } catch (error: CancellationException) {
        throw error
      } catch (error: TranslationProviderException) {
        lastError = error
        if (!error.retryable || attempts >= request.config.retryMaxAttempts) {
          break
        }
        val delayMs = 250L * attempts
        logger.info("Segment ${segmentIndex + 1} failed (${error.code}); retrying in ${delayMs}ms.")
        delay(delayMs)
      } catch (error: Exception) {
        lastError = TranslationProviderException(
          "Translation failed due to an unknown error.",
          TranslationErrorCode.UNKNOWN,
          retryable = false,
          cause = error,
        )
        break
      }
    }

    val error = lastError ?: TranslationProviderException(
      "Translation failed due to an unknown error.",
      TranslationErrorCode.UNKNOWN,
      retryable = false,
    )

    val placeholder = buildPlaceholderSegment(error, segmentMarkdown)
    val recovery = SegmentRecovery(
      segmentIndex = segmentIndex,
      code = error.code,
      type = "placeholder",
      attempts = attempts,
      message = error.message ?: "Translation failed.",
    )

    return SegmentOutcome(
      result = RawTranslationResult(
        markdown = placeholder,
        providerId = request.config.model,
        latencyMs = 0,
      ),
      recovery = recovery,
    )
  }

  private fun normalizeConcurrency(requested: Int, segmentCount: Int): Int {
    if (requested < 1) {
      return 1
    }
    return requested.coerceAtMost(segmentCount.coerceAtLeast(1))
  }

  private fun buildPlaceholderSegment(
    error: TranslationProviderException,
    segmentMarkdown: String,
  ): String {
    val intro = "Translation failed for this section (${error.code})."
    val body = if (segmentMarkdown.trim().isNotEmpty()) "\n\n$segmentMarkdown" else ""
    return "> $intro\n>\n> Showing original text.$body"
  }

  private data class SegmentOutcome(
    val result: RawTranslationResult,
    val recovery: SegmentRecovery?,
  )
}

data class TranslationRequest(
  val documentText: String,
  val fileName: String,
  val documentLabel: String,
  val config: ResolvedTranslationConfig,
  val prompt: TranslationPrompt,
)
