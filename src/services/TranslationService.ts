import * as vscode from 'vscode';

import type { ExtensionConfiguration } from '../types/config';
import type {
  RawTranslationResult,
  ResolvedTranslationConfiguration,
  TranslationResult,
} from '../types/translation';
import { OpenAITranslationClient } from './OpenAITranslationClient';
import { ExtensionLogger } from '../utils/logger';
import { renderMarkdownToHtml } from '../utils/markdown';

export interface TranslationRequestContext {
  document: vscode.TextDocument;
  configuration: ExtensionConfiguration;
  resolvedConfig: ResolvedTranslationConfiguration;
  signal?: AbortSignal;
}

export interface TranslationSegmentUpdate {
  segmentIndex: number;
  totalSegments: number;
  markdown: string;
  html: string;
  latencyMs: number;
  providerId: string;
}

export interface TranslationHandlers {
  onPlan?: (segments: string[]) => void;
  onSegment?: (update: TranslationSegmentUpdate) => void;
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
    const executeWithConcurrency = async (limit: number): Promise<RawTranslationResult> =>
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

        this.logger.error('Translation service failed.', error);
        throw error instanceof Error ? error : new Error(String(error));
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

      if (!context.configuration.translation.parallelismFallbackEnabled) {
        this.logger.error('Translation service failed.', error);
        throw error instanceof Error ? error : new Error(String(error));
      }

      this.logger.warn(
        `Parallel translation failed for ${relativePath}; retrying serially.`,
      );
      this.logger.event('translation.parallelFallback', {
        documentPath: relativePath,
        targetLanguage: context.resolvedConfig.targetLanguage,
        attemptedConcurrency: concurrencyLimit,
        error: error instanceof Error ? error.message : String(error),
      });

      return runSerial();
    }
  }

  private composeResult(result: RawTranslationResult): TranslationResult {
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
  ): Promise<RawTranslationResult> {
    const totalSegments = segments.length;
    if (totalSegments === 0) {
      return {
        markdown: '',
        providerId: context.resolvedConfig.model,
        latencyMs: 0,
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
      }
    >();
    let aggregateLatency = 0;
    let providerId: string | undefined;
    let nextIndex = 0;
    let flushIndex = 0;
    let capturedError: unknown;

    const takeNextIndex = (): number | undefined => {
      if (capturedError) {
        return undefined;
      }

      if (nextIndex >= totalSegments) {
        return undefined;
      }

      const index = nextIndex;
      nextIndex += 1;
      return index;
    };

    const flush = () => {
      while (pending.has(flushIndex)) {
        const entry = pending.get(flushIndex)!;
        pending.delete(flushIndex);

        combinedMarkdown[flushIndex] = entry.markdown.trimEnd();
        aggregateLatency += entry.latencyMs;
        providerId = entry.providerId;

        handlers?.onSegment?.({
          segmentIndex: flushIndex,
          totalSegments,
          markdown: entry.markdown,
          html: entry.html,
          latencyMs: entry.latencyMs,
          providerId: entry.providerId,
        });

        flushIndex += 1;
      }
    };

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
          if (context.signal?.aborted) {
            throw new vscode.CancellationError();
          }

          const segment = segments[index];
          const segmentResult = await this.openAIClient.translate({
            documentText: segment,
            fileName: `${options.relativePath}#segment-${index + 1}`,
            resolvedConfig: context.resolvedConfig,
            signal: context.signal,
          });

          if (context.signal?.aborted) {
            throw new vscode.CancellationError();
          }

          pending.set(index, {
            markdown: segmentResult.markdown,
            html: renderMarkdownToHtml(segmentResult.markdown),
            latencyMs: segmentResult.latencyMs,
            providerId: segmentResult.providerId,
          });

          flush();
        } catch (error) {
          capturedError = error;
          return;
        }
      }
    };

    const workers = Array.from({ length: effectiveConcurrency }, () => worker());
    await Promise.all(workers);

    if (capturedError) {
      throw capturedError;
    }

    flush();

    const markdown = combinedMarkdown.map((chunk) => chunk ?? '').join('\n\n');
    return {
      markdown,
      providerId: providerId ?? context.resolvedConfig.model,
      latencyMs: aggregateLatency,
    };
  }
}
