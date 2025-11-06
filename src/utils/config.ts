import * as vscode from 'vscode';

import type { ExtensionConfiguration } from '../types/config';

export function getExtensionConfiguration(
  scope?: vscode.ConfigurationScope,
): ExtensionConfiguration {
  const configuration = vscode.workspace.getConfiguration('babelMdViewer', scope);
  const apiKeyRaw = configuration.get<string>('translation.apiKey', '').trim();

  return {
    previewTheme: configuration.get<'light' | 'dark'>('previewTheme', 'light'),
    transformPlugins: configuration.get<string[]>('transformPlugins', []),
    translation: {
      apiBaseUrl: configuration.get<string>('translation.apiBaseUrl', 'https://api.openai.com/v1'),
      apiKey: apiKeyRaw || undefined,
      model: configuration.get<string>('translation.model', 'gpt-4o-mini'),
      targetLanguage: configuration.get<string>('translation.targetLanguage', 'en'),
      timeoutMs: configuration.get<number>('translation.timeoutMs', 30000),
      adaptiveBatchingEnabled: configuration.get<boolean>('translation.enableAdaptiveBatching', false),
      segmentMetricsLoggingEnabled: configuration.get<boolean>('translation.logSegmentMetrics', false),
  concurrencyLimit: configuration.get<number>('translation.concurrencyLimit', 2),
      parallelismFallbackEnabled: configuration.get<boolean>('translation.parallelFallbackEnabled', true),
    },
  };
}
