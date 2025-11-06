export interface TranslationConfiguration {
  apiBaseUrl: string;
  apiKey?: string;
  model: string;
  targetLanguage: string;
  timeoutMs: number;
  adaptiveBatchingEnabled: boolean;
  segmentMetricsLoggingEnabled: boolean;
  concurrencyLimit: number;
  parallelismFallbackEnabled: boolean;
  retryMaxAttempts: number;
}

export interface ExtensionConfiguration {
  previewTheme: 'light' | 'dark';
  transformPlugins: string[];
  translation: TranslationConfiguration;
}
