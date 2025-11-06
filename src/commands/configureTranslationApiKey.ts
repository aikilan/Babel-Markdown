import * as vscode from 'vscode';

import { SecretStorageService } from '../services/SecretStorageService';
import { getExtensionConfiguration } from '../utils/config';
import { localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';

export function createConfigureTranslationApiKeyCommand(
  secrets: SecretStorageService,
  logger: ExtensionLogger,
): () => Promise<void> {
  return async () => {
    const configuration = getExtensionConfiguration();
    const existingSecret = await secrets.getTranslationApiKey();
    const hasStoredSecret = Boolean(existingSecret);
    const hasConfigValue = Boolean(configuration.translation.apiKey);

    const input = await vscode.window.showInputBox({
      title: localize('command.configureApiKey.title'),
      prompt: localize('command.configureApiKey.prompt'),
      placeHolder: localize('command.configureApiKey.placeholder'),
      password: true,
      ignoreFocusOut: true,
      value: '',
      validateInput: (value) => {
        if (!value.trim()) {
          return null;
        }

        if (!value.trim().startsWith('sk-')) {
          return localize('command.configureApiKey.validation');
        }

        return null;
      },
    });

    if (input === undefined) {
      logger.info('User cancelled translation API key input.');
      return;
    }

    const trimmed = input.trim();
    const configurationTarget = vscode.ConfigurationTarget.Workspace;
    const configurationSection = vscode.workspace.getConfiguration('babelMdViewer');

    try {
      if (!trimmed) {
        await secrets.clearTranslationApiKey();
        await configurationSection.update('translation.apiKey', undefined, configurationTarget);
        void vscode.window.showInformationMessage(localize('command.configureApiKey.cleared'));
        return;
      }

      await secrets.storeTranslationApiKey(trimmed);

      if (hasConfigValue) {
        await configurationSection.update('translation.apiKey', undefined, configurationTarget);
      }

      void vscode.window.showInformationMessage(localize('command.configureApiKey.stored'));
    } catch (error) {
      logger.error('Failed to persist translation API key.', error);
      void vscode.window.showErrorMessage(localize('command.configureApiKey.storeError'));
      return;
    }

    if (!hasStoredSecret && !hasConfigValue) {
      logger.info('Translation API key saved for the first time.');
    }
  };
}
