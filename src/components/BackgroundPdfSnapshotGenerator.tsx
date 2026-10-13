import React, { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { createDedicatedPdfWorker } from '../utils/pdfWorker';

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileCount?: number;
  dirCount?: number;
  mtime: string;
  ext?: string;
}

interface BackgroundPdfSnapshotGeneratorProps {
  entries: DirEntry[];
}

export const BackgroundPdfSnapshotGenerator: React.FC<BackgroundPdfSnapshotGeneratorProps> = ({ entries }) => {
  const processedPathsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<DirEntry[]>([]);
  const isProcessingRef = useRef<boolean>(false);
  const totalBatchRef = useRef<number>(0);
  const processedBatchRef = useRef<number>(0);

  // Clean up any pending status when unmounting
  useEffect(() => {
    return () => {
      try {
        window.dispatchEvent(
          new CustomEvent('jabro-bg-activity', {
            detail: { active: false, text: '', subtext: '' },
          })
        );
      } catch {}
    };
  }, []);

  const processQueue = async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const api = typeof window !== 'undefined' ? (window as any).api : null;
    if (!api?.saveThumbnailCache) {
      isProcessingRef.current = false;
      return;
    }

    while (queueRef.current.length > 0) {
      const entry = queueRef.current.shift();
      if (!entry) continue;

      processedBatchRef.current++;
      const currentIdx = processedBatchRef.current;
      const total = totalBatchRef.current;

      try {
        window.dispatchEvent(
          new CustomEvent('jabro-bg-activity', {
            detail: {
              active: true,
              text: 'Generating PDF preview',
              subtext: `${currentIdx}/${total}: ${entry.name}`,
            },
          })
        );
      } catch {}

      const filePath = entry.path;

      try {
        await new Promise<void>((resolve) => {
          let isDone = false;
          const finish = () => {
            if (!isDone) {
              isDone = true;
              resolve();
            }
          };

          const timeoutId = setTimeout(() => {
            console.warn('[BackgroundPdfSnapshotGenerator] PDF thumbnail timed out for:', filePath);
            finish();
          }, 8000);

          (async () => {
            let doc: pdfjsLib.PDFDocumentProxy | null = null;
            let workerObj: ReturnType<typeof createDedicatedPdfWorker> = null;

            try {
              let pdfData: Uint8Array | null = null;

              if (api.readBinaryFile) {
                try {
                  const raw = await api.readBinaryFile(filePath);
                  if (raw) {
                    pdfData = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
                  }
                } catch {}
              }

              if (!pdfData) {
                const mediaUrl = `jabro-media://localhost?path=${encodeURIComponent(filePath)}`;
                const response = await fetch(mediaUrl);
                if (response.ok) {
                  const buf = await response.arrayBuffer();
                  pdfData = new Uint8Array(buf);
                }
              }

              if (!pdfData) {
                clearTimeout(timeoutId);
                finish();
                return;
              }

              workerObj = createDedicatedPdfWorker();
              const loadingTask = pdfjsLib.getDocument({
                data: pdfData,
                worker: workerObj ? workerObj.pdfWorker : undefined,
                cMapPacked: true,
              });

              doc = await loadingTask.promise;
              const page = await doc.getPage(1);

              const origViewport = page.getViewport({ scale: 1.0 });
              const maxDim = 256;
              const scale = Math.min(maxDim / origViewport.width, maxDim / origViewport.height);
              const viewport = page.getViewport({ scale: Math.max(0.1, scale) });

              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.floor(viewport.width));
              canvas.height = Math.max(1, Math.floor(viewport.height));
              const ctx = canvas.getContext('2d');

              if (ctx) {
                // Fill clean crisp white paper background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                await page.render({
                  canvasContext: ctx,
                  viewport,
                }).promise;

                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                if (dataUrl && dataUrl.length > 200) {
                  const ok = await api.saveThumbnailCache(filePath, dataUrl, entry.mtime, entry.size);
                  if (ok) {
                    window.dispatchEvent(
                      new CustomEvent('jabro-thumbnail-saved', {
                        detail: { filePath, mtime: entry.mtime, size: entry.size },
                      })
                    );
                  }
                }
              }
            } catch (renderErr) {
              console.warn('[BackgroundPdfSnapshotGenerator] Render failed for:', filePath, renderErr);
            } finally {
              clearTimeout(timeoutId);
              if (doc) {
                try { doc.destroy(); } catch {}
              }
              if (workerObj) {
                try { workerObj.pdfWorker.destroy(); } catch {}
              }
              finish();
            }
          })();
        });
      } catch (err) {
        console.warn('[BackgroundPdfSnapshotGenerator] Queue item error:', filePath, err);
      }

      // Small 25ms yield to keep browser thread completely buttery smooth
      await new Promise((r) => setTimeout(r, 25));
    }

    isProcessingRef.current = false;
    totalBatchRef.current = 0;
    processedBatchRef.current = 0;

    try {
      window.dispatchEvent(
        new CustomEvent('jabro-bg-activity', {
          detail: { active: false, text: '', subtext: '' },
        })
      );
    } catch {}
  };

  // Enqueue uncached PDF items whenever entries change
  useEffect(() => {
    const api = typeof window !== 'undefined' ? (window as any).api : null;
    if (!api?.saveThumbnailCache) return;

    const pdfEntries = entries.filter((e) => {
      if (!e || e.isDirectory || !e.name) return false;
      const lower = e.name.toLowerCase();
      return lower.endsWith('.pdf') && !processedPathsRef.current.has(e.path);
    });

    if (pdfEntries.length === 0) return;

    // Check which ones are already cached
    (async () => {
      let uncachedList = pdfEntries;
      if (api.getThumbnailsBatch) {
        try {
          const cachedMap = await api.getThumbnailsBatch(
            pdfEntries.map((e) => ({
              filePath: e.path,
              mtime: e.mtime || '',
              size: e.size,
            }))
          );
          uncachedList = pdfEntries.filter((e) => !cachedMap[e.path]);
          // Mark already cached items as processed
          for (const e of pdfEntries) {
            if (cachedMap[e.path]) {
              processedPathsRef.current.add(e.path);
            }
          }
        } catch {}
      }

      if (uncachedList.length === 0) return;

      for (const e of uncachedList) {
        processedPathsRef.current.add(e.path);
        queueRef.current.push(e);
      }

      totalBatchRef.current += uncachedList.length;
      processQueue();
    })();
  }, [entries]);

  return null;
};
