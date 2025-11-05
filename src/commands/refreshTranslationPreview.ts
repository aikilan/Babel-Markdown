import * as vscode from 'vscode';

import { TranslationPreviewManager } from '../panel/TranslationPreviewManager';
import { SecretStorageService } from '../services/SecretStorageService';
import type { ResolvedTranslationConfiguration } from '../types/translation';
import { getExtensionConfiguration } from '../utils/config';
import { ExtensionLogger } from '../utils/logger';

export function createRefreshTranslationPreviewCommand(
  previewManager: TranslationPreviewManager,
  secretService: SecretStorageService,
  logger: ExtensionLogger,
): () => Promise<void> {
  return async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      void vscode.window.showWarningMessage('No active Markdown document to refresh.');
      return;
    }

    if (editor.document.languageId !== 'markdown') {
      void vscode.window.showWarningMessage('Translation preview is only available for Markdown files.');
      return;
    }

    const configuration = getExtensionConfiguration(editor.document);
    const secretKey = await secretService.getTranslationApiKey();
    const configKey = configuration.translation.apiKey;
    const apiKey = secretKey ?? configKey;

    if (!apiKey) {
      void vscode.window.showWarningMessage(
        'Translation API key not set. Run "Babel MD Viewer: Set Translation API Key" first.',
      );
      return;
    }

    const resolvedConfig: ResolvedTranslationConfiguration = {
      apiBaseUrl: configuration.translation.apiBaseUrl,
      apiKey,
      model: configuration.translation.model,
      targetLanguage: configuration.translation.targetLanguage,
      timeoutMs: configuration.translation.timeoutMs,
    };

    try {
      const refreshed = await previewManager.refreshPreview({
        document: editor.document,
        configuration,
        resolvedConfig,
      });

      if (!refreshed) {
        void vscode.window.showInformationMessage('Open a translation preview before refreshing.');
      }
    } catch (error) {
      logger.error('Failed to refresh translation preview.', error);
      void vscode.window.showErrorMessage('Unable to refresh translation preview. Check logs for details.');
    }
  };
}
