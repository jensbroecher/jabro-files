import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, FolderOpen, 
  HardDrive, Folder, File, Search, X, Calculator, ChevronDown 
} from 'lucide-react';

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
  if (['.tsx', '.ts', '.js', '.jsx'].includes(ext)) return <File size={18} className="text-yellow-400" />;
  if (['.json', '.toml', '.yaml'].includes(ext)) return <File size={18} className="text-emerald-400" />;
  if (['.css', '.scss'].includes(ext)) return <File size={18} className="text-pink-400" />;
  if (['.html', '.htm'].includes(ext)) return <File size={18} className="text-orange-400" />;
  if (['.md', '.txt'].includes(ext)) return <File size={18} className="text-purple-400" />;
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) return <File size={18} className="text-sky-400" />;
  return <File size={18} className="text-zinc-400" />;
}

function toFileUrl(p: string): string {
  // Proper file:// URL for local media in Electron renderer (works on Windows too)
  let normalized = p.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return `file://${normalized}`;
}

function getViewerType(ext?: string): 'image' | 'audio' | 'video' | 'text' | null {
  if (!ext) return null;
  const e = ext.toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico'].includes(e)) return 'image';
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma'].includes(e)) return 'audio';
  if (['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv', '.wmv'].includes(e)) return 'video';
  if (['.txt', '.md', '.js', '.ts', '.tsx', '.json', '.css', '.html', '.htm', '.xml', '.csv', '.log', '.ini', '.bat', '.sh', '.py', '.c', '.cpp', '.h'].includes(e)) return 'text';
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
  const [viewer, setViewer] = useState<null | { type: 'image' | 'audio' | 'video' | 'text'; path: string; name: string }>(null);
  const [textContent, setTextContent] = useState<string | null>(null);

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

  // Listen for copy/paste progress from main process (robocopy or custom)
  useEffect(() => {
    if (api && typeof api.onCopyProgress === 'function') {
      api.onCopyProgress((data: any) => {
        if (data && data.line) {
          setOperationStatus(data.line);
          // Auto clear after a bit when complete
          if (data.line.includes('complete') || data.line.includes('Complete')) {
            setTimeout(() => setOperationStatus(''), 2500);
          }
        }
      });
    }
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
  const copyToClipboard = useCallback((isCut = false) => {
    if (!selected) return;
    setClipboard({ paths: [selected], isCut });
  }, [selected]);

  const pasteFromClipboard = useCallback(async () => {
    if (!clipboard) return;
    const targetIsRight = dualPane && activePane === 'right';
    const targetPath = targetIsRight ? rightCurrentPath : currentPath;
    if (!targetPath) return;
    try {
      if (clipboard.isCut) {
        await api.moveFiles(clipboard.paths, targetPath);
        setClipboard(null);
      } else {
        await api.copyFiles(clipboard.paths, targetPath);
      }
      if (targetIsRight) {
        await loadRightDirectory(targetPath);
      } else {
        await loadDirectory(targetPath);
      }
    } catch (err) {
      console.error('Paste failed', err);
    }
  }, [clipboard, currentPath, rightCurrentPath, dualPane, activePane, loadDirectory, loadRightDirectory]);

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

  const openEntry = (entry: DirEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    } else {
      const vtype = getViewerType(entry.ext);
      if (vtype) {
        setViewer({ type: vtype, path: entry.path, name: entry.name });
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
        }
      }
      if (e.key === 'Enter' && selected) {
        const ent = entries.find(x => x.path === selected);
        if (ent) openEntry(ent);
      }
      // Also support Enter to open in the right pane when it is active
      if (e.key === 'Enter' && activePaneIsRight && rightSelected) {
        const ent = rightEntries.find(x => x.path === rightSelected);
        if (ent) {
          if (ent.isDirectory) navigateRight(ent.path);
          else api.openPath(ent.path);
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copyToClipboard(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        copyToClipboard(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pasteFromClipboard();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeGoUp, activeRefresh, activeCalculateAllVisibleSizes, selected, entries, copyToClipboard, pasteFromClipboard, activePaneIsRight, rightSelected, rightEntries, navigateRight, viewer]);

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
    if (entry) {
      setSelected(entry.path);
    }
    setCtx({ x, y, entry });
  };

  // legacy for rows
  const showCtx = (e: React.MouseEvent, entry: DirEntry) => {
    showContextMenu(e, entry);
  };

  const closeCtx = () => setCtx(null);

  const ctxAction = async (act: string) => {
    if (!ctx) return;
    const entry = ctx.entry;
    closeCtx();

    if (act === 'new-folder') {
      const targetDir = activePaneIsRight ? rightCurrentPath : currentPath;
      try {
        await api.createFolder(targetDir);
        if (activePaneIsRight) {
          loadRightDirectory(targetDir);
        } else {
          loadDirectory(targetDir);
        }
      } catch (e) {
        console.error('Failed to create folder', e);
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

    if (!entry) return; // pane ctx handled above

    if (act === 'open') openEntry(entry);
    if (act === 'explorer') api.showInExplorer(entry.path);
    if (act === 'calc' && entry.isDirectory) calculateFolderSize(entry.path, true);
    if (act === 'copy') navigator.clipboard.writeText(entry.path);
    if (act === 'copy-item') copyToClipboard(false);
    if (act === 'cut-item') copyToClipboard(true);
    if (act === 'paste') pasteFromClipboard();

    if (act === 'open-cmd' || act === 'open-powershell') {
      let targetDir = activePaneIsRight ? rightCurrentPath : currentPath;
      if (entry) {
        targetDir = entry.isDirectory ? entry.path : entry.path.substring(0, entry.path.lastIndexOf('\\') || entry.path.length);
      }
      if (api) {
        const sh = act === 'open-cmd' ? 'cmd' : 'powershell';
        await (api as any).openTerminal(targetDir, sh);
      }
    }
  };

  useEffect(() => {
    if (!ctx) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        closeCtx();
      }
    };

    // Use mousedown so it closes before click handlers on other elements, and doesn't interfere with menu item clicks
    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [ctx]);

  const selectedEntry = entries.find(e => e.path === selected);

  const onRightRowClick = (entry: DirEntry) => {
    setRightSelected(entry.path);
    setActivePane('right');
  };
  const onRightRowDoubleClick = (entry: DirEntry) => {
    setActivePane('right');
    if (entry.isDirectory) {
      navigateRight(entry.path);
    } else {
      const vtype = getViewerType(entry.ext);
      if (vtype) {
        setViewer({ type: vtype, path: entry.path, name: entry.name });
      } else {
        api.openPath(entry.path);
      }
    }
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

        <button onClick={pickFolder} className="nav-button" title="Choose a folder to browse" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <FolderOpen size={15} />
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
              <div className="file-list h-full" onClick={activateLeft} onContextMenu={showLeftPaneCtx}>
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

                        return (
                          <tr
                            key={entry.path}
                            className={`file-row ${selected === entry.path ? 'selected' : ''}`}
                            onClick={(e) => { e.stopPropagation(); onRowClick(entry); }}
                            onDoubleClick={() => onRowDoubleClick(entry)}
                            onContextMenu={(e) => { e.stopPropagation(); showCtx(e, entry); }}
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

                          return (
                            <tr
                              key={entry.path}
                              className={`file-row ${rightSelected === entry.path ? 'selected' : ''}`}
                              onClick={(e) => { e.stopPropagation(); onRightRowClick(entry); }}
                              onDoubleClick={() => onRightRowDoubleClick(entry)}
                              onContextMenu={(e) => { e.stopPropagation(); showCtx(e, entry); }}
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
          <div className="statusbar h-7 px-3 text-xs bg-[#18181b] border-t border-zinc-800 flex items-center gap-x-4 text-zinc-400">
            <div>{entries.length} items • {stats.folderCount} folders, {stats.fileCount} files</div>
            <div>Files in view: <span className="text-zinc-200">{formatSize(stats.filesTotalBytes)}</span></div>
            {selectedEntry && <div className="ml-auto truncate max-w-[520px] text-zinc-500">{selectedEntry.path}</div>}
            {operationStatus && <div className="ml-2 text-blue-400 truncate max-w-[300px]">{operationStatus}</div>}
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
              <div className="border-t border-zinc-700 my-0.5" />
              <div className="context-menu-item" onClick={() => ctxAction('copy')}>
                Copy full path
              </div>
            </>
          )}
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
            <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-[#111113] text-sm">
              <div className="truncate font-medium pr-4">{viewer.name}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    api.openPath(viewer.path);
                    setViewer(null);
                  }}
                  className="text-xs px-2 py-0.5 bg-zinc-700 hover:bg-zinc-600 rounded"
                >
                  Open with default app
                </button>
                <button onClick={() => setViewer(null)} className="text-xl leading-none px-2 hover:text-red-400">×</button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-[#0f0f10] flex items-center justify-center">
              {viewer.type === 'image' && (
                <img
                  src={toFileUrl(viewer.path)}
                  alt={viewer.name}
                  className="max-w-full max-h-[78vh] object-contain shadow"
                />
              )}
              {viewer.type === 'audio' && (
                <audio
                  controls
                  src={toFileUrl(viewer.path)}
                  className="w-full max-w-md"
                />
              )}
              {viewer.type === 'video' && (
                <video
                  controls
                  src={toFileUrl(viewer.path)}
                  className="max-w-full max-h-[78vh]"
                />
              )}
              {viewer.type === 'text' && (
                <pre className="whitespace-pre-wrap font-mono text-sm w-full max-w-4xl bg-[#111113] p-4 rounded overflow-auto max-h-[78vh] border border-zinc-800">
                  {textContent || 'Loading...'}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
