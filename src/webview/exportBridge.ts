import { toPng } from 'html-to-image';

type ExportResult = {
  dataUrl: string;
  width: number;
  height: number;
};

declare global {
  interface Window {
    __babelMdViewerExport?: {
      captureElement(element: HTMLElement): Promise<ExportResult>;
    };
  }
}

const DEFAULT_PIXEL_RATIO = 1.5;
const MAX_PIXEL_RATIO = 3;

async function captureElement(element: HTMLElement): Promise<ExportResult> {
  const deviceRatio = window.devicePixelRatio || 1;
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, deviceRatio * DEFAULT_PIXEL_RATIO);
  const rect = element.getBoundingClientRect();
  const width = rect.width * pixelRatio;
  const height = rect.height * pixelRatio;
  const background = window
    .getComputedStyle(document.body)
    .getPropertyValue('background-color') || '#ffffff';

  const dataUrl = await toPng(element, {
    cacheBust: true,
    backgroundColor: background,
    pixelRatio,
  });

  return { dataUrl, width, height };
}

if (typeof window !== 'undefined') {
  window.__babelMdViewerExport = {
    captureElement,
  };
}
