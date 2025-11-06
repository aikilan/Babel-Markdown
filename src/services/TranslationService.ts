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

export class TranslationService {
  constructor(
    private readonly logger: ExtensionLogger,
    private readonly openAIClient: OpenAITranslationClient,
  ) {}

  async translateDocument(context: TranslationRequestContext): Promise<TranslationResult> {
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

    try {
      const result = await this.openAIClient.translate({
        documentText: text,
        fileName: relativePath,
        resolvedConfig: context.resolvedConfig,
        signal: context.signal,
      });

      return this.composeResult(result);
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
}
