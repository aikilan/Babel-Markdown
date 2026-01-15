import * as vscode from 'vscode';

import type {
  ResolvedTranslationConfiguration,
  TranslationPrompt,
  TranslationResult,
  TranslationRecovery,
} from '../types/translation';
import { sha256Hex } from '../utils/hash';
import { ExtensionLogger } from '../utils/logger';

interface CachedTranslationEntry {
  fileUri: string;
  filePath: string;
  contentHash: string;
  targetLanguage: string;
  model: string;
  promptFingerprint: string;
  markdown: string;
  html: string;
  providerId: string;
  latencyMs: number;
  recoveries?: TranslationRecovery[];
  updatedAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class TranslationCacheStore {
  constructor(
    private readonly storageRoot: vscode.Uri,
    private readonly logger: ExtensionLogger,
  ) {}

  async load(
    document: vscode.TextDocument,
    documentText: string,
    resolvedConfig: ResolvedTranslationConfiguration,
    prompt: TranslationPrompt,
  ): Promise<CachedTranslationEntry | undefined> {
    const { entryUri } = this.resolvePaths(document, resolvedConfig, prompt.fingerprint);
    let raw: Uint8Array;

    try {
      raw = await vscode.workspace.fs.readFile(entryUri);
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return undefined;
      }
      this.logger.warn(
        `Failed to read translation cache at ${entryUri.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
      );
      return undefined;
    }

    const entry = this.parseEntry(raw, entryUri);
    if (!entry) {
      return undefined;
    }

    const contentHash = sha256Hex(documentText);

    if (
      entry.fileUri !== document.uri.toString() ||
      entry.contentHash !== contentHash ||
      entry.targetLanguage !== resolvedConfig.targetLanguage ||
      entry.model !== resolvedConfig.model ||
      entry.promptFingerprint !== prompt.fingerprint
    ) {
      return undefined;
    }

    return entry;
  }

  async save(
    document: vscode.TextDocument,
    documentText: string,
    resolvedConfig: ResolvedTranslationConfiguration,
    prompt: TranslationPrompt,
    result: TranslationResult,
  ): Promise<void> {
    const { entryUri, entryDir } = this.resolvePaths(document, resolvedConfig, prompt.fingerprint);
    const entry: CachedTranslationEntry = {
      fileUri: document.uri.toString(),
      filePath: document.uri.fsPath,
      contentHash: sha256Hex(documentText),
      targetLanguage: resolvedConfig.targetLanguage,
      model: resolvedConfig.model,
      promptFingerprint: prompt.fingerprint,
      markdown: result.markdown,
      html: result.html,
      providerId: result.providerId,
      latencyMs: result.latencyMs,
      recoveries: result.recoveries ?? [],
      updatedAt: Date.now(),
    };

    try {
      await vscode.workspace.fs.createDirectory(entryDir);
      await vscode.workspace.fs.writeFile(entryUri, encoder.encode(JSON.stringify(entry)));
    } catch (error) {
      this.logger.warn(
        `Failed to persist translation cache at ${entryUri.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }

  async clearForDocument(document: vscode.TextDocument): Promise<void> {
    const { entryDir } = this.resolvePaths(document, null, null);
    try {
      await vscode.workspace.fs.delete(entryDir, { recursive: true, useTrash: false });
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
        return;
      }
      this.logger.warn(
        `Failed to clear translation cache at ${entryDir.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
      );
    }
  }

  private resolvePaths(
    document: vscode.TextDocument,
    resolvedConfig: ResolvedTranslationConfiguration | null,
    promptFingerprint: string | null,
  ): { entryDir: vscode.Uri; entryUri: vscode.Uri } {
    const workspaceHash = this.getWorkspaceHash(document);
    const fileHash = sha256Hex(document.uri.toString());
    const entryDir = vscode.Uri.joinPath(
      this.storageRoot,
      'translation-cache',
      workspaceHash,
      fileHash,
    );

    if (!resolvedConfig || !promptFingerprint) {
      return { entryDir, entryUri: entryDir };
    }

    const configKey = sha256Hex(
      [resolvedConfig.targetLanguage.trim(), resolvedConfig.model.trim(), promptFingerprint.trim()].join('|'),
    );
    const entryUri = vscode.Uri.joinPath(entryDir, `${configKey}.json`);
    return { entryDir, entryUri };
  }

  private getWorkspaceHash(document: vscode.TextDocument): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceKey = workspaceFolder?.uri.toString() || 'global';
    return sha256Hex(workspaceKey);
  }

  private parseEntry(raw: Uint8Array, entryUri: vscode.Uri): CachedTranslationEntry | undefined {
    try {
      const json = decoder.decode(raw);
      return JSON.parse(json) as CachedTranslationEntry;
    } catch (error) {
      this.logger.warn(
        `Failed to parse translation cache at ${entryUri.fsPath}: ${error instanceof Error ? error.message : String(error)}.`,
      );
      return undefined;
    }
  }
}
