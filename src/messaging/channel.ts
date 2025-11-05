export type HostToWebviewMessage =
  | {
      type: 'translationResult';
      payload: {
        markdown: string;
        providerId: string;
        latencyMs: number;
        targetLanguage: string;
      };
    }
  | {
      type: 'translationError';
      payload: {
        message: string;
      };
    }
  | {
      type: 'setLoading';
      payload: {
        isLoading: boolean;
        documentPath: string;
        targetLanguage: string;
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
      type: 'log';
      payload: {
        level: 'info' | 'warn' | 'error';
        message: string;
      };
    };
