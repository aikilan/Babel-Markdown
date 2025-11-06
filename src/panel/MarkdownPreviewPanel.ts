import * as vscode from 'vscode';

import type { BabelMarkdownService, TransformationResult } from '../services/BabelMarkdownService';
import { getLanguageTag, localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';

export class MarkdownPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private documentSubscription: vscode.Disposable | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private currentDocumentUri: vscode.Uri | undefined;
  private lastRenderedHash: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: BabelMarkdownService,
    private readonly logger: ExtensionLogger,
  ) {}

  async show(document: vscode.TextDocument): Promise<void> {
    this.logger.info(`Opening preview for ${document.uri.toString(true)}`);

    if (!this.panel) {
      this.panel = this.createPanel();
    }

    this.currentDocumentUri = document.uri;
    this.panel.title = localize('preview.markdownPanelTitle', {
      document: vscode.workspace.asRelativePath(document.uri),
    });
    this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, true);

    await this.render(document, { force: true });
    this.listenToDocument(document);
  }

  async refresh(): Promise<boolean> {
    if (!this.panel || !this.currentDocumentUri) {
      return false;
    }

    const document = await vscode.workspace.openTextDocument(this.currentDocumentUri);
    await this.render(document, { force: true });
    return true;
  }

  dispose(): void {
    this.panel?.dispose();
    this.documentSubscription?.dispose();

    while (this.disposables.length > 0) {
      const disposable = this.disposables.pop();
      disposable?.dispose();
    }

    this.logger.info('Disposed preview panel resources.');
  }

  private createPanel(): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
      'babelMdViewer.preview',
      localize('preview.markdownWindowTitle'),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableCommandUris: false,
        localResourceRoots: [
          this.extensionUri,
          vscode.Uri.joinPath(this.extensionUri, 'assets'),
        ],
      },
    );

    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'icons', 'preview.svg');
    panel.onDidDispose(() => this.handlePanelDispose(), null, this.disposables);

    return panel;
  }

  private async render(document: vscode.TextDocument, options?: { force?: boolean }): Promise<void> {
    if (!this.panel) {
      return;
    }

    try {
      const result = await this.service.transformDocument(document);

      if (!options?.force && result.contentHash === this.lastRenderedHash) {
        return;
      }

      this.lastRenderedHash = result.contentHash;
      this.panel.webview.html = this.buildHtml(result);
    } catch (error) {
      this.logger.error('Failed to transform Markdown document.', error);
      this.panel.webview.html = this.buildErrorHtml(error);
    }
  }

  private buildHtml(result: TransformationResult): string {
    const isDark = result.theme === 'dark';
    const background = isDark ? '#1e1e1e' : '#ffffff';
    const foreground = isDark ? '#d4d4d4' : '#1e1e1e';
    const border = isDark ? '#2d2d2d' : '#e5e5e5';
    const languageTag = getLanguageTag();
    const title = this.escapeHtml(localize('preview.markdownHtmlTitle'));

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(languageTag)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: ${result.theme};
    }

    body {
      background: ${background};
      color: ${foreground};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      padding: 24px;
      line-height: 1.6;
    }

    main {
      max-width: 960px;
      margin: 0 auto;
      background: ${isDark ? '#252526' : '#ffffff'};
      border: 1px solid ${border};
      border-radius: 8px;
      padding: 24px;
      box-shadow: ${isDark ? 'none' : '0 10px 24px rgba(15, 23, 42, 0.08)'};
    }

    pre {
      white-space: pre-wrap;
      word-break: break-word;
    }

    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    }
  </style>
</head>
<body>
  <main>
    ${result.html}
  </main>
</body>
</html>`;
  }

  private buildErrorHtml(error: unknown): string {
    const message = error instanceof Error ? error.message : localize('common.unknownError');
    const languageTag = getLanguageTag();
    const title = this.escapeHtml(localize('preview.markdownErrorTitle'));
    const heading = this.escapeHtml(localize('preview.markdownErrorHeading'));

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(languageTag)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #2d1d1d;
      color: #ffb4b4;
      padding: 24px;
    }
  </style>
</head>
<body>
  <h1>${heading}</h1>
  <p>${this.escapeHtml(message)}</p>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private listenToDocument(document: vscode.TextDocument): void {
    this.documentSubscription?.dispose();

    this.documentSubscription = vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      await this.render(event.document);
    });
  }

  private handlePanelDispose(): void {
    this.panel = undefined;
    this.currentDocumentUri = undefined;
    this.lastRenderedHash = undefined;
    this.documentSubscription?.dispose();
    this.documentSubscription = undefined;
  }
}
