import type { HostToWebviewMessage, WebviewToHostMessage } from '../messaging/channel';

declare const acquireVsCodeApi: <T>() => {
  postMessage(message: T): void;
  getState(): unknown;
  setState(state: unknown): void;
};

type WebviewLocaleBundle = {
  languageTag: string;
  pageTitle: string;
  retryButtonLabel: string;
  ariaContentLabel: string;
  placeholders: {
    currentDocument: string;
    configuredLanguage: string;
  };
  translations: {
    statusInProgress: string;
    progressTemplate: string;
    statusCompleted: string;
    statusCompletedWithWarnings: string;
    statusLastAttempt: string;
    errorMessage: string;
    warningCacheFallback: string;
    warningPlaceholder: string;
  };
  meta: {
    cachedLabel: string;
    recoveredLabel: string;
  };
  exportControls: {
    imageButtonLabel: string;
    pdfButtonLabel: string;
    failureMessage: string;
    inProgressMessage: string;
  };
};

declare global {
  interface Window {
    __babelMdViewerLocale?: WebviewLocaleBundle;
    __babelMdViewerExport?: {
      captureElement(element: HTMLElement): Promise<{
        dataUrl: string;
        width: number;
        height: number;
      }>;
    };
  }
}

const FALLBACK_LOCALE: WebviewLocaleBundle = {
  languageTag: 'en',
  pageTitle: 'Translation Preview',
  retryButtonLabel: 'Retry translation',
  ariaContentLabel: 'Translated Markdown',
  placeholders: {
    currentDocument: 'current document',
    configuredLanguage: 'configured language',
  },
  translations: {
    statusInProgress: 'Translating {document} → {language}{progress}…',
    progressTemplate: ' ({current}/{total})',
    statusCompleted: 'Translated {document} → {language} — {meta}',
    statusCompletedWithWarnings: 'Translated {document} → {language} — {meta} (warnings)',
    statusLastAttempt: 'Last attempt · {document} → {language}',
    errorMessage: 'Failed to translate {document} → {language}: {message}{hint}',
    warningCacheFallback: 'Reused cached translations for {count} segment(s) after errors.',
    warningPlaceholder: 'Showing original text for {count} segment(s) because translation failed.',
  },
  meta: {
    cachedLabel: 'cached',
    recoveredLabel: 'warnings',
  },
  exportControls: {
    imageButtonLabel: 'Save as PNG',
    pdfButtonLabel: 'Save as PDF',
    failureMessage: 'Unable to capture the preview for export.',
    inProgressMessage: 'Preparing export…',
  },
};

const locale: WebviewLocaleBundle =
  typeof window !== 'undefined' && window.__babelMdViewerLocale
    ? window.__babelMdViewerLocale
    : FALLBACK_LOCALE;

function format(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = params[token];

    if (value === undefined || value === null) {
      return '';
    }

    return String(value);
  });
}

function formatProgress(current: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) {
    return '';
  }

  return format(locale.translations.progressTemplate, { current, total });
}

const vscodeApi = (typeof acquireVsCodeApi !== 'undefined'
  ? acquireVsCodeApi()
  : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined });

const outputElement = document.getElementById('preview-content');
const statusElement = document.getElementById('preview-status');
const errorElement = document.getElementById('preview-error');
const warningElement = document.getElementById('preview-warning');
const retryElement = document.getElementById('preview-retry');
const exportButtonElements = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-export-format]'),
);
const exportErrorElement = document.getElementById('preview-export-error');

