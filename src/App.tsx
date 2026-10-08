import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, FolderOpen, 
  HardDrive, Folder, File, Search, X, Calculator, ChevronDown,
  CheckCircle2, AlertTriangle, AlertCircle, Copy, Scissors, Clipboard, Loader2, Info,
  ShieldAlert, ShieldCheck, Box, Sparkles, FileText
} from 'lucide-react';
import { ThreeViewer } from './components/ThreeViewer';

interface ToastInfo {
  id: string;
  type: 'success' | 'error' | 'info' | 'loading';
  title: string;
  message: string;
  details?: string;
}

// Types (match preload)
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

interface SizeResult {
  size: number;
  fileCount: number;
  dirCount: number;
}

interface DriveInfo {
  name: string;
  path: string;
  label?: string;
  size?: number;
  freeSpace?: number;
}

// In production / Electron the api is always provided via preload
const api = (typeof window !== 'undefined' ? (window as any).api : null) as any;

function formatSize(bytes?: number): string {
  if (bytes == null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getIcon(entry: DirEntry) {
  if (entry.isDirectory) return <Folder size={18} className="text-blue-400" />;
  const ext = entry.ext?.toLowerCase() || '';
  if (ext === '.pdf') return <FileText size={18} className="text-rose-400" />;
  if (['.splat', '.ksplat', '.spz'].includes(ext)) return <Sparkles size={18} className="text-violet-400" />;
  if (['.gltf', '.glb', '.obj', '.stl', '.ply', '.fbx'].includes(ext)) return <Box size={18} className="text-indigo-400" />;
  if (['.tsx', '.ts', '.js', '.jsx'].includes(ext)) return <File size={18} className="text-yellow-400" />;
  if (['.json', '.toml', '.yaml', '.yml'].includes(ext)) return <File size={18} className="text-emerald-400" />;
  if (['.css', '.scss'].includes(ext)) return <File size={18} className="text-pink-400" />;
  if (['.html', '.htm'].includes(ext)) return <File size={18} className="text-orange-400" />;
  if (['.md', '.txt'].includes(ext)) return <File size={18} className="text-purple-400" />;
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) return <File size={18} className="text-sky-400" />;
  return <File size={18} className="text-zinc-400" />;
}

function toMediaUrl(p: string): string {
  // Use our privileged custom scheme for reliable streaming, byte ranges, and PDF/3D loading
  return `jabro-media://localhost?path=${encodeURIComponent(p)}`;
}

function toFileUrl(p: string): string {
  return toMediaUrl(p);
}

function getViewerType(ext?: string): 'image' | 'audio' | 'video' | 'text' | 'pdf' | '3d' | 'gaussian-splat' | null {
  if (!ext) return null;
  const e = ext.toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(e)) return 'image';
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma'].includes(e)) return 'audio';
  if (['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.wmv'].includes(e)) return 'video';
  if (e === '.pdf') return 'pdf';
  if (['.splat', '.ksplat', '.spz'].includes(e)) return 'gaussian-splat';
  if (['.gltf', '.glb', '.obj', '.stl', '.fbx', '.ply'].includes(e)) return '3d';
  if (['.txt', '.md', '.js', '.ts', '.tsx', '.json', '.css', '.html', '.htm', '.xml', '.csv', '.log', '.ini', '.bat', '.sh', '.py', '.c', '.cpp', '.h', '.yaml', '.yml', '.toml', '.rs', '.go', '.sql'].includes(e)) return 'text';
  return null;
}

function matchesSearch(name: string, search: string): boolean {
  if (!search) return true;
  const lowerName = name.toLowerCase();
  const s = search.toLowerCase().trim();
  const patterns = s.split(/[;,]/).map(p => p.trim()).filter(p => p.length > 0);
  if (patterns.length === 0) return true;
  return patterns.some(pattern => {
    if (!pattern.includes('*') && !pattern.includes('?')) {
      return lowerName.includes(pattern);
    }
    // glob support e.g. *.mp3 or report*.pdf
    let reStr = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    try {
      return new RegExp('^' + reStr + '$', 'i').test(name);
    } catch {
      return lowerName.includes(pattern);
    }
  });
}

// QUICK_ACCESS is now dynamic from state + persisted pinned folders (loaded from main process defaults)

