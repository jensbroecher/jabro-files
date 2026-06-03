import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { 
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, FolderOpen, 
  HardDrive, Folder, File, Search, X, Calculator 
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
}

// Check if running inside Electron
const hasApi = typeof window !== 'undefined' && !!(window as any).api;
const api = hasApi ? (window as any).api : null;

// Demo data (used when running `npm run dev` outside Electron)
const DEMO_ROOTS: Record<string, DirEntry[]> = {
  'H:\\AppDev': [
    { name: 'size-browser', path: 'H:\\AppDev\\size-browser', isDirectory: true, mtime: '2026-06-03T18:20:00Z' },
    { name: 'android_studio', path: 'H:\\AppDev\\android_studio', isDirectory: true, mtime: '2025-07-16T16:54:00Z' },
    { name: 'flutter', path: 'H:\\AppDev\\flutter', isDirectory: true, mtime: '2025-07-16T04:54:00Z' },
    { name: 'ComfyUI-Easy', path: 'H:\\AppDev\\ComfyUI-Easy', isDirectory: true, mtime: '2026-05-11T21:24:00Z' },
    { name: 'README.md', path: 'H:\\AppDev\\README.md', isDirectory: false, size: 1240, mtime: '2026-06-01T10:00:00Z', ext: '.md' },
  ],
  'H:\\AppDev\\size-browser': [
    { name: 'node_modules', path: 'H:\\AppDev\\size-browser\\node_modules', isDirectory: true, mtime: '2026-06-03T18:10:00Z' },
    { name: 'src', path: 'H:\\AppDev\\size-browser\\src', isDirectory: true, mtime: '2026-06-03T17:50:00Z' },
    { name: 'public', path: 'H:\\AppDev\\size-browser\\public', isDirectory: true, mtime: '2026-06-03T17:46:00Z' },
    { name: 'package.json', path: 'H:\\AppDev\\size-browser\\package.json', isDirectory: false, size: 1840, mtime: '2026-06-03T17:55:00Z', ext: '.json' },
    { name: 'vite.config.ts', path: 'H:\\AppDev\\size-browser\\vite.config.ts', isDirectory: false, size: 312, mtime: '2026-06-03T17:48:00Z', ext: '.ts' },
    { name: 'tsconfig.json', path: 'H:\\AppDev\\size-browser\\tsconfig.json', isDirectory: false, size: 522, mtime: '2026-06-03T17:46:00Z', ext: '.json' },
    { name: 'index.html', path: 'H:\\AppDev\\size-browser\\index.html', isDirectory: false, size: 428, mtime: '2026-06-03T17:47:00Z', ext: '.html' },
  ],
  'H:\\AppDev\\size-browser\\src': [
    { name: 'App.tsx', path: 'H:\\AppDev\\size-browser\\src\\App.tsx', isDirectory: false, size: 9200, mtime: '2026-06-03T18:30:00Z', ext: '.tsx' },
    { name: 'main.tsx', path: 'H:\\AppDev\\size-browser\\src\\main.tsx', isDirectory: false, size: 312, mtime: '2026-06-03T17:50:00Z', ext: '.tsx' },
    { name: 'index.css', path: 'H:\\AppDev\\size-browser\\src\\index.css', isDirectory: false, size: 2910, mtime: '2026-06-03T18:05:00Z', ext: '.css' },
    { name: 'assets', path: 'H:\\AppDev\\size-browser\\src\\assets', isDirectory: true, mtime: '2026-06-03T17:46:00Z' },
  ],
};

const DEMO_SIZES: Record<string, SizeResult> = {
  'H:\\AppDev\\size-browser\\node_modules': { size: 298_450_112, fileCount: 11820, dirCount: 1720 },
  'H:\\AppDev\\size-browser\\src': { size: 12480, fileCount: 4, dirCount: 1 },
  'H:\\AppDev\\size-browser': { size: 312_800_000, fileCount: 11850, dirCount: 1730 },
};

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

const QUICK_ACCESS = [
  { label: 'Desktop', path: 'C:\\Users\\schre\\Desktop' },
  { label: 'Documents', path: 'C:\\Users\\schre\\Documents' },
  { label: 'Downloads', path: 'C:\\Users\\schre\\Downloads' },
  { label: 'AppDev (H:)', path: 'H:\\AppDev' },
];

