import * as vscode from 'vscode';

import type { ExtensionConfiguration } from '../types/config';
import type { ResolvedTranslationConfiguration } from '../types/translation';
import { TranslationService } from '../services/TranslationService';
import { TranslationCache } from '../services/TranslationCache';
import type { HostToWebviewMessage, WebviewToHostMessage } from '../messaging/channel';
import { ExtensionLogger } from '../utils/logger';

interface PreviewEntry {
  panel: vscode.WebviewPanel;
  disposable: vscode.Disposable;
  lastVersion: number;
  rangeSubscription?: vscode.Disposable;
}

interface RenderContext {
  document: vscode.TextDocument;
  configuration: ExtensionConfiguration;
  resolvedConfig: ResolvedTranslationConfiguration;
}

export class TranslationPreviewManager implements vscode.Disposable {
  private readonly previews = new Map<string, PreviewEntry>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly cache = new TranslationCache();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly translationService: TranslationService,
    private readonly logger: ExtensionLogger,
  ) {
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        const key = document.uri.toString();
        const preview = this.previews.get(key);
        if (preview) {
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
      preview.rangeSubscription?.dispose();
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
      existing.panel.reveal(undefined, true);
      this.registerScrollListener(key, context.document);
      this.postVisibleRange(existing.panel, context.document);
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
      if (message.type === 'log') {
        this.logger.info(`[Webview] ${message.payload.level}: ${message.payload.message}`);
        return;
      }

      if (message.type === 'requestScrollSync') {
        this.handleScrollRequest(context.document, message.payload.fraction);
      }
    });

    const disposable = panel.onDidDispose(() => {
      this.logger.info(`Translation preview disposed for ${key}.`);
      const entry = this.previews.get(key);
      entry?.rangeSubscription?.dispose();
      this.previews.delete(key);
      disposable.dispose();
      const controller = this.abortControllers.get(key);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(key);
      }
    });

    const entry: PreviewEntry = {
      panel,
      disposable,
      lastVersion: context.document.version,
    };

    this.previews.set(key, entry);
    this.registerScrollListener(key, context.document);
    this.postVisibleRange(panel, context.document);

    await this.render(panel, context, { force: true });
  }

  async refreshPreview(context: RenderContext): Promise<boolean> {
    const key = context.document.uri.toString();
    const preview = this.previews.get(key);

    if (!preview) {
      return false;
    }

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

    if (!options?.force && context.document.version === preview.lastVersion) {
      this.logger.info(`Skipping translation refresh for ${key}; document version unchanged.`);
      return;
    }

    preview.lastVersion = context.document.version;

    if (options?.invalidateCache) {
      this.cache.clearForDocument(context.document);
    }

    const cached = this.cache.get(context.document, context.resolvedConfig);

    if (cached) {
      this.logger.info(`Serving translation for ${key} from cache.`);
      this.postMessage(panel, {
        type: 'translationResult',
        payload: {
          markdown: cached.markdown,
          providerId: cached.providerId,
          latencyMs: cached.latencyMs,
          targetLanguage: context.resolvedConfig.targetLanguage,
        },
      });
      return;
    }

    this.logger.info(`Rendering translation preview for ${key}.`);

    const controller = new AbortController();
    const previousController = this.abortControllers.get(key);
    if (previousController) {
      previousController.abort();
    }
    this.abortControllers.set(key, controller);

    this.postMessage(panel, {
      type: 'setLoading',
      payload: {
        isLoading: true,
        documentPath: vscode.workspace.asRelativePath(context.document.uri),
        targetLanguage: context.resolvedConfig.targetLanguage,
      },
    });

    try {
      const result = await this.translationService.translateDocument({
        document: context.document,
        configuration: context.configuration,
        resolvedConfig: context.resolvedConfig,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        return;
      }

      panel.title = this.buildTitle(context.document);
      this.postMessage(panel, {
        type: 'translationResult',
        payload: {
          markdown: result.markdown,
          providerId: result.providerId,
          latencyMs: result.latencyMs,
          targetLanguage: context.resolvedConfig.targetLanguage,
        },
      });
      this.cache.set(context.document, context.resolvedConfig, result);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        this.logger.warn(`Translation request cancelled for ${key}.`);
        return;
      }

      this.logger.error('Failed to render translation preview.', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.postMessage(panel, {
        type: 'translationError',
        payload: {
          message,
        },
      });
    } finally {
      const storedController = this.abortControllers.get(key);
      if (storedController === controller) {
        this.abortControllers.delete(key);
      }
    }
  }

  private buildTitle(document: vscode.TextDocument): string {
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    return `Translated: ${relativePath}`;
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'translationPreview.js'),
    );
    const nonce = this.createNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Translation Preview</title>
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

    .preview__status {
      margin: 0;
      font-size: 0.85rem;
      color: var(--vscode-descriptionForeground);
    }

    .preview__error {
      margin: 0;
      padding: 12px 16px;
      border-radius: 6px;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }

    .preview__content {
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    a {
      color: var(--vscode-textLink-foreground);
    }

    code, pre {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
  </style>
</head>
<body>
  <main>
    <p id="preview-status" class="preview__status" role="status" aria-live="polite"></p>
    <div id="preview-error" class="preview__error" role="alert" hidden></div>
    <article id="preview-content" class="preview__content" aria-label="Translated Markdown"></article>
  </main>
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

  private registerScrollListener(key: string, document: vscode.TextDocument): void {
    const preview = this.previews.get(key);

    preview?.rangeSubscription?.dispose();

    if (!preview) {
      return;
    }

    const subscription = vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      if (event.textEditor.document !== document) {
        return;
      }

      const visibleRange = event.visibleRanges[0];

      if (!visibleRange) {
        return;
      }

      this.postMessage(preview.panel, {
        type: 'scrollSync',
        payload: {
          line: visibleRange.start.line,
          totalLines: document.lineCount,
        },
      });
    });

    preview.rangeSubscription = subscription;
  }

  private postVisibleRange(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);

    if (!editor) {
      return;
    }

    const visibleRange = editor.visibleRanges[0];

    if (!visibleRange) {
      return;
    }

    this.postMessage(panel, {
      type: 'scrollSync',
      payload: {
        line: visibleRange.start.line,
        totalLines: document.lineCount,
      },
    });
  }

  private handleScrollRequest(document: vscode.TextDocument, fraction: number): void {
    const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);

    if (!editor) {
      return;
    }

    const lastLine = Math.max(editor.document.lineCount - 1, 0);
    const targetLine = Math.min(Math.floor(lastLine * fraction), lastLine);
    const position = new vscode.Position(targetLine, 0);
    const range = new vscode.Range(position, position);
    editor.revealRange(range, vscode.TextEditorRevealType.AtTop);
  }
}
