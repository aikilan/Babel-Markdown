import * as vscode from 'vscode';
import { basename } from 'path';

import type { BabelMarkdownService, TransformationResult } from '../services/BabelMarkdownService';
import { getLanguageTag, localize } from '../i18n/localize';
import { ExtensionLogger } from '../utils/logger';
import { MarkdownExportService } from '../services/MarkdownExportService';

type ExportFormat = 'png' | 'pdf';

type MarkdownPreviewHostMessage = {
  type: 'requestExport';
  payload: {
    format: ExportFormat;
    target?: 'preview' | 'source';
  };
};

type MarkdownPreviewMessage =
  | {
      type: 'exportContent';
      payload: {
        format: ExportFormat;
        dataUrl: string;
        width: number;
        height: number;
        content: 'preview' | 'source';
      };
    }
  | {
      type: 'ready';
    }
  | {
      type: 'log';
      payload: {
        level: 'info' | 'warn' | 'error';
        message: string;
      };
    };

export class MarkdownPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private documentSubscription: vscode.Disposable | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private currentDocumentUri: vscode.Uri | undefined;
  private lastRenderedHash: string | undefined;
  private webviewReady: Promise<void> = Promise.resolve();
  private resolveWebviewReady: (() => void) | undefined;

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
      this.resetWebviewReady();
      this.panel.webview.html = this.buildHtml(this.panel.webview, result);
    } catch (error) {
      this.logger.error('Failed to transform Markdown document.', error);
      this.panel.webview.html = this.buildErrorHtml(error);
      this.resolveWebviewReady?.();
      this.resolveWebviewReady = undefined;
      this.webviewReady = Promise.resolve();
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
    const exportTargetLabel = this.escapeHtml(localize('preview.exportTargetLabel'));
    const exportTargetPreviewLabel = this.escapeHtml(localize('preview.exportTarget.preview'));
    const exportTargetSourceLabel = this.escapeHtml(localize('preview.exportTarget.source'));
    const exportError = this.escapeHtml(localize('preview.exportError'));
    const exportBusy = this.escapeHtml(localize('preview.exportInProgress'));
    const sourceMarkdown = this.escapeHtml(result.sourceMarkdown);
    const exportScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'exportBridge.js'),
    );
    const nonce = this.createNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src ${webview.cspSource} https: data:;`;
    const imageIcon = `<svg class="preview-actions__iconSvg" viewBox="0 0 24 24" role="presentation" focusable="false"><path fill="currentColor" d="M4 6h16a2 2 0 0 1 2 2v10.5A1.5 1.5 0 0 1 20.5 20h-17A1.5 1.5 0 0 1 2 18.5V8a2 2 0 0 1 2-2Zm0 2v10h16V8zm3.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Zm11 7.25-3.25-4.24-2.54 3.39-1.71-2.06L7.5 17.75z"/></svg>`;
    const pdfIcon = `<svg class="preview-actions__iconSvg" viewBox="0 0 24 24" role="presentation" focusable="false"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 2H6v18h12V8h-4zm-2.5 6H13c1.38 0 2.5 1.12 2.5 2.5S14.38 15 13 15h-.5v3H11.5V10Zm1.5 1.5H11.5v2h1.5a1 1 0 0 0 0-2Z"/></svg>`;

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

    .preview-actions__control {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
    }

    .preview-actions__select {
      border-radius: 4px;
      border: 1px solid ${isDark ? '#3a3d41' : '#d4d4d4'};
      background: ${isDark ? '#2d2d30' : '#fdfdfd'};
      color: inherit;
      padding: 4px 8px;
      font-family: inherit;
    }

    .preview-actions__button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
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

    .preview-actions__iconSvg {
      width: 16px;
      height: 16px;
      display: inline-block;
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

    .preview-source {
      position: absolute;
      top: 24px;
      left: 24px;
      right: 24px;
      opacity: 1;
      z-index: -1;
      pointer-events: none;
      background: ${isDark ? '#252526' : '#ffffff'};
      border: 1px solid ${border};
      border-radius: 8px;
      padding: 24px;
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="preview-actions">
        <label class="preview-actions__control">
          <span>${exportTargetLabel}</span>
          <select id="preview-export-target" class="preview-actions__select">
            <option value="preview">${exportTargetPreviewLabel}</option>
            <option value="source">${exportTargetSourceLabel}</option>
          </select>
        </label>
        <button type="button" class="preview-actions__button" data-export-format="png">${imageIcon}<span>${exportImageLabel}</span></button>
        <button type="button" class="preview-actions__button" data-export-format="pdf">${pdfIcon}<span>${exportPdfLabel}</span></button>
        <span id="preview-export-error" class="preview-actions__error" hidden>${exportError}</span>
      </div>
    </header>
    <section id="preview-root">
      ${result.html}
    </section>
    <section id="preview-source-export" class="preview-source" aria-hidden="true">
      <pre>${sourceMarkdown}</pre>
    </section>
  </main>
  <script nonce="${nonce}" src="${exportScriptUri}"></script>
  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();
      const exportButtons = Array.from(document.querySelectorAll('[data-export-format]'));
      const errorElement = document.getElementById('preview-export-error');
      const exportContainer = document.getElementById('preview-root');
      const sourceContainer = document.getElementById('preview-source-export');
      const exportTargetSelect = document.getElementById('preview-export-target');
      const busyLabel = '${exportBusy}';
      const defaultError = '${exportError}';

      if (!(exportContainer instanceof HTMLElement)) {
        return;
      }

      if (sourceContainer && !(sourceContainer instanceof HTMLElement)) {
        return;
      }

      if (exportTargetSelect && !(exportTargetSelect instanceof HTMLSelectElement)) {
        return;
      }

      function logExport(message, details) {
        try {
          console.log('[BabelMarkdown][export]', message, details ?? '');
          vscode.postMessage({
            type: 'log',
            payload: {
              level: 'info',
              message: '[Markdown Preview] ' + message + ' ' + JSON.stringify(details ?? {}),
            },
          });
        } catch {
          // ignore logging errors
        }
      }

      function getExportTarget(preferred) {
        if (preferred === 'source') {
          if (exportTargetSelect) {
            exportTargetSelect.value = 'source';
          }
          return 'source';
        }
        if (preferred === 'preview') {
          if (exportTargetSelect) {
            exportTargetSelect.value = 'preview';
          }
          return 'preview';
        }
        if (exportTargetSelect && exportTargetSelect.value === 'source') {
          return 'source';
        }
        return 'preview';
      }

      function cloneSourceContainer() {
        if (!(sourceContainer instanceof HTMLElement)) {
          logExport('Source export container missing.');
          return undefined;
        }

        const referenceWidth = exportContainer.getBoundingClientRect().width || sourceContainer.getBoundingClientRect().width;
        logExport('Cloning source container', { referenceWidth });
        const wrapper = document.createElement('section');
        wrapper.className = sourceContainer.className || 'preview-source';
        wrapper.innerHTML = sourceContainer.innerHTML;
        wrapper.style.position = 'absolute';
        wrapper.style.left = '24px';
        wrapper.style.top = '24px';
        wrapper.style.pointerEvents = 'none';
        wrapper.style.zIndex = '-1';
        wrapper.style.opacity = '1';
        wrapper.style.visibility = 'visible';
        if (referenceWidth) {
          wrapper.style.width = referenceWidth + 'px';
        }
        document.body.appendChild(wrapper);
        return wrapper;
      }

      function getExportElement(preferredTarget) {
        const target = getExportTarget(preferredTarget);

        if (target === 'source') {
          const clone = cloneSourceContainer();
          if (clone) {
            return { element: clone, cleanup: () => clone.remove(), target };
          }
        }
        return { element: exportContainer, cleanup: undefined, target };
      }

      function setBusy(isBusy) {
        for (const button of exportButtons) {
          button.toggleAttribute('disabled', isBusy);
        }
        if (exportTargetSelect) {
          exportTargetSelect.toggleAttribute('disabled', isBusy);
        }
        if (isBusy) {
          errorElement?.setAttribute('hidden', 'true');
        }
      }

      async function handleExport(format, preferredTarget) {
        if (!window.__babelMdViewerExport?.captureElement) {
          logExport('Export bridge is unavailable.');
          errorElement?.removeAttribute('hidden');
          if (errorElement) {
            errorElement.textContent = defaultError;
          }
          return;
        }

        let cleanup;
        try {
          setBusy(true);
          if (errorElement) {
            errorElement.textContent = busyLabel;
            errorElement.removeAttribute('hidden');
          }
          const { element, cleanup: cleanupFn, target } = getExportElement(preferredTarget);
          cleanup = cleanupFn;
          const content = target;
          logExport('Starting export', { format, content });
          const result = await window.__babelMdViewerExport.captureElement(element);
          logExport('Export captured', { width: result.width, height: result.height });
          vscode.postMessage({
            type: 'exportContent',
            payload: {
              format,
              dataUrl: result.dataUrl,
              width: result.width,
              height: result.height,
              content,
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
          cleanup?.();
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

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === 'requestExport') {
          const format = message.payload?.format;
          const target = message.payload?.target === 'source' ? 'source' : 'preview';
          if (format === 'png' || format === 'pdf') {
            void handleExport(format, target);
          }
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
  }

  async exportDocument(
    document: vscode.TextDocument,
    format: ExportFormat,
    target: 'preview' | 'source' = 'preview',
  ): Promise<void> {
    await this.show(document);
    await this.waitForWebviewReady();
    await this.requestExportFromWebview(format, target);
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
    if (message.type === 'exportContent') {
      await this.exportService.export({
        format: message.payload.format,
        dataUri: message.payload.dataUrl,
        width: message.payload.width,
        height: message.payload.height,
        documentUri: this.currentDocumentUri,
        fileNameHint: this.buildFileNameHint(message.payload.content),
      });
      return;
    }

    if (message.type === 'ready') {
      this.logger.info('Markdown preview webview reported ready.');
      this.resolveWebviewReady?.();
      this.resolveWebviewReady = undefined;
      return;
    }

    if (message.type === 'log') {
      this.logger.info(`[Markdown Preview] ${message.payload.message}`);
      return;
    }

    this.logger.warn(`Unhandled message from Markdown preview: ${(message as { type: string }).type}`);
  }

  private buildFileNameHint(content: 'preview' | 'source'): string {
    if (!this.currentDocumentUri) {
      return content === 'source' ? 'markdown-source' : 'markdown-preview';
    }

    const baseName =
      this.currentDocumentUri.scheme === 'file'
        ? basename(this.currentDocumentUri.fsPath)
        : basename(this.currentDocumentUri.path);

    if (!baseName) {
      return content === 'source' ? 'markdown-source' : 'markdown-preview';
    }

    const index = baseName.lastIndexOf('.');
    const stripped = index >= 0 ? baseName.slice(0, index) : baseName;
    return `${stripped}-${content === 'source' ? 'source' : 'preview'}`;
  }

  private handlePanelDispose(): void {
    this.panel = undefined;
    this.currentDocumentUri = undefined;
    this.lastRenderedHash = undefined;
    this.documentSubscription?.dispose();
    this.documentSubscription = undefined;
    this.resolveWebviewReady?.();
    this.resolveWebviewReady = undefined;
    this.webviewReady = Promise.resolve();
  }

  private resetWebviewReady(): void {
    this.webviewReady = new Promise<void>((resolve) => {
      this.resolveWebviewReady = resolve;
    });
  }

  private async waitForWebviewReady(): Promise<void> {
    await this.webviewReady;
  }

  private async requestExportFromWebview(
    format: ExportFormat,
    target: 'preview' | 'source',
  ): Promise<void> {
    if (!this.panel) {
      this.logger.warn('Cannot request export: preview panel is not available.');
      return;
    }

    const delivered = await this.panel.webview.postMessage({
      type: 'requestExport',
      payload: { format, target },
    } satisfies MarkdownPreviewHostMessage);

    if (!delivered) {
      this.logger.warn('Failed to deliver export request to markdown preview webview.');
    }
  }
}
