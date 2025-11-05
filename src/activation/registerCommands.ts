import * as vscode from 'vscode';

import { createOpenPreviewCommand } from '../commands/openPreview';
import { createRefreshPreviewCommand } from '../commands/refreshPreview';
import { createConfigureTranslationApiKeyCommand } from '../commands/configureTranslationApiKey';
import { createOpenTranslationPreviewCommand } from '../commands/openTranslationPreview';
import { createRefreshTranslationPreviewCommand } from '../commands/refreshTranslationPreview';
import { MarkdownPreviewPanel } from '../panel/MarkdownPreviewPanel';
import { TranslationPreviewManager } from '../panel/TranslationPreviewManager';
import { BabelMarkdownService } from '../services/BabelMarkdownService';
import { SecretStorageService } from '../services/SecretStorageService';
import { TranslationService } from '../services/TranslationService';
import { ExtensionLogger } from '../utils/logger';

export function registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  const logger = new ExtensionLogger();
  const service = new BabelMarkdownService(logger);
  const previewPanel = new MarkdownPreviewPanel(context.extensionUri, service, logger);
  const secretStorageService = new SecretStorageService(context.secrets, logger);
  const translationService = new TranslationService(logger);
  const translationPreviewManager = new TranslationPreviewManager(
    context.extensionUri,
    translationService,
    logger,
  );

  context.subscriptions.push(logger, previewPanel, translationPreviewManager);

  return [
    vscode.commands.registerCommand(
      'babelMdViewer.openPreview',
      createOpenPreviewCommand(previewPanel, logger),
    ),
    vscode.commands.registerCommand(
      'babelMdViewer.refreshPreview',
      createRefreshPreviewCommand(previewPanel, logger),
    ),
    vscode.commands.registerCommand(
      'babelMdViewer.openTranslationPreview',
      createOpenTranslationPreviewCommand(translationPreviewManager, secretStorageService, logger),
    ),
    vscode.commands.registerCommand(
      'babelMdViewer.refreshTranslationPreview',
      createRefreshTranslationPreviewCommand(
        translationPreviewManager,
        secretStorageService,
        logger,
      ),
    ),
    vscode.commands.registerCommand(
      'babelMdViewer.configureTranslationApiKey',
      createConfigureTranslationApiKeyCommand(secretStorageService, logger),
    ),
  ];
}
