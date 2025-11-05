import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

import { SecretStorageService } from '../../src/services/SecretStorageService';
import { BabelMarkdownService } from '../../src/services/BabelMarkdownService';
import { TranslationCache } from '../../src/services/TranslationCache';
import { TranslationService } from '../../src/services/TranslationService';
import type { OpenAITranslationClient } from '../../src/services/OpenAITranslationClient';
import type { ExtensionConfiguration, TranslationConfiguration } from '../../src/types/config';
import type {
  RawTranslationResult,
  ResolvedTranslationConfiguration,
} from '../../src/types/translation';
import { getExtensionConfiguration } from '../../src/utils/config';
import { ExtensionLogger } from '../../src/utils/logger';

const CONFIG_SECTION = 'babelMdViewer';

class InMemorySecretStorage implements vscode.SecretStorage {
  private readonly storageMap = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  readonly onDidChange = this.emitter.event;

  async get(key: string): Promise<string | undefined> {
    return this.storageMap.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.storageMap.set(key, value);
    this.emitter.fire({ key });
  }

  async delete(key: string): Promise<void> {
    this.storageMap.delete(key);
    this.emitter.fire({ key });
  }

  async keys(): Promise<string[]> {
    return Array.from(this.storageMap.keys());
  }
}

class InMemoryTextDocument {
  constructor(public readonly uri: vscode.Uri, public version: number) {}
}

suite('Configuration Helper', () => {
  let originalConfig: TranslationConfiguration | undefined;

  suiteSetup(() => {
    const extensionConfig = getExtensionConfiguration();
    originalConfig = extensionConfig.translation;
  });

  suiteTeardown(async () => {
    const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);

    await configuration.update(
      'translation.apiBaseUrl',
      originalConfig?.apiBaseUrl,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.apiKey',
      originalConfig?.apiKey,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.model',
      originalConfig?.model,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.targetLanguage',
      originalConfig?.targetLanguage,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.timeoutMs',
      originalConfig?.timeoutMs,
      vscode.ConfigurationTarget.Workspace,
    );
  });

  test('reads translation configuration with overrides', async () => {
    const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);

    await configuration.update(
      'translation.apiBaseUrl',
      'https://example.com/v1',
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.apiKey',
      'secret-key',
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.model',
      'gpt-test',
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.targetLanguage',
      'fr',
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.timeoutMs',
      45000,
      vscode.ConfigurationTarget.Workspace,
    );

    const result = getExtensionConfiguration();

    assert.strictEqual(result.translation.apiBaseUrl, 'https://example.com/v1');
    assert.strictEqual(result.translation.apiKey, 'secret-key');
    assert.strictEqual(result.translation.model, 'gpt-test');
    assert.strictEqual(result.translation.targetLanguage, 'fr');
    assert.strictEqual(result.translation.timeoutMs, 45000);
  });
});

suite('SecretStorageService', () => {
  test('stores, retrieves and clears translation api key', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Secret Test)');
    const storage = new InMemorySecretStorage();
    const service = new SecretStorageService(storage, logger);

    await service.storeTranslationApiKey(' test-key ');

    const stored = await service.getTranslationApiKey();
    assert.strictEqual(stored, 'test-key');

    await service.clearTranslationApiKey();

    const cleared = await service.getTranslationApiKey();
    assert.strictEqual(cleared, undefined);

    logger.dispose();
  });
});

