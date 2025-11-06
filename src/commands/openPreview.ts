import * as vscode from 'vscode';

import { MarkdownPreviewPanel } from '../panel/MarkdownPreviewPanel';
import { ExtensionLogger } from '../utils/logger';
import { localize } from '../i18n/localize';

export function createOpenPreviewCommand(
  previewPanel: MarkdownPreviewPanel,
  logger: ExtensionLogger,
): () => Promise<void> {
  return async () => {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      void vscode.window.showWarningMessage(localize('command.openPreview.noEditor'));
      return;
    }

    if (editor.document.languageId !== 'markdown') {
      void vscode.window.showWarningMessage(localize('command.openPreview.unsupported'));
      return;
    }

    try {
      await previewPanel.show(editor.document);
    } catch (error) {
      logger.error('Failed to open preview panel.', error);
      void vscode.window.showErrorMessage(localize('command.openPreview.failure'));
    }
  };
}
