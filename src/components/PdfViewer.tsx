import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { createDedicatedPdfWorker } from '../utils/pdfWorker';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  Download,
  Loader2,
  AlertCircle,
  FileText,
  Maximize2,
  PanelLeftClose,
  PanelLeft,
  Rows,
  Square
} from 'lucide-react';

interface PdfViewerProps {
  filePath: string;
  fileName: string;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({ filePath, fileName }) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.2);
  const [rotation, setRotation] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [showThumbnails, setShowThumbnails] = useState<boolean>(true);
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>('single');
  const [pageInput, setPageInput] = useState<string>('1');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const continuousContainerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<any>(null);
  const continuousCanvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const activeWorkerRef = useRef<pdfjsLib.PDFWorker | null>(null);
  const activeDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  // 1. Load the PDF document
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    setPageInput('1');

    // Clean up any previously opened document and worker
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {}
      renderTaskRef.current = null;
    }
    if (activeDocRef.current) {
      try {
        activeDocRef.current.destroy();
      } catch {}
      activeDocRef.current = null;
    }
    if (activeWorkerRef.current) {
      try {
        activeWorkerRef.current.destroy();
      } catch {}
      activeWorkerRef.current = null;
    }

    async function loadDocument() {
      try {
        let pdfData: Uint8Array | null = null;

        // Try reading via preload API first (zero CORS, direct local disk read)
        if (window.api && typeof window.api.readBinaryFile === 'function') {
          try {
            const raw = await window.api.readBinaryFile(filePath);
            if (raw) {
              pdfData = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
            }
          } catch (e) {
            console.warn('[PdfViewer] readBinaryFile failed, trying fetch fallback:', e);
          }
        }

        // Fallback to fetch via custom scheme
        if (!pdfData) {
          const mediaUrl = `jabro-media://localhost?path=${encodeURIComponent(filePath)}`;
          const response = await fetch(mediaUrl);
          if (!response.ok) {
            throw new Error(`Failed to load PDF (${response.status} ${response.statusText})`);
          }
          const buffer = await response.arrayBuffer();
          pdfData = new Uint8Array(buffer);
        }

        if (isCancelled) return;

        // Create a direct dedicated Web Worker port to bypass Chromium file:// origin restrictions
        let pdfWorker: pdfjsLib.PDFWorker | undefined;
        const dedicated = createDedicatedPdfWorker();
        if (dedicated) {
          pdfWorker = dedicated.pdfWorker;
          activeWorkerRef.current = pdfWorker;
        }

        const loadingTask = pdfjsLib.getDocument({
          data: pdfData,
          cMapPacked: true,
          worker: pdfWorker,
        });

        // 10-second timeout guard to ensure user never gets stuck loading forever
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('PDF loading timed out.')), 10000);
        });

        const doc = await Promise.race([loadingTask.promise, timeoutPromise]);
        if (isCancelled) {
          try {
            doc.destroy();
          } catch {}
          return;
        }

        activeDocRef.current = doc;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setLoading(false);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('[PdfViewer] Document load error:', err);
        setError(err?.message || 'Failed to open PDF document.');
        setLoading(false);
      }
    }

    loadDocument();

    return () => {
      isCancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {}
        renderTaskRef.current = null;
      }
      if (activeDocRef.current) {
        try {
          activeDocRef.current.destroy();
        } catch {}
        activeDocRef.current = null;
      }
      if (activeWorkerRef.current) {
        try {
          activeWorkerRef.current.destroy();
        } catch {}
        activeWorkerRef.current = null;
      }
    };
  }, [filePath]);

  // 2. Render Single Page
  const renderSinglePage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || viewMode !== 'single') return;

    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {}
      renderTaskRef.current = null;
    }

    try {
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const context = canvas.getContext('2d');
      if (!context) return;

      const viewport = page.getViewport({ scale, rotation });
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const renderContext: any = {
        canvas,
        canvasContext: context,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      };

      const task = page.render(renderContext);
      renderTaskRef.current = task;
      await task.promise;
      renderTaskRef.current = null;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('[PdfViewer] Page render error:', err);
      }
    }
  }, [pdfDoc, currentPage, scale, rotation, viewMode]);

  useEffect(() => {
    if (viewMode === 'single') {
      renderSinglePage();
    }
  }, [renderSinglePage, viewMode]);

  // 3. Render Continuous Pages
  useEffect(() => {
    if (!pdfDoc || viewMode !== 'continuous') return;

    let isCancelled = false;

    async function renderAllPages() {
      for (let i = 1; i <= pdfDoc!.numPages; i++) {
        if (isCancelled) break;
        const canvas = continuousCanvasesRef.current.get(i);
        if (!canvas) continue;

        try {
          const page = await pdfDoc!.getPage(i);
          const context = canvas.getContext('2d');
          if (!context) continue;

          const viewport = page.getViewport({ scale, rotation });
          const dpr = window.devicePixelRatio || 1;

          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const renderContext: any = {
            canvas,
            canvasContext: context,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          };

          await page.render(renderContext).promise;
        } catch (e: any) {
          if (e?.name !== 'RenderingCancelledException') {
            console.error('[PdfViewer] Continuous render page error:', i, e);
          }
        }
      }
    }

    renderAllPages();

    return () => {
      isCancelled = true;
    };
  }, [pdfDoc, scale, rotation, viewMode]);

  // Sync page number input display
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  // Controls Handlers
  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage((p) => p - 1);
    }
  };

  const handleNextPage = () => {
    if (numPages && currentPage < numPages) {
      setCurrentPage((p) => p + 1);
    }
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseInt(pageInput, 10);
    if (!isNaN(p) && p >= 1 && p <= numPages) {
      setCurrentPage(p);
      if (viewMode === 'continuous') {
        const el = continuousCanvasesRef.current.get(p);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      setPageInput(currentPage.toString());
    }
  };

  const handleZoomIn = () => {
    setScale((s) => Math.min(3.0, +(s + 0.2).toFixed(1)));
  };

  const handleZoomOut = () => {
    setScale((s) => Math.max(0.5, +(s - 0.2).toFixed(1)));
  };

  const handleRotate = () => {
    setRotation((r) => (r + 90) % 360);
  };

  const handleOpenExternally = () => {
    if (window.api?.openPath) {
      window.api.openPath(filePath);
    }
  };

  const handleSaveAs = () => {
    if (window.api?.saveFileAs) {
      window.api.saveFileAs(filePath);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['input', 'textarea'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return;

      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        handleNextPage();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setScale(1.0);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        handleRotate();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [numPages, currentPage]);

  return (
    <div className="w-full h-full flex flex-col bg-[#141416] select-none text-zinc-200 overflow-hidden font-sans">
      {/* Top Controls Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#1b1b1e] border-b border-zinc-800 text-xs gap-2 flex-wrap">
        {/* Left: Thumbnail toggle & Page switcher */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowThumbnails((v) => !v)}
            className={`p-1.5 rounded transition ${
              showThumbnails
                ? 'bg-zinc-700/60 text-zinc-100 hover:bg-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            title={showThumbnails ? 'Hide page thumbnails' : 'Show page thumbnails'}
          >
            {showThumbnails ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition"
            title="Previous Page (Left Arrow)"
          >
            <ChevronLeft size={16} />
          </button>

          <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
            <input
              type="text"
              value={pageInput}
              onChange={handlePageInputChange}
              onBlur={() => setPageInput(currentPage.toString())}
              className="w-10 px-1.5 py-0.5 text-center bg-[#101012] border border-zinc-700 rounded text-xs text-zinc-200 focus:outline-none focus:border-rose-500"
            />
            <span className="text-zinc-400 text-xs">/ {numPages || 1}</span>
          </form>

          <button
            onClick={handleNextPage}
            disabled={numPages === 0 || currentPage >= numPages}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition"
            title="Next Page (Right Arrow)"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Center: Zoom & View Mode */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition"
            title="Zoom Out (Ctrl -)"
          >
            <ZoomOut size={15} />
          </button>

          <button
            onClick={() => setScale(1.0)}
            className="px-2 py-0.5 rounded bg-zinc-800/80 hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 transition"
            title="Reset Zoom to 100%"
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            onClick={handleZoomIn}
            disabled={scale >= 3.0}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none transition"
            title="Zoom In (Ctrl +)"
          >
            <ZoomIn size={15} />
          </button>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* View Mode Toggle */}
          <button
            onClick={() => setViewMode(viewMode === 'single' ? 'continuous' : 'single')}
            className={`p-1.5 rounded transition ${
              viewMode === 'continuous'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
            }`}
            title={viewMode === 'single' ? 'Switch to Continuous Scroll' : 'Switch to Single Page View'}
          >
            {viewMode === 'single' ? <Square size={15} /> : <Rows size={15} />}
          </button>

          <button
            onClick={handleRotate}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition"
            title="Rotate 90° Clockwise (R)"
          >
            <RotateCw size={15} />
          </button>
        </div>

        {/* Right: External Open & Save As */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSaveAs}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition text-[11px]"
            title="Save As"
          >
            <Download size={13} />
            <span>Save As</span>
          </button>

          <button
            onClick={handleOpenExternally}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-zinc-800 text-zinc-300 hover:text-white transition text-[11px]"
            title="Open in System Default PDF Viewer"
          >
            <ExternalLink size={13} />
            <span>Open Externally</span>
          </button>
        </div>
      </div>

      {/* Main Content: Sidebar + Viewer Canvas */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Thumbnails Sidebar */}
        {showThumbnails && numPages > 0 && (
          <div className="w-48 bg-[#18181b] border-r border-zinc-800/80 flex flex-col overflow-y-auto p-2 gap-2 flex-shrink-0">
            <div className="text-[10px] uppercase font-semibold tracking-wider text-zinc-500 px-1 py-0.5">
              Pages ({numPages})
            </div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setCurrentPage(p);
                  if (viewMode === 'continuous') {
                    const el = continuousCanvasesRef.current.get(p);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                className={`flex flex-col items-center p-2 rounded-lg transition border ${
                  currentPage === p
                    ? 'bg-rose-500/15 border-rose-500/50 text-rose-300'
                    : 'bg-[#101012] border-zinc-800/60 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <div className="w-20 h-28 bg-[#202024] rounded border border-zinc-700/40 flex items-center justify-center text-xs shadow-inner">
                  <FileText size={20} className={currentPage === p ? 'text-rose-400' : 'text-zinc-600'} />
                </div>
                <span className="text-[11px] font-mono mt-1 font-medium">Page {p}</span>
              </button>
            ))}
          </div>
        )}

        {/* Viewport Area */}
        <div className="flex-1 overflow-auto bg-[#1a1a1d] flex flex-col items-center justify-start p-6 relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1a1a1d]/80 z-20 backdrop-blur-xs">
              <Loader2 size={32} className="animate-spin text-rose-400" />
              <p className="text-sm text-zinc-300 font-medium">Loading PDF document...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center gap-3 my-auto max-w-md text-center p-6 bg-[#202024] border border-rose-500/30 rounded-xl">
              <AlertCircle size={36} className="text-rose-400" />
              <h3 className="text-base font-semibold text-zinc-100">Unable to preview PDF</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">{error}</p>
              <button
                onClick={handleOpenExternally}
                className="mt-2 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition flex items-center gap-1.5"
              >
                <ExternalLink size={14} />
                <span>Open in default PDF application</span>
              </button>
            </div>
          )}

          {!loading && !error && viewMode === 'single' && (
            <div className="flex justify-center items-center my-auto transition-transform">
              <canvas
                ref={canvasRef}
                className="shadow-2xl rounded-sm border border-zinc-800/80 bg-white"
              />
            </div>
          )}

          {!loading && !error && viewMode === 'continuous' && (
            <div ref={continuousContainerRef} className="flex flex-col items-center gap-6 w-full py-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
                <div key={p} className="flex flex-col items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500 font-mono">Page {p}</span>
                  <canvas
                    ref={(el) => {
                      if (el) {
                        continuousCanvasesRef.current.set(p, el);
                      } else {
                        continuousCanvasesRef.current.delete(p);
                      }
                    }}
                    className="shadow-2xl rounded-sm border border-zinc-800/80 bg-white"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
