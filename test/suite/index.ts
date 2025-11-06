import * as assert from 'assert';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

import { SecretStorageService } from '../../src/services/SecretStorageService';
import { BabelMarkdownService } from '../../src/services/BabelMarkdownService';
import { TranslationCache } from '../../src/services/TranslationCache';
import { TranslationService, TranslationRunError } from '../../src/services/TranslationService';
import {
  TranslationProviderError,
  type OpenAITranslationClient,
  type TranslateRequest,
} from '../../src/services/OpenAITranslationClient';
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
    await configuration.update(
      'translation.enableAdaptiveBatching',
      originalConfig?.adaptiveBatchingEnabled,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.logSegmentMetrics',
      originalConfig?.segmentMetricsLoggingEnabled,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.concurrencyLimit',
      originalConfig?.concurrencyLimit,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.parallelFallbackEnabled',
      originalConfig?.parallelismFallbackEnabled,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.retry.maxAttempts',
      originalConfig?.retryMaxAttempts,
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
    await configuration.update(
      'translation.enableAdaptiveBatching',
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.logSegmentMetrics',
      true,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.concurrencyLimit',
      3,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.parallelFallbackEnabled',
      false,
      vscode.ConfigurationTarget.Workspace,
    );
    await configuration.update(
      'translation.retry.maxAttempts',
      4,
      vscode.ConfigurationTarget.Workspace,
    );

    const result = getExtensionConfiguration();

    assert.strictEqual(result.translation.apiBaseUrl, 'https://example.com/v1');
    assert.strictEqual(result.translation.apiKey, 'secret-key');
    assert.strictEqual(result.translation.model, 'gpt-test');
    assert.strictEqual(result.translation.targetLanguage, 'fr');
    assert.strictEqual(result.translation.timeoutMs, 45000);
    assert.strictEqual(result.translation.adaptiveBatchingEnabled, true);
    assert.strictEqual(result.translation.segmentMetricsLoggingEnabled, true);
    assert.strictEqual(result.translation.concurrencyLimit, 3);
    assert.strictEqual(result.translation.parallelismFallbackEnabled, false);
    assert.strictEqual(result.translation.retryMaxAttempts, 4);
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

  test('stores and retrieves segment cache entries', () => {
    const cache = new TranslationCache({ ttlMs: 1000, maxEntries: 2 });
    const doc = new InMemoryTextDocument(vscode.Uri.parse('file:///doc.md'), 1);
    const config: ResolvedTranslationConfiguration = {
      apiBaseUrl: 'https://example.com',
      apiKey: 'sk-example',
      model: 'gpt-test',
      targetLanguage: 'en',
      timeoutMs: 1000,
    };

    const segment = 'Segment content.';
    const result: RawTranslationResult = {
      markdown: 'cached translation',
      providerId: 'mock',
      latencyMs: 12,
    };

    cache.setSegment(doc, config, segment, result);

    const hit = cache.getSegment(doc, config, segment);
    assert.ok(hit);
    assert.strictEqual(hit?.markdown, result.markdown);
    assert.strictEqual(hit?.providerId, result.providerId);

    cache.clearForDocument(doc);
    const afterClear = cache.getSegment(doc, config, segment);
    assert.strictEqual(afterClear, undefined);
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
      adaptiveBatchingEnabled: false,
      segmentMetricsLoggingEnabled: false,
      concurrencyLimit: 1,
      parallelismFallbackEnabled: true,
      retryMaxAttempts: 3,
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

  test('emits placeholder content when translation fails without cache', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Translation Error Test)');
    let attemptCount = 0;
    const client: Partial<OpenAITranslationClient> = {
      translate: async (): Promise<RawTranslationResult> => {
        attemptCount += 1;
        throw new Error('boom');
      },
    };

    const fallbackConfiguration: ExtensionConfiguration = {
      ...configuration,
      translation: {
        ...configuration.translation,
        retryMaxAttempts: 1,
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'Source <script>alert(1)</script>',
    });

    const segments: Array<{ index: number; recoveryType: string | undefined }> = [];

    const result = await service.translateDocument(
      {
        document,
        configuration: fallbackConfiguration,
        resolvedConfig,
        cache: new TranslationCache(),
      },
      {
        onSegment: (update) => {
          segments.push({ index: update.segmentIndex, recoveryType: update.recovery?.type });
        },
      },
    );

    assert.strictEqual(attemptCount, 1);
    assert.strictEqual(segments.length, 1);
    assert.strictEqual(segments[0]?.recoveryType, 'placeholder');
    assert.ok(result.recoveries);
    assert.strictEqual(result.recoveries?.length, 1);
    assert.strictEqual(result.recoveries?.[0]?.type, 'placeholder');
    assert.ok(result.markdown.includes('Source <script>alert(1)</script>'));

    logger.dispose();
  });

  test('raises structured error on authentication failure', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Auth Error Test)');
    const client: Partial<OpenAITranslationClient> = {
      translate: async (): Promise<RawTranslationResult> => {
        throw new TranslationProviderError('Unauthorized', {
          code: 'authentication',
          retryable: false,
        });
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# Heading',
    });

    await assert.rejects(
      service.translateDocument({
        document,
        configuration,
        resolvedConfig,
        cache: new TranslationCache(),
      }),
      (error: unknown) => {
        assert.ok(error instanceof TranslationRunError);
        assert.strictEqual(error.code, 'authentication');
        return true;
      },
    );

    logger.dispose();
  });

  test('invokes segment handler for each translated paragraph', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Translation Segments Test)');
    let callCount = 0;
    const client: Partial<OpenAITranslationClient> = {
      translate: async ({ documentText }: TranslateRequest): Promise<RawTranslationResult> => {
        callCount += 1;
        return {
          markdown: `translated: ${documentText}`,
          providerId: 'stub-provider',
          latencyMs: 5,
        };
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'First paragraph.\n\nSecond paragraph.\nStill second.',
    });

    const segments: Array<{ index: number; total: number }> = [];

    const result = await service.translateDocument(
      {
        document,
        configuration,
        resolvedConfig,
      },
      {
        onSegment: (update) => {
          segments.push({ index: update.segmentIndex, total: update.totalSegments });
        },
      },
    );

    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(segments, [
      { index: 0, total: 2 },
      { index: 1, total: 2 },
    ]);
    assert.ok(result.markdown.includes('translated: First paragraph.'));
    assert.ok(result.markdown.includes('translated: Second paragraph.\nStill second.'));

    logger.dispose();
  });

  test('adaptive batching merges short segments when enabled', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Adaptive Segments Test)');
    let callCount = 0;
    const translatedSegments: string[] = [];
    const client: Partial<OpenAITranslationClient> = {
      translate: async ({ documentText }: TranslateRequest): Promise<RawTranslationResult> => {
        callCount += 1;
        translatedSegments.push(documentText);
        return {
          markdown: `translated: ${documentText}`,
          providerId: 'stub-provider',
          latencyMs: 7,
        };
      },
    };

    const adaptiveConfiguration: ExtensionConfiguration = {
      ...configuration,
      translation: {
        ...configuration.translation,
        adaptiveBatchingEnabled: true,
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'Short one.\n\nShort two.\n\nShort three.',
    });

    const segments: Array<{ index: number; total: number }> = [];

    const result = await service.translateDocument(
      {
        document,
        configuration: adaptiveConfiguration,
        resolvedConfig,
      },
      {
        onSegment: (update) => {
          segments.push({ index: update.segmentIndex, total: update.totalSegments });
        },
      },
    );

    assert.strictEqual(callCount, 1);
    assert.deepStrictEqual(segments, [{ index: 0, total: 1 }]);
    assert.ok(result.markdown.includes('translated: Short one.'));
    assert.ok(result.markdown.includes('Short three.'));
    assert.strictEqual(translatedSegments[0].includes('Short two.'), true);

    logger.dispose();
  });

  test('parallel scheduler preserves segment order', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Parallel Order Test)');
    const callOrder: number[] = [];
    const emissionOrder: number[] = [];

    const client: Partial<OpenAITranslationClient> = {
      translate: async ({ fileName, documentText }: TranslateRequest): Promise<RawTranslationResult> => {
        const match = /#segment-(\d+)/.exec(fileName);
        const index = match ? Number(match[1]) - 1 : 0;
        callOrder.push(index);

        if (index === 0) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        } else if (index === 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        return {
          markdown: `translated-${index}: ${documentText}`,
          providerId: 'stub-provider',
          latencyMs: index + 1,
        };
      },
    };

    const parallelConfiguration: ExtensionConfiguration = {
      ...configuration,
      translation: {
        ...configuration.translation,
        concurrencyLimit: 2,
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'Alpha paragraph.\n\nBeta paragraph.\n\nGamma paragraph.',
    });

    const result = await service.translateDocument(
      {
        document,
        configuration: parallelConfiguration,
        resolvedConfig,
      },
      {
        onSegment: (update) => {
          emissionOrder.push(update.segmentIndex);
        },
      },
    );

    assert.deepStrictEqual(emissionOrder, [0, 1, 2]);
    assert.strictEqual(result.markdown.includes('translated-0'), true);
    assert.strictEqual(result.markdown.includes('translated-1'), true);
    assert.strictEqual(result.markdown.includes('translated-2'), true);
    assert.strictEqual(callOrder.length, 3);
    assert.strictEqual(
      result.markdown.indexOf('translated-0') < result.markdown.indexOf('translated-1'),
      true,
    );
    assert.strictEqual(
      result.markdown.indexOf('translated-1') < result.markdown.indexOf('translated-2'),
      true,
    );

    logger.dispose();
  });

  test('parallel scheduler falls back to serial on failure when enabled', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Parallel Fallback Test)');
    const failureCounts = new Map<number, number>();
    const segmentUpdates = new Map<number, string>();

    const client: Partial<OpenAITranslationClient> = {
      translate: async ({ fileName, documentText }: TranslateRequest): Promise<RawTranslationResult> => {
        const match = /#segment-(\d+)/.exec(fileName);
        const index = match ? Number(match[1]) - 1 : 0;

        if (index === 1 && (failureCounts.get(index) ?? 0) === 0) {
          failureCounts.set(index, 1);
          throw new Error('synthetic failure');
        }

        return {
          markdown: `final-${index}: ${documentText}`,
          providerId: 'stub-provider',
          latencyMs: 4,
        };
      },
    };

    const fallbackConfiguration: ExtensionConfiguration = {
      ...configuration,
      translation: {
        ...configuration.translation,
        concurrencyLimit: 2,
        parallelismFallbackEnabled: true,
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'One paragraph.\n\nTwo paragraph.\n\nThree paragraph.',
    });

    const result = await service.translateDocument(
      {
        document,
        configuration: fallbackConfiguration,
        resolvedConfig,
      },
      {
        onSegment: (update) => {
          segmentUpdates.set(update.segmentIndex, update.markdown);
        },
      },
    );

    assert.strictEqual(failureCounts.get(1), 1);
    assert.strictEqual(segmentUpdates.size, 3);
    assert.strictEqual(segmentUpdates.get(1)?.startsWith('final-1'), true);
    assert.strictEqual(result.markdown.includes('final-0'), true);
    assert.strictEqual(result.markdown.includes('final-1'), true);
    assert.strictEqual(result.markdown.includes('final-2'), true);

    logger.dispose();
  });

  test('segment cache prevents repeated provider calls', async () => {
    const logger = new ExtensionLogger('Babel MD Viewer (Segment Cache Test)');
    const cache = new TranslationCache({ ttlMs: 1000 });
    let callCount = 0;

    const client: Partial<OpenAITranslationClient> = {
      translate: async ({ documentText }: TranslateRequest): Promise<RawTranslationResult> => {
        callCount += 1;
        return {
          markdown: `cached-${documentText}`,
          providerId: 'stub-provider',
          latencyMs: 2,
        };
      },
    };

    const cachedConfiguration: ExtensionConfiguration = {
      ...configuration,
      translation: {
        ...configuration.translation,
        concurrencyLimit: 2,
      },
    };

    const service = new TranslationService(logger, client as OpenAITranslationClient);
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: 'Cache me first.\n\nCache me second.',
    });

    await service.translateDocument(
      {
        document,
        configuration: cachedConfiguration,
        resolvedConfig,
        cache,
      },
      {
        onSegment: () => undefined,
      },
    );

    assert.strictEqual(callCount, 2);

    const cachedSegments: Array<{ index: number; wasCached: boolean }> = [];
    await service.translateDocument(
      {
        document,
        configuration: cachedConfiguration,
        resolvedConfig,
        cache,
      },
      {
        onSegment: (update) => {
          cachedSegments.push({ index: update.segmentIndex, wasCached: update.wasCached });
        },
      },
    );

    assert.strictEqual(callCount, 2);
    assert.deepStrictEqual(cachedSegments, [
      { index: 0, wasCached: true },
      { index: 1, wasCached: true },
    ]);

    logger.dispose();
  });
});
