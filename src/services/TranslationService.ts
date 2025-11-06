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

export class TranslationService {
  constructor(
    private readonly logger: ExtensionLogger,
    private readonly openAIClient: OpenAITranslationClient,
  ) {}

  async translateDocument(
    context: TranslationRequestContext,
    handlers?: { onSegment?: (update: TranslationSegmentUpdate) => void },
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

    const segments = this.splitIntoSegments(text);

    if (segments.length === 0) {
      return this.composeResult({
        markdown: '_The source document is empty; nothing to translate._',
        providerId: 'noop',
        latencyMs: 0,
      });
    }

    const combinedMarkdown: string[] = [];
    let aggregateLatency = 0;
    let providerId: string | undefined;

    try {
      for (let index = 0; index < segments.length; index += 1) {
        if (context.signal?.aborted) {
          throw new vscode.CancellationError();
        }

        const segment = segments[index];
        const segmentResult = await this.openAIClient.translate({
          documentText: segment,
          fileName: `${relativePath}#segment-${index + 1}`,
          resolvedConfig: context.resolvedConfig,
          signal: context.signal,
        });

  providerId = segmentResult.providerId;
  aggregateLatency += segmentResult.latencyMs;
  combinedMarkdown.push(segmentResult.markdown.trimEnd());

        handlers?.onSegment?.({
          segmentIndex: index,
          totalSegments: segments.length,
          markdown: segmentResult.markdown,
          html: renderMarkdownToHtml(segmentResult.markdown),
          latencyMs: segmentResult.latencyMs,
          providerId: segmentResult.providerId,
        });
      }

      const markdown = combinedMarkdown.join('\n\n');
      const finalResult: RawTranslationResult = {
        markdown,
        providerId: providerId ?? context.resolvedConfig.model,
        latencyMs: aggregateLatency,
      };

      return this.composeResult(finalResult);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        throw error;
      }

      this.logger.error('Translation service failed.', error);

      throw error instanceof Error ? error : new Error(String(error));
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
}
