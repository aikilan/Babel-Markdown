import type { TranslationErrorCode } from '../types/translation';

type SerializedSegmentRecovery = {
  type: 'cacheFallback' | 'placeholder';
  code: TranslationErrorCode;
  attempts: number;
  message: string;
};

export type HostToWebviewMessage =
  | {
      type: 'translationResult';
      payload: {
        markdown: string;
        html: string;
        providerId: string;
        latencyMs: number;
        targetLanguage: string;
        documentPath: string;
        sourceVersion: number;
        wasCached: boolean;
        recoveries?: SerializedSegmentRecovery[];
      };
    }
  | {
      type: 'translationError';
      payload: {
        message: string;
        documentPath: string;
        targetLanguage: string;
        hint?: string;
      };
    }
  | {
      type: 'setLoading';
      payload: {
        isLoading: boolean;
        documentPath: string;
        targetLanguage: string;
        totalSegments?: number;
      };
    }
  | {
      type: 'translationSource';
      payload: {
        documentPath: string;
        targetLanguage: string;
        segments: Array<{
          segmentIndex: number;
          markdown: string;
        }>;
      };
    }
  | {
      type: 'translationChunk';
      payload: {
        segmentIndex: number;
        totalSegments: number;
        markdown: string;
        html: string;
        providerId: string;
        latencyMs: number;
        documentPath: string;
        targetLanguage: string;
        wasCached: boolean;
        recovery?: SerializedSegmentRecovery;
      };
    }
  | {
      type: 'scrollSync';
      payload: {
        line: number;
        totalLines: number;
      };
    };

export type WebviewToHostMessage =
  | {
      type: 'requestScrollSync';
      payload: {
        fraction: number;
      };
    }
  | {
      type: 'requestRetry';
    }
  | {
      type: 'exportContent';
      payload: {
        format: 'png' | 'pdf';
        dataUrl: string;
        width: number;
        height: number;
      };
    }
  | {
      type: 'log';
      payload: {
        level: 'info' | 'warn' | 'error';
        message: string;
      };
    };
