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

if (!(outputElement instanceof HTMLDivElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-content.');
}

if (!(statusElement instanceof HTMLParagraphElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-status.');
}

if (!(errorElement instanceof HTMLDivElement)) {
  throw new Error('Translation preview DOM failed to initialize: preview-error.');
}

const outputContainer = outputElement;
const statusContainer = statusElement;
const errorContainer = errorElement;

function postMessage(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

function renderMarkdown(markdown: string): void {
  outputContainer.textContent = markdown;
}

function setLoading(isLoading: boolean, documentPath: string, targetLanguage: string): void {
  if (isLoading) {
    statusContainer.textContent = `Translating ${documentPath} → ${targetLanguage}…`;
  } else {
    statusContainer.textContent = '';
  }
}

function renderResult(payload: Extract<HostToWebviewMessage, { type: 'translationResult' }>['payload']): void {
  errorContainer.hidden = true;
  statusContainer.textContent = `Provider: ${payload.providerId} · Target: ${payload.targetLanguage} · Latency: ${payload.latencyMs}ms`;
  renderMarkdown(payload.markdown);
}

function renderError(message: string): void {
  errorContainer.hidden = false;
  errorContainer.textContent = message;
  statusContainer.textContent = '';
  outputContainer.textContent = '';
}
let suppressScrollEvents = false;
let suppressTimer: number | undefined;

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
      setLoading(message.payload.isLoading, message.payload.documentPath, message.payload.targetLanguage);
      break;
    case 'translationResult':
      setLoading(false, '', message.payload.targetLanguage);
      renderResult(message.payload);
      break;
    case 'translationError':
      setLoading(false, '', '');
      renderError(message.payload.message);
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
