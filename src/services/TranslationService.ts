import * as vscode from 'vscode';

import type { ExtensionConfiguration } from '../types/config';
import type {
  RawTranslationResult,
  ResolvedTranslationConfiguration,
  TranslationResult,
  TranslationRecovery,
  TranslationErrorCode,
} from '../types/translation';
import { OpenAITranslationClient, TranslationProviderError } from './OpenAITranslationClient';
import { TranslationCache } from './TranslationCache';
import { ExtensionLogger } from '../utils/logger';
import { renderMarkdownToHtml } from '../utils/markdown';
import { delay } from '../utils/async';

export interface TranslationRequestContext {
  document: vscode.TextDocument;
  configuration: ExtensionConfiguration;
  resolvedConfig: ResolvedTranslationConfiguration;
  signal?: AbortSignal;
  cache?: TranslationCache;
}

export interface TranslationSegmentUpdate {
  segmentIndex: number;
  totalSegments: number;
  markdown: string;
  html: string;
  latencyMs: number;
  providerId: string;
  wasCached: boolean;
  recovery?: TranslationSegmentRecovery;
}

export interface TranslationSegmentRecovery {
  type: 'cacheFallback' | 'placeholder';
  code: TranslationErrorCode;
  attempts: number;
  message: string;
}

type SegmentProcessingOutcome =
  | {
      kind: 'success';
      result: RawTranslationResult;
      shouldCache: boolean;
    }
  | {
      kind: 'recovered';
      result: RawTranslationResult;
      recovery: TranslationSegmentRecovery;
      shouldCache: boolean;
    }
  | {
      kind: 'failed';
      error: TranslationProviderError;
    };

export interface TranslationHandlers {
  onPlan?: (segments: string[]) => void;
  onSegment?: (update: TranslationSegmentUpdate) => void;
}

export class TranslationRunError extends Error {
  constructor(
    message: string,
    public readonly code: TranslationErrorCode,
    public readonly segmentIndex?: number,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = 'TranslationRunError';

    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TranslationRunError);
    }
  }
}

export class TranslationService {
  private static readonly ADAPTIVE_TARGET_LENGTH = 500;
  private static readonly ADAPTIVE_MAX_LENGTH = 1400;

  constructor(
    private readonly logger: ExtensionLogger,
    private readonly openAIClient: OpenAITranslationClient,
  ) {}

