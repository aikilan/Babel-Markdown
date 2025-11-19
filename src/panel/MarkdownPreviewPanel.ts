import * as vscode from 'vscode';
import { basename } from 'path';

import type { BabelMarkdownService, TransformationResult } from '../services/BabelMarkdownService';
import { getLanguageTag, localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';
import { MarkdownExportService } from '../services/MarkdownExportService';

type ExportFormat = 'png' | 'pdf';

type MarkdownPreviewMessage = {
  type: 'exportContent';
  payload: {
    format: ExportFormat;
    dataUrl: string;
    width: number;
    height: number;
  };
};

export class MarkdownPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private documentSubscription: vscode.Disposable | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private currentDocumentUri: vscode.Uri | undefined;
  private lastRenderedHash: string | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: BabelMarkdownService,
    private readonly exportService: MarkdownExportService,
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
    panel.webview.onDidReceiveMessage(
      (message: MarkdownPreviewMessage) => {
        void this.handleWebviewMessage(message);
      },
      undefined,
      this.disposables,
    );

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
    this.panel.webview.html = this.buildHtml(this.panel.webview, result);
    } catch (error) {
      this.logger.error('Failed to transform Markdown document.', error);
      this.panel.webview.html = this.buildErrorHtml(error);
    }
  }

  private buildHtml(webview: vscode.Webview, result: TransformationResult): string {
    const isDark = result.theme === 'dark';
    const background = isDark ? '#1e1e1e' : '#ffffff';
    const foreground = isDark ? '#d4d4d4' : '#1e1e1e';
    const border = isDark ? '#2d2d2d' : '#e5e5e5';
    const languageTag = getLanguageTag();
    const title = this.escapeHtml(localize('preview.markdownHtmlTitle'));
    const exportImageLabel = this.escapeHtml(localize('preview.exportImageButton'));
    const exportPdfLabel = this.escapeHtml(localize('preview.exportPdfButton'));
    const exportError = this.escapeHtml(localize('preview.exportError'));
    const exportBusy = this.escapeHtml(localize('preview.exportInProgress'));
    const exportScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'exportBridge.js'),
    );
    const nonce = this.createNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src ${webview.cspSource} https: data:;`;

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(languageTag)}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
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

    header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .preview-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .preview-actions__button {
      padding: 6px 14px;
      border-radius: 4px;
      border: 1px solid ${isDark ? '#3a3d41' : '#d4d4d4'};
      background: ${isDark ? '#2d2d30' : '#f3f3f3'};
      color: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      transition: background 150ms ease;
    }

    .preview-actions__button:hover:not([disabled]) {
      background: ${isDark ? '#3e3e42' : '#e5e5e5'};
    }

    .preview-actions__button[disabled] {
      opacity: 0.6;
      cursor: wait;
    }

    .preview-actions__error {
      flex: 1 1 100%;
      margin: 0;
      color: ${isDark ? '#f28b82' : '#9b2226'};
      font-size: 0.85rem;
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
    <header>
      <div class="preview-actions">
        <button type="button" class="preview-actions__button" data-export-format="png">${exportImageLabel}</button>
        <button type="button" class="preview-actions__button" data-export-format="pdf">${exportPdfLabel}</button>
        <span id="preview-export-error" class="preview-actions__error" hidden>${exportError}</span>
      </div>
    </header>
    <section id="preview-root">
      ${result.html}
    </section>
  </main>
  <script nonce="${nonce}" src="${exportScriptUri}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const exportButtons = Array.from(document.querySelectorAll('[data-export-format]'));
      const errorElement = document.getElementById('preview-export-error');
      const exportContainer = document.getElementById('preview-root');
      const busyLabel = '${exportBusy}';
      const defaultError = '${exportError}';

      if (!(exportContainer instanceof HTMLElement)) {
        return;
      }

      function setBusy(isBusy) {
        for (const button of exportButtons) {
          button.toggleAttribute('disabled', isBusy);
        }
        if (isBusy) {
          errorElement?.setAttribute('hidden', 'true');
        }
      }

      async function handleExport(format) {
        if (!window.__babelMdViewerExport?.captureElement) {
          errorElement?.removeAttribute('hidden');
          if (errorElement) {
            errorElement.textContent = defaultError;
          }
          return;
        }

        try {
          setBusy(true);
          if (errorElement) {
            errorElement.textContent = busyLabel;
            errorElement.removeAttribute('hidden');
          }
          const result = await window.__babelMdViewerExport.captureElement(exportContainer);
          vscode.postMessage({
            type: 'exportContent',
            payload: {
              format,
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
            },
          });
          if (errorElement) {
            errorElement.setAttribute('hidden', 'true');
          }
        } catch (error) {
          console.error('Export failed', error);
          if (errorElement) {
            errorElement.textContent = defaultError;
            errorElement.removeAttribute('hidden');
          }
        } finally {
          setBusy(false);
        }
      }

      for (const button of exportButtons) {
        button.addEventListener('click', () => {
          const format = button.getAttribute('data-export-format');
          if (format === 'png' || format === 'pdf') {
            void handleExport(format);
          }
        });
      }
    })();
  </script>
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

  private listenToDocument(document: vscode.TextDocument): void {
    this.documentSubscription?.dispose();

    this.documentSubscription = vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      await this.render(event.document);
    });
  }

  private async handleWebviewMessage(message: MarkdownPreviewMessage): Promise<void> {
    if (message.type !== 'exportContent') {
      this.logger.warn(`Unhandled message from Markdown preview: ${(message as { type: string }).type}`);
      return;
    }

    await this.exportService.export({
      format: message.payload.format,
      dataUri: message.payload.dataUrl,
      width: message.payload.width,
      height: message.payload.height,
      documentUri: this.currentDocumentUri,
      fileNameHint: this.buildFileNameHint(),
    });
  }

  private buildFileNameHint(): string {
    if (!this.currentDocumentUri) {
      return 'markdown-preview';
    }

    const baseName =
      this.currentDocumentUri.scheme === 'file'
        ? basename(this.currentDocumentUri.fsPath)
        : basename(this.currentDocumentUri.path);

    if (!baseName) {
      return 'markdown-preview';
    }

    const index = baseName.lastIndexOf('.');
    const stripped = index >= 0 ? baseName.slice(0, index) : baseName;
    return `${stripped}-preview`;
  }

  private handlePanelDispose(): void {
    this.panel = undefined;
    this.currentDocumentUri = undefined;
    this.lastRenderedHash = undefined;
    this.documentSubscription?.dispose();
    this.documentSubscription = undefined;
  }
}
