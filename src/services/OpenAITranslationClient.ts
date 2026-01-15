import * as vscode from 'vscode';

import type {
  RawTranslationResult,
  ResolvedTranslationConfiguration,
  TranslationErrorCode,
  TranslationPrompt,
} from '../types/translation';
import { ExtensionLogger } from '../utils/logger';

export interface TranslateRequest {
  documentText: string;
  fileName: string;
  documentLabel: string;
  resolvedConfig: ResolvedTranslationConfiguration;
  prompt: TranslationPrompt;
  signal?: AbortSignal;
}

interface OpenAIResponseChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  choices: Array<{
    index: number;
    finish_reason: string | null;
    message: {
      role: 'assistant';
      content: string;
    };
  }>;
}

export type TranslationProviderErrorCode = TranslationErrorCode;

export class TranslationProviderError extends Error {
  readonly code: TranslationProviderErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code: TranslationProviderErrorCode; status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'TranslationProviderError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;

    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TranslationProviderError);
    }
  }
}

export class OpenAITranslationClient {
  constructor(private readonly logger: ExtensionLogger) {}

  async translate(request: TranslateRequest): Promise<RawTranslationResult> {
    const { resolvedConfig, documentText, fileName, documentLabel, prompt, signal } = request;
    const url = this.buildEndpointUrl(resolvedConfig.apiBaseUrl);
    const instructions = this.interpolateInstructions(prompt.instructions, {
      targetLanguage: resolvedConfig.targetLanguage,
      fileName: documentLabel,
    });
    const messages = this.buildPrompt({
      instructions,
      markdown: documentText,
      fileName,
    });
    const payload = {
      model: resolvedConfig.model,
      messages,
      temperature: 0.2,
      top_p: 1,
      response_format: { type: 'text' },
    };
    const payloadJson = JSON.stringify(payload);
    this.logger.info(`Translation request payload: ${payloadJson}`);

    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;
    let timedOut = false;

    if (signal?.aborted) {
      throw new vscode.CancellationError();
    }

    const abortFromUpstream = (): void => {
      controller.abort();
    };

    signal?.addEventListener('abort', abortFromUpstream, { once: true });

    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, resolvedConfig.timeoutMs);

    const started = Date.now();

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedConfig.apiKey}`,
          'api-key': resolvedConfig.apiKey,
        },
        body: payloadJson,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await this.safeReadBody(response);
        const status = response.status;
        const { code, retryable } = this.mapStatusToError(status);
        throw new TranslationProviderError(
          `Translation API responded with ${status}: ${errorBody ?? 'No body'}.`,
          {
            code,
            status,
            retryable,
          },
        );
      }

      const body = (await response.json()) as OpenAIResponseChunk;
      const message = body.choices?.[0]?.message?.content;

      if (!message) {
        throw new TranslationProviderError('Translation API returned an empty response.', {
          code: 'invalidResponse',
          retryable: false,
        });
      }

      const latency = Date.now() - started;

      return {
        markdown: message,
        providerId: body.model || resolvedConfig.model,
        latencyMs: latency,
      };
    } catch (error) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (signal?.aborted && !timedOut) {
        throw new vscode.CancellationError();
      }

      if (controller.signal.aborted && timedOut) {
        throw new TranslationProviderError('Translation request timed out.', {
          code: 'timeout',
          retryable: true,
          cause: error,
        });
      }

      if (error instanceof vscode.CancellationError) {
        throw error;
      }

      if (error instanceof TranslationProviderError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new vscode.CancellationError();
      }

      if (error instanceof Error) {
        throw this.normalizeError(error);
      }

      throw new TranslationProviderError('Translation failed due to an unknown error.', {
        code: 'unknown',
        retryable: false,
        cause: error,
      });
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (signal) {
        signal.removeEventListener('abort', abortFromUpstream);
      }
    }
  }

  private buildPrompt(params: {
    instructions: string;
    markdown: string;
    fileName: string;
  }): Array<{ role: 'system' | 'user'; content: string }> {
    const userPrompt = `Translate the following Markdown file (${params.fileName}). Respond only with translated Markdown.

${params.markdown}`;

    return [
      { role: 'system', content: params.instructions.trim() },
      { role: 'user', content: userPrompt },
    ];
  }

  private buildEndpointUrl(apiBaseUrl: string): string {
    const trimmed = apiBaseUrl.replace(/\/+$/, '');

    if (/\/chat\/completions$/i.test(trimmed)) {
      return trimmed;
    }

    return `${trimmed}/chat/completions`;
  }

  private async safeReadBody(response: Response): Promise<string | undefined> {
    try {
      return await response.text();
    } catch (error) {
      this.logger.warn('Failed to read error response body.');
      return undefined;
    }
  }

  private interpolateInstructions(
    template: string,
    values: { targetLanguage: string; fileName: string },
  ): string {
    const replace = (needle: string, replacement: string): ((value: string) => string) => {
      const pattern = new RegExp(`{{\\s*${needle}\\s*}}`, 'gi');
      return (value: string) => value.replace(pattern, () => replacement);
    };

    const withTargetLanguage = replace('targetLanguage', values.targetLanguage)(template);
    return replace('fileName', values.fileName)(withTargetLanguage).trim();
  }

  private normalizeError(error: Error): TranslationProviderError {
    const message = error.message || 'Translation failed.';
    const normalized = message.toLowerCase();

    if (
      normalized.includes('etimedout') ||
      normalized.includes('timeout') ||
      normalized.includes('timed out')
    ) {
      return new TranslationProviderError(message, {
        code: 'timeout',
        retryable: true,
        cause: error,
      });
    }

    if (
      normalized.includes('econnrefused') ||
      normalized.includes('econnreset') ||
      normalized.includes('enotfound') ||
      normalized.includes('network') ||
      normalized.includes('fetch failed') ||
      normalized.includes('socket hang up')
    ) {
      return new TranslationProviderError(message, {
        code: 'network',
        retryable: true,
        cause: error,
      });
    }

    return new TranslationProviderError(message, {
      code: 'unknown',
      retryable: false,
      cause: error,
    });
  }

  private mapStatusToError(status: number): { code: TranslationProviderErrorCode; retryable: boolean } {
    if (status === 401 || status === 403) {
      return { code: 'authentication', retryable: false };
    }

    if (status === 408) {
      return { code: 'timeout', retryable: true };
    }

    if (status === 429) {
      return { code: 'rateLimit', retryable: true };
    }

    if (status >= 500 && status < 600) {
      return { code: 'server', retryable: true };
    }

    return { code: 'unknown', retryable: false };
  }
}