suite('TranslationCache', () => {
  test('stores and retrieves cache entries within ttl', () => {
    const cache = new TranslationCache({ ttlMs: 1000, maxEntries: 2 });
    const doc = new InMemoryTextDocument(vscode.Uri.parse('file:///doc.md'), 1);
    const config = {
      apiBaseUrl: 'https://example.com',
      apiKey: 'sk-example',
      model: 'gpt-test',
      targetLanguage: 'en',
      timeoutMs: 1000,
    };

    const result = {
      markdown: 'translated',
      html: '<p>translated</p>',
      providerId: 'mock',
      latencyMs: 42,
    };

    cache.set(doc, config, result);

    const cached = cache.get(doc, config);
    assert.deepStrictEqual(cached, result);
  });

  test('evicts entries when ttl expires', async () => {
    const cache = new TranslationCache({ ttlMs: 10, maxEntries: 2 });
    const doc = new InMemoryTextDocument(vscode.Uri.parse('file:///doc.md'), 1);
    const config = {
      apiBaseUrl: 'https://example.com',
      apiKey: 'sk-example',
      model: 'gpt-test',
      targetLanguage: 'en',
      timeoutMs: 1000,
    };

    const result = {
      markdown: 'translated',
      html: '<p>translated</p>',
      providerId: 'mock',
      latencyMs: 42,
    };

    cache.set(doc, config, result);
    await new Promise((resolve) => setTimeout(resolve, 15));

    const cached = cache.get(doc, config);
    assert.strictEqual(cached, undefined);
  });

  test('evicts oldest entry when exceeding max entries', () => {
    const cache = new TranslationCache({ ttlMs: 1000, maxEntries: 1 });
    const docA = new InMemoryTextDocument(vscode.Uri.parse('file:///a.md'), 1);
    const docB = new InMemoryTextDocument(vscode.Uri.parse('file:///b.md'), 1);
    const config = {
      apiBaseUrl: 'https://example.com',
      apiKey: 'sk-example',
      model: 'gpt-test',
      targetLanguage: 'en',
      timeoutMs: 1000,
    };

    const resultA = {
      markdown: 'A',
      html: '<p>A</p>',
      providerId: 'mock',
      latencyMs: 10,
    };
    const resultB = {
      markdown: 'B',
      html: '<p>B</p>',
      providerId: 'mock',
      latencyMs: 20,
    };

    cache.set(docA, config, resultA);
    cache.set(docB, config, resultB);

    const cachedA = cache.get(docA, config);
    const cachedB = cache.get(docB, config);

    assert.strictEqual(cachedA, undefined);
    assert.deepStrictEqual(cachedB, resultB);
  });
});

suite('Babel Markdown Service', () => {
  test('returns escaped HTML for markdown content', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Test)');
    const service = new BabelMarkdownService(logger);

    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# Hello <world>',
    });

    const result = await service.transformDocument(document);

    assert.strictEqual(result.html.includes('&lt;world&gt;'), true);
    logger.dispose();
  });
});

suite('TranslationService', () => {
  const configuration: ExtensionConfiguration = {
    previewTheme: 'light',
    transformPlugins: [],
    translation: {
      apiBaseUrl: 'https://example.com',
      apiKey: 'sk-test',
      model: 'gpt-test',
      targetLanguage: 'de',
      timeoutMs: 1000,
    },
  };

  const resolvedConfig: ResolvedTranslationConfiguration = {
    apiBaseUrl: configuration.translation.apiBaseUrl,
    apiKey: 'sk-test',
    model: configuration.translation.model,
    targetLanguage: configuration.translation.targetLanguage,
    timeoutMs: configuration.translation.timeoutMs,
  };

  test('returns rendered html alongside markdown result', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Translation Test)');
    const stubResponse: RawTranslationResult = {
      markdown: '**Hello** <script>alert(1)</script>',
      providerId: 'stub-provider',
      latencyMs: 12,
    };

    const client: Partial<OpenAITranslationClient> = {
      translate: async (): Promise<RawTranslationResult> => stubResponse,
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# Source',
    });

    const result = await service.translateDocument({
      document,
      configuration,
      resolvedConfig,
    });

    assert.strictEqual(result.markdown, stubResponse.markdown);
    assert.strictEqual(result.providerId, stubResponse.providerId);
    assert.strictEqual(result.latencyMs, stubResponse.latencyMs);
    assert.ok(result.html.includes('<strong>Hello</strong>'));
    assert.ok(!result.html.includes('<script'));

    logger.dispose();
  });

  test('returns sanitized fallback html on error', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Translation Error Test)');
    const client: Partial<OpenAITranslationClient> = {
      translate: async (): Promise<RawTranslationResult> => {
        throw new Error('boom');
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'Source <script>alert(1)</script>',
    });

    const result = await service.translateDocument({
      document,
      configuration,
      resolvedConfig,
    });

    assert.strictEqual(result.providerId, 'error-fallback');
    assert.ok(result.html.includes('Translation failed'));
    assert.ok(!result.html.includes('<script>'));

    logger.dispose();
  });
});
