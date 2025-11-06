export interface ResolvedTranslationConfiguration {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  targetLanguage: string;
  timeoutMs: number;
}

export interface RawTranslationResult {
  markdown: string;
  providerId: string;
  latencyMs: number;
}

export interface TranslationResult extends RawTranslationResult {
  html: string;
}

export interface CachedSegmentResult extends RawTranslationResult {
  fingerprint: string;
}