  async translateDocument(
    context: TranslationRequestContext,
    handlers?: TranslationHandlers,
  ): Promise<TranslationResult> {
    const relativePath = vscode.workspace.asRelativePath(context.document.uri);

    this.logger.info(
      `Translating ${relativePath} to ${context.resolvedConfig.targetLanguage} with model ${context.resolvedConfig.model}.`,
    );

    if (context.signal?.aborted) {
      throw new vscode.CancellationError();
    }

    const text = context.document.getText();

    if (!text.trim()) {
      return this.composeResult({
        markdown: '_The source document is empty; nothing to translate._',
        providerId: 'noop',
        latencyMs: 0,
      });
    }

    const plan = this.planSegments(text, {
      adaptive: context.configuration.translation.adaptiveBatchingEnabled,
    });
    const segments = plan.segments;
    const concurrencyLimit = this.normalizeConcurrencyLimit(
      context.configuration.translation.concurrencyLimit,
      segments.length,
    );

    if (context.configuration.translation.segmentMetricsLoggingEnabled) {
      this.logger.event('translation.segmentPlan', {
        documentPath: relativePath,
        totalSegments: plan.metrics.totalSegments,
        averageLength: plan.metrics.averageLength,
        minLength: plan.metrics.minLength,
        maxLength: plan.metrics.maxLength,
        strategy: plan.strategy,
        documentCharacters: plan.metrics.documentCharacters,
        baseSegments: plan.metrics.baseSegments,
        concurrencyLimit,
        parallelEnabled: concurrencyLimit > 1,
        parallelFallbackEnabled: context.configuration.translation.parallelismFallbackEnabled,
      });
    }

    if (segments.length === 0) {
      return this.composeResult({
        markdown: '_The source document is empty; nothing to translate._',
        providerId: 'noop',
        latencyMs: 0,
      });
    }

    handlers?.onPlan?.([...segments]);
    const executeWithConcurrency = async (
      limit: number,
    ): Promise<RawTranslationResult & { recoveries: TranslationRecovery[] }> =>
      this.executeSegments(segments, context, handlers, {
        concurrency: limit,
        relativePath,
      });

    const runSerial = async (): Promise<TranslationResult> => {
      try {
        const result = await executeWithConcurrency(1);
        return this.composeResult(result);
      } catch (error) {
        if (error instanceof vscode.CancellationError) {
          throw error;
        }

        const runError = this.ensureRunError(error);
        this.logger.error('Translation service failed.', runError);
        throw runError;
      }
    };

    if (concurrencyLimit <= 1) {
      return runSerial();
    }

    try {
      const result = await executeWithConcurrency(concurrencyLimit);
      return this.composeResult(result);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }

      const runError = this.ensureRunError(error);

      if (
        !context.configuration.translation.parallelismFallbackEnabled ||
        this.isFatalCode(runError.code)
      ) {
        this.logger.error('Translation service failed.', runError);
        throw runError;
      }

      this.logger.warn(
        `Parallel translation failed for ${relativePath}; retrying serially.`,
      );
      this.logger.event('translation.parallelFallback', {
        documentPath: relativePath,
        targetLanguage: context.resolvedConfig.targetLanguage,
        attemptedConcurrency: concurrencyLimit,
        error: runError.message,
        errorCode: runError.code,
        segmentIndex: runError.segmentIndex ?? null,
      });

      return runSerial();
    }
  }

  private composeResult(
    result: RawTranslationResult & { recoveries?: TranslationRecovery[] },
  ): TranslationResult {
    return {
      ...result,
      html: renderMarkdownToHtml(result.markdown),
    };
  }

  private splitIntoSegments(markdown: string): string[] {
    const lines = markdown.split(/\r?\n/);
    const segments: string[] = [];
    let buffer: string[] = [];
    let inFence = false;

    const flush = () => {
      if (buffer.length > 0) {
        segments.push(buffer.join('\n'));
        buffer = [];
      }
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        buffer.push(line);
        inFence = !inFence;
        continue;
      }

      if (!inFence && trimmed === '') {
        flush();
        continue;
      }

      buffer.push(line);
    }

    flush();

    if (segments.length === 0 && markdown.trim().length > 0) {
      return [markdown];
    }

    return segments;
  }

  private planSegments(
    markdown: string,
    options: { adaptive: boolean },
  ): {
    segments: string[];
    strategy: 'basic' | 'adaptive';
    metrics: {
      totalSegments: number;
      averageLength: number;
      minLength: number;
      maxLength: number;
      documentCharacters: number;
      baseSegments: number;
    };
  } {
    const baseSegments = this.splitIntoSegments(markdown);
    const strategy = options.adaptive ? 'adaptive' : 'basic';
    const segments = options.adaptive ? this.mergeSegments(baseSegments) : baseSegments;
    const lengths = segments.map((segment) => segment.length);
    const metrics = {
      totalSegments: segments.length,
      averageLength: lengths.length > 0 ? lengths.reduce((acc, value) => acc + value, 0) / lengths.length : 0,
      minLength: lengths.length > 0 ? Math.min(...lengths) : 0,
      maxLength: lengths.length > 0 ? Math.max(...lengths) : 0,
      documentCharacters: markdown.length,
      baseSegments: baseSegments.length,
    };

    return { segments, strategy, metrics };
  }

  private mergeSegments(segments: string[]): string[] {
    const merged: string[] = [];
    let buffer = '';

    const pushBuffer = () => {
      if (buffer.trim().length > 0) {
        merged.push(buffer);
      }
      buffer = '';
    };

    for (const segment of segments) {
      const trimmedBuffer = buffer.trim();
      const trimmedSegment = segment.trim();

      if (!trimmedBuffer) {
        buffer = segment;
        if (segment.length >= TranslationService.ADAPTIVE_TARGET_LENGTH) {
          pushBuffer();
        }
        continue;
      }

      const candidate = `${buffer}\n\n${segment}`;

      if (candidate.length > TranslationService.ADAPTIVE_MAX_LENGTH) {
        pushBuffer();
        buffer = segment;
        if (segment.length >= TranslationService.ADAPTIVE_TARGET_LENGTH || segment.length > TranslationService.ADAPTIVE_MAX_LENGTH) {
          pushBuffer();
        }
        continue;
      }

      if (candidate.length >= TranslationService.ADAPTIVE_TARGET_LENGTH || trimmedSegment.length === 0) {
        buffer = candidate;
        pushBuffer();
        continue;
      }

      buffer = candidate;
    }

    pushBuffer();

    return merged.length > 0 ? merged : segments;
  }

  private normalizeConcurrencyLimit(requested: number, segmentCount: number): number {
    if (!Number.isFinite(requested) || requested < 1) {
      return 1;
    }

    const normalized = Math.floor(requested);
    const maximum = Math.max(segmentCount, 1);
    return Math.min(Math.max(normalized, 1), maximum);
  }

  private async executeSegments(
    segments: string[],
    context: TranslationRequestContext,
    handlers: TranslationHandlers | undefined,
    options: { concurrency: number; relativePath: string },
  ): Promise<RawTranslationResult & { recoveries: TranslationRecovery[] }> {
    const totalSegments = segments.length;
    if (totalSegments === 0) {
      return {
        markdown: '',
        providerId: context.resolvedConfig.model,
        latencyMs: 0,
        recoveries: [],
      };
    }

    const effectiveConcurrency = this.normalizeConcurrencyLimit(options.concurrency, totalSegments);
    const combinedMarkdown: Array<string | undefined> = new Array(totalSegments);
    const pending = new Map<
      number,
      {
        markdown: string;
        html: string;
        latencyMs: number;
        providerId: string;
        wasCached: boolean;
        recovery?: TranslationSegmentRecovery;
      }
    >();
    let aggregateLatency = 0;
    let providerId: string | undefined;
    let nextIndex = 0;
    let flushIndex = 0;
    const cachedIndices = new Set<number>();
    const recoveries: TranslationRecovery[] = [];
    let capturedError: { error: TranslationProviderError; index: number } | undefined;

    if (context.cache) {
      for (let index = 0; index < totalSegments; index += 1) {
        const segment = segments[index];
        const cached = context.cache.getSegment(context.document, context.resolvedConfig, segment);

        if (!cached) {
          continue;
        }

        cachedIndices.add(index);
        pending.set(index, {
          markdown: cached.markdown,
          html: renderMarkdownToHtml(cached.markdown),
          latencyMs: cached.latencyMs,
          providerId: cached.providerId,
          wasCached: true,
        });
      }
    }

    const takeNextIndex = (): number | undefined => {
      while (nextIndex < totalSegments) {
        if (capturedError) {
          return undefined;
        }

        if (cachedIndices.has(nextIndex)) {
          nextIndex += 1;
          continue;
        }

        const index = nextIndex;
        nextIndex += 1;
        return index;
      }

      return undefined;
    };

    const flush = (): void => {
      while (pending.has(flushIndex)) {
        const entry = pending.get(flushIndex)!;
        pending.delete(flushIndex);

        combinedMarkdown[flushIndex] = entry.markdown.trimEnd();
        aggregateLatency += entry.latencyMs;
        providerId = entry.providerId;

        if (entry.recovery) {
          recoveries.push({
            segmentIndex: flushIndex,
            code: entry.recovery.code,
            type: entry.recovery.type,
            attempts: entry.recovery.attempts,
            message: entry.recovery.message,
          });
        }

        handlers?.onSegment?.({
          segmentIndex: flushIndex,
          totalSegments,
          markdown: entry.markdown,
          html: entry.html,
          latencyMs: entry.latencyMs,
          providerId: entry.providerId,
          wasCached: entry.wasCached,
          recovery: entry.recovery,
        });

        flushIndex += 1;
      }
    };

    flush();

    const remainingSegments = totalSegments - cachedIndices.size;
    if (remainingSegments === 0) {
      const markdown = combinedMarkdown.map((chunk) => chunk ?? '').join('\n\n');
      return {
        markdown,
        providerId: providerId ?? context.resolvedConfig.model,
        latencyMs: aggregateLatency,
        recoveries,
      };
    }

    const maxAttempts = this.normalizeRetryAttempts(
      context.configuration.translation.retryMaxAttempts,
    );

    const worker = async (): Promise<void> => {
      while (true) {
        const index = takeNextIndex();

        if (index === undefined) {
          return;
        }

        if (capturedError) {
          return;
        }

        try {
          const outcome = await this.translateSegmentWithRetries({
            segmentIndex: index,
            totalSegments,
            segmentMarkdown: segments[index],
            context,
            attemptLimit: maxAttempts,
            relativePath: options.relativePath,
          });

          if (outcome.kind === 'failed') {
            capturedError = { error: outcome.error, index };
            return;
          }

          if (outcome.shouldCache) {
            context.cache?.setSegment(
              context.document,
              context.resolvedConfig,
              segments[index],
              outcome.result,
            );
          }

          const wasCached =
            outcome.kind === 'recovered' && outcome.recovery.type === 'cacheFallback';

          pending.set(index, {
            markdown: outcome.result.markdown,
            html: renderMarkdownToHtml(outcome.result.markdown),
            latencyMs: outcome.result.latencyMs,
            providerId: outcome.result.providerId,
            wasCached,
            recovery: outcome.kind === 'recovered' ? outcome.recovery : undefined,
          });

          flush();
        } catch (error) {
          if (error instanceof vscode.CancellationError) {
            throw error;
          }

          capturedError = { error: this.ensureProviderError(error), index };
          return;
        }
      }
    };

    const workers = Array.from(
      { length: Math.min(effectiveConcurrency, remainingSegments) },
      () => worker(),
    );
    await Promise.all(workers);

    if (capturedError) {
      const sanitized = this.sanitizeErrorMessage(capturedError.error.message);
      throw new TranslationRunError(sanitized, capturedError.error.code, capturedError.index, {
        cause: capturedError.error,
      });
    }

    flush();

    const markdown = combinedMarkdown.map((chunk) => chunk ?? '').join('\n\n');
    return {
      markdown,
      providerId: providerId ?? context.resolvedConfig.model,
      latencyMs: aggregateLatency,
      recoveries,
    };
  }

  private async translateSegmentWithRetries(params: {
    segmentIndex: number;
    totalSegments: number;
    segmentMarkdown: string;
    context: TranslationRequestContext;
    attemptLimit: number;
    relativePath: string;
  }): Promise<SegmentProcessingOutcome> {
    const {
      segmentIndex,
      totalSegments,
      segmentMarkdown,
      context,
      attemptLimit,
      relativePath,
    } = params;

    const maxAttempts = Math.max(attemptLimit, 1);
    let attempt = 0;
    let lastError: TranslationProviderError | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;

      if (context.signal?.aborted) {
        throw new vscode.CancellationError();
      }

      try {
        const result = await this.openAIClient.translate({
          documentText: segmentMarkdown,
          fileName: `${relativePath}#segment-${segmentIndex + 1}`,
          resolvedConfig: context.resolvedConfig,
          signal: context.signal,
        });

        return {
          kind: 'success',
          result,
          shouldCache: true,
        };
      } catch (error) {
        if (error instanceof vscode.CancellationError) {
          throw error;
        }

        const providerError = this.ensureProviderError(error);
        lastError = providerError;

        if (this.isFatalCode(providerError.code)) {
          return { kind: 'failed', error: providerError };
        }

        if (providerError.retryable && attempt < maxAttempts) {
          const delayMs = this.calculateRetryDelay(attempt);
          this.logger.warn(
            `Segment ${segmentIndex + 1}/${totalSegments} failed (${providerError.code}). Retrying in ${delayMs}ms.`,
          );
          await delay(delayMs);
          continue;
        }

        break;
      }
    }

    if (!lastError) {
      lastError = new TranslationProviderError('Translation failed.', {
        code: 'unknown',
        retryable: false,
      });
    }

    if (this.isFatalCode(lastError.code)) {
      return { kind: 'failed', error: lastError };
    }

    const recovery = this.tryRecoverSegment({
      context,
      segmentMarkdown,
      segmentIndex,
      totalSegments,
      error: lastError,
      attempts: Math.max(attempt, 1),
      relativePath,
    });

    if (recovery) {
      return {
        kind: 'recovered',
        result: recovery.result,
        recovery: recovery.recovery,
        shouldCache: false,
      };
    }

    return { kind: 'failed', error: lastError };
  }

  private normalizeRetryAttempts(value: number): number {
    if (!Number.isFinite(value)) {
      return 1;
    }

    const normalized = Math.floor(value);
    return Math.max(1, Math.min(normalized, 6));
  }

  private calculateRetryDelay(attempt: number): number {
    const base = 250;
    const max = 2000;
    const jitter = Math.random() * 100;
    return Math.min(base * Math.pow(2, attempt - 1) + jitter, max);
  }

  private ensureProviderError(error: unknown): TranslationProviderError {
    if (error instanceof TranslationProviderError) {
      return error;
    }

    if (error instanceof TranslationRunError) {
      return new TranslationProviderError(error.message, {
        code: error.code,
        retryable: false,
        cause: error,
      });
    }

    if (error instanceof Error) {
      return new TranslationProviderError(error.message || 'Translation failed.', {
        code: 'unknown',
        retryable: false,
        cause: error,
      });
    }

    return new TranslationProviderError('Translation failed.', {
      code: 'unknown',
      retryable: false,
      cause: error,
    });
  }

  private ensureRunError(error: unknown): TranslationRunError {
    if (error instanceof TranslationRunError) {
      return error;
    }

    const providerError = this.ensureProviderError(error);
    const message = this.sanitizeErrorMessage(providerError.message);

    return new TranslationRunError(message, providerError.code, undefined, {
      cause: providerError,
    });
  }

  private isFatalCode(code: TranslationErrorCode): boolean {
    return code === 'authentication';
  }

  private tryRecoverSegment(params: {
    context: TranslationRequestContext;
    segmentMarkdown: string;
    segmentIndex: number;
    totalSegments: number;
    error: TranslationProviderError;
    attempts: number;
    relativePath: string;
  }):
    | {
        result: RawTranslationResult;
        recovery: TranslationSegmentRecovery;
      }
    | undefined {
    const { context, segmentMarkdown, segmentIndex, totalSegments, error, attempts, relativePath } = params;
    const sanitizedMessage = this.sanitizeErrorMessage(error.message);

    const cached = context.cache?.getSegment(
      context.document,
      context.resolvedConfig,
      segmentMarkdown,
    );

    if (cached) {
      this.logger.warn(
        `Segment ${segmentIndex + 1}/${totalSegments} failed after ${attempts} attempt(s); reused cached translation.`,
      );
      this.logger.event('translation.segmentRecovery', {
        documentPath: relativePath,
        segmentIndex,
        totalSegments,
        strategy: 'cacheFallback',
        attempts,
        errorCode: error.code,
      });

      return {
        result: {
          markdown: cached.markdown,
          providerId: cached.providerId,
          latencyMs: cached.latencyMs,
        },
        recovery: {
          type: 'cacheFallback',
          code: error.code,
          attempts,
          message: sanitizedMessage,
        },
      };
    }

    this.logger.warn(
      `Segment ${segmentIndex + 1}/${totalSegments} failed after ${attempts} attempt(s); emitting placeholder content.`,
    );
    this.logger.event('translation.segmentRecovery', {
      documentPath: relativePath,
      segmentIndex,
      totalSegments,
      strategy: 'placeholder',
      attempts,
      errorCode: error.code,
    });

    const placeholderMarkdown = this.buildPlaceholderSegment(error, segmentMarkdown);

    return {
      result: {
        markdown: placeholderMarkdown,
        providerId: context.resolvedConfig.model,
        latencyMs: 0,
      },
      recovery: {
        type: 'placeholder',
        code: error.code,
        attempts,
        message: sanitizedMessage,
      },
    };
  }

  private buildPlaceholderSegment(error: TranslationProviderError, segmentMarkdown: string): string {
    const sanitizedMessage = this.sanitizeErrorMessage(error.message);
    const headerLines = [
      `> Translation failed (${error.code}). Showing original text instead.`,
    ];

    if (sanitizedMessage) {
      headerLines.push(`> ${sanitizedMessage}`);
    }

    const header = headerLines.join('\n');
    const body = segmentMarkdown.trim().length > 0 ? `\n\n${segmentMarkdown}` : '';
    return `${header}${body}`;
  }

  private sanitizeErrorMessage(message: string): string {
    const normalized = message.replace(/\s+/g, ' ').trim();

    if (normalized.length > 180) {
      return `${normalized.slice(0, 177)}...`;
    }

    return normalized;
  }
}
