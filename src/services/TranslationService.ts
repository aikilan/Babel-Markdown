import * as vscode from 'vscode';

import type { ExtensionConfiguration } from '../types/config';
import type { ResolvedTranslationConfiguration, TranslationResult } from '../types/translation';
import { escapeHtml } from '../utils/text';
import { ExtensionLogger } from '../utils/logger';

export interface TranslationRequestContext {
  document: vscode.TextDocument;
  configuration: ExtensionConfiguration;
  resolvedConfig: ResolvedTranslationConfiguration;
  signal?: AbortSignal;
}

export class TranslationService {
  constructor(private readonly logger: ExtensionLogger) {}

  async translateDocument(context: TranslationRequestContext): Promise<TranslationResult> {
    this.logger.info(
      `Translating ${vscode.workspace.asRelativePath(context.document.uri)} to ${context.resolvedConfig.targetLanguage} with model ${context.resolvedConfig.model}.`,
    );

    if (context.signal?.aborted) {
      throw new vscode.CancellationError();
    }

    // Placeholder implementation until OpenAI integration lands.
    const text = context.document.getText();
    await this.delay(150);

    if (context.signal?.aborted) {
      throw new vscode.CancellationError();
    }

    const escaped = escapeHtml(text);
    const markdown = `> **Translated preview (${context.resolvedConfig.targetLanguage})**  \
> Model: ${context.resolvedConfig.model}\n\n${escaped}`;

    return {
      markdown,
      providerId: 'mock-openai',
      latencyMs: 150,
    };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
