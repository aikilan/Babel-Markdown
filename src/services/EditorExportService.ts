import * as vscode from 'vscode';

import type { TransformationResult, BabelMarkdownService } from './BabelMarkdownService';
import { MarkdownExportService, ExportFormat } from './MarkdownExportService';
import { ExtensionLogger } from '../utils/logger';
import { getLanguageTag, localize } from '../i18n/localize';
import { buildPreviewStyles } from '../utils/previewStyles';

type CaptureResult = {
  dataUrl: string;
  width: number;
  height: number;
};

type WorkerMessage =
  | { type: 'captured'; payload: CaptureResult }
  | { type: 'error'; payload: string };

export class EditorExportService {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly exportService: MarkdownExportService,
    private readonly markdownService: BabelMarkdownService,
    private readonly logger: ExtensionLogger,
  ) {}

  async exportActiveEditor(format: ExportFormat): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      void vscode.window.showWarningMessage(localize('command.openPreview.noEditor'));
      return;
    }

    if (editor.document.languageId !== 'markdown') {
      void vscode.window.showWarningMessage(localize('command.openPreview.unsupported'));
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: localize('export.progress.capturing'),
      },
      async () => {
        const capture = await this.captureDocument(editor);
        await this.exportService.export({
          format,
          dataUri: capture.dataUrl,
          width: capture.width,
          height: capture.height,
          documentUri: editor.document.uri,
          fileNameHint: this.buildFileNameHint(editor.document),
        });
      },
    );
  }

  private async captureDocument(editor: vscode.TextEditor): Promise<CaptureResult> {
    const transform = await this.markdownService.transformDocument(editor.document);
    const panel = vscode.window.createWebviewPanel(
      'babelMdViewer.exportWorker',
      localize('export.worker.title'),
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        enableCommandUris: false,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
          this.extensionUri,
        ],
      },
    );

    const html = this.buildPreviewHtml(transform, panel.webview, editor.document);

    return new Promise<CaptureResult>((resolve, reject) => {
      let settled = false;

      const subscription = panel.webview.onDidReceiveMessage((message: WorkerMessage) => {
        if (settled) {
          return;
        }
        if (message.type === 'captured') {
          settled = true;
          subscription.dispose();
          panel.dispose();
          resolve(message.payload);
        } else if (message.type === 'error') {
          settled = true;
          subscription.dispose();
          panel.dispose();
          const error = new Error(message.payload || 'Export worker failed.');
          reject(error);
        }
      });

      panel.onDidDispose(() => {
        if (settled) {
          return;
        }
        settled = true;
        subscription.dispose();
        this.logger.error('Export panel closed before capture finished.');
        reject(new Error('Export panel was closed before capture completed.'));
      });

      panel.webview.html = html;
    });
  }

  private buildPreviewHtml(
    result: TransformationResult,
    webview: vscode.Webview,
    document: vscode.TextDocument,
  ): string {
    const isDark = result.theme === 'dark';
    const background = isDark ? '#1e1e1e' : '#ffffff';
    const foreground = isDark ? '#d4d4d4' : '#1e1e1e';
    const border = isDark ? '#2d2d2d' : '#e5e5e5';
    const languageTag = getLanguageTag();
    const title = this.escapeHtml(localize('preview.markdownHtmlTitle'));
    const sourceMarkdown = this.escapeHtml(result.sourceMarkdown);
    const exportScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'exportBridge.js'),
    );
    const nonce = this.createNonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src ${webview.cspSource} https: data:;`;
    const sharedStyles = buildPreviewStyles({
      theme: result.theme,
      background,
      foreground,
      border,
    });

    return `<!DOCTYPE html>
<html lang="${this.escapeHtml(languageTag)}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    ${sharedStyles}

    #capture-root section {
      padding: 4px 0;
    }
  </style>
</head>
<body>
  <main id="capture-root">
    <section id="preview-root">
      ${result.html}
    </section>
    <section id="preview-source-export" aria-hidden="true" hidden>
      <pre>${sourceMarkdown}</pre>
    </section>
  </main>
  <script nonce="${nonce}" src="${exportScriptUri}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function capture() {
      const target = document.getElementById('capture-root');
      if (!window.__babelMdViewerExport?.captureElement) {
        vscode.postMessage({ type: 'error', payload: 'Capture bridge unavailable.' });
        return;
      }
      window.__babelMdViewerExport.captureElement(target)
        .then((result) => vscode.postMessage({ type: 'captured', payload: result }))
        .catch((error) =>
          vscode.postMessage({ type: 'error', payload: error?.message || String(error) }),
        );
    }
    window.addEventListener('load', capture);
  </script>
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

  private buildFileNameHint(document: vscode.TextDocument): string {
    const baseName =
      document.uri.scheme === 'file'
        ? document.uri.fsPath.split(/[\\/]/).pop()
        : document.uri.path.split(/[\\/]/).pop();

    if (!baseName) {
      return 'markdown-preview';
    }

    const index = baseName.lastIndexOf('.');
    const stripped = index >= 0 ? baseName.slice(0, index) : baseName;
    return `${stripped}-preview`;
  }
}
