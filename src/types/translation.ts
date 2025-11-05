export interface ResolvedTranslationConfiguration {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
  timeoutMs: number;
}

export interface TranslationResult {
  markdown: string;
  providerId: string;
  latencyMs: number;
}
