import * as vscode from 'vscode';
import { basename } from 'path';

import type { ExtensionConfiguration } from '../types/config';
import type { ResolvedTranslationConfiguration } from '../types/translation';
import { TranslationService, TranslationSegmentUpdate } from '../services/TranslationService';
import { TranslationCache } from '../services/TranslationCache';
import { PromptResolver } from '../services/PromptResolver';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../messaging/channel';
import { getWebviewLocaleBundle, localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';
import { MarkdownExportService } from '../services/MarkdownExportService';

interface PreviewEntry {
  panel: vscode.WebviewPanel;
  disposable: vscode.Disposable;
  lastVersion: number;
  context: RenderContext;
}

interface RenderContext {
  document: vscode.TextDocument;
  configuration: ExtensionConfiguration;
  resolvedConfig: ResolvedTranslationConfiguration;
}

type TranslationErrorCategory = 'authentication' | 'timeout' | 'rateLimit' | 'network' | 'unknown';

interface ErrorResolutionAction {
  title: string;
  command: string;
  args?: unknown[];
}

interface ErrorInterpretation {
  hint?: string;
  notification: string;
  category: TranslationErrorCategory;
  actions?: ErrorResolutionAction[];
}

export class TranslationPreviewManager implements vscode.Disposable {
  private readonly previews = new Map<string, PreviewEntry>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly cache = new TranslationCache();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly translationService: TranslationService,
    private readonly promptResolver: PromptResolver,
    private readonly exportService: MarkdownExportService,
    private readonly logger: ExtensionLogger,
  ) {
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        const key = document.uri.toString();
        const preview = this.previews.get(key);
        if (preview) {
          this.cancelPendingTranslation(key, 'source-document-closed', {
            documentPath: this.getDocumentLabel(document),
            targetLanguage: preview.context.resolvedConfig.targetLanguage,
          });
          this.logger.info(`Closing translation preview for ${key} (source document closed).`);
          preview.panel.dispose();
        }
        this.cache.clearForDocument(document);
      }),
    );
  }

  dispose(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();

    for (const preview of this.previews.values()) {
      preview.panel.dispose();
      preview.disposable.dispose();
    }
    this.previews.clear();

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }
  }

  async openPreview(context: RenderContext): Promise<void> {
    const key = context.document.uri.toString();
    const existing = this.previews.get(key);

    if (existing) {
      existing.context = context;
      existing.panel.reveal(undefined, true);
      await this.render(existing.panel, context);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'babelMdViewer.translationPreview',
      this.buildTitle(context.document),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
      },
    );

    panel.webview.html = this.getWebviewHtml(panel.webview);
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'icons', 'preview.svg');
    panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      const previewEntry = this.previews.get(key);

      if (!previewEntry) {
        this.logger.warn('Received webview message for a disposed translation preview.');
        return;
      }

      switch (message.type) {
        case 'log':
          this.logger.info(`[Webview] ${message.payload.level}: ${message.payload.message}`);
          break;
        case 'requestRetry':
          void this.render(previewEntry.panel, previewEntry.context, { force: true, invalidateCache: true });
          break;
        case 'exportContent':
          void this.handleExportRequest(message.payload, previewEntry);
          break;
        default:
          this.logger.warn(`Unhandled message from webview: ${(message as { type: string }).type}`);
          break;
      }
    });

    const disposable = panel.onDidDispose(() => {
      this.logger.info(`Translation preview disposed for ${key}.`);
      const entry = this.previews.get(key);
      if (entry) {
        this.cancelPendingTranslation(key, 'preview-closed', {
          documentPath: this.getDocumentLabel(entry.context.document),
          targetLanguage: entry.context.resolvedConfig.targetLanguage,
        });
      }
      this.previews.delete(key);
      disposable.dispose();
    });

    const entry: PreviewEntry = {
      panel,
      disposable,
      lastVersion: context.document.version,
      context,
    };

    this.previews.set(key, entry);
    await this.render(panel, context, { force: true });
  }

  async refreshPreview(context: RenderContext): Promise<boolean> {
    const key = context.document.uri.toString();
    const preview = this.previews.get(key);

    if (!preview) {
      return false;
    }

    preview.context = context;
    await this.render(preview.panel, context, { force: true, invalidateCache: true });
    return true;
  }

  private async render(
    panel: vscode.WebviewPanel,
    context: RenderContext,
    options?: { force?: boolean; invalidateCache?: boolean },
  ): Promise<void> {
    const key = context.document.uri.toString();
    const preview = this.previews.get(key);

    if (!preview) {
      return;
    }

    preview.context = context;

    const documentPath = this.getDocumentLabel(context.document);
    let requestMeta: {
      documentPath: string;
      targetLanguage: string;
      version: number;
      force: boolean;
      invalidateCache: boolean;
      promptSource?: string;
    } = {
      documentPath,
      targetLanguage: context.resolvedConfig.targetLanguage,
      version: context.document.version,
      force: Boolean(options?.force),
      invalidateCache: Boolean(options?.invalidateCache),
    };

    if (!options?.force && context.document.version === preview.lastVersion) {
      this.logger.event('translation.skipped', {
        ...requestMeta,
        reason: 'documentVersionUnchanged',
      });
      return;
    }

    const prompt = await this.promptResolver.resolve(context.document, context.configuration);
    requestMeta = {
      ...requestMeta,
      promptSource: prompt.source,
    };

    if (prompt.source === 'workspace' && prompt.uri) {
      this.logger.info(`Using workspace translation prompt from ${prompt.uri.fsPath}.`);
    } else if (prompt.source === 'configuration') {
      this.logger.info('Using translation prompt from user settings.');
    }

    this.logger.event('translation.requested', requestMeta);

    preview.lastVersion = context.document.version;

    if (options?.invalidateCache) {
      this.cache.clearForDocument(context.document);
    }

    const cached = this.cache.get(context.document, context.resolvedConfig, prompt.fingerprint);

    if (cached) {
      this.logger.info(`Serving translation for ${key} from cache.`);
      this.logger.event('translation.cacheHit', {
        ...requestMeta,
        providerId: cached.providerId,
        latencyMs: cached.latencyMs,
        wasCached: true,
      });
      this.postMessage(panel, {
        type: 'translationResult',
        payload: {
          markdown: cached.markdown,
          html: cached.html,
          providerId: cached.providerId,
          latencyMs: cached.latencyMs,
          targetLanguage: context.resolvedConfig.targetLanguage,
          documentPath,
          sourceVersion: context.document.version,
          wasCached: true,
          recoveries: cached.recoveries ?? [],
        },
      });
      return;
    }

    this.logger.info(
      `Rendering translation preview for ${documentPath} → ${context.resolvedConfig.targetLanguage} (v${context.document.version}).`,
    );
    this.logger.event('translation.fetchStarted', requestMeta);

    const controller = new AbortController();
    this.cancelPendingTranslation(key, 'superseded');
    this.abortControllers.set(key, controller);

    this.postMessage(panel, {
      type: 'setLoading',
      payload: {
        isLoading: true,
        documentPath,
        targetLanguage: context.resolvedConfig.targetLanguage,
      },
    });

    try {
      const onPlan = (segments: string[]): void => {
        if (controller.signal.aborted) {
          return;
        }

        this.logger.event('translation.planReady', {
          ...requestMeta,
          totalSegments: segments.length,
        });

        this.postMessage(panel, {
          type: 'translationSource',
          payload: {
            documentPath,
            targetLanguage: context.resolvedConfig.targetLanguage,
            segments: segments.map((markdown, index) => ({
              segmentIndex: index,
              markdown,
            })),
          },
        });
      };

      const onSegment = (update: TranslationSegmentUpdate): void => {
        if (controller.signal.aborted) {
          return;
        }

        this.logger.event('translation.segmentCompleted', {
          ...requestMeta,
          segmentIndex: update.segmentIndex,
          totalSegments: update.totalSegments,
          latencyMs: update.latencyMs,
          providerId: update.providerId,
          wasCached: update.wasCached,
          recoveryType: update.recovery?.type ?? null,
          recoveryCode: update.recovery?.code ?? null,
        });

        this.postMessage(panel, {
          type: 'translationChunk',
          payload: {
            segmentIndex: update.segmentIndex,
            totalSegments: update.totalSegments,
            markdown: update.markdown,
            html: update.html,
            providerId: update.providerId,
            latencyMs: update.latencyMs,
            targetLanguage: context.resolvedConfig.targetLanguage,
            documentPath,
            wasCached: update.wasCached,
            recovery: update.recovery,
          },
        });
      };

      const result = await this.translationService.translateDocument(
        {
          document: context.document,
          configuration: context.configuration,
          resolvedConfig: context.resolvedConfig,
          signal: controller.signal,
          cache: this.cache,
          prompt,
        },
        { onPlan, onSegment },
      );

      if (controller.signal.aborted) {
        return;
      }

      panel.title = this.buildTitle(context.document);
      const recoveries = result.recoveries ?? [];
      const shouldPersistDocumentCache = recoveries.length === 0;

      if (recoveries.length > 0) {
        this.logger.event('translation.recoverySummary', {
          ...requestMeta,
          recoveredSegments: recoveries.length,
          cacheFallbackCount: recoveries.filter((entry) => entry.type === 'cacheFallback').length,
          placeholderCount: recoveries.filter((entry) => entry.type === 'placeholder').length,
        });
      }

      this.postMessage(panel, {
        type: 'translationResult',
        payload: {
          markdown: result.markdown,
          html: result.html,
          providerId: result.providerId,
          latencyMs: result.latencyMs,
          targetLanguage: context.resolvedConfig.targetLanguage,
          documentPath,
          sourceVersion: context.document.version,
          wasCached: false,
          recoveries,
        },
      });
      if (shouldPersistDocumentCache) {
        this.cache.set(context.document, context.resolvedConfig, prompt.fingerprint, result);
      } else {
        this.logger.info(
          `Skipped document-level cache for ${documentPath} due to segment recoveries.`,
        );
      }
      this.logger.event('translation.success', {
        ...requestMeta,
        providerId: result.providerId,
        latencyMs: result.latencyMs,
        wasCached: false,
        recoveredSegments: recoveries.length,
      });
      this.logger.info(
        `Translation succeeded for ${documentPath} → ${context.resolvedConfig.targetLanguage} using ${result.providerId} in ${result.latencyMs}ms.`,
      );
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        this.logger.warn(`Translation request cancelled for ${key}.`);
        this.logger.event('translation.cancelled', requestMeta);
        return;
      }

    this.logger.error(`Failed to render translation preview for ${documentPath}.`, error);
    const message = error instanceof Error ? error.message : localize('common.unknownError');
      const interpretation = this.interpretError(message, {
        documentPath,
        targetLanguage: context.resolvedConfig.targetLanguage,
      });

      this.logger.event('translation.error', {
        ...requestMeta,
        error: message,
        category: interpretation.category,
        hint: interpretation.hint ?? null,
      });
      this.postMessage(panel, {
        type: 'translationError',
        payload: {
          message,
          documentPath,
          targetLanguage: context.resolvedConfig.targetLanguage,
          hint: interpretation.hint,
        },
      });

      if (interpretation.notification) {
        const actions = interpretation.actions ?? [];
        const actionLabels = actions.map((action) => action.title);

        this.logger.event('translation.errorNotified', {
          ...requestMeta,
          category: interpretation.category,
          notification: interpretation.notification,
        });

        void vscode.window
          .showErrorMessage(interpretation.notification, ...actionLabels)
          .then((selection) => {
            if (!selection) {
              return;
            }

            const chosen = actions.find((action) => action.title === selection);

            if (!chosen) {
              return;
            }

            this.logger.event('translation.errorActionInvoked', {
              ...requestMeta,
              category: interpretation.category,
              action: chosen.title,
            });

            if (chosen.args && chosen.args.length > 0) {
              void vscode.commands.executeCommand(chosen.command, ...chosen.args);
            } else {
              void vscode.commands.executeCommand(chosen.command);
            }
          });
      }
    } finally {
      const storedController = this.abortControllers.get(key);
      if (storedController === controller) {
        this.abortControllers.delete(key);
      }
    }
  }

  private buildTitle(document: vscode.TextDocument): string {
    const relativePath = this.getDocumentLabel(document);
    return localize('preview.translationPanelTitle', { document: relativePath });
  }

  private getDocumentLabel(document: vscode.TextDocument): string {
    return vscode.workspace.asRelativePath(document.uri, false);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'translationPreview.js'),
    );
    const exportScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'exportBridge.js'),
    );
    const nonce = this.createNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource} https: data:;`;
    const localeBundle = getWebviewLocaleBundle();
    const localeJson = JSON.stringify(localeBundle).replace(/</g, '\\u003c');
    const escapeHtml = (value: string): string =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapeAttribute = (value: string): string => escapeHtml(value).replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="${escapeAttribute(localeBundle.languageTag)}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(localeBundle.pageTitle)}</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      padding: 0;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }

    main {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 20px 48px;
      min-height: 100vh;
      box-sizing: border-box;
    }

    .preview__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .preview__status {
      flex: 1 1 auto;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      font-size: 0.85rem;
      color: var(--vscode-descriptionForeground);
      min-height: 1.25rem;
    }

    .preview__status[data-state='loading']::before {
      content: '';
      width: 12px;
      height: 12px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.2);
      border-top-color: var(--vscode-progressBar-background);
      border-right-color: var(--vscode-progressBar-background);
      animation: preview-spin 0.8s linear infinite;
    }

    @media (prefers-reduced-motion: reduce) {
      .preview__status[data-state='loading']::before {
        animation-duration: 2s;
      }
    }

    .preview__retry {
      flex: 0 0 auto;
      padding: 6px 14px;
      font-size: 0.85rem;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-secondaryBorder, transparent);
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      cursor: pointer;
      transition: background 150ms ease;
    }

    .preview__retry:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .preview__retry[disabled] {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .preview__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .preview__exportButton {
      display: inline-flex;
      align-items: center;
      gap: 0;
      padding: 5px 10px;
      font-size: 0.82rem;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, rgba(128, 128, 128, 0.35));
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;
    }

    .preview__exportButton:hover:not([disabled]) {
      background: var(--vscode-button-hoverBackground, rgba(128, 128, 128, 0.1));
      border-color: var(--vscode-focusBorder, var(--vscode-button-border, rgba(128, 128, 128, 0.35)));
    }

    .preview__exportButton[disabled] {
      opacity: 0.6;
      cursor: wait;
    }

    .preview__exportError {
      flex: 1 1 100%;
      margin: 0;
      font-size: 0.85rem;
      color: var(--vscode-inputValidation-errorForeground);
    }

    .preview__error {
      margin: 0;
      padding: 12px 16px;
      border-radius: 6px;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }

    .preview__warning {
      margin: 0 0 12px;
      padding: 10px 14px;
      border-radius: 6px;
      background: var(--vscode-inputValidation-warningBackground, rgba(255, 204, 0, 0.12));
      color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
      border: 1px solid var(--vscode-inputValidation-warningBorder, rgba(255, 204, 0, 0.35));
    }

    .preview__content {
      line-height: 1.6;
      white-space: normal;
      word-break: break-word;
    }

    .preview__chunk {
      margin: 0 0 16px;
    }

    .preview__chunk--source {
      opacity: 0.65;
    }

    .preview__chunk--cached {
      border-left: 3px solid var(--vscode-terminal-ansiGreen, #4caf50);
      padding-left: 12px;
    }

    .preview__chunk--recovered {
      position: relative;
    }

    .preview__chunk--placeholder {
      border-left: 3px solid var(--vscode-inputValidation-warningBorder, #ff9800);
      padding-left: 12px;
      background: var(--vscode-inputValidation-warningBackground, rgba(255, 152, 0, 0.08));
    }

    a {
      color: var(--vscode-textLink-foreground);
    }

    code, pre {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }

    pre {
      background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.1));
      padding: 12px;
      border-radius: 6px;
      overflow-x: auto;
    }

    table {
      border-collapse: collapse;
      width: 100%;
    }

    th,
    td {
      border: 1px solid var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.3));
      padding: 6px 10px;
      text-align: left;
    }

    @keyframes preview-spin {
      from {
        transform: rotate(0deg);
      }

      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body>
  <main>
    <header class="preview__header">
      <p id="preview-status" class="preview__status" role="status" aria-live="polite" data-state="idle"></p>
      <div class="preview__actions">
        <button type="button" class="preview__exportButton" data-export-format="png"><span>${escapeHtml(
          localeBundle.exportControls.imageButtonLabel,
        )}</span></button>
        <button type="button" class="preview__exportButton" data-export-format="pdf"><span>${escapeHtml(
          localeBundle.exportControls.pdfButtonLabel,
        )}</span></button>
        <span id="preview-export-error" class="preview__exportError" hidden>${escapeHtml(
          localeBundle.exportControls.failureMessage,
        )}</span>
      </div>
      <button id="preview-retry" class="preview__retry" type="button" hidden>${escapeHtml(
        localeBundle.retryButtonLabel,
      )}</button>
    </header>
    <div id="preview-error" class="preview__error" role="alert" hidden></div>
    <div id="preview-warning" class="preview__warning" role="note" hidden></div>
    <article id="preview-content" class="preview__content" aria-label="${escapeAttribute(
      localeBundle.ariaContentLabel,
    )}"></article>
  </main>
  <script nonce="${nonce}" src="${exportScriptUri}"></script>
  <script nonce="${nonce}">window.__babelMdViewerLocale=${localeJson};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private createNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = 16;
    let result = '';
    for (let i = 0; i < length; i += 1) {
      const index = Math.floor(Math.random() * possible.length);
      result += possible.charAt(index);
    }
    return result;
  }

  private postMessage(panel: vscode.WebviewPanel, message: HostToWebviewMessage): void {
    panel.webview.postMessage(message).then(
      undefined,
      (error) => this.logger.error('Failed to post message to translation webview.', error),
    );
  }

  private async handleExportRequest(
    payload: Extract<WebviewToHostMessage, { type: 'exportContent' }>['payload'],
    previewEntry: PreviewEntry,
  ): Promise<void> {
    await this.exportService.export({
      format: payload.format,
      dataUri: payload.dataUrl,
      width: payload.width,
      height: payload.height,
      documentUri: previewEntry.context.document.uri,
      fileNameHint: this.buildTranslationFileName(previewEntry.context),
    });
  }

  private buildTranslationFileName(
    context: RenderContext,
  ): string {
    const baseName =
      context.document.uri.scheme === 'file'
        ? basename(context.document.uri.fsPath)
        : basename(context.document.uri.path);
    const index = baseName.lastIndexOf('.');
    const stripped = index >= 0 ? baseName.slice(0, index) : baseName;
    const language = context.resolvedConfig.targetLanguage || 'translation';
    return `${stripped}-${language}-translation-preview`;
  }

  private interpretError(
    message: string,
    info: { documentPath: string; targetLanguage: string },
  ): ErrorInterpretation {
    const normalized = message.toLowerCase();
    const baseNotification = localize('translation.error.base', {
      document: info.documentPath,
      language: info.targetLanguage,
    });
    const formatNotification = (hint: string): string => `${baseNotification} ${hint} (${message})`;

    if (normalized.includes('401') || normalized.includes('unauthorized') || normalized.includes('forbidden')) {
      const hint = localize('translation.error.authHint');
      return {
        category: 'authentication',
        hint,
        notification: formatNotification(hint),
        actions: [
          {
            title: localize('translation.error.action.setApiKey'),
            command: 'babelMdViewer.configureTranslationApiKey',
          },
        ],
      };
    }

    if (
      normalized.includes('timeout') ||
      normalized.includes('timed out') ||
      normalized.includes('etimedout')
    ) {
      const hint = localize('translation.error.timeoutHint');
      return {
        category: 'timeout',
        hint,
        notification: formatNotification(hint),
        actions: [
          {
            title: localize('translation.error.action.adjustTimeout'),
            command: 'workbench.action.openSettings',
            args: ['babelMdViewer.translation.timeoutMs'],
          },
        ],
      };
    }

    if (normalized.includes('429') || normalized.includes('rate limit')) {
      const hint = localize('translation.error.rateLimitHint');
      return {
        category: 'rateLimit',
        hint,
        notification: formatNotification(hint),
      };
    }

    if (
      normalized.includes('enotfound') ||
      normalized.includes('econnrefused') ||
      normalized.includes('network') ||
      normalized.includes('fetch failed')
    ) {
      const hint = localize('translation.error.networkHint');
      return {
        category: 'network',
        hint,
        notification: formatNotification(hint),
        actions: [
          {
            title: localize('translation.error.action.openSettings'),
            command: 'workbench.action.openSettings',
            args: ['babelMdViewer.translation'],
          },
        ],
      };
    }

    const hint = localize('translation.error.unknownHint');
    return {
      category: 'unknown',
      hint,
      notification: formatNotification(hint),
    };
  }

  private cancelPendingTranslation(
    key: string,
    reason: 'source-document-closed' | 'preview-closed' | 'superseded',
    meta?: { documentPath: string; targetLanguage: string },
  ): void {
    const controller = this.abortControllers.get(key);

    if (!controller) {
      return;
    }

    if (!controller.signal.aborted) {
      this.logger.info(`Cancelling translation for ${key} (${reason}).`);

      if (meta) {
        this.logger.event('translation.cancelPending', {
          documentPath: meta.documentPath,
          targetLanguage: meta.targetLanguage,
          reason,
        });
      }
    }

    controller.abort();
    this.abortControllers.delete(key);
  }
}
