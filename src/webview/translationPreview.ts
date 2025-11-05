import type { HostToWebviewMessage, WebviewToHostMessage } from '../messaging/channel';

declare const acquireVsCodeApi: <T>() => {
  postMessage(message: T): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscodeApi = (typeof acquireVsCodeApi !== 'undefined'
  ? acquireVsCodeApi()
  : { postMessage: () => undefined, getState: () => undefined, setState: () => undefined });

const outputContainer = document.getElementById('preview-content') as HTMLDivElement;
const statusContainer = document.getElementById('preview-status') as HTMLParagraphElement;
const errorContainer = document.getElementById('preview-error') as HTMLDivElement;

function postMessage(message: WebviewToHostMessage): void {
  vscodeApi.postMessage(message);
}

function renderMarkdown(markdown: string): void {
  outputContainer.innerText = markdown;
}

function setLoading(isLoading: boolean, documentPath: string, targetLanguage: string): void {
  if (isLoading) {
    statusContainer.innerText = `Translating ${documentPath} → ${targetLanguage}…`;
  } else {
    statusContainer.innerText = '';
  }
}

function renderResult(payload: Extract<HostToWebviewMessage, { type: 'translationResult' }>['payload']): void {
  errorContainer.style.display = 'none';
  statusContainer.innerText = `Provider: ${payload.providerId} · Target: ${payload.targetLanguage} · Latency: ${payload.latencyMs}ms`;
  renderMarkdown(payload.markdown);
}

function renderError(message: string): void {
  errorContainer.style.display = 'block';
  errorContainer.innerText = message;
  statusContainer.innerText = '';
  outputContainer.innerText = '';
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
    default:
      postMessage({ type: 'log', payload: { level: 'warn', message: `Unknown message type: ${message.type}` } });
      break;
  }
});

document.addEventListener('scroll', () => {
  const fraction = window.scrollY / Math.max(document.body.scrollHeight - window.innerHeight, 1);
  postMessage({ type: 'requestScrollSync', payload: { fraction } });
});
