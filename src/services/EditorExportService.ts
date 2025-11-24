import * as vscode from 'vscode';

import { MarkdownExportService, ExportFormat } from './MarkdownExportService';
import { ExtensionLogger } from '../utils/logger';
import { localize } from '../i18n/localize';

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

    const html = this.buildWorkerHtml(editor, panel.webview);

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

  private buildWorkerHtml(editor: vscode.TextEditor, webview: vscode.Webview): string {
    const exportScriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'exportBridge.js'))
      .toString();
    const nonce = this.createNonce();
    const theme = vscode.window.activeColorTheme.kind;
    const palette = this.getPalette(theme);
    const fontFamily = this.getFontFamily(editor);
    const fontSize = this.getFontSize(editor);
    const lineHeightPx = this.getLineHeight(editor, fontSize);
    const tabSize = this.getTabSize(editor);
    const documentText = editor.document.getText().replace(/\r\n/g, '\n');
    const lineHtml = this.renderLines(documentText);
    const csp = `default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource} https: data:;`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style nonce="${nonce}">
    :root {
      color-scheme: ${palette.colorScheme};
    }

    body {
      margin: 0;
      padding: 18px;
      background: ${palette.surface};
      color: ${palette.foreground};
      font-family: ${fontFamily};
    }

    .export-shell {
      background: ${palette.background};
      border: 1px solid ${palette.border};
      border-radius: 8px;
      box-shadow: ${palette.shadow};
      overflow: hidden;
    }

    .export-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid ${palette.border};
      color: ${palette.header};
      font-size: 12px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }

    .export-content {
      display: grid;
      grid-template-columns: auto 1fr;
      background: ${palette.background};
      color: ${palette.foreground};
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      line-height: ${lineHeightPx}px;
      tab-size: ${tabSize};
    }

    .gutter {
      background: ${palette.gutterBackground};
      color: ${palette.gutter};
      border-right: 1px solid ${palette.border};
      padding: 12px 8px 12px 12px;
      text-align: right;
      user-select: none;
      font-variant-numeric: tabular-nums;
    }

    .gutter-line {
      display: block;
      padding: 0 8px 0 0;
    }

    .code {
      padding: 12px 16px;
      white-space: pre;
      overflow: visible;
    }

    .code-line {
      display: block;
      white-space: pre;
    }
  </style>
</head>
<body>
  <main id="capture-root" class="export-shell">
    <header class="export-header">Markdown · ${this.escapeHtml(
      editor.document.fileName.split(/[\\/]/).pop() ?? 'untitled',
    )}</header>
    <section class="export-content">
      <div class="gutter">${this.renderGutter(documentText)}</div>
      <div class="code">${lineHtml}</div>
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

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'capture') {
        capture();
      }
    });

    window.addEventListener('load', capture);
  </script>
</body>
</html>`;
  }

  private renderLines(content: string): string {
    const lines = content.split(/\r?\n/);
    return lines
      .map((line) => `<span class="code-line">${this.escapeHtml(line || ' ')}</span>`)
      .join('');
  }

  private renderGutter(content: string): string {
    const lines = content.split(/\r?\n/);
    return lines
      .map((_, index) => `<span class="gutter-line">${index + 1}</span>`)
      .join('');
  }

  private getFontFamily(editor: vscode.TextEditor): string {
    const configured = vscode.workspace.getConfiguration('editor').get<string>('fontFamily');
    if (configured && configured.trim()) {
      return configured;
    }
    return `'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`;
  }

  private getFontSize(editor: vscode.TextEditor): number {
    const configured = vscode.workspace.getConfiguration('editor').get<number>('fontSize');
    if (configured && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return 14;
  }

  private getLineHeight(editor: vscode.TextEditor, fontSize: number): number {
    const configured = vscode.workspace.getConfiguration('editor').get<number>('lineHeight');
    if (configured && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return Math.round(fontSize * 1.6);
  }

  private getTabSize(editor: vscode.TextEditor): number {
    const option = editor.options.tabSize;
    if (typeof option === 'number' && Number.isFinite(option) && option > 0) {
      return option;
    }
    const configured = vscode.workspace.getConfiguration('editor').get<number>('tabSize');
    if (configured && Number.isFinite(configured) && configured > 0) {
      return configured;
    }
    return 4;
  }

  private getPalette(theme: vscode.ColorThemeKind): {
    background: string;
    surface: string;
    gutter: string;
    gutterBackground: string;
    border: string;
    foreground: string;
    header: string;
    shadow: string;
    colorScheme: 'light' | 'dark';
  } {
    if (theme === vscode.ColorThemeKind.Light) {
      return {
        background: '#ffffff',
        surface: '#f3f4f6',
        gutter: '#6b7280',
        gutterBackground: '#f8fafc',
        border: '#e5e7eb',
        foreground: '#111827',
        header: '#4b5563',
        shadow: '0 10px 24px rgba(0, 0, 0, 0.08)',
        colorScheme: 'light',
      };
    }

    return {
      background: '#1e1e1e',
      surface: '#121212',
      gutter: '#9ca3af',
      gutterBackground: '#18181b',
      border: '#2d2d2d',
      foreground: '#d4d4d4',
      header: '#9ca3af',
      shadow: '0 10px 24px rgba(0, 0, 0, 0.35)',
      colorScheme: 'dark',
    };
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
      return 'markdown-source';
    }

    const index = baseName.lastIndexOf('.');
    const stripped = index >= 0 ? baseName.slice(0, index) : baseName;
    return `${stripped}-source`;
  }
}