if (!(outputElement instanceof HTMLElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-content.');
}

if (!(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-status.');
}

if (!(errorElement instanceof HTMLDivElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-error.');
}

if (!(warningElement instanceof HTMLDivElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-warning.');
}

if (!(retryElement instanceof HTMLButtonElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-retry.');
}

for (const button of exportButtonElements) {
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('Translation preview DOM failed to initialize: export button.');
  }
}

if (exportErrorElement && !(exportErrorElement instanceof HTMLElement)) {
  throw new Error('Translation preview DOM failed to initialize: export error element.');
}

const outputContainer = outputElement;
const statusContainer = statusElement;
const errorContainer = errorElement;
const warningContainer = warningElement;
const retryButton = retryElement;
const exportButtons = exportButtonElements;
const exportErrorArea = exportErrorElement instanceof HTMLElement ? exportErrorElement : undefined;

function logExport(message: string, details?: unknown): void {
  const payload = { message, details };
  try {
    // eslint-disable-next-line no-console
    console.log('[BabelMarkdown][translation][export]', payload);
  } catch {
    // ignore console issues
  }
  postMessage({
    type: 'log',
    payload: {
      level: 'info',
      message: `[Translation Preview] ${message} ${JSON.stringify(details ?? {})}`,
    },
  });
}

retryButton.textContent = locale.retryButtonLabel;
outputContainer.setAttribute('aria-label', locale.ariaContentLabel);
disableExportButtons(false);
setExportMessage(false);

function postMessage(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

let lastDocumentPath = '';
let lastTargetLanguage = '';
let pendingRetry = false;
let totalSegments = 0;
let completedSegments = 0;
let exportInProgress = false;

function resetStreamingState(): void {
  totalSegments = 0;
  completedSegments = 0;
}

function renderHtml(html: string): void {
  outputContainer.innerHTML = html;
}

function renderSourceSegments(
  payload: Extract<HostToWebviewMessage, { type: 'translationSource' }>['payload'],
): void {
  resetStreamingState();
  totalSegments = payload.segments.length;
  completedSegments = 0;
  lastDocumentPath = payload.documentPath || lastDocumentPath;
  lastTargetLanguage = payload.targetLanguage || lastTargetLanguage;
  errorContainer.hidden = true;
  warningContainer.hidden = true;
  warningContainer.textContent = '';
  retryButton.hidden = true;
  retryButton.disabled = true;
  setExportMessage(false);

  outputContainer.innerHTML = '';

  for (const segment of payload.segments) {
    const section = document.createElement('section');
    section.className = 'preview__chunk preview__chunk--source';
    section.dataset.chunkIndex = segment.segmentIndex.toString();

    const pre = document.createElement('pre');
    pre.textContent = segment.markdown;
    section.appendChild(pre);

    outputContainer.appendChild(section);
  }

  const documentLabel = lastDocumentPath || locale.placeholders.currentDocument;
  const languageLabel = lastTargetLanguage || locale.placeholders.configuredLanguage;
  statusContainer.dataset.state = 'loading';
  statusContainer.textContent = format(locale.translations.statusInProgress, {
    document: documentLabel,
    language: languageLabel,
    progress: formatProgress(0, totalSegments),
  });
}

function setLoading(
  isLoading: boolean,
  documentPath: string,
  targetLanguage: string,
  segmentsHint?: number,
): void {
  if (documentPath) {
    lastDocumentPath = documentPath;
  }

  if (targetLanguage) {
    lastTargetLanguage = targetLanguage;
  }

  statusContainer.dataset.state = isLoading ? 'loading' : 'idle';

  if (isLoading) {
    resetStreamingState();
    if (typeof segmentsHint === 'number' && Number.isFinite(segmentsHint)) {
      totalSegments = segmentsHint;
    }
    outputContainer.innerHTML = '';
    const documentLabel = lastDocumentPath || locale.placeholders.currentDocument;
    const languageLabel = lastTargetLanguage || locale.placeholders.configuredLanguage;
    statusContainer.textContent = format(locale.translations.statusInProgress, {
      document: documentLabel,
      language: languageLabel,
      progress: formatProgress(0, totalSegments),
    });
    retryButton.hidden = true;
    retryButton.disabled = true;
    warningContainer.hidden = true;
    warningContainer.textContent = '';
    setExportMessage(false);
    disableExportButtons(true);
  } else if (!pendingRetry) {
    statusContainer.textContent = '';
    disableExportButtons(false);
  }
}

function disableExportButtons(isDisabled: boolean): void {
  for (const button of exportButtons) {
    button.disabled = isDisabled;
  }
}

function setExportMessage(isVisible: boolean, message?: string): void {
  if (!exportErrorArea) {
    return;
  }

  if (!isVisible) {
    exportErrorArea.hidden = true;
    return;
  }

  exportErrorArea.textContent = message ?? locale.exportControls.failureMessage;
  exportErrorArea.hidden = false;
}

async function requestExport(format: 'png' | 'pdf'): Promise<void> {
  if (exportInProgress) {
    return;
  }

  if (!window.__babelMdViewerExport?.captureElement) {
    setExportMessage(true);
    return;
  }

  exportInProgress = true;
  disableExportButtons(true);
  setExportMessage(true, locale.exportControls.inProgressMessage);

  try {
    logExport('Starting translation export', { format, content: 'preview' });
    const result = await window.__babelMdViewerExport.captureElement(outputContainer);
    logExport('Translation export captured', { width: result.width, height: result.height });
    postMessage({
      type: 'exportContent',
      payload: {
        format,
        dataUrl: result.dataUrl,
        width: result.width,
        height: result.height,
        content: 'preview',
      },
    });
    setExportMessage(false);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error(`Export failed: ${details}`);
    setExportMessage(true);
  } finally {
    exportInProgress = false;
    disableExportButtons(false);
  }
}

function renderResult(payload: Extract<HostToWebviewMessage, { type: 'translationResult' }>['payload']): void {
  pendingRetry = false;
  resetStreamingState();
  lastDocumentPath = payload.documentPath;
  lastTargetLanguage = payload.targetLanguage;
  errorContainer.hidden = true;
  retryButton.hidden = true;
  retryButton.disabled = false;
  statusContainer.dataset.state = 'idle';
  const metaSegments = [
    payload.providerId,
    `${payload.latencyMs}ms`,
    `v${payload.sourceVersion}`,
  ];

  if (payload.wasCached) {
    metaSegments.push(locale.meta.cachedLabel);
  }

  const cacheFallbackCount =
    payload.recoveries?.filter((entry) => entry.type === 'cacheFallback').length ?? 0;
  const placeholderCount =
    payload.recoveries?.filter((entry) => entry.type === 'placeholder').length ?? 0;
  const hasWarnings = cacheFallbackCount + placeholderCount > 0;

  if (hasWarnings) {
    metaSegments.push(locale.meta.recoveredLabel);
  }

  const documentLabel = payload.documentPath || locale.placeholders.currentDocument;
  const languageLabel = payload.targetLanguage || locale.placeholders.configuredLanguage;
  if (hasWarnings) {
    const warningMessages: string[] = [];
    if (cacheFallbackCount > 0) {
      warningMessages.push(
        format(locale.translations.warningCacheFallback, { count: cacheFallbackCount }),
      );
    }
    if (placeholderCount > 0) {
      warningMessages.push(
        format(locale.translations.warningPlaceholder, { count: placeholderCount }),
      );
    }

    warningContainer.hidden = false;
    warningContainer.textContent = warningMessages.join(' ');
  } else {
    warningContainer.hidden = true;
    warningContainer.textContent = '';
  }

  statusContainer.textContent = format(
    hasWarnings
      ? locale.translations.statusCompletedWithWarnings
      : locale.translations.statusCompleted,
    {
      document: documentLabel,
      language: languageLabel,
      meta: metaSegments.join(' · '),
    },
  );
  renderHtml(payload.html);
}

function renderError(payload: Extract<HostToWebviewMessage, { type: 'translationError' }>['payload']): void {
  pendingRetry = false;
  resetStreamingState();
  errorContainer.hidden = false;
  const documentLabel = payload.documentPath || locale.placeholders.currentDocument;
  const languageLabel = payload.targetLanguage || locale.placeholders.configuredLanguage;
  const hintSuffix = payload.hint ? ` ${payload.hint}` : '';
  errorContainer.textContent = format(locale.translations.errorMessage, {
    document: documentLabel,
    language: languageLabel,
    message: payload.message,
    hint: hintSuffix,
  });
  statusContainer.dataset.state = 'idle';
  statusContainer.textContent = payload.hint
    ? `${payload.hint}`
    : format(locale.translations.statusLastAttempt, {
        document: documentLabel,
        language: languageLabel,
      });
  outputContainer.innerHTML = '';
  retryButton.hidden = false;
  retryButton.disabled = false;
  warningContainer.hidden = true;
  warningContainer.textContent = '';
}
let suppressScrollEvents = false;
let suppressTimer: number | undefined;

function appendChunk(
  payload: Extract<HostToWebviewMessage, { type: 'translationChunk' }>['payload'],
): void {
  const wasCached = Boolean(payload.wasCached);
  completedSegments = Math.max(completedSegments, payload.segmentIndex + 1);
  totalSegments = Math.max(totalSegments, payload.totalSegments);

  const existing = outputContainer.querySelector<HTMLElement>(
    `[data-chunk-index="${payload.segmentIndex}"]`,
  );

  if (existing) {
    existing.innerHTML = payload.html;
    existing.classList.remove('preview__chunk--source');
    existing.classList.add('preview__chunk--translated');
    existing.dataset.cached = wasCached ? 'true' : 'false';
    if (wasCached) {
      existing.classList.add('preview__chunk--cached');
    } else {
      existing.classList.remove('preview__chunk--cached');
    }
    if (payload.recovery) {
      existing.dataset.recoveryType = payload.recovery.type;
      existing.classList.add('preview__chunk--recovered');
      if (payload.recovery.type === 'placeholder') {
        existing.classList.add('preview__chunk--placeholder');
        existing.classList.remove('preview__chunk--cached');
      } else {
        existing.classList.remove('preview__chunk--placeholder');
      }
    } else {
      existing.classList.remove('preview__chunk--recovered');
      existing.classList.remove('preview__chunk--placeholder');
      existing.removeAttribute('data-recovery-type');
    }
  } else {
    const wrapper = document.createElement('section');
    wrapper.className = 'preview__chunk preview__chunk--translated';
    wrapper.dataset.chunkIndex = payload.segmentIndex.toString();
    wrapper.dataset.cached = wasCached ? 'true' : 'false';
    if (wasCached) {
      wrapper.classList.add('preview__chunk--cached');
    }
    if (payload.recovery) {
      wrapper.dataset.recoveryType = payload.recovery.type;
      wrapper.classList.add('preview__chunk--recovered');
      if (payload.recovery.type === 'placeholder') {
        wrapper.classList.add('preview__chunk--placeholder');
        wrapper.classList.remove('preview__chunk--cached');
      }
    }
    wrapper.innerHTML = payload.html;
    outputContainer.appendChild(wrapper);
  }

  const documentLabel = lastDocumentPath || payload.documentPath || locale.placeholders.currentDocument;
  const languageLabel = lastTargetLanguage || payload.targetLanguage || locale.placeholders.configuredLanguage;
  statusContainer.dataset.state = 'loading';
  statusContainer.textContent = format(locale.translations.statusInProgress, {
    document: documentLabel,
    language: languageLabel,
    progress: formatProgress(completedSegments, totalSegments),
  });
  retryButton.hidden = true;
  retryButton.disabled = true;
  errorContainer.hidden = true;
}

function applyScrollSync(line: number, totalLines: number): void {
  if (totalLines <= 1) {
    suppressScrollEvents = true;
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (suppressTimer !== undefined) {
      window.clearTimeout(suppressTimer);
    }
    suppressTimer = window.setTimeout(() => {
      suppressScrollEvents = false;
    }, 50);
    return;
  }

  const clampedLine = Math.max(0, Math.min(line, totalLines - 1));
  const fraction = clampedLine / (totalLines - 1);
  const maxScroll = Math.max(document.body.scrollHeight - window.innerHeight, 0);

  suppressScrollEvents = true;
  window.scrollTo({ top: fraction * maxScroll, behavior: 'auto' });
  if (suppressTimer !== undefined) {
    window.clearTimeout(suppressTimer);
  }
  suppressTimer = window.setTimeout(() => {
    suppressScrollEvents = false;
  }, 50);
}

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'setLoading':
      setLoading(
        message.payload.isLoading,
        message.payload.documentPath,
        message.payload.targetLanguage,
        message.payload.totalSegments,
      );
      break;
    case 'translationResult':
      setLoading(false, '', message.payload.targetLanguage);
      renderResult(message.payload);
      break;
    case 'translationError':
      setLoading(false, message.payload.documentPath, message.payload.targetLanguage);
      renderError(message.payload);
      break;
    case 'translationSource':
      renderSourceSegments(message.payload);
      break;
    case 'translationChunk':
      appendChunk(message.payload);
      break;
    case 'scrollSync':
      applyScrollSync(message.payload.line, message.payload.totalLines);
      break;
    default: {
      const unexpected: never = message;
      void unexpected;
      postMessage({ type: 'log', payload: { level: 'warn', message: 'Unknown message received from host.' } });
      break;
    }
  }
});
let scrollEventQueued = false;

document.addEventListener('scroll', () => {
  if (suppressScrollEvents) {
    return;
  }

  if (scrollEventQueued) {
    return;
  }

  scrollEventQueued = true;
  window.requestAnimationFrame(() => {
    scrollEventQueued = false;
    const maxScroll = Math.max(document.body.scrollHeight - window.innerHeight, 1);
    const fraction = window.scrollY / maxScroll;
    postMessage({ type: 'requestScrollSync', payload: { fraction } });
  });
});

for (const button of exportButtons) {
  button.addEventListener('click', () => {
    const format = button.dataset.exportFormat;
    if (format === 'png' || format === 'pdf') {
      void requestExport(format);
    }
  });
}

retryButton.addEventListener('click', () => {
  if (pendingRetry) {
    return;
  }

  pendingRetry = true;
  retryButton.disabled = true;
  setLoading(true, lastDocumentPath, lastTargetLanguage);
  postMessage({ type: 'requestRetry' });
});
