import type { HostToWebviewMessage, WebviewToHostMessage } from '../messaging/channel';

declare const acquireVsCodeApi: <T>() => {
  postMessage(message: T): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = (typeof acquireVsCodeApi !== 'undefined'
  ? acquireVsCodeApi()
  : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined });

const outputElement = document.getElementById('preview-content');
const statusElement = document.getElementById('preview-status');
const errorElement = document.getElementById('preview-error');
const retryElement = document.getElementById('preview-retry');

if (!(outputElement instanceof HTMLElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-content.');
}

if (!(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-status.');
}

if (!(errorElement instanceof HTMLDivElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-error.');
}

if (!(retryElement instanceof HTMLButtonElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-retry.');
}

const outputContainer = outputElement;
const statusContainer = statusElement;
const errorContainer = errorElement;
const retryButton = retryElement;

function postMessage(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

let lastDocumentPath = '';
let lastTargetLanguage = '';
let pendingRetry = false;
let totalSegments = 0;
let completedSegments = 0;

function resetStreamingState(): void {
  totalSegments = 0;
  completedSegments = 0;
}

function renderHtml(html: string): void {
  outputContainer.innerHTML = html;
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
    const documentLabel = lastDocumentPath || 'current document';
    const languageLabel = lastTargetLanguage || 'configured language';
    const segmentLabel = totalSegments > 0 ? ` (0/${totalSegments})` : '';
    statusContainer.textContent = `Translating ${documentLabel} → ${languageLabel}${segmentLabel}…`;
    retryButton.hidden = true;
    retryButton.disabled = true;
  } else if (!pendingRetry) {
    statusContainer.textContent = '';
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
    metaSegments.push('cached');
  }

  statusContainer.textContent = `Translated ${payload.documentPath} → ${payload.targetLanguage} — ${metaSegments.join(' · ')}`;
  renderHtml(payload.html);
}

function renderError(payload: Extract<HostToWebviewMessage, { type: 'translationError' }>['payload']): void {
  pendingRetry = false;
  resetStreamingState();
  errorContainer.hidden = false;
  const messageSegments = [
    `Failed to translate ${payload.documentPath} → ${payload.targetLanguage}: ${payload.message}`,
  ];

  if (payload.hint) {
    messageSegments.push(payload.hint);
  }

  errorContainer.textContent = messageSegments.join(' ');
  statusContainer.dataset.state = 'idle';
  statusContainer.textContent = payload.hint
    ? `${payload.hint}`
    : `Last attempt · ${payload.documentPath} → ${payload.targetLanguage}`;
  outputContainer.innerHTML = '';
  retryButton.hidden = false;
  retryButton.disabled = false;
}
let suppressScrollEvents = false;
let suppressTimer: number | undefined;

function appendChunk(
  payload: Extract<HostToWebviewMessage, { type: 'translationChunk' }>['payload'],
): void {
  completedSegments = Math.max(completedSegments, payload.segmentIndex + 1);
  totalSegments = Math.max(totalSegments, payload.totalSegments);

  const wrapper = document.createElement('section');
  wrapper.className = 'preview__chunk';
  wrapper.dataset.chunkIndex = payload.segmentIndex.toString();
  wrapper.innerHTML = payload.html;
  outputContainer.appendChild(wrapper);

  const documentLabel = lastDocumentPath || payload.documentPath;
  const languageLabel = lastTargetLanguage || payload.targetLanguage;
  statusContainer.dataset.state = 'loading';
  statusContainer.textContent = `Translating ${documentLabel} → ${languageLabel} (${completedSegments}/${totalSegments})…`;
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

retryButton.addEventListener('click', () => {
  if (pendingRetry) {
    return;
  }

  pendingRetry = true;
  retryButton.disabled = true;
  setLoading(true, lastDocumentPath, lastTargetLanguage);
  postMessage({ type: 'requestRetry' });
});
