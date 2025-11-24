import * as vscode from 'vscode';

import { createOpenPreviewCommand } from '../commands/openPreview';
import { createRefreshPreviewCommand } from '../commands/refreshPreview';
import { createConfigureTranslationApiKeyCommand } from '../commands/configureTranslationApiKey';
import { createOpenTranslationPreviewCommand } from '../commands/openTranslationPreview';
import { createRefreshTranslationPreviewCommand } from '../commands/refreshTranslationPreview';
import { MarkdownPreviewPanel } from '../panel/MarkdownPreviewPanel';
import { createExportMarkdownCommand } from '../commands/exportMarkdown';
import { TranslationPreviewManager } from '../panel/TranslationPreviewManager';
import { BabelMarkdownService } from '../services/BabelMarkdownService';
import { SecretStorageService } from '../services/SecretStorageService';
import { OpenAITranslationClient } from '../services/OpenAITranslationClient';
import { TranslationService } from '../services/TranslationService';
import { PromptResolver } from '../services/PromptResolver';
import { ExtensionLogger } from '../utils/logger';
import { MarkdownExportService } from '../services/MarkdownExportService';
import { EditorExportService } from '../services/EditorExportService';

export function registerCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
  const logger = new ExtensionLogger();
  const service = new BabelMarkdownService(logger);
  const exportService = new MarkdownExportService(logger);
  const editorExportService = new EditorExportService(context.extensionUri, exportService, logger);
  const previewPanel = new MarkdownPreviewPanel(
    context.extensionUri,
    service,
    exportService,
    logger,
  );
  const secretStorageService = new SecretStorageService(context.secrets, logger);
  const openAIClient = new OpenAITranslationClient(logger);
  const translationService = new TranslationService(logger, openAIClient);
  const promptResolver = new PromptResolver(logger);
  const translationPreviewManager = new TranslationPreviewManager(
    context.extensionUri,
    translationService,
    promptResolver,
    exportService,
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
    vscode.commands.registerCommand(
      'babelMdViewer.exportMarkdownAsImage',
      createExportMarkdownCommand(editorExportService, logger, 'png'),
    ),
    vscode.commands.registerCommand(
      'babelMdViewer.exportMarkdownAsPdf',
      createExportMarkdownCommand(editorExportService, logger, 'pdf'),
    ),
  ];
}
