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
const EXPORT_PADDING_PX = 24;

async function captureElement(element: HTMLElement): Promise<ExportResult> {
  const deviceRatio = window.devicePixelRatio || 1;
  const pixelRatio = Math.min(MAX_PIXEL_RATIO, deviceRatio * DEFAULT_PIXEL_RATIO);
  const background = window
    .getComputedStyle(document.body)
    .getPropertyValue('background-color') || '#ffffff';

  const baseDataUrl = await toPng(element, {
    cacheBust: true,
    backgroundColor: background,
    pixelRatio,
  });

  if (EXPORT_PADDING_PX <= 0) {
    const { width, height } = await getImageDimensions(baseDataUrl);
    return { dataUrl: baseDataUrl, width, height };
  }

  return addHorizontalPadding(baseDataUrl, EXPORT_PADDING_PX, background);
}

function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return loadImage(dataUrl).then((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error('Failed to calculate export dimensions.'));
    };
    image.src = dataUrl;
  });
}

async function addHorizontalPadding(
  dataUrl: string,
  paddingPx: number,
  backgroundColor: string,
): Promise<ExportResult> {
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const paddedWidth = width + paddingPx * 2;
  const canvas = document.createElement('canvas');
  canvas.width = paddedWidth;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to prepare export canvas.');
  }

  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, paddedWidth, height);
  context.drawImage(image, paddingPx, 0);

  const paddedDataUrl = canvas.toDataURL('image/png');

  return {
    dataUrl: paddedDataUrl,
    width: paddedWidth,
    height,
  };
}

if (typeof window !== 'undefined') {
  window.__babelMdViewerExport = {
    captureElement,
  };
}