export default function App() {
  const isElectron = hasApi;

  const [currentPath, setCurrentPath] = useState('H:\\AppDev\\size-browser');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [sizeCache, setSizeCache] = useState<Record<string, SizeResult>>(isElectron ? {} : { ...DEMO_SIZES });
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

  // Right pane for dual mode (basic independent navigation)
  const [rightCurrentPath, setRightCurrentPath] = useState('H:\\');
  const [rightEntries, setRightEntries] = useState<DirEntry[]>([]);
  const [rightSelected, setRightSelected] = useState<string | null>(null);
  const [rightFilter, setRightFilter] = useState('');
  const [rightSortBy, setRightSortBy] = useState<'name' | 'size' | 'mtime'>('name');
  const [rightSortDir, setRightSortDir] = useState<'asc' | 'desc'>('asc');
  const [rightHistory, setRightHistory] = useState<string[]>(['H:\\']);
  const [rightHistoryIndex, setRightHistoryIndex] = useState(0);

  // Load directory contents
  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setSelected(null);
    setFilter('');

    try {
      let list: DirEntry[];
      if (isElectron && api) {
        list = await api.listDirectory(path);
      } else {
        // Demo mode
        await new Promise(r => setTimeout(r, 50));
        list = DEMO_ROOTS[path] || [];
      }

      // Merge any already known sizes from cache
      const merged = list.map(e => {
        const cached = sizeCache[e.path];
        if (e.isDirectory && cached) {
          return { ...e, size: cached.size, fileCount: cached.fileCount, dirCount: cached.dirCount };
        }
        return e;
      });

      setEntries(merged);
      setCurrentPath(path);

      // Auto-trigger size calculation for folders without known size
      if (autoCalc) {
        setTimeout(() => {
          merged
            .filter(e => e.isDirectory && !sizeCache[e.path])
            .slice(0, 8) // safety
            .forEach(e => calculateFolderSize(e.path));
        }, 80);
      }
    } catch (err) {
      console.error('Failed to list directory', err);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [isElectron, sizeCache, autoCalc]);

  // Load for right pane (duplicated for dual pane support)
  const loadRightDirectory = useCallback(async (path: string) => {
    setIsRightLoading(true);
    try {
      let list: DirEntry[];
      if (isElectron && api) {
        list = await api.listDirectory(path);
      } else {
        await new Promise(r => setTimeout(r, 50));
        list = DEMO_ROOTS[path] || [];
      }
      const merged = list.map(e => {
        const cached = sizeCache[e.path];
        if (e.isDirectory && cached) {
          return { ...e, size: cached.size, fileCount: cached.fileCount, dirCount: cached.dirCount };
        }
        return e;
      });
      setRightEntries(merged);
      setRightCurrentPath(path);
      if (autoCalc) {
        setTimeout(() => {
          merged.filter(e => e.isDirectory && !sizeCache[e.path]).slice(0, 8).forEach(e => calculateFolderSize(e.path));
        }, 80);
      }
    } catch (err) {
      console.error('Failed to list right directory', err);
      setRightEntries([]);
    } finally {
      setIsRightLoading(false);
    }
  }, [isElectron, sizeCache, autoCalc]);

  // Initial + drive load

  useEffect(() => {
    loadDirectory(currentPath);
    loadRightDirectory(rightCurrentPath);

    if (isElectron && api) {
      api.getDrives().then((d: DriveInfo[]) => setDrives(d)).catch(() => {});
    } else {
      setDrives([
        { name: 'H:', path: 'H:\\' },
        { name: 'C:', path: 'C:\\' },
      ]);
    }
  }, []);

  // History navigation
  const navigateTo = useCallback((newPath: string) => {
    const trimmed = newPath.replace(/\\+$/, '');
    if (!trimmed) return;

    const newHist = history.slice(0, historyIndex + 1);
    newHist.push(trimmed);
    setHistory(newHist);
    setHistoryIndex(newHist.length - 1);
    loadDirectory(trimmed);
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
    if (!trimmed) return;
    const newHist = rightHistory.slice(0, rightHistoryIndex + 1);
    newHist.push(trimmed);
    setRightHistory(newHist);
    setRightHistoryIndex(newHist.length - 1);
    loadRightDirectory(trimmed);
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
      let result: SizeResult;
      if (isElectron && api) {
        result = await api.getFolderSize(targetPath);
      } else {
        // Demo simulation
        await new Promise(r => setTimeout(r, 260 + Math.random() * 380));
        result = DEMO_SIZES[targetPath] || {
          size: 4_800_000 + Math.floor(Math.random() * 28_000_000),
          fileCount: 12 + Math.floor(Math.random() * 310),
          dirCount: 2 + Math.floor(Math.random() * 27),
        };
      }

      setSizeCache(prev => ({ ...prev, [targetPath]: result }));

      // Update row in place if visible
      setEntries(prev =>
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
  }, [sizeCache, isElectron]);

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
    if (!clipboard || !currentPath) return;
    try {
      if (isElectron && api) {
        if (clipboard.isCut) {
          await api.moveFiles(clipboard.paths, currentPath);
          setClipboard(null);
        } else {
          await api.copyFiles(clipboard.paths, currentPath);
        }
        await loadDirectory(currentPath);
      }
    } catch (err) {
      console.error('Paste failed', err);
    }
  }, [clipboard, currentPath, loadDirectory]);

  const refresh = useCallback(() => {
    // Invalidate sizes for current level's folders? Keep cache for speed, user can force per item.
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // Native folder picker
  const pickFolder = useCallback(async () => {
    if (isElectron && api) {
      const chosen = await api.selectFolder();
      if (chosen) navigateTo(chosen);
    } else {
      // Cycle demo folders
      const keys = Object.keys(DEMO_ROOTS);
      const next = keys[(keys.indexOf(currentPath) + 1) % keys.length];
      navigateTo(next);
    }
  }, [isElectron, currentPath, navigateTo]);

  const openEntry = (entry: DirEntry) => {
    if (entry.isDirectory) {
      navigateTo(entry.path);
    } else if (isElectron && api) {
      api.openPath(entry.path);
    } else {
      alert('Demo mode: would open ' + entry.path);
    }
  };

  // Row interactions
  const onRowClick = (entry: DirEntry) => setSelected(entry.path);
  const onRowDoubleClick = (entry: DirEntry) => openEntry(entry);

  // Processed + sorted + filtered list
  const visibleEntries = useMemo(() => {
    let res = entries.filter(e =>
      !filter || e.name.toLowerCase().includes(filter.toLowerCase())
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
    let res = rightEntries.filter(e =>
      !rightFilter || e.name.toLowerCase().includes(rightFilter.toLowerCase())
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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') {
        goUp();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        refresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        calculateAllVisibleSizes();
      }
      if (e.key === 'Escape') {
        setFilter('');
        setSelected(null);
      }
      if (e.key === 'Enter' && selected) {
        const ent = entries.find(x => x.path === selected);
        if (ent) openEntry(ent);
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
  }, [goUp, refresh, calculateAllVisibleSizes, selected, entries, copyToClipboard, pasteFromClipboard]);

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

  // Context menu (simple)
  const [ctx, setCtx] = useState<{ x: number; y: number; entry: DirEntry } | null>(null);
  const showCtx = (e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    setSelected(entry.path);
    setCtx({ x: e.clientX, y: e.clientY, entry });
  };
  const closeCtx = () => setCtx(null);

  const ctxAction = async (act: string) => {
    if (!ctx) return;
    const entry = ctx.entry;
    closeCtx();

    if (act === 'open') openEntry(entry);
    if (act === 'explorer' && isElectron && api) api.showInExplorer(entry.path);
    if (act === 'calc' && entry.isDirectory) calculateFolderSize(entry.path, true);
    if (act === 'copy') navigator.clipboard.writeText(entry.path);
    if (act === 'copy-item') copyToClipboard(false);
    if (act === 'cut-item') copyToClipboard(true);
    if (act === 'paste') pasteFromClipboard();
  };

  useEffect(() => {
    const clickAway = () => closeCtx();
    if (ctx) document.addEventListener('click', clickAway, { once: true });
    return () => document.removeEventListener('click', clickAway);
  }, [ctx]);

  const selectedEntry = entries.find(e => e.path === selected);

  const onRightRowClick = (entry: DirEntry) => setRightSelected(entry.path);
  const onRightRowDoubleClick = (entry: DirEntry) => {
    if (entry.isDirectory) navigateRight(entry.path);
  };

  return (
    <div className="app-container flex flex-col h-screen text-sm select-none bg-[#0f0f10] text-[#e5e5e7]">
      {/* Top controls (titlebar area is handled by Electron overlay when packaged) */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#18181b] border-b border-zinc-800" style={{ WebkitAppRegion: 'drag' } as any}>
        <div className="px-1.5 text-[10px] tracking-[1px] text-zinc-500 font-semibold select-none">JABROFILES</div>

        <button onClick={goBack} disabled={historyIndex === 0} className="nav-button" title="Back (Backspace in list)" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ArrowLeft size={15} />
        </button>
        <button onClick={goForward} disabled={historyIndex >= history.length - 1} className="nav-button" title="Forward" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ArrowRight size={15} />
        </button>
        <button onClick={goUp} className="nav-button" title="Up one level" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <ArrowUp size={15} />
        </button>
        <button onClick={refresh} className="nav-button" title="Refresh (F5)" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <RefreshCw size={14} />
        </button>

        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as any} />

        <button
          onClick={() => setAutoCalc(!autoCalc)}
          className={`text-[11px] px-2 py-0.5 rounded flex items-center gap-1 transition ${autoCalc ? 'bg-zinc-800 text-blue-400' : 'hover:bg-zinc-800'}`}
          title="Auto-calculate folder sizes when entering a directory"
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <Calculator size={13} /> Auto
        </button>
        <button onClick={calculateAllVisibleSizes} className="nav-button" title="Calculate sizes for every folder in current view (Ctrl+R)" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <Calculator size={14} />
        </button>

        <button 
          onClick={() => setDualPane(!dualPane)} 
          className={`nav-button ${dualPane ? 'bg-blue-600 text-white' : ''}`} 
          title="Toggle dual pane mode" 
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          <span className="text-xs">⧉</span>
        </button>

        <button onClick={pickFolder} className="nav-button" title="Choose a folder to browse" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <FolderOpen size={15} />
        </button>
      </div>

      {/* Path bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#111113] border-b border-zinc-800">
        <input
          className="path-bar flex-1 px-3 py-1 text-[13px]"
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigateTo(currentPath);
          }}
          spellCheck={false}
        />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 bg-[#111113] border-r border-zinc-800 overflow-auto flex flex-col text-sm">
          <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500">QUICK ACCESS</div>
          {QUICK_ACCESS.map(item => (
            <div
              key={item.path}
              onClick={() => navigateTo(item.path)}
              className={`mx-1.5 px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer ${currentPath === item.path ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
            >
              <Folder size={15} className="text-blue-400" /> {item.label}
            </div>
          ))}

          <div className="px-3 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500">THIS PC</div>
          {drives.length > 0 ? drives.map(d => (
            <div
              key={d.path}
              onClick={() => navigateTo(d.path)}
              className={`mx-1.5 px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer ${currentPath.startsWith(d.path) ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
            >
              <HardDrive size={15} className="text-emerald-400" />
              {d.name} {d.label ? `(${d.label})` : ''}
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
            <div className="flex items-center flex-1 max-w-xs bg-zinc-900 rounded pl-3">
              <Search size={14} className="text-zinc-500" />
              <input
                className="flex-1 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-zinc-600"
                placeholder="Search current folder..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
              {filter && <X size={15} className="mr-2 cursor-pointer text-zinc-500" onClick={() => setFilter('')} />}
            </div>

            <div className="flex-1" />

            <button
              onClick={calculateAllVisibleSizes}
              className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 active:bg-black rounded flex items-center gap-1.5"
            >
              <Calculator size={13} /> Calc sizes in view
            </button>
            <button
              onClick={refresh}
              className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 active:bg-black rounded flex items-center gap-1.5"
            >
              <RefreshCw size={13} /> Refresh
            </button>
            <button
              onClick={pickFolder}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 rounded flex items-center gap-1.5 text-white"
            >
              <FolderOpen size={13} /> Open folder…
            </button>
          </div>

          {/* The list */}
          <div className="file-list flex-1 overflow-auto">
            <div className="file-list h-full">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-zinc-500">
                    <RefreshCw className="spinner mr-2" size={18} /> Loading…
                  </div>
                ) : visibleEntries.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2">
                    <Folder size={40} />
                    <div>Empty folder{filter ? ' (no matches)' : ''}</div>
                  </div>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th onClick={() => toggleSort('name')} className="sortable w-[52%] text-left">Name {sortBy === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th onClick={() => toggleSort('size')} className="sortable w-36 text-right pr-4">Size {sortBy === 'size' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th onClick={() => toggleSort('mtime')} className="sortable w-40">Date modified {sortBy === 'mtime' ? (sortDir === 'asc' ? '▲' : '▼') : ''}</th>
                        <th>Kind</th>
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
                            onClick={() => onRowClick(entry)}
                            onDoubleClick={() => onRowDoubleClick(entry)}
                            onContextMenu={(e) => showCtx(e, entry)}
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




                      <tbody>
                        {rightVisibleEntries.map(entry => {
                          const cached = sizeCache[entry.path];
                          const sz = entry.isDirectory ? (cached?.size ?? entry.size) : entry.size;

                          return (
                            <tr
                              key={entry.path}
                              className={`file-row ${rightSelected === entry.path ? 'selected' : ''}`}
                              onClick={() => onRightRowClick(entry)}
                              onDoubleClick={() => onRightRowDoubleClick(entry)}
                              onContextMenu={(e) => showCtx(e, entry)}
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

          {/* Status bar */}
          <div className="statusbar h-7 px-3 text-xs bg-[#18181b] border-t border-zinc-800 flex items-center gap-x-4 text-zinc-400">
            <div>{entries.length} items • {stats.folderCount} folders, {stats.fileCount} files</div>
            <div>Files in view: <span className="text-zinc-200">{formatSize(stats.filesTotalBytes)}</span></div>
            {selectedEntry && <div className="ml-auto truncate max-w-[520px] text-zinc-500">{selectedEntry.path}</div>}
            <div className="ml-auto text-[10px] text-zinc-500 hidden md:block">
              Ctrl+R = calc all • Click folder size to scan {dualPane ? '• Dual pane ON' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      {ctx && (
        <div className="context-menu" style={{ left: ctx.x, top: ctx.y }}>
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
        </div>
      )}
    </div>
  );
}
