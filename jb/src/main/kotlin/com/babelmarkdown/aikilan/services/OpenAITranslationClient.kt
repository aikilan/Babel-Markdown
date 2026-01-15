package com.babelmarkdown.aikilan.services

import com.google.gson.Gson
import com.intellij.openapi.diagnostic.Logger
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

class TranslationProviderException(
  message: String,
  val code: TranslationErrorCode,
  val status: Int? = null,
  val retryable: Boolean = false,
  cause: Throwable? = null,
) : RuntimeException(message, cause)

class OpenAITranslationClient(private val logger: Logger) {
  private val gson = Gson()
  private val mediaType = "application/json".toMediaType()
  private val baseClient = OkHttpClient.Builder().build()

  suspend fun translate(request: TranslateRequest): RawTranslationResult {
    val endpoint = buildEndpointUrl(request.config.apiBaseUrl)
    val instructions = interpolateInstructions(
      request.prompt.instructions,
      request.config.targetLanguage,
      request.documentLabel,
    )
    val messages = listOf(
      ChatMessage(role = "system", content = instructions.trim()),
      ChatMessage(
        role = "user",
        content = "Translate the following Markdown file (${request.fileName}). Respond only with translated Markdown.\n\n${request.documentText}",
      ),
    )

    val payload = ChatRequest(
      model = request.config.model,
      messages = messages,
      temperature = 0.2,
      top_p = 1.0,
      response_format = ResponseFormat(type = "text"),
    )

    val body = gson.toJson(payload).toRequestBody(mediaType)
    val httpClient = baseClient.newBuilder()
      .callTimeout(request.config.timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      .build()

    val requestBuilder = Request.Builder()
      .url(endpoint)
      .post(body)
      .header("Content-Type", "application/json")
      .header("Authorization", "Bearer ${request.config.apiKey}")
      .header("api-key", request.config.apiKey)

    val start = System.currentTimeMillis()

    val response = try {
      httpClient.newCall(requestBuilder.build()).execute()
    } catch (error: SocketTimeoutException) {
      throw TranslationProviderException(
        "Translation request timed out.",
        TranslationErrorCode.TIMEOUT,
        retryable = true,
        cause = error,
      )
    } catch (error: IOException) {
      throw TranslationProviderException(
        "Translation request failed due to a network error.",
        TranslationErrorCode.NETWORK,
        retryable = true,
        cause = error,
      )
    } catch (error: Exception) {
      throw TranslationProviderException(
        "Translation request failed due to an unknown error.",
        TranslationErrorCode.UNKNOWN,
        retryable = false,
        cause = error,
      )
    }

    response.use { httpResponse ->
      if (!httpResponse.isSuccessful) {
        val status = httpResponse.code
        val errorBody = httpResponse.body?.string()?.trim().orEmpty()
        val mapping = mapStatusToError(status)
        throw TranslationProviderException(
          "Translation API responded with $status: ${if (errorBody.isBlank()) "No body" else errorBody}.",
          mapping.first,
          status = status,
          retryable = mapping.second,
        )
      }

      val responseBody = httpResponse.body?.string().orEmpty()
      val parsed = gson.fromJson(responseBody, OpenAIResponse::class.java)
      val content = parsed.choices?.firstOrNull()?.message?.content?.trim().orEmpty()

      if (content.isEmpty()) {
        throw TranslationProviderException(
          "Translation API returned an empty response.",
          TranslationErrorCode.INVALID_RESPONSE,
          retryable = false,
        )
      }

      val latency = System.currentTimeMillis() - start
      val providerId = parsed.model?.ifEmpty { null } ?: request.config.model

      return RawTranslationResult(
        markdown = content,
        providerId = providerId,
        latencyMs = latency,
      )
    }
  }

  private fun buildEndpointUrl(apiBaseUrl: String): String {
    val trimmed = apiBaseUrl.trim().trimEnd('/')
    return if (trimmed.endsWith("/chat/completions", ignoreCase = true)) {
      trimmed
    } else {
      "$trimmed/chat/completions"
    }
  }

  private fun interpolateInstructions(template: String, targetLanguage: String, fileName: String): String {
    return template
      .replace("{{targetLanguage}}", targetLanguage)
      .replace("{{fileName}}", fileName)
  }

  private fun mapStatusToError(status: Int): Pair<TranslationErrorCode, Boolean> {
    return when (status) {
      401, 403 -> TranslationErrorCode.AUTHENTICATION to false
      408, 504 -> TranslationErrorCode.TIMEOUT to true
      429 -> TranslationErrorCode.RATE_LIMIT to true
      in 500..599 -> TranslationErrorCode.SERVER to true
      else -> TranslationErrorCode.UNKNOWN to false
    }
  }

  private data class ChatRequest(
    val model: String,
    val messages: List<ChatMessage>,
    val temperature: Double,
    val top_p: Double,
    val response_format: ResponseFormat,
  )

  private data class ChatMessage(
    val role: String,
    val content: String,
  )

  private data class ResponseFormat(
    val type: String,
  )

  private data class OpenAIResponse(
    val model: String?,
    val choices: List<Choice>?,
  )

  private data class Choice(
    val message: Message?,
  )

  private data class Message(
    val content: String?,
  )
}

data class TranslateRequest(
  val documentText: String,
  val fileName: String,
  val documentLabel: String,
  val config: ResolvedTranslationConfig,
  val prompt: TranslationPrompt,
)
