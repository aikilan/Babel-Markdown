export type TranslationErrorCode =
  | 'authentication'
  | 'timeout'
  | 'rateLimit'
  | 'network'
  | 'server'
  | 'invalidResponse'
  | 'unknown';

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
  recoveries?: TranslationRecovery[];
}

export interface CachedSegmentResult extends RawTranslationResult {
  fingerprint: string;
}

export interface TranslationRecovery {
  segmentIndex: number;
  code: TranslationErrorCode;
  type: 'cacheFallback' | 'placeholder';
  attempts: number;
  message: string;
}
