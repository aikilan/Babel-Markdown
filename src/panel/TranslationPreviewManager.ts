import * as vscode from 'vscode';

import type { ExtensionConfiguration } from '../types/config';
import type { ResolvedTranslationConfiguration, TranslationResult } from '../types/translation';
import { TranslationService } from '../services/TranslationService';
import { escapeHtml } from '../utils/text';
import { ExtensionLogger } from '../utils/logger';

interface PreviewEntry {
  panel: vscode.WebviewPanel;
  disposable: vscode.Disposable;
  lastVersion: number;
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
      },
    );

    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'icons', 'preview.svg');

    const disposable = panel.onDidDispose(() => {
      this.logger.info(`Translation preview disposed for ${key}.`);
      this.previews.delete(key);
      disposable.dispose();
      const controller = this.abortControllers.get(key);
      if (controller) {
        controller.abort();
        this.abortControllers.delete(key);
      }
    });

    this.previews.set(key, {
      panel,
      disposable,
      lastVersion: context.document.version,
    });

    await this.render(panel, context);
  }

  async refreshPreview(context: RenderContext): Promise<boolean> {
    const key = context.document.uri.toString();
    const preview = this.previews.get(key);

    if (!preview) {
      return false;
    }

    await this.render(preview.panel, context, { force: true });
    return true;
  }

  private async render(
    panel: vscode.WebviewPanel,
    context: RenderContext,
    options?: { force?: boolean },
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

    this.logger.info(`Rendering translation preview for ${key}.`);
    preview.lastVersion = context.document.version;

    const controller = new AbortController();
    const previousController = this.abortControllers.get(key);
    if (previousController) {
      previousController.abort();
    }
    this.abortControllers.set(key, controller);

    panel.webview.html = this.renderLoadingHtml(context);

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
      panel.webview.html = this.renderResultHtml(result, context);
    } catch (error) {
      if (error instanceof vscode.CancellationError) {
        this.logger.warn(`Translation request cancelled for ${key}.`);
        return;
      }

      this.logger.error('Failed to render translation preview.', error);
      panel.webview.html = this.renderErrorHtml(error);
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

  private renderLoadingHtml(context: RenderContext): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Loading translation</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111827;
      color: #e5e7eb;
    }
    .card {
      padding: 24px;
      border-radius: 12px;
      background: rgba(17, 24, 39, 0.85);
      border: 1px solid rgba(59, 130, 246, 0.4);
      box-shadow: 0 20px 45px rgba(15, 23, 42, 0.45);
    }
    h1 {
      font-size: 1.25rem;
      margin-bottom: 12px;
      color: #93c5fd;
    }
    p {
      margin: 0;
      opacity: 0.85;
    }
  </style>
</head>
<body>
  <section class="card">
    <h1>Translating…</h1>
    <p>${vscode.workspace.asRelativePath(context.document.uri)}</p>
    <p>Target language: ${context.resolvedConfig.targetLanguage}</p>
  </section>
</body>
</html>`;
  }

  private renderResultHtml(result: TranslationResult, context: RenderContext): string {
  const escapedMarkdown = escapeHtml(result.markdown);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Translated Markdown</title>
  <style>
    body {
      margin: 0;
      padding: 32px 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    header {
      margin-bottom: 24px;
    }
    pre {
      background: #1e293b;
      border-radius: 8px;
      padding: 20px;
      overflow-x: auto;
      box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
    }
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      line-height: 1.6;
      font-size: 0.95rem;
      color: #f8fafc;
    }
    footer {
      margin-top: 16px;
      font-size: 0.8rem;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <header>
    <h1>Translated Markdown Preview</h1>
    <p>Provider: ${result.providerId} · Target: ${context.resolvedConfig.targetLanguage} · Latency: ${result.latencyMs}ms</p>
  </header>
  <pre><code>${escapedMarkdown}</code></pre>
  <footer>Source: ${vscode.workspace.asRelativePath(context.document.uri)}</footer>
</body>
</html>`;
  }

  private renderErrorHtml(error: unknown): string {
    const message = error instanceof Error ? error.message : 'Unknown error';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Translation Error</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1f2937;
      color: #fecaca;
      text-align: center;
    }
    section {
      padding: 24px;
      max-width: 420px;
      background: rgba(127, 29, 29, 0.25);
      border-radius: 10px;
      border: 1px solid rgba(248, 113, 113, 0.35);
    }
    h1 {
      margin-bottom: 12px;
      font-size: 1.25rem;
    }
    p {
      margin: 0;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <section>
    <h1>Translation failed</h1>
    <p>${message}</p>
  </section>
</body>
</html>`;
  }
}
