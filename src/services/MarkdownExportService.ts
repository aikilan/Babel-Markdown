import * as vscode from 'vscode';
import { basename, dirname } from 'path';
import { PDFDocument } from 'pdf-lib';

import { ExtensionLogger } from '../utils/logger';
import { localize } from '../i18n/localize';

export type ExportFormat = 'png' | 'pdf';

interface ExportRequest {
  format: ExportFormat;
  dataUri: string;
  documentUri?: vscode.Uri;
  fileNameHint?: string;
  width?: number;
  height?: number;
}

const PX_PER_INCH = 96;
const PDF_POINTS_PER_INCH = 72;

export class MarkdownExportService {
  constructor(private readonly logger: ExtensionLogger) {}

  async export(request: ExportRequest): Promise<boolean> {
    const fileName = this.buildFileName(request);
    const defaultDir = this.getDefaultDirectory(request.documentUri);
    const target = await vscode.window.showSaveDialog({
      defaultUri: fileName ? this.buildDefaultUri(fileName, request.format, defaultDir) : defaultDir,
      filters:
        request.format === 'png'
          ? { [localize('export.fileFilter.image')]: ['png'] }
          : { [localize('export.fileFilter.pdf')]: ['pdf'] },
      saveLabel:
        request.format === 'png'
          ? localize('export.saveLabel.image')
          : localize('export.saveLabel.pdf'),
    });

    if (!target) {
      return false;
    }

    try {
      const buffer = this.decodeDataUri(request.dataUri);

      if (request.format === 'png') {
        await vscode.workspace.fs.writeFile(target, buffer);
      } else {
        const pdfBytes = await this.wrapImageInPdf(buffer, request.width, request.height);
        await vscode.workspace.fs.writeFile(target, pdfBytes);
      }

      const messageKey =
        request.format === 'png' ? 'export.success.image' : 'export.success.pdf';
      void vscode.window.showInformationMessage(
        localize(messageKey, { path: target.fsPath }),
      );
      return true;
    } catch (error) {
      this.logger.error('Failed to export preview.', error);
      void vscode.window.showErrorMessage(localize('export.failure.generic'));
      return false;
    }
  }

  private buildFileName(request: ExportRequest): string | undefined {
    if (request.fileNameHint && request.fileNameHint.trim()) {
      return request.fileNameHint;
    }

    if (request.documentUri?.scheme === 'file') {
      return basename(request.documentUri.fsPath);
    }

    if (request.documentUri) {
      return basename(request.documentUri.path);
    }

    return undefined;
  }

  private buildDefaultUri(
    fileName: string,
    format: ExportFormat,
    directory?: vscode.Uri,
  ): vscode.Uri | undefined {
    const sanitized = this.stripExtension(fileName);
    const file =
      format === 'png'
        ? `${sanitized}.png`
        : `${sanitized}.pdf`;

    if (!directory) {
      return undefined;
    }

    return vscode.Uri.joinPath(directory, file);
  }

  private stripExtension(fileName: string): string {
    const index = fileName.lastIndexOf('.');
    if (index === -1) {
      return fileName;
    }
    return fileName.slice(0, index);
  }

  private getDefaultDirectory(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri?.scheme === 'file') {
      const folderPath = dirname(uri.fsPath);
      return vscode.Uri.file(folderPath);
    }

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.workspace.workspaceFolders[0].uri;
    }

    return undefined;
  }

  private decodeDataUri(dataUri: string): Uint8Array {
    const matches = /^data:(?<mime>.+);base64,(?<content>.+)$/u.exec(dataUri);
    if (!matches?.groups?.content) {
      throw new Error('Invalid data URI payload.');
    }

    return Buffer.from(matches.groups.content, 'base64');
  }

  private async wrapImageInPdf(
    imageBuffer: Uint8Array,
    width?: number,
    height?: number,
  ): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const embedded = await pdf.embedPng(imageBuffer);

    const fallbackWidth = embedded.width;
    const fallbackHeight = embedded.height;

    const pixelWidth = Number.isFinite(width) && width ? width : fallbackWidth;
    const pixelHeight = Number.isFinite(height) && height ? height : fallbackHeight;

    const pageWidth = this.pxToPoints(pixelWidth);
    const pageHeight = this.pxToPoints(pixelHeight);

    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });

    return pdf.save();
  }

  private pxToPoints(px: number): number {
    return (px / PX_PER_INCH) * PDF_POINTS_PER_INCH;
  }
}
