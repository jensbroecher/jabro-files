import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

let sharedWorkerBlobUrl: string | null = null;

/**
 * Returns a self-contained in-memory Blob URL for the PDF worker.
 * Guaranteed zero network requests, works in dev, ASAR packages, portable executables, and file:// contexts.
 */
export function getPdfWorkerBlobUrl(): string | null {
  if (typeof window === 'undefined') return null;
  if (!sharedWorkerBlobUrl && pdfjsWorkerSrc) {
    try {
      const blob = new Blob([pdfjsWorkerSrc], { type: 'application/javascript' });
      sharedWorkerBlobUrl = URL.createObjectURL(blob);
    } catch (err) {
      console.warn('[pdfWorker] Could not create worker blob:', err);
    }
  }
  return sharedWorkerBlobUrl;
}

/**
 * Creates a dedicated Web Worker and wraps it in a PDFWorker port.
 * This directly bypasses Chromium's file:// origin checks and prevents PDF.js from hanging on CDN wrappers.
 */
export function createDedicatedPdfWorker(): { workerInstance: Worker; pdfWorker: pdfjsLib.PDFWorker } | null {
  const blobUrl = getPdfWorkerBlobUrl();
  if (!blobUrl) return null;
  try {
    const workerInstance = new Worker(blobUrl, { type: 'module' });
    const pdfWorker = pdfjsLib.PDFWorker.fromPort({ port: workerInstance });
    return { workerInstance, pdfWorker };
  } catch (err) {
    console.warn('[pdfWorker] Could not instantiate dedicated PDF worker:', err);
    return null;
  }
}