export default function App() {
  // Always running inside Electron now (no more demo mode)

  const [currentPath, setCurrentPath] = useState('H:\\AppDev\\size-browser');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [sizeCache, setSizeCache] = useState<Record<string, SizeResult>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'mtime'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filter, setFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<string[]>(['H:\\AppDev\\size-browser']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [autoCalc, setAutoCalc] = useState(true);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [clipboard, setClipboard] = useState<{ paths: string[]; isCut: boolean } | null>(null);
  const [dualPane, setDualPane] = useState(false);
  const [isRightLoading, setIsRightLoading] = useState(false);

  // Customizable Quick Access (pinned folders). Persisted in localStorage.
  const [quickAccess, setQuickAccess] = useState<Array<{ label: string; path: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [operationStatus, setOperationStatus] = useState('');
  const [viewer, setViewer] = useState<null | { type: 'image' | 'audio' | 'video' | 'text' | 'pdf' | '3d' | 'gaussian-splat'; path: string; name: string }>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

  // Drag/drop + drive context + copy feedback
  const [driveCtx, setDriveCtx] = useState<{ x: number; y: number; drive: DriveInfo } | null>(null);
  const driveMenuRef = useRef<HTMLDivElement>(null);
  const [copyMessages, setCopyMessages] = useState<string[]>([]);
  const [showCopyDialog, setShowCopyDialog] = useState(false);

  // Toast notifications & visual highlights
  const [toasts, setToasts] = useState<ToastInfo[]>([]);
  const [errorModalDetails, setErrorModalDetails] = useState<{ title: string; message: string; details?: string } | null>(null);
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null);
  const [dragOverFolderPath, setDragOverFolderPath] = useState<string | null>(null);

  // Administrator elevation modal state
  const [elevationPrompt, setElevationPrompt] = useState<{
    sources: string[];
    target: string;
    isMove: boolean;
    action?: 'copy' | 'move' | 'createFolder';
    newFolderName?: string;
  } | null>(null);
  const [isElevating, setIsElevating] = useState(false);

  const showToast = useCallback((toast: Omit<ToastInfo, 'id'>, duration = 3200) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => {
      const filtered = toast.type === 'loading'
        ? prev.filter(t => t.type !== 'loading')
        : prev.filter(t => t.type !== 'loading');
      return [...filtered, { ...toast, id }];
    });
    if (toast.type !== 'loading' && toast.type !== 'error' && duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, duration);
    }
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Guards to prevent duplicate/reload loops for the same path (e.g. special folders like Downloads)
  const leftLoadingRef = useRef<string | null>(null);
  const rightLoadingRef = useRef<string | null>(null);

  // Tokens to ignore results from previous (cancelled) loads when user clicks elsewhere quickly
  const leftLoadTokenRef = useRef(0);
  const rightLoadTokenRef = useRef(0);

  // Ref for the context menu to detect outside clicks
  const menuRef = useRef<HTMLDivElement>(null);

  // In-memory cache for directory listings to show cached results instantly
  // while fetching fresh data in the background for changes (stale-while-revalidate).
  const dirCacheRef = useRef(new Map<string, DirEntry[]>());

  // Right pane for dual mode (basic independent navigation)
  const [rightCurrentPath, setRightCurrentPath] = useState('H:\\');
  const [rightEntries, setRightEntries] = useState<DirEntry[]>([]);
  const [rightSelected, setRightSelected] = useState<string | null>(null);
  const [rightFilter, setRightFilter] = useState('');
  const [rightSortBy, setRightSortBy] = useState<'name' | 'size' | 'mtime'>('name');
  const [rightSortDir, setRightSortDir] = useState<'asc' | 'desc'>('asc');
  const [rightHistory, setRightHistory] = useState<string[]>(['H:\\']);
  const [rightHistoryIndex, setRightHistoryIndex] = useState(0);
  const [activePane, setActivePane] = useState<'left' | 'right'>('left');

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    const trimmed = path.replace(/\\+$/, '');
    const normalized = trimmed.endsWith(':') ? trimmed + '\\' : trimmed;
    if (leftLoadingRef.current === normalized) return;
    leftLoadingRef.current = normalized;

    const myToken = ++leftLoadTokenRef.current;

    // Show cached listing immediately (if any) for snappy feel, then fetch fresh in bg
    const cached = dirCacheRef.current.get(normalized);
    if (cached) {
      const mergedCached = cached.map(e => {
        const c = sizeCache[e.path];
        return (e.isDirectory && c) ? { ...e, size: c.size, fileCount: c.fileCount, dirCount: c.dirCount } : e;
      });
      setEntries(mergedCached);
      // do not show spinner if we have cache
    } else {
      setIsLoading(true);
    }
    setSelected(null);
    setFilter('');

    try {
      const list: DirEntry[] = await api.listDirectory(normalized);

      // Ignore if user has since navigated elsewhere
      if (myToken !== leftLoadTokenRef.current) return;

      // Update cache with fresh listing
      dirCacheRef.current.set(normalized, list);

      // Merge any already known sizes from cache
      const merged = list.map(e => {
        const cachedSize = sizeCache[e.path];
        if (e.isDirectory && cachedSize) {
          return { ...e, size: cachedSize.size, fileCount: cachedSize.fileCount, dirCount: cachedSize.dirCount };
        }
        return e;
      });

      setEntries(merged);
      setCurrentPath(normalized);

      // Auto-trigger size calculation for folders without known size
      if (autoCalc) {
        setTimeout(() => {
          // Only if still the current load
          if (myToken === leftLoadTokenRef.current) {
            merged
              .filter(e => e.isDirectory && !sizeCache[e.path])
              .slice(0, 8) // safety
              .forEach(e => calculateFolderSize(e.path));
          }
        }, 80);
      }
    } catch (err) {
      if (myToken === leftLoadTokenRef.current) {
        console.error('Failed to list directory', err);
        if (!cached) setEntries([]);
      }
    } finally {
      if (myToken === leftLoadTokenRef.current) {
        leftLoadingRef.current = null;
        setIsLoading(false);
      }
    }
  }, [sizeCache, autoCalc]);

  // Load for right pane (duplicated for dual pane support)
  const loadRightDirectory = useCallback(async (path: string) => {
    const trimmed = path.replace(/\\+$/, '');
    const normalized = trimmed.endsWith(':') ? trimmed + '\\' : trimmed;
    if (rightLoadingRef.current === normalized) return;
    rightLoadingRef.current = normalized;

    const myToken = ++rightLoadTokenRef.current;

    // Show cached listing immediately (if any) for snappy feel, then fetch fresh in bg
    const cached = dirCacheRef.current.get(normalized);
    if (cached) {
      const mergedCached = cached.map(e => {
        const c = sizeCache[e.path];
        return (e.isDirectory && c) ? { ...e, size: c.size, fileCount: c.fileCount, dirCount: c.dirCount } : e;
      });
      setRightEntries(mergedCached);
      // do not show spinner if we have cache
    } else {
      setIsRightLoading(true);
    }

    try {
      const list: DirEntry[] = await api.listDirectory(normalized);

      if (myToken !== rightLoadTokenRef.current) return;

      // Update cache with fresh listing
      dirCacheRef.current.set(normalized, list);

      const merged = list.map(e => {
        const cachedSize = sizeCache[e.path];
        if (e.isDirectory && cachedSize) {
          return { ...e, size: cachedSize.size, fileCount: cachedSize.fileCount, dirCount: cachedSize.dirCount };
        }
        return e;
      });
      setRightEntries(merged);
      setRightCurrentPath(normalized);
      if (autoCalc) {
        setTimeout(() => {
          if (myToken === rightLoadTokenRef.current) {
            merged.filter(e => e.isDirectory && !sizeCache[e.path]).slice(0, 8).forEach(e => calculateFolderSize(e.path));
          }
        }, 80);
      }
    } catch (err) {
      if (myToken === rightLoadTokenRef.current) {
        console.error('Failed to list right directory', err);
        if (!cached) setRightEntries([]);
      }
    } finally {
      if (myToken === rightLoadTokenRef.current) {
        rightLoadingRef.current = null;
        setIsRightLoading(false);
      }
    }
  }, [sizeCache, autoCalc]);

  // Initial + drive load

  useEffect(() => {
    loadDirectory(currentPath);
    loadRightDirectory(rightCurrentPath);

    api.getDrives().then((d: DriveInfo[]) => setDrives(d)).catch(() => {
      // demo fallback with sizes
      setDrives([
        { name: 'C:', path: 'C:\\', size: 1000000000000, freeSpace: 300000000000 },
        { name: 'D:', path: 'D:\\', size: 500000000000, freeSpace: 150000000000 },
      ]);
    });
  }, []);

  // Load customizable Quick Access (defaults from main process using proper app.getPath for symlinks/custom locations)
  useEffect(() => {
    const loadQuickAccess = async () => {
      try {
        const defaults = await api.getDefaultQuickAccess();
        const saved = localStorage.getItem('quickAccess');
        if (saved) {
          const parsed: Array<{label: string; path: string}> = JSON.parse(saved);
          setQuickAccess(parsed.length > 0 ? parsed : defaults);
        } else {
          setQuickAccess(defaults);
        }
      } catch {
        setQuickAccess([]);
      }
    };
    loadQuickAccess();
  }, []);

  // Listen for copy/paste progress from main process
  useEffect(() => {
    let removeListener: (() => void) | undefined;
    if (api && typeof api.onCopyProgress === 'function') {
      removeListener = api.onCopyProgress((data: any) => {
        if (data && data.line) {
          setOperationStatus(data.line);
          setCopyMessages(prev => [...prev.slice(-150), data.line]);
          if (data.phase === 'complete') {
            setTimeout(() => setOperationStatus(''), 2500);
          }
        }
      });
    }
    return () => {
      if (removeListener) removeListener();
    };
  }, [api]);

  // Load text content when text viewer opens
  useEffect(() => {
    if (viewer?.type === 'text' && api) {
      setTextContent('Loading text preview...');
      (api as any).readTextFile?.(viewer.path)
        .then((content: string) => setTextContent(content))
        .catch(() => setTextContent('Failed to load text content. The file may be too large or binary.'));
    } else {
      setTextContent(null);
    }
  }, [viewer, api]);

  // History navigation
  const navigateTo = useCallback((newPath: string) => {
    const trimmed = newPath.replace(/\\+$/, '');
    const normalized = trimmed.endsWith(':') ? trimmed + '\\' : trimmed;
    if (!normalized) return;

    const newHist = history.slice(0, historyIndex + 1);
    newHist.push(normalized);
    setHistory(newHist);
    setHistoryIndex(newHist.length - 1);
    loadDirectory(normalized);
  }, [history, historyIndex, loadDirectory]);

  const goBack = () => {
    if (historyIndex > 0) {
      const p = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      loadDirectory(p);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const p = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      loadDirectory(p);
    }
  };

  const goUp = () => {
    const parts = currentPath.split('\\').filter(Boolean);
    if (parts.length <= 1) return;
    const parent = parts.slice(0, -1).join('\\') + '\\';
    navigateTo(parent);
  };

  // Right pane navigation (for dual mode)
  const navigateRight = useCallback((newPath: string) => {
    const trimmed = newPath.replace(/\\+$/, '');
    const normalized = trimmed.endsWith(':') ? trimmed + '\\' : trimmed;
    if (!normalized) return;
    const newHist = rightHistory.slice(0, rightHistoryIndex + 1);
    newHist.push(normalized);
    setRightHistory(newHist);
    setRightHistoryIndex(newHist.length - 1);
    loadRightDirectory(normalized);
  }, [rightHistory, rightHistoryIndex, loadRightDirectory]);

  const goRightBack = () => {
    if (rightHistoryIndex > 0) {
      const p = rightHistory[rightHistoryIndex - 1];
      setRightHistoryIndex(rightHistoryIndex - 1);
      loadRightDirectory(p);
    }
  };

  const goRightForward = () => {
    if (rightHistoryIndex < rightHistory.length - 1) {
      const p = rightHistory[rightHistoryIndex + 1];
      setRightHistoryIndex(rightHistoryIndex + 1);
      loadRightDirectory(p);
    }
  };

  const goRightUp = () => {
    const parts = rightCurrentPath.split('\\').filter(Boolean);
    if (parts.length <= 1) return;
    const parent = parts.slice(0, -1).join('\\') + '\\';
    navigateRight(parent);
  };

  // THE KEY FEATURE: recursive folder size
  const calculateFolderSize = useCallback(async (targetPath: string, force = false) => {
    const existing = sizeCache[targetPath];
    if (!force && existing) return;

    // Mark calculating
    setSizeCache(prev => ({
      ...prev,
      [targetPath]: { size: existing?.size || 0, fileCount: existing?.fileCount || 0, dirCount: existing?.dirCount || 0 }
    }));

    try {
      const result: SizeResult = await api.getFolderSize(targetPath);

      setSizeCache(prev => ({ ...prev, [targetPath]: result }));

      // Update row in place if visible (left)
      setEntries(prev =>
        prev.map(e =>
          e.path === targetPath && e.isDirectory
            ? { ...e, size: result.size, fileCount: result.fileCount, dirCount: result.dirCount }
            : e
        )
      );
      // Also sync right pane rows if dual
      setRightEntries(prev =>
        prev.map(e =>
          e.path === targetPath && e.isDirectory
            ? { ...e, size: result.size, fileCount: result.fileCount, dirCount: result.dirCount }
            : e
        )
      );
    } catch (err) {
      console.error('Size calculation failed for', targetPath, err);
      setSizeCache(prev => {
        const copy = { ...prev };
        delete copy[targetPath];
        return copy;
      });
    }
  }, [sizeCache]);

  // Calculate sizes for every folder shown in current view
  const calculateAllVisibleSizes = useCallback(async () => {
    const folders = entries.filter(e => e.isDirectory);
    for (const f of folders) {
      await calculateFolderSize(f.path, true);
      // tiny pause so UI stays responsive and we see progress
      await new Promise(r => setTimeout(r, 35));
    }
  }, [entries, calculateFolderSize]);

  // Copy / Cut / Paste support
  const copyToClipboard = useCallback((isCut = false, specificPath?: string) => {
    const p = specificPath || (activePane === 'right' ? rightSelected : selected);
    if (!p) {
      showToast({
        type: 'info',
        title: 'No item selected',
        message: 'Select a file or folder to copy or cut.'
      });
      return;
    }
    const fileName = p.split(/[\\/]/).pop() || p;
    setClipboard({ paths: [p], isCut });

    try {
      navigator.clipboard.writeText(p);
    } catch {}

    showToast({
      type: 'info',
      title: isCut ? 'Cut to clipboard' : 'Copied to clipboard',
      message: `"${fileName}" • Ready to paste (${isCut ? 'move' : 'copy'})`
    });
  }, [selected, rightSelected, activePane, showToast]);

  const pasteFromClipboard = useCallback(async (customTarget?: string) => {
    let pathsToPaste = clipboard?.paths || [];
    let isCut = clipboard?.isCut ?? false;

    // If internal clipboard is empty, check system clipboard for valid file paths
    if (pathsToPaste.length === 0) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          const lines = text.split(/\r?\n/).map(l => l.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          const valid = lines.filter(l => /^[a-zA-Z]:[\\/]/.test(l) || /^\\\\[\w]/.test(l));
          if (valid.length > 0) {
            pathsToPaste = valid;
            isCut = false;
          }
        }
      } catch {}
    }

    if (pathsToPaste.length === 0) {
      showToast({
        type: 'info',
        title: 'Clipboard is empty',
        message: 'Copy (Ctrl+C) or cut (Ctrl+X) an item first.'
      });
      return;
    }

    const targetIsRight = dualPane && activePane === 'right';
    const targetPath = customTarget || (targetIsRight ? rightCurrentPath : currentPath);
    if (!targetPath) return;

    const count = pathsToPaste.length;
    const firstItemName = pathsToPaste[0].split(/[\\/]/).pop() || 'item';
    const progressToastId = showToast({
      type: 'loading',
      title: isCut ? 'Moving...' : 'Copying...',
      message: count === 1 ? `"${firstItemName}"` : `${count} items...`
    }, 0);

    try {
      let result: any;
      if (isCut) {
        result = await api.moveFiles(pathsToPaste, targetPath);
      } else {
        result = await api.copyFiles(pathsToPaste, targetPath);
      }

      dismissToast(progressToastId);

      if (result?.requiresElevation) {
        setElevationPrompt({
          sources: result.sources || pathsToPaste,
          target: targetPath,
          isMove: isCut,
        });
        return;
      }

      if (isCut && result?.success) {
        setClipboard(null);
      }

      // Reload destination directory
      if (targetIsRight) {
        await loadRightDirectory(targetPath);
      } else {
        await loadDirectory(targetPath);
      }

      // If cut across different folders, also reload source directory
      if (isCut && pathsToPaste.length > 0) {
        const srcDir = pathsToPaste[0].substring(0, Math.max(pathsToPaste[0].lastIndexOf('\\'), pathsToPaste[0].lastIndexOf('/')));
        if (srcDir && srcDir.toLowerCase() !== targetPath.toLowerCase()) {
          if (targetIsRight) await loadDirectory(srcDir);
          else await loadRightDirectory(srcDir);
        }
      }

      // Highlight newly created item
      const createdItem = result?.items?.find((i: any) => i.success);
      if (createdItem?.dest) {
        setHighlightedPath(createdItem.dest);
        if (targetIsRight) setRightSelected(createdItem.dest);
        else setSelected(createdItem.dest);
        setTimeout(() => setHighlightedPath(null), 2500);
      }

      const succeeded = result?.items?.filter((i: any) => i.success).length ?? count;
      const failed = result?.items?.filter((i: any) => !i.success).length ?? 0;

      if (failed === 0) {
        const displayName = createdItem?.name || firstItemName;
        showToast({
          type: 'success',
          title: isCut ? 'Moved successfully' : 'Copied successfully',
          message: count === 1 ? `"${displayName}"` : `All ${succeeded} items ${isCut ? 'moved' : 'copied'}`
        });
      } else {
        const firstError = result?.errors?.[0] || 'Some items could not be copied.';
        showToast({
          type: 'error',
          title: isCut ? 'Move partially failed' : 'Copy partially failed',
          message: firstError,
          details: result?.errors?.join('\n')
        });
      }
    } catch (err: any) {
      dismissToast(progressToastId);
      const errMsg = err?.message || String(err);
      console.error('Paste failed:', err);
      if (errMsg.includes('Permission denied') || errMsg.includes('administrator') || errMsg.includes('EPERM')) {
        setElevationPrompt({
          sources: pathsToPaste,
          target: targetPath,
          isMove: isCut,
        });
        return;
      }
      showToast({
        type: 'error',
        title: isCut ? 'Move failed' : 'Copy failed',
        message: errMsg.replace(/^Error:\s*/, ''),
        details: err?.stack || errMsg
      });
    }
  }, [clipboard, currentPath, rightCurrentPath, dualPane, activePane, loadDirectory, loadRightDirectory, showToast, dismissToast]);

  const refresh = useCallback(() => {
    // Invalidate sizes for current level's folders? Keep cache for speed, user can force per item.
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // Active-pane aware versions for top bar + shared path bar + keyboard.
  // Placed here so all delegate functions (refresh, navigate*, goRight*, calculateFolderSize, load*) are already declared.
  const activePaneIsRight = activePane === 'right';
  const activeCurrentPath = activePaneIsRight ? rightCurrentPath : currentPath;
  const activeHistoryIndex = activePaneIsRight ? rightHistoryIndex : historyIndex;
  const activeHistoryLength = activePaneIsRight ? rightHistory.length : history.length;

  const activeGoBack = useCallback(() => {
    if (activePaneIsRight) goRightBack(); else goBack();
  }, [activePaneIsRight, goRightBack, goBack]);

  const activeGoForward = useCallback(() => {
    if (activePaneIsRight) goRightForward(); else goForward();
  }, [activePaneIsRight, goRightForward, goForward]);

  const activeGoUp = useCallback(() => {
    if (activePaneIsRight) goRightUp(); else goUp();
  }, [activePaneIsRight, goRightUp, goUp]);

  const activeRefresh = useCallback(() => {
    if (activePaneIsRight) {
      loadRightDirectory(rightCurrentPath);
    } else {
      refresh();
    }
  }, [activePaneIsRight, rightCurrentPath, loadRightDirectory, refresh]);

  const activeNavigate = useCallback((newPath: string) => {
    if (activePaneIsRight) navigateRight(newPath); else navigateTo(newPath);
  }, [activePaneIsRight, navigateRight, navigateTo]);

  const activeCalculateAllVisibleSizes = useCallback(async () => {
    const list = activePaneIsRight ? rightEntries : entries;
    for (const f of list.filter(e => e.isDirectory)) {
      await calculateFolderSize(f.path, true);
      await new Promise(r => setTimeout(r, 35));
    }
  }, [activePaneIsRight, rightEntries, entries, calculateFolderSize]);

  const handleConfirmElevation = useCallback(async () => {
    if (!elevationPrompt) return;
    setIsElevating(true);
    try {
      const res = await api.performElevatedFileOp(
        elevationPrompt.sources,
        elevationPrompt.target,
        elevationPrompt.isMove,
        elevationPrompt.action,
        elevationPrompt.newFolderName
      );

      setIsElevating(false);
      setElevationPrompt(null);

      if (res?.cancelled) {
        showToast({
          type: 'info',
          title: 'Operation canceled',
          message: 'Administrator authorization was canceled.'
        });
        return;
      }

      if (res?.success) {
        if (elevationPrompt.isMove) {
          setClipboard(null);
        }

        // Refresh active and target panes
        await activeRefresh();
        if (dualPane) {
          if (activePaneIsRight) await loadDirectory(currentPath);
          else await loadRightDirectory(rightCurrentPath);
        }

        const created = res.items?.find((i: any) => i.success);
        if (created?.dest) {
          setHighlightedPath(created.dest);
          if (activePaneIsRight) setRightSelected(created.dest);
          else setSelected(created.dest);
          setTimeout(() => setHighlightedPath(null), 2500);
        }

        const targetFolderDisplay = elevationPrompt.target.split(/[\\/]/).filter(Boolean).pop() || elevationPrompt.target;
        const isFolder = elevationPrompt.action === 'createFolder';
        showToast({
          type: 'success',
          title: isFolder
            ? 'Folder created'
            : (elevationPrompt.isMove ? 'Moved successfully' : 'Copied successfully'),
          message: isFolder
            ? `New folder created in ${targetFolderDisplay}`
            : (elevationPrompt.sources.length === 1
                ? `"${created?.name || 'Item'}" placed in ${targetFolderDisplay}`
                : `${res.items?.length || elevationPrompt.sources.length} items placed in ${targetFolderDisplay}`)
        });
      } else {
        showToast({
          type: 'error',
          title: 'Administrator operation failed',
          message: res?.error || 'Operation failed with administrator rights.',
          details: res?.error
        });
      }
    } catch (err: any) {
      setIsElevating(false);
      setElevationPrompt(null);
      const msg = err?.message || String(err);
      if (msg.includes('canceled by the user') || msg.includes('1223') || msg.includes('UAC_CANCELLED')) {
        showToast({
          type: 'info',
          title: 'Operation canceled',
          message: 'Administrator authorization was canceled.'
        });
      } else {
        showToast({
          type: 'error',
          title: 'Administrator operation failed',
          message: msg.replace(/^Error:\s*/, ''),
          details: err?.stack || msg
        });
      }
    }
  }, [elevationPrompt, activeRefresh, dualPane, activePaneIsRight, currentPath, rightCurrentPath, loadDirectory, loadRightDirectory, showToast]);

  // Drag & drop support: internal (from our rows via dataTransfer) + external (files from Explorer/desktop)
  // Drop targets the given path (dir row, pane bg, QA, drive).
  // Modifiers: Ctrl held = force copy, Shift held = force move.
  // Default: same volume = move, different volume = copy.
  const handleDropToPath = useCallback(async (e: React.DragEvent, targetDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderPath(null);

    let paths: string[] = [];
    try {
      const json = e.dataTransfer.getData('application/x-jabro-path') || e.dataTransfer.getData('text/plain');
      if (json) {
        try {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) paths = parsed.filter((p: any) => typeof p === 'string');
          else if (typeof parsed === 'string') paths = [parsed];
        } catch {
          if (/^[a-zA-Z]:[\\/]/.test(json.trim()) || /^\\\\[\w]/.test(json.trim())) {
            paths = [json.trim()];
          }
        }
      }
    } catch {}

    // Try external drops (requires preload bridge to webUtils.getPathForFile)
    if (paths.length === 0 && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const f = e.dataTransfer.files[i];
        let p = '';
        try {
          p = (api as any)?.getPathForFile ? (api as any).getPathForFile(f) : (f as any).path || '';
        } catch {}
        if (p) paths.push(p);
      }
    }
    if (paths.length === 0) return;

    // Modifiers & destination calculation
    const forceCopy = e.ctrlKey;
    const forceMove = e.shiftKey;
    const isSameDrive = paths.length > 0 && paths[0][0]?.toLowerCase() === targetDir[0]?.toLowerCase();
    const useMove = forceMove || (!forceCopy && isSameDrive);

    // Dropping in the same folder without holding Ctrl
    const srcDir = paths[0].substring(0, Math.max(paths[0].lastIndexOf('\\'), paths[0].lastIndexOf('/')));
    const isSameFolder = paths.length === 1 && srcDir.toLowerCase() === targetDir.toLowerCase();
    if (isSameFolder && !forceCopy) {
      showToast({
        type: 'info',
        title: 'Already in this folder',
        message: 'Hold Ctrl while dragging to duplicate this file.'
      });
      return;
    }

    const count = paths.length;
    const firstItemName = paths[0].split(/[\\/]/).pop() || 'item';
    const progressToastId = showToast({
      type: 'loading',
      title: useMove ? 'Moving...' : 'Copying...',
      message: count === 1 ? `"${firstItemName}"` : `${count} items...`
    }, 0);

    try {
      let result: any;
      if (useMove) {
        result = await api.moveFiles(paths, targetDir);
      } else {
        result = await api.copyFiles(paths, targetDir);
      }

      dismissToast(progressToastId);

      if (result?.requiresElevation) {
        setElevationPrompt({
          sources: result.sources || paths,
          target: targetDir,
          isMove: useMove,
        });
        return;
      }

      // Refresh panes that are viewing the target or ancestor/descendant
      const actPath = activePaneIsRight ? rightCurrentPath : currentPath;
      const isAffected = (p: string) => p === targetDir || p.startsWith(targetDir + '\\') || targetDir.startsWith(p + '\\');
      if (isAffected(actPath)) {
        if (activePaneIsRight) await loadRightDirectory(actPath); else await loadDirectory(actPath);
      }
      if (dualPane) {
        const othPath = activePaneIsRight ? currentPath : rightCurrentPath;
        if (isAffected(othPath)) {
          if (activePaneIsRight) await loadDirectory(othPath); else await loadRightDirectory(othPath);
        }
      }

      // Highlight newly created item
      const createdItem = result?.items?.find((i: any) => i.success);
      if (createdItem?.dest) {
        setHighlightedPath(createdItem.dest);
        if (activePaneIsRight) setRightSelected(createdItem.dest);
        else setSelected(createdItem.dest);
        setTimeout(() => setHighlightedPath(null), 2500);
      }

      const succeeded = result?.items?.filter((i: any) => i.success).length ?? count;
      const failed = result?.items?.filter((i: any) => !i.success).length ?? 0;

      if (failed === 0) {
        const targetFolderName = targetDir.split(/[\\/]/).pop() || targetDir;
        const displayName = createdItem?.name || firstItemName;
        showToast({
          type: 'success',
          title: useMove ? 'Moved successfully' : 'Copied successfully',
          message: count === 1 
            ? `"${displayName}" placed in ${targetFolderName}` 
            : `${succeeded} items placed in ${targetFolderName}`
        });
      } else {
        const firstError = result?.errors?.[0] || 'Drop failed for some items.';
        showToast({
          type: 'error',
          title: useMove ? 'Move partially failed' : 'Copy partially failed',
          message: firstError,
          details: result?.errors?.join('\n')
        });
      }
    } catch (err: any) {
      dismissToast(progressToastId);
      const errMsg = err?.message || String(err);
      console.error('Drop failed:', err);
      if (errMsg.includes('Permission denied') || errMsg.includes('administrator') || errMsg.includes('EPERM')) {
        setElevationPrompt({
          sources: paths,
          target: targetDir,
          isMove: useMove,
        });
        return;
      }
      showToast({
        type: 'error',
        title: useMove ? 'Move failed' : 'Drop failed',
        message: errMsg.replace(/^Error:\s*/, ''),
        details: err?.stack || errMsg
      });
    }
  }, [activePaneIsRight, rightCurrentPath, currentPath, dualPane, loadDirectory, loadRightDirectory, showToast, dismissToast]);

  const handlePaneDrop = useCallback((e: React.DragEvent, isRight: boolean) => {
    const tgt = isRight ? rightCurrentPath : currentPath;
    handleDropToPath(e, tgt);
    if (isRight) {
      setActivePane('right');
      setRightSelected(null);
    } else {
      setActivePane('left');
      setSelected(null);
    }
  }, [handleDropToPath, rightCurrentPath, currentPath]);

  // Native folder picker — targets the active pane
  const pickFolder = useCallback(async () => {
    const chosen = await api.selectFolder();
    if (chosen) activeNavigate(chosen);
  }, [activeNavigate]);

  const addFolderToQuickAccess = async () => {
    const chosen = await api.selectFolder();
    if (chosen) {
      const label = chosen.split(/[\\/]/).pop() || chosen;
      const exists = quickAccess.some(q => q.path.toLowerCase() === chosen.toLowerCase());
      if (!exists) {
        const newList = [...quickAccess, { label, path: chosen }];
        setQuickAccess(newList);
        localStorage.setItem('quickAccess', JSON.stringify(newList));
      }
    }
  };

  const removeFromQuickAccess = (pathToRemove: string) => {
    const newList = quickAccess.filter(q => q.path !== pathToRemove);
    setQuickAccess(newList);
    localStorage.setItem('quickAccess', JSON.stringify(newList));
  };

  const openEntry = async (entry: DirEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    } else {
      let vtype = getViewerType(entry.ext);
      if (vtype) {
        if (entry.ext?.toLowerCase() === '.ply' && api?.detectPlyType) {
          try {
            const detected = await api.detectPlyType(entry.path);
            if (detected === 'gaussian-splat') {
              vtype = 'gaussian-splat';
            }
          } catch {}
        }
        setViewer({ type: vtype, path: entry.path, name: entry.name });
        if (vtype === 'text') {
          setTextContent('Loading file content...');
          api.readTextFile(entry.path)
            .then((txt: string) => setTextContent(txt))
            .catch((err: any) => setTextContent(`Failed to read file: ${err?.message || err}`));
        }
      } else {
        api.openPath(entry.path);
      }
    }
  };

  // Row interactions
  const onRowClick = (entry: DirEntry) => {
    setSelected(entry.path);
    setActivePane('left');
  };
  const onRowDoubleClick = (entry: DirEntry) => openEntry(entry);

  // Processed + sorted + filtered list
  const visibleEntries = useMemo(() => {
    const activeSearch = filter;
    let res = entries.filter(e =>
      matchesSearch(e.name, activeSearch)
    );

    res.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;

      let va: any, vb: any;
      if (sortBy === 'name') {
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
      } else if (sortBy === 'size') {
        va = a.size ?? -1;
        vb = b.size ?? -1;
      } else {
        va = a.mtime;
        vb = b.mtime;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return res;
  }, [entries, filter, sortBy, sortDir]);

  // Right pane visible (duplicated logic for independence)
  const rightVisibleEntries = useMemo(() => {
    const activeSearch = rightFilter;
    let res = rightEntries.filter(e =>
      matchesSearch(e.name, activeSearch)
    );
    res.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let va: any, vb: any;
      if (rightSortBy === 'name') {
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
      } else if (rightSortBy === 'size') {
        va = a.size ?? -1;
        vb = b.size ?? -1;
      } else {
        va = a.mtime;
        vb = b.mtime;
      }
      if (va < vb) return rightSortDir === 'asc' ? -1 : 1;
      if (va > vb) return rightSortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return res;
  }, [rightEntries, rightFilter, rightSortBy, rightSortDir]);

  const stats = useMemo(() => {
    const folderCount = entries.filter(e => e.isDirectory).length;
    const fileCount = entries.length - folderCount;
    const filesTotalBytes = entries
      .filter(e => !e.isDirectory)
      .reduce((s, e) => s + (e.size || 0), 0);
    return { folderCount, fileCount, filesTotalBytes };
  }, [entries]);

  // Keyboard shortcuts — respect active pane for nav / refresh / calc
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') {
        activeGoUp();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        activeRefresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        activeCalculateAllVisibleSizes();
      }
      if (e.key === 'Escape') {
        if (viewer) {
          setViewer(null);
        } else {
          setFilter('');
          setSelected(null);
          setRightSelected(null);
        }
      }
      if (e.key === 'Enter' && !activePaneIsRight && selected) {
        const ent = entries.find(x => x.path === selected);
        if (ent) openEntry(ent);
      }
      // Also support Enter to open in the right pane when it is active
      if (e.key === 'Enter' && activePaneIsRight && rightSelected) {
        const ent = rightEntries.find(x => x.path === rightSelected);
        if (ent) openEntry(ent);
      }
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '');
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (isInput) return;
        e.preventDefault();
        copyToClipboard(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (isInput) return;
        e.preventDefault();
        copyToClipboard(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (isInput) return;
        e.preventDefault();
        pasteFromClipboard();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeGoUp, activeRefresh, activeCalculateAllVisibleSizes, selected, entries, copyToClipboard, pasteFromClipboard, activePaneIsRight, rightSelected, rightEntries, navigateRight, viewer, activePane]);

  const toggleSort = (key: 'name' | 'size' | 'mtime') => {
    if (sortBy === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const toggleRightSort = (key: 'name' | 'size' | 'mtime') => {
    if (rightSortBy === key) {
      setRightSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setRightSortBy(key);
      setRightSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  // Context menu (simple) - supports row (with entry) and pane-level (entry=null) for empty space
  const [ctx, setCtx] = useState<{ x: number; y: number; entry: DirEntry | null } | null>(null);

  const showContextMenu = (e: React.MouseEvent, entry: DirEntry | null) => {
    e.preventDefault();
    e.stopPropagation();
    let x = e.clientX;
    let y = e.clientY;
    // Flip upwards if near bottom of viewport to avoid cutoff
    const estimatedMenuHeight = entry ? 220 : 120; // pane ctx is smaller
    if (y + estimatedMenuHeight > window.innerHeight - 8) {
      y = Math.max(8, e.clientY - estimatedMenuHeight);
    }
    // Note: callers are responsible for setting the correct pane's selected + activePane
    // before calling (so copy/cut/paste target the intended item and pane).
    setCtx({ x, y, entry });
  };

  // legacy for rows
  const showCtx = (e: React.MouseEvent, entry: DirEntry) => {
    showContextMenu(e, entry);
  };

  const closeCtx = () => setCtx(null);

  // Drive context menu (for THIS PC sidebar entries)
  const showDriveCtx = (e: React.MouseEvent, drive: DriveInfo) => {
    e.preventDefault();
    e.stopPropagation();
    let x = e.clientX;
    let y = e.clientY;
    const estimatedMenuHeight = 170;
    if (y + estimatedMenuHeight > window.innerHeight - 8) {
      y = Math.max(8, e.clientY - estimatedMenuHeight);
    }
    // also close any file ctx
    if (ctx) closeCtx();
    setDriveCtx({ x, y, drive });
  };

  const closeDriveCtx = () => setDriveCtx(null);

  const ctxAction = async (act: string) => {
    if (!ctx) return;
    const entry = ctx.entry;
    closeCtx();

    if (act === 'paste') {
      const target = (entry && entry.isDirectory) ? entry.path : undefined;
      pasteFromClipboard(target);
      return;
    }

    if (act === 'new-folder') {
      const targetDir = activePaneIsRight ? rightCurrentPath : currentPath;
      try {
        const res = await api.createFolder(targetDir);
        if (res && typeof res === 'object' && res.requiresElevation) {
          setElevationPrompt({
            sources: [],
            target: targetDir,
            isMove: false,
            action: 'createFolder',
          });
          return;
        }
        if (activePaneIsRight) {
          loadRightDirectory(targetDir);
        } else {
          loadDirectory(targetDir);
        }
      } catch (e: any) {
        console.error('Failed to create folder', e);
        const errMsg = e?.message || String(e);
        if (errMsg.includes('Permission denied') || errMsg.includes('administrator') || errMsg.includes('EPERM')) {
          setElevationPrompt({
            sources: [],
            target: targetDir,
            isMove: false,
            action: 'createFolder',
          });
        }
      }
      return;
    }

    if (act === 'pin-quick') {
      const targetDir = entry ? entry.path : (activePaneIsRight ? rightCurrentPath : currentPath);
      if (!targetDir) return;
      const label = entry ? entry.name : (targetDir.split(/[\\/]/).pop() || targetDir);
      const exists = quickAccess.some(q => q.path.toLowerCase() === targetDir.toLowerCase());
      if (!exists) {
        const newList = [...quickAccess, { label, path: targetDir }];
        setQuickAccess(newList);
        localStorage.setItem('quickAccess', JSON.stringify(newList));
      }
      return;
    }

    if (act === 'open-cmd' || act === 'open-powershell') {
      let targetDir = activePaneIsRight ? rightCurrentPath : currentPath;
      if (entry) {
        targetDir = entry.isDirectory ? entry.path : entry.path.substring(0, Math.max(entry.path.lastIndexOf('\\'), entry.path.lastIndexOf('/')) || entry.path.length);
      }
      if (api) {
        const sh = act === 'open-cmd' ? 'cmd' : 'powershell';
        await (api as any).openTerminal(targetDir, sh);
      }
      return;
    }

    if (!entry) return; // row-only actions below

    if (act === 'open') openEntry(entry);
    if (act === 'explorer') api.showInExplorer(entry.path);
    if (act === 'calc' && entry.isDirectory) calculateFolderSize(entry.path, true);
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(entry.path);
        showToast({
          type: 'info',
          title: 'Path copied to clipboard',
          message: entry.path
        });
      } catch {}
    }
    if (act === 'copy-item') copyToClipboard(false, entry.path);
    if (act === 'cut-item') copyToClipboard(true, entry.path);
  };

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (ctx && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeCtx();
      }
      if (driveCtx && driveMenuRef.current && !driveMenuRef.current.contains(event.target as Node)) {
        closeDriveCtx();
      }
    };

    // Use mousedown so it closes before click handlers on other elements, and doesn't interfere with menu item clicks
    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [ctx, driveCtx]);

  const selectedEntry = entries.find(e => e.path === selected);

  const onRightRowClick = (entry: DirEntry) => {
    setRightSelected(entry.path);
    setActivePane('right');
  };
  const onRightRowDoubleClick = (entry: DirEntry) => {
    setActivePane('right');
    openEntry(entry);
  };

  // Empty space handlers for panes: activate pane, allow paste / new folder via context
  const activateLeft = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActivePane('left');
    setSelected(null);
  };
  const showLeftPaneCtx = (e: React.MouseEvent) => {
    setActivePane('left');
    setSelected(null);
    showContextMenu(e, null);
  };

  const activateRight = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setActivePane('right');
    setRightSelected(null);
  };
  const showRightPaneCtx = (e: React.MouseEvent) => {
    setActivePane('right');
    setRightSelected(null);
    showContextMenu(e, null);
  };

  return (
    <div className="app-container flex flex-col h-screen text-sm select-none bg-[#0f0f10] text-[#e5e5e7]">
      {/* Top controls (titlebar area is handled by Electron overlay when packaged).
          All custom buttons are on the LEFT so they don't get covered by the OS min/max/close controls on the right. */}
      <div
        className="flex items-center gap-1.5 px-2 pr-8 bg-[#18181b] border-b border-zinc-800"
        style={{ WebkitAppRegion: 'drag', height: '40px' } as any}
      >
        <div className="px-1.5 text-[10px] tracking-[1px] text-zinc-500 font-semibold select-none">JABROFILES</div>

        {/* All buttons clustered on the left, away from the system window controls (min/max/close) */}
        <button onClick={activeGoBack} disabled={activeHistoryIndex === 0} className="nav-button" title="Back (Backspace in list)" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ArrowLeft size={15} />
        </button>
        <button onClick={activeGoForward} disabled={activeHistoryIndex >= activeHistoryLength - 1} className="nav-button" title="Forward" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ArrowRight size={15} />
        </button>
        <button onClick={activeGoUp} className="nav-button" title="Up one level" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ArrowUp size={15} />
        </button>
        <button onClick={activeRefresh} className="nav-button" title="Refresh (F5) — active pane" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <RefreshCw size={14} />
        </button>
        <button onClick={pickFolder} className="nav-button" title="Choose a folder to browse" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <FolderOpen size={15} />
        </button>

        {/* small visual gap between nav and actions */}
        <div className="w-2" />

        <button
          onClick={() => setAutoCalc(!autoCalc)}
          className={`text-[11px] px-2 py-0.5 rounded flex items-center gap-1 transition ${autoCalc ? 'bg-zinc-800 text-blue-400' : 'hover:bg-zinc-800'}`}
          title="Auto-calculate folder sizes when entering a directory"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <Calculator size={13} /> Auto
        </button>
        <button onClick={activeCalculateAllVisibleSizes} className="nav-button" title="Calculate sizes for every folder in active pane (Ctrl+R)" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Calculator size={14} />
        </button>

        <button 
          onClick={() => {
            const next = !dualPane;
            setDualPane(next);
            if (next && rightEntries.length === 0) {
              loadRightDirectory(rightCurrentPath);
            }
            setActivePane(next ? 'right' : 'left');
          }} 
          className={`nav-button flex items-center gap-1 ${dualPane ? 'bg-zinc-800 text-blue-300 ring-1 ring-blue-500/50' : 'text-zinc-400'}`} 
          style={{ WebkitAppRegion: 'no-drag', width: 'auto', minWidth: '66px', padding: '0 6px' } as any}
          title="Toggle dual pane / second page (split view) — click to open the second pane"
        >
          <span className="text-[10px] font-bold tracking-tighter">||</span>
          <span className="text-[10px] font-semibold">Split</span>
        </button>

        {/* breathing room so the last button isn't under the OS min/max/close overlay controls on the right */}
        <div className="w-10" style={{ WebkitAppRegion: 'drag' } as any} />

        {/* Draggable area on the RIGHT (under the OS min/max/close overlay controls) */}
        <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as any} />
      </div>

      {/* Path bar — shared between panes. Shows/edits the path of the active pane. */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#111113] border-b border-zinc-800">
        <input
          className="path-bar flex-1 px-3 py-1 text-[13px]"
          value={activeCurrentPath}
          onChange={(e) => {
            if (activePaneIsRight) {
              setRightCurrentPath(e.target.value);
            } else {
              setCurrentPath(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              activeNavigate(activePaneIsRight ? rightCurrentPath : currentPath);
            }
          }}
          spellCheck={false}
          title={activePaneIsRight ? 'Right pane path (active)' : 'Left pane path (active)'}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 bg-[#111113] border-r border-zinc-800 overflow-auto flex flex-col text-sm">
          <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500 flex items-center justify-between">
            QUICK ACCESS
            <button
              onClick={addFolderToQuickAccess}
              className="text-blue-400 hover:text-blue-300 text-lg leading-none px-1"
              title="Pin a folder to Quick Access"
            >
              +
            </button>
          </div>
          {quickAccess.map(item => (
            <div
              key={item.path}
              onClick={() => activeNavigate(item.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (window.confirm(`Remove "${item.label}" from Quick Access?`)) {
                  removeFromQuickAccess(item.path);
                }
              }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={(e) => handleDropToPath(e, item.path)}
              className={`mx-1.5 px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer ${(activePaneIsRight ? rightCurrentPath : currentPath) === item.path ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
              title={item.path}
            >
              <Folder size={15} className="text-blue-400" /> {item.label}
            </div>
          ))}

          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500">THIS PC</div>
          {drives.length > 0 ? drives.map(d => (
            <div
              key={d.path}
              onClick={() => activeNavigate(d.path)}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showDriveCtx(e, d); }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={(e) => handleDropToPath(e, d.path)}
              className={`mx-1.5 px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer ${(activePaneIsRight ? rightCurrentPath : currentPath).startsWith(d.path) ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
              title={d.size != null && d.freeSpace != null ? `${formatSize(d.freeSpace)} free of ${formatSize(d.size)}` : undefined}
            >
              <HardDrive size={15} className="text-emerald-400" />
              <span className="flex-1 min-w-0 truncate">
                {d.name} {d.label ? `(${d.label})` : ''}
              </span>
              {d.size != null && d.freeSpace != null && (
                <span className="text-[10px] text-zinc-500 flex-shrink-0 ml-1 whitespace-nowrap">({formatSize(d.freeSpace)} free of {formatSize(d.size)})</span>
              )}
            </div>
          )) : (
            <div className="mx-1.5 px-2.5 py-1 text-zinc-500 text-xs">No drives detected</div>
          )}

          <div className="flex-1" />
        </div>

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Secondary toolbar */}
          <div className="h-10 px-3 flex items-center gap-2 bg-[#111113] border-b border-zinc-800">
            <div className="flex items-center flex-1 max-w-xs bg-zinc-900 rounded pl-3 relative">
              <Search size={14} className="text-zinc-500" />
              <input
                className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-600"
                placeholder="Search..."
                value={activePaneIsRight ? rightFilter : filter}
                onChange={e => {
                  if (activePaneIsRight) setRightFilter(e.target.value); else setFilter(e.target.value);
                }}
                onFocus={() => setShowSuggestions(false)}
              />
              {(activePaneIsRight ? rightFilter : filter) && <X size={15} className="mr-2 cursor-pointer text-zinc-500" onClick={() => {
                if (activePaneIsRight) setRightFilter(''); else setFilter('');
              }} />}
              <button
                onClick={() => setShowSuggestions(!showSuggestions)}
                className="text-zinc-400 hover:text-zinc-200 px-1"
                title="Search suggestions for common formats"
              >
                <ChevronDown size={14} />
              </button>
              {showSuggestions && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-[#18181b] border border-zinc-700 rounded shadow text-xs w-44 overflow-hidden">
                  {[
                    { label: 'All files', value: '' },
                    { label: 'Media files', value: '*.mp3;*.mp4;*.avi;*.mkv;*.mov;*.flac;*.wav;*.aac' },
                    { label: 'Image files', value: '*.png;*.jpg;*.jpeg;*.gif;*.bmp;*.webp;*.svg;*.ico' },
                    { label: '3D files', value: '*.fbx;*.obj;*.gltf;*.glb;*.blend;*.3ds;*.max;*.ma' },
                    { label: 'Documents', value: '*.pdf;*.doc;*.docx;*.xls;*.xlsx;*.ppt;*.pptx;*.txt;*.md;*.csv' },
                    { label: 'Archives', value: '*.zip;*.rar;*.7z;*.tar;*.gz' },
                    { label: 'Code files', value: '*.js;*.ts;*.tsx;*.py;*.cpp;*.cs;*.java;*.go' },
                  ].map((sug, idx) => (
                    <div
                      key={idx}
                      className="px-2 py-1 hover:bg-zinc-800 cursor-pointer"
                      onClick={() => {
                        if (activePaneIsRight) setRightFilter(sug.value); else setFilter(sug.value);
                        setShowSuggestions(false);
                      }}
                    >
                      {sug.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-1" />
          </div>

          {/* The list area - supports dual pane ("second page") */}
          <div className={`flex-1 overflow-hidden list-area ${dualPane ? 'flex flex-row' : 'flex flex-col'}`}>
            {/* Left pane */}
            <div className={`overflow-auto ${dualPane ? 'w-1/2 border-r border-zinc-800' : 'file-list flex-1'} ${dualPane && activePane === 'left' ? 'ring-1 ring-inset ring-blue-500/30' : ''}`}>
              <div
                className="file-list h-full"
                onClick={activateLeft}
                onContextMenu={showLeftPaneCtx}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={(e) => handlePaneDrop(e, false)}
              >
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 pt-4">
                    <RefreshCw className="spinner mr-2" size={18} /> Loading…
                  </div>
                ) : visibleEntries.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 pt-4">
                    <Folder size={40} />
                    <div>Empty folder{filter ? ' (no matches)' : ''}</div>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th onClick={() => toggleSort('name')} className="sortable w-[48%] text-left">Name {sortBy === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th onClick={() => toggleSort('size')} className="sortable w-[18%] text-right pr-4">Size {sortBy === 'size' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th onClick={() => toggleSort('mtime')} className="sortable w-[22%]">Date modified {sortBy === 'mtime' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th className="w-[12%]">Kind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map(entry => {
                        const cached = sizeCache[entry.path];
                        const sz = entry.isDirectory ? (cached?.size ?? entry.size) : entry.size;

                        const isCut = clipboard?.isCut && clipboard?.paths.includes(entry.path);
                        const isJustPasted = highlightedPath === entry.path;
                        const isDropTarget = dragOverFolderPath === entry.path;

                        return (
                          <tr
                            key={entry.path}
                            className={`file-row ${selected === entry.path ? 'selected' : ''} ${isCut ? 'is-cut' : ''} ${isDropTarget ? 'drop-target' : ''} ${isJustPasted ? 'just-pasted' : ''}`}
                            draggable
                            onDragStart={(e) => {
                              const p = entry.path;
                              e.dataTransfer.setData('application/x-jabro-path', JSON.stringify([p]));
                              e.dataTransfer.setData('text/plain', p);
                              e.dataTransfer.effectAllowed = 'copyMove';
                            }}
                            onDragOver={entry.isDirectory ? (e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                              setDragOverFolderPath(entry.path);
                            } : undefined}
                            onDragLeave={entry.isDirectory ? () => {
                              if (dragOverFolderPath === entry.path) setDragOverFolderPath(null);
                            } : undefined}
                            onDrop={entry.isDirectory ? (e) => { handleDropToPath(e, entry.path); setActivePane('left'); } : undefined}
                            onClick={(e) => { e.stopPropagation(); onRowClick(entry); }}
                            onDoubleClick={() => onRowDoubleClick(entry)}
                            onContextMenu={(e) => { e.stopPropagation(); setActivePane('left'); setSelected(entry.path); showCtx(e, entry); }}
                          >
                            <td>
                              <div className="name-cell">
                                {getIcon(entry)}
                                <span className="truncate">{entry.name}</span>
                                {entry.isDirectory && (entry.fileCount != null || entry.dirCount != null) && (
                                  <span className="text-[10px] px-1.5 py-px rounded bg-zinc-800 text-zinc-400 tabular-nums">
                                    {(entry.dirCount || 0) + (entry.fileCount || 0)} items
                                  </span>
                                )}
                              </div>
                            </td>

                            <td
                              className={`size-cell text-right pr-4 ${entry.isDirectory ? 'hover:text-blue-400 cursor-pointer' : ''}`}
                              onClick={(e) => {
                                if (entry.isDirectory) {
                                  e.stopPropagation();
                                  calculateFolderSize(entry.path, true);
                                }
                              }}
                              title={entry.isDirectory ? 'Click to (re)calculate total size of this folder' : ''}
                            >
                              {formatSize(sz)}
                              {entry.isDirectory && !sz && <span className="text-blue-400/70 text-xs ml-1">—</span>}
                            </td>

                            <td className="text-zinc-400 tabular-nums">{formatDate(entry.mtime)}</td>
                            <td className="text-zinc-500">{entry.isDirectory ? 'Folder' : (entry.ext || 'File')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right pane (the "second page") - no extra header/buttons, uses shared top bar + filter. Aligned with left. */}
            {dualPane && (
              <div className={`w-1/2 flex flex-col overflow-hidden ${activePane === 'right' ? 'ring-1 ring-inset ring-blue-500/30' : ''}`}>
                <div 
                  className="file-list flex-1 overflow-auto"
                  onClick={activateRight}
                  onContextMenu={showRightPaneCtx}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                  onDrop={(e) => handlePaneDrop(e, true)}
                >
                  {isRightLoading ? (
                    <div className="h-full flex items-center justify-center text-zinc-500 pt-4">
                      <RefreshCw className="spinner mr-2" size={18} /> Loading…
                    </div>
                  ) : rightVisibleEntries.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 pt-4">
                      <Folder size={40} />
                      <div>Empty</div>
                    </div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr>
                          <th onClick={() => toggleRightSort('name')} className="sortable w-[48%] text-left">Name {rightSortBy === 'name' ? (rightSortDir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th onClick={() => toggleRightSort('size')} className="sortable w-[18%] text-right pr-4">Size {rightSortBy === 'size' ? (rightSortDir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th onClick={() => toggleRightSort('mtime')} className="sortable w-[22%]">Date modified {rightSortBy === 'mtime' ? (rightSortDir === 'asc' ? '▲' : '▼') : ''}</th>
                          <th className="w-[12%]">Kind</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rightVisibleEntries.map(entry => {
                          const cached = sizeCache[entry.path];
                          const sz = entry.isDirectory ? (cached?.size ?? entry.size) : entry.size;

                          const isCut = clipboard?.isCut && clipboard?.paths.includes(entry.path);
                          const isJustPasted = highlightedPath === entry.path;
                          const isDropTarget = dragOverFolderPath === entry.path;

                          return (
                            <tr
                              key={entry.path}
                              className={`file-row ${rightSelected === entry.path ? 'selected' : ''} ${isCut ? 'is-cut' : ''} ${isDropTarget ? 'drop-target' : ''} ${isJustPasted ? 'just-pasted' : ''}`}
                              draggable
                              onDragStart={(e) => {
                                const p = entry.path;
                                e.dataTransfer.setData('application/x-jabro-path', JSON.stringify([p]));
                                e.dataTransfer.setData('text/plain', p);
                                e.dataTransfer.effectAllowed = 'copyMove';
                              }}
                              onDragOver={entry.isDirectory ? (e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                                setDragOverFolderPath(entry.path);
                              } : undefined}
                              onDragLeave={entry.isDirectory ? () => {
                                if (dragOverFolderPath === entry.path) setDragOverFolderPath(null);
                              } : undefined}
                              onDrop={entry.isDirectory ? (e) => { handleDropToPath(e, entry.path); setActivePane('right'); } : undefined}
                              onClick={(e) => { e.stopPropagation(); onRightRowClick(entry); }}
                              onDoubleClick={() => onRightRowDoubleClick(entry)}
                              onContextMenu={(e) => { e.stopPropagation(); setActivePane('right'); setRightSelected(entry.path); showCtx(e, entry); }}
                            >
                              <td>
                                <div className="name-cell">
                                  {getIcon(entry)}
                                  <span className="truncate">{entry.name}</span>
                                  {entry.isDirectory && (entry.fileCount != null || entry.dirCount != null) && (
                                    <span className="text-[10px] px-1.5 py-px rounded bg-zinc-800 text-zinc-400 tabular-nums">
                                      {(entry.dirCount || 0) + (entry.fileCount || 0)} items
                                    </span>
                                  )}
                                </div>
                              </td>

                              <td
                                className={`size-cell text-right pr-4 ${entry.isDirectory ? 'hover:text-blue-400 cursor-pointer' : ''}`}
                                onClick={(e) => {
                                  if (entry.isDirectory) {
                                    e.stopPropagation();
                                    calculateFolderSize(entry.path, true);
                                  }
                                }}
                                title={entry.isDirectory ? 'Click to (re)calculate total size of this folder' : ''}
                              >
                                {formatSize(sz)}
                                {entry.isDirectory && !sz && <span className="text-blue-400/70 text-xs ml-1">—</span>}
                              </td>

                              <td className="text-zinc-400 tabular-nums">{formatDate(entry.mtime)}</td>
                              <td className="text-zinc-500">{entry.isDirectory ? 'Folder' : (entry.ext || 'File')}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="statusbar h-7 px-3 text-xs bg-[#18181b] border-t border-zinc-800 flex items-center gap-x-3 text-zinc-400">
            <div>{entries.length} items • {stats.folderCount} folders, {stats.fileCount} files</div>
            <div>Files in view: <span className="text-zinc-200">{formatSize(stats.filesTotalBytes)}</span></div>
            {clipboard && clipboard.paths.length > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px]">
                {clipboard.isCut ? <Scissors size={12} className="text-amber-400" /> : <Copy size={12} className="text-blue-400" />}
                <span className="font-medium text-zinc-200">
                  {clipboard.paths.length} {clipboard.paths.length === 1 ? 'item' : 'items'} {clipboard.isCut ? 'cut' : 'copied'}
                </span>
                <button
                  onClick={() => pasteFromClipboard()}
                  className="ml-1 px-1.5 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-500 text-white rounded font-medium cursor-pointer"
                  title="Paste to active folder (Ctrl+V)"
                >
                  Paste
                </button>
                <button
                  onClick={() => setClipboard(null)}
                  className="text-zinc-400 hover:text-zinc-200 ml-0.5 px-0.5 cursor-pointer"
                  title="Clear clipboard"
                >
                  ×
                </button>
              </div>
            )}
            {selectedEntry && <div className="ml-auto truncate max-w-[420px] text-zinc-500">{selectedEntry.path}</div>}
            {operationStatus && <div className="ml-2 text-blue-400 truncate max-w-[280px]">{operationStatus}</div>}
            <div className="ml-auto text-[10px] text-zinc-500 hidden md:block">
              Ctrl+R = calc all • Click folder size to scan {dualPane ? '• Dual pane ON' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Context menu - supports rows and empty-pane (for paste here + new folder) */}
      {ctx && (
        <div ref={menuRef} className="context-menu" style={{ left: ctx.x, top: ctx.y }}>
          {!ctx.entry ? (
            // Pane-level (empty space) menu
            <>
              <div className="context-menu-item" onClick={() => ctxAction('new-folder')}>
                <Folder size={14} /> New folder
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('pin-quick')}>
                Add current folder to Quick Access
              </div>
              <div className="border-t border-zinc-700 my-0.5" />
              <div className="context-menu-item" onClick={() => ctxAction('open-cmd')}>
                Open Command Prompt here
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('open-powershell')}>
                Open PowerShell here
              </div>
              <div className="border-t border-zinc-700 my-0.5" />
              <div className="context-menu-item" onClick={() => ctxAction('paste')}>
                Paste
              </div>
              {clipboard && clipboard.paths.length > 0 && (
                <div
                  className="context-menu-item text-amber-300 hover:text-amber-200"
                  onClick={() => {
                    const target = activePaneIsRight ? rightCurrentPath : currentPath;
                    closeCtx();
                    setElevationPrompt({
                      sources: clipboard.paths,
                      target,
                      isMove: clipboard.isCut,
                    });
                  }}
                >
                  <ShieldAlert size={14} className="text-amber-400" />
                  <span>Paste as Administrator</span>
                </div>
              )}
            </>
          ) : (
            // Row menu
            <>
              <div className="context-menu-item" onClick={() => ctxAction('open')}>
                {ctx.entry.isDirectory ? 'Open' : 'Open file'}
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('explorer')}>
                Show in Explorer
              </div>
              <div className="border-t border-zinc-700 my-0.5" />
              {ctx.entry.isDirectory && (
                <div className="context-menu-item" onClick={() => ctxAction('calc')}>
                  <Calculator size={14} /> Calculate size now
                </div>
              )}
              {ctx.entry?.isDirectory && !quickAccess.some(q => q.path.toLowerCase() === ctx.entry!.path.toLowerCase()) && (
                <div className="context-menu-item" onClick={() => ctxAction('pin-quick')}>
                  Pin to Quick Access
                </div>
              )}
              <div className="context-menu-item" onClick={() => ctxAction('open-cmd')}>
                Open Command Prompt here
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('open-powershell')}>
                Open PowerShell here
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('copy-item')}>
                Copy
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('cut-item')}>
                Cut
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('paste')}>
                Paste
              </div>
              {clipboard && clipboard.paths.length > 0 && (
                <div
                  className="context-menu-item text-amber-300 hover:text-amber-200"
                  onClick={() => {
                    const target = (ctx.entry && ctx.entry.isDirectory) ? ctx.entry.path : (activePaneIsRight ? rightCurrentPath : currentPath);
                    closeCtx();
                    setElevationPrompt({
                      sources: clipboard.paths,
                      target,
                      isMove: clipboard.isCut,
                    });
                  }}
                >
                  <ShieldAlert size={14} className="text-amber-400" />
                  <span>Paste as Administrator</span>
                </div>
              )}
              <div className="border-t border-zinc-700 my-0.5" />
              <div className="context-menu-item" onClick={() => ctxAction('copy')}>
                Copy full path
              </div>
            </>
          )}
        </div>
      )}

      {/* Drive context menu for THIS PC entries */}
      {driveCtx && (
        <div ref={driveMenuRef} className="context-menu" style={{ left: driveCtx.x, top: driveCtx.y }}>
          <div className="context-menu-item" onClick={() => { activeNavigate(driveCtx.drive.path); closeDriveCtx(); }}>
            Open
          </div>
          <div className="context-menu-item" onClick={() => { api.showInExplorer(driveCtx.drive.path); closeDriveCtx(); }}>
            Show in Explorer
          </div>
          <div className="border-t border-zinc-700 my-0.5" />
          <div className="context-menu-item" onClick={async () => {
            const p = driveCtx.drive.path;
            closeDriveCtx();
            if (api) await (api as any).openTerminal(p, 'cmd');
          }}>
            Open Command Prompt here
          </div>
          <div className="context-menu-item" onClick={async () => {
            const p = driveCtx.drive.path;
            closeDriveCtx();
            if (api) await (api as any).openTerminal(p, 'powershell');
          }}>
            Open PowerShell here
          </div>
          <div className="border-t border-zinc-700 my-0.5" />
          <div className="context-menu-item" onClick={() => {
            navigator.clipboard.writeText(driveCtx.drive.path);
            closeDriveCtx();
          }}>
            Copy path
          </div>
        </div>
      )}

      {/* Integrated viewer modal for images, audio, video, text */}
      {viewer && (
        <div
          className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4"
          onClick={() => setViewer(null)}
        >
          <div
            className="bg-[#18181b] border border-zinc-700 rounded-xl shadow-2xl max-w-[92vw] max-h-[92vh] w-full flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-700 bg-[#111113] text-sm">
              <div className="flex items-center gap-2 truncate font-medium pr-4">
                {viewer.type === 'pdf' && <FileText size={16} className="text-rose-400 flex-shrink-0" />}
                {viewer.type === '3d' && <Box size={16} className="text-indigo-400 flex-shrink-0" />}
                {viewer.type === 'gaussian-splat' && <Sparkles size={16} className="text-violet-400 flex-shrink-0" />}
                <span className="truncate">{viewer.name}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono uppercase">
                  {viewer.type === 'gaussian-splat' ? 'Gaussian Splat' : viewer.type.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    api.openPath(viewer.path);
                    setViewer(null);
                  }}
                  className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-200 transition cursor-pointer font-medium"
                >
                  Open with default app
                </button>
                <button onClick={() => setViewer(null)} className="text-xl leading-none px-2 hover:text-red-400 cursor-pointer">×</button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-0 bg-[#0f0f10] flex items-center justify-center relative min-h-[500px]">
              {viewer.type === 'image' && (
                <div className="p-4 flex items-center justify-center w-full h-full">
                  <img
                    src={toFileUrl(viewer.path)}
                    alt={viewer.name}
                    className="max-w-full max-h-[78vh] object-contain shadow-2xl"
                  />
                </div>
              )}
              {viewer.type === 'audio' && (
                <div className="p-8 flex items-center justify-center w-full">
                  <audio
                    controls
                    src={toFileUrl(viewer.path)}
                    className="w-full max-w-md shadow-lg"
                  />
                </div>
              )}
              {viewer.type === 'video' && (
                <div className="p-4 flex items-center justify-center w-full h-full">
                  <video
                    controls
                    autoPlay
                    src={toFileUrl(viewer.path)}
                    className="max-w-full max-h-[78vh] shadow-2xl rounded"
                  />
                </div>
              )}
              {viewer.type === 'text' && (
                <div className="p-4 w-full h-full flex justify-center">
                  <pre className="whitespace-pre-wrap font-mono text-sm w-full max-w-4xl bg-[#111113] p-4 rounded overflow-auto max-h-[78vh] border border-zinc-800">
                    {textContent || 'Loading...'}
                  </pre>
                </div>
              )}
              {viewer.type === 'pdf' && (
                <div className="w-full h-[80vh] flex flex-col bg-[#242426] overflow-hidden">
                  <iframe
                    src={toMediaUrl(viewer.path)}
                    title={viewer.name}
                    className="w-full flex-1 border-0"
                  />
                </div>
              )}
              {(viewer.type === '3d' || viewer.type === 'gaussian-splat') && (
                <div className="w-full h-[80vh] flex flex-col overflow-hidden">
                  <ThreeViewer
                    key={viewer.path}
                    filePath={viewer.path}
                    fileName={viewer.name}
                    isGaussianSplat={viewer.type === 'gaussian-splat'}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications container - non-blocking feedback */}
      <div className="fixed bottom-9 right-4 z-[9999] flex flex-col gap-2 max-w-[420px] w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 p-3 rounded-xl border shadow-2xl backdrop-blur-md toast-enter transition-all ${
              toast.type === 'success'
                ? 'bg-[#121c15]/95 border-emerald-500/40 text-emerald-200'
                : toast.type === 'error'
                ? 'bg-[#221214]/95 border-rose-500/40 text-rose-200'
                : toast.type === 'loading'
                ? 'bg-[#151c28]/95 border-blue-500/40 text-blue-200'
                : 'bg-[#18181b]/95 border-zinc-700/80 text-zinc-200'
            }`}
          >
            <div className="mt-0.5 flex-shrink-0">
              {toast.type === 'success' && <CheckCircle2 size={18} className="text-emerald-400" />}
              {toast.type === 'error' && <AlertCircle size={18} className="text-rose-400" />}
              {toast.type === 'loading' && <Loader2 size={18} className="text-blue-400 animate-spin" />}
              {toast.type === 'info' && <Info size={18} className="text-sky-400" />}
            </div>
            <div className="flex-1 min-w-0 text-xs">
              <div className="font-semibold text-sm leading-tight text-white mb-0.5">{toast.title}</div>
              <div className="text-zinc-300 break-words leading-relaxed">{toast.message}</div>
              {toast.details && (
                <button
                  onClick={() => {
                    setErrorModalDetails({
                      title: toast.title,
                      message: toast.message,
                      details: toast.details
                    });
                  }}
                  className="mt-1.5 text-[11px] font-medium text-rose-300 hover:text-rose-100 underline cursor-pointer"
                >
                  View error details
                </button>
              )}
            </div>
            {toast.type !== 'loading' && (
              <button
                onClick={() => dismissToast(toast.id)}
                className="text-zinc-400 hover:text-zinc-200 text-lg leading-none p-0.5 -mr-1 -mt-1 cursor-pointer"
                title="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Administrator Permission Prompt Modal */}
      {elevationPrompt && (
        <div
          className="fixed inset-0 bg-black/75 z-[10001] flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => { if (!isElevating) setElevationPrompt(null); }}
        >
          <div
            className="bg-[#18181b] border border-amber-500/40 rounded-xl shadow-2xl max-w-[500px] w-full flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-700/80 bg-[#141416]">
              <div className="flex items-center gap-2.5 font-semibold text-amber-400 text-sm">
                <ShieldAlert size={19} className="text-amber-400" />
                <span>Administrator Permission Required</span>
              </div>
              {!isElevating && (
                <button
                  onClick={() => setElevationPrompt(null)}
                  className="text-xl leading-none px-2 text-zinc-400 hover:text-white cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>

            {/* Content */}
            <div className="p-5 bg-[#121215] text-xs text-zinc-200 flex flex-col gap-3">
              <p className="text-zinc-300 leading-relaxed text-[13px]">
                {elevationPrompt.action === 'createFolder'
                  ? 'Administrator permission is required to create a folder in this location:'
                  : `Administrator permission is required to ${elevationPrompt.isMove ? 'move' : 'copy'} into this location:`}
              </p>

              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#1a1a1f] border border-zinc-700/80 font-mono text-xs text-blue-300">
                <Folder size={16} className="text-blue-400 flex-shrink-0" />
                <span className="truncate font-semibold">{elevationPrompt.target}</span>
              </div>

              {elevationPrompt.action !== 'createFolder' && (
                <div className="text-xs text-zinc-400 mt-1 flex flex-col gap-1">
                  <div>
                    <span className="text-zinc-500">Items ({elevationPrompt.sources.length}): </span>
                    <span className="text-zinc-300 font-medium">
                      {elevationPrompt.sources.length === 1
                        ? `"${elevationPrompt.sources[0].split(/[\\/]/).pop()}"`
                        : `${elevationPrompt.sources.slice(0, 3).map(s => `"${s.split(/[\\/]/).pop()}"`).join(', ')}${elevationPrompt.sources.length > 3 ? ` and ${elevationPrompt.sources.length - 3} more` : ''}`}
                    </span>
                  </div>
                </div>
              )}

              <div className="p-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-[11px] text-zinc-400 leading-normal flex items-start gap-2">
                <Info size={14} className="text-blue-400 flex-shrink-0 mt-0.5" />
                <span>
                  Clicking <strong>Continue as Administrator</strong> will launch the native Windows User Account Control (UAC) authorization prompt.
                </span>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="p-3.5 border-t border-zinc-700/80 bg-[#141416] flex justify-end gap-2.5 text-xs">
              <button
                onClick={() => setElevationPrompt(null)}
                disabled={isElevating}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg cursor-pointer font-medium transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmElevation}
                disabled={isElevating}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer font-semibold shadow-lg shadow-blue-900/30 transition disabled:opacity-60"
              >
                {isElevating ? (
                  <>
                    <Loader2 size={15} className="animate-spin text-white" />
                    <span>Authorizing with Windows UAC...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={15} className="text-emerald-300" />
                    <span>Continue as Administrator</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error Details Modal - only shown if user clicks "View error details" */}
      {errorModalDetails && (
        <div
          className="fixed inset-0 bg-black/75 z-[10000] flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setErrorModalDetails(null)}
        >
          <div
            className="bg-[#18181b] border border-zinc-700 rounded-xl shadow-2xl max-w-[620px] w-full max-h-[75vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 bg-[#121214] text-sm">
              <div className="flex items-center gap-2 font-medium text-rose-300">
                <AlertTriangle size={16} />
                <span>{errorModalDetails.title}</span>
              </div>
              <button onClick={() => setErrorModalDetails(null)} className="text-xl leading-none px-2 text-zinc-400 hover:text-white cursor-pointer">×</button>
            </div>
            <div className="p-4 bg-[#141417] text-sm text-zinc-200 border-b border-zinc-800">
              <p className="font-medium mb-1">{errorModalDetails.message}</p>
              <p className="text-xs text-zinc-400">
                Common causes: file is locked by another open program, insufficient permissions (admin required), or path exceeds Windows limits.
              </p>
            </div>
            <div className="flex-1 overflow-auto p-3 bg-[#0c0c0e] text-xs select-text">
              <pre className="font-mono whitespace-pre-wrap text-zinc-300 leading-snug select-text p-2 bg-[#08080a] rounded border border-zinc-800/80 cursor-text">
                {errorModalDetails.details || 'No additional technical details recorded.'}
              </pre>
            </div>
            <div className="p-3 border-t border-zinc-700 bg-[#121214] flex justify-end gap-2 text-xs">
              <button
                onClick={async () => {
                  const text = `${errorModalDetails.title}\n${errorModalDetails.message}\n\n${errorModalDetails.details || ''}`;
                  try {
                    await navigator.clipboard.writeText(text);
                    showToast({ type: 'info', title: 'Copied', message: 'Error log copied to clipboard' });
                  } catch {}
                }}
                className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded cursor-pointer font-medium"
                title="Copy the full log to clipboard"
              >
                Copy error log
              </button>
              <button
                onClick={() => setErrorModalDetails(null)}
                className="px-4 py-1.5 bg-zinc-600 hover:bg-zinc-500 text-white rounded cursor-pointer font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
