import * as vscode from 'vscode';

import { EditorExportService } from '../services/EditorExportService';
import { ExtensionLogger } from '../utils/logger';
import { localize } from '../i18n/localize';

type ExportFormat = 'png' | 'pdf';

export function createExportMarkdownCommand(
  editorExportService: EditorExportService,
  logger: ExtensionLogger,
  format: ExportFormat,
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
      await editorExportService.exportActiveEditor(format);
    } catch (error) {
      logger.error('Failed to export markdown preview.', error);
      void vscode.window.showErrorMessage(localize('export.failure.generic'));
    }
  };
}
