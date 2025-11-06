import * as vscode from 'vscode';

import { TranslationPreviewManager } from '../panel/TranslationPreviewManager';
import { SecretStorageService } from '../services/SecretStorageService';
import type { ResolvedTranslationConfiguration } from '../types/translation';
import { getExtensionConfiguration } from '../utils/config';
import { localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';

export function createRefreshTranslationPreviewCommand(
  previewManager: TranslationPreviewManager,
  secretService: SecretStorageService,
  logger: ExtensionLogger,
): () => Promise<void> {
  return async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      void vscode.window.showWarningMessage(localize('command.refreshTranslation.noDocument'));
      return;
    }

    if (editor.document.languageId !== 'markdown') {
      void vscode.window.showWarningMessage(localize('command.refreshTranslation.onlyMarkdown'));
      return;
    }

    const configuration = getExtensionConfiguration(editor.document);
    const secretKey = await secretService.getTranslationApiKey();
    const configKey = configuration.translation.apiKey;
    const apiKey = secretKey ?? configKey;

    if (!apiKey) {
      void vscode.window.showWarningMessage(localize('command.openTranslation.missingKey'));
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
        void vscode.window.showInformationMessage(localize('command.refreshTranslation.noPreview'));
      }
    } catch (error) {
      logger.error('Failed to refresh translation preview.', error);
      void vscode.window.showErrorMessage(localize('command.refreshTranslation.failure'));
    }
  };
}
