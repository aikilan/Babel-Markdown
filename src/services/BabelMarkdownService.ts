import * as vscode from 'vscode';
import { createHash } from 'crypto';

import { ExtensionLogger } from '../utils/logger';
import { getExtensionConfiguration } from '../utils/config';
import { escapeHtml } from '../utils/text';

export interface TransformationResult {
  html: string;
  theme: 'light' | 'dark';
  contentHash: string;
  sourceMarkdown: string;
}

export class BabelMarkdownService {
  constructor(private readonly logger: ExtensionLogger) {}

  async transformDocument(document: vscode.TextDocument): Promise<TransformationResult> {
  const configuration = getExtensionConfiguration(document);
  const theme = configuration.previewTheme;
  const plugins = configuration.transformPlugins;

    this.logger.info(
      `Applying ${plugins.length} Babel plugin${plugins.length === 1 ? '' : 's'} to ${vscode.workspace.asRelativePath(document.uri)}`,
    );

    const markdownContent = document.getText();
    const transformedHtml = await this.applyTransformations(markdownContent, plugins);
    const hash = this.computeContentHash(document, markdownContent, plugins);

    return {
      html: transformedHtml,
      theme,
      contentHash: hash,
      sourceMarkdown: markdownContent,
    };
  }

  private async applyTransformations(content: string, plugins: string[]): Promise<string> {
    if (!content.trim()) {
      return '<p><em>This document is empty.</em></p>';
    }

    if (plugins.length > 0) {
      this.logger.warn('Babel plugins are declared but the pipeline is not implemented yet.');
    }

    const escaped = escapeHtml(content);
    return `<pre>${escaped}</pre>`;
  }

  private computeContentHash(
    document: vscode.TextDocument,
    markdown: string,
    plugins: string[],
  ): string {
    const hash = createHash('sha256');

    hash.update(document.uri.toString());
    hash.update(String(document.version));
    hash.update(markdown);
    hash.update(JSON.stringify(plugins));

    return hash.digest('hex');
  }
}
