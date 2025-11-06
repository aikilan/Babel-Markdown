import * as vscode from 'vscode';

import type { RawTranslationResult, ResolvedTranslationConfiguration } from '../types/translation';
import { delay } from '../utils/async';
import { ExtensionLogger } from '../utils/logger';

export interface TranslateRequest {
  documentText: string;
  fileName: string;
  resolvedConfig: ResolvedTranslationConfiguration;
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

export class OpenAITranslationClient {
  constructor(private readonly logger: ExtensionLogger, private readonly maxRetries = 2) {}

  async translate(request: TranslateRequest): Promise<RawTranslationResult> {
  const { resolvedConfig, documentText, fileName, signal } = request;
  const url = this.buildEndpointUrl(resolvedConfig.apiBaseUrl);
    const prompt = this.buildPrompt(documentText, resolvedConfig.targetLanguage, fileName);

    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), resolvedConfig.timeoutMs);
      const combinedSignal = this.combineSignals(signal, controller.signal);

      const started = Date.now();

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolvedConfig.apiKey}`,
            'api-key': resolvedConfig.apiKey,
          },
          body: JSON.stringify({
            model: resolvedConfig.model,
            messages: prompt,
            temperature: 0.2,
            top_p: 1,
            response_format: { type: 'text' },
          }),
          signal: combinedSignal ?? controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await this.safeReadBody(response);
          throw new Error(
            `Translation API responded with ${response.status}: ${errorBody ?? 'No body'}.`,
          );
        }

        const body = (await response.json()) as OpenAIResponseChunk;
        const message = body.choices?.[0]?.message?.content;

        if (!message) {
          throw new Error('Translation API returned an empty response.');
        }

        const latency = Date.now() - started;

        return {
          markdown: message,
          providerId: body.model || resolvedConfig.model,
          latencyMs: latency,
        };
      } catch (error) {
        if (combinedSignal?.aborted || controller.signal.aborted) {
          throw new vscode.CancellationError();
        }

        clearTimeout(timeoutId);

        lastError = error;
        attempt += 1;

        if (attempt > this.maxRetries) {
          break;
        }

        const delayMs = this.calculateBackoff(attempt);
        this.logger.warn(`Translation attempt ${attempt} failed. Retrying in ${delayMs}ms.`);
        await delay(delayMs);
      }
    }

    this.logger.error('Exhausted translation retries.', lastError);
    throw lastError instanceof Error ? lastError : new Error('Translation failed.');
  }

  private buildPrompt(
    markdown: string,
    targetLanguage: string,
    fileName: string,
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const systemPrompt = `You are an expert technical translator. Translate Markdown documents into ${targetLanguage} while preserving the original Markdown structure, code blocks, inline formatting, tables, and metadata. Do not add commentary.`;

    const userPrompt = `Translate the following Markdown file (${fileName}). Respond only with translated Markdown.

${markdown}`;

    return [
      { role: 'system', content: systemPrompt },
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

  private combineSignals(signalA?: AbortSignal, signalB?: AbortSignal): AbortSignal | undefined {
    if (!signalA) {
      return signalB;
    }

    if (!signalB) {
      return signalA;
    }

    if ((signalA as any).addEventListener && (signalB as any).addEventListener) {
      const controller = new AbortController();
      const abort = () => controller.abort();

      if (signalA.aborted || signalB.aborted) {
        controller.abort();
      } else {
        signalA.addEventListener('abort', abort);
        signalB.addEventListener('abort', abort);
      }

      return controller.signal;
    }

    return signalA;
  }

  private async safeReadBody(response: Response): Promise<string | undefined> {
    try {
      return await response.text();
    } catch (error) {
  this.logger.warn('Failed to read error response body.');
      return undefined;
    }
  }

  private calculateBackoff(attempt: number): number {
    const base = 300;
    const max = 2000;
    const jitter = Math.random() * 100;
    return Math.min(base * Math.pow(2, attempt - 1) + jitter, max);
  }
}
