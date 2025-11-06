import * as vscode from 'vscode';

import { MarkdownPreviewPanel } from '../panel/MarkdownPreviewPanel';
import { localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';

export function createRefreshPreviewCommand(
  previewPanel: MarkdownPreviewPanel,
  logger: ExtensionLogger,
): () => Promise<void> {
  return async () => {
    try {
      const refreshed = await previewPanel.refresh();

      if (!refreshed) {
        void vscode.window.showInformationMessage(localize('command.refreshPreview.noPreview'));
      }
    } catch (error) {
      logger.error('Failed to refresh preview panel.', error);
      void vscode.window.showErrorMessage(localize('command.refreshPreview.failure'));
    }
  };
}
