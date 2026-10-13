import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { 
  ArrowLeft, ArrowRight, ArrowUp, RefreshCw, FolderOpen, 
  HardDrive, Folder, File, Search, X, Calculator, ChevronDown,
  CheckCircle2, AlertTriangle, AlertCircle, Copy, Scissors, Clipboard, Loader2, Info,
  ShieldAlert, ShieldCheck, Box, Sparkles, FileText,
  Plus, ChevronRight, ChevronLeft, LayoutGrid, List, Flame, Edit3, ExternalLink, Eye, PieChart,
  Database, Trash2, PanelLeft, PanelLeftClose, PanelLeftOpen, Save,
  Columns2, Link2, Layers, Image, Video, Music, FileCode,
  Bookmark, BookmarkCheck, BookmarkPlus, Tag, FolderPlus
} from 'lucide-react';
import { ThreeViewer } from './components/ThreeViewer';
import { PdfViewer } from './components/PdfViewer';
import { GridView } from './components/GridView';
import { Background3DSnapshotGenerator } from './components/Background3DSnapshotGenerator';
import { BackgroundPdfSnapshotGenerator } from './components/BackgroundPdfSnapshotGenerator';

export interface Collection {
  id: string;
  name: string;
  color?: 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'cyan';
  paths: string[];
  createdAt: string;
}

export const COLLECTION_COLORS: Array<{
  key: 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'cyan';
  label: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  ringClass: string;
}> = [
  { key: 'violet', label: 'Violet', textClass: 'text-violet-400', bgClass: 'bg-violet-500', borderClass: 'border-violet-500', ringClass: 'ring-violet-500' },
  { key: 'blue', label: 'Blue', textClass: 'text-blue-400', bgClass: 'bg-blue-500', borderClass: 'border-blue-500', ringClass: 'ring-blue-500' },
  { key: 'emerald', label: 'Emerald', textClass: 'text-emerald-400', bgClass: 'bg-emerald-500', borderClass: 'border-emerald-500', ringClass: 'ring-emerald-500' },
  { key: 'amber', label: 'Amber', textClass: 'text-amber-400', bgClass: 'bg-amber-500', borderClass: 'border-amber-500', ringClass: 'ring-amber-500' },
  { key: 'rose', label: 'Rose', textClass: 'text-rose-400', bgClass: 'bg-rose-500', borderClass: 'border-rose-500', ringClass: 'ring-rose-500' },
  { key: 'cyan', label: 'Cyan', textClass: 'text-cyan-400', bgClass: 'bg-cyan-500', borderClass: 'border-cyan-500', ringClass: 'ring-cyan-500' },
];

function getColColor(colColor?: string) {
  return COLLECTION_COLORS.find(c => c.key === colColor) || COLLECTION_COLORS[0];
}

interface ToastInfo {
  id: string;
  type: 'success' | 'error' | 'info' | 'loading';
  title: string;
  message: string;
  details?: string;
}

interface TabInfo {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
}

interface LargestFileItem {
  name: string;
  path: string;
  size: number;
  mtime: string;
  ext: string;
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
  missing?: boolean;
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

function getTabTitle(p: string, collections?: Collection[]): string {
  if (p.startsWith('collection:')) {
    const colId = p.slice('collection:'.length);
    const col = collections?.find(c => c.id === colId);
    return col ? col.name : 'Collection';
  }
  const trimmed = p.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return p;
  return parts[parts.length - 1] || p;
}

function parseBreadcrumbs(pathStr: string, collections?: Collection[]): Array<{ name: string; fullPath: string; isCollectionRoot?: boolean; isCollection?: boolean }> {
  if (pathStr.startsWith('collection:')) {
    const colId = pathStr.slice('collection:'.length);
    const col = collections?.find(c => c.id === colId);
    return [
      { name: 'Collections', fullPath: 'collection:', isCollectionRoot: true },
      { name: col?.name || 'Virtual Collection', fullPath: pathStr, isCollection: true },
    ];
  }
  const normalized = pathStr.replace(/\//g, '\\');
  const parts = normalized.split('\\').filter(Boolean);
  const breadcrumbs: Array<{ name: string; fullPath: string; isCollectionRoot?: boolean; isCollection?: boolean }> = [];

  let accumulated = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i === 0 && /^[a-zA-Z]:$/.test(part)) {
      accumulated = part + '\\';
      breadcrumbs.push({ name: part, fullPath: accumulated });
    } else {
      accumulated = accumulated ? (accumulated.endsWith('\\') ? accumulated + part : accumulated + '\\' + part) : part;
      breadcrumbs.push({ name: part, fullPath: accumulated });
    }
  }
  return breadcrumbs.length > 0 ? breadcrumbs : [{ name: pathStr, fullPath: pathStr }];
}

const TreemapView: React.FC<{
  entries: DirEntry[];
  sizeCache: Record<string, SizeResult>;
  onNavigate: (path: string) => void;
  onOpen: (entry: DirEntry) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  onCalculateAll: () => void;
}> = ({ entries, sizeCache, onNavigate, onOpen, onSelect, selectedPath, onCalculateAll }) => {
  const items = useMemo(() => {
    const list = entries.map(e => {
      const computedSize = e.isDirectory ? (sizeCache[e.path]?.size ?? e.size ?? 0) : (e.size ?? 0);
      return { ...e, computedSize };
    });
    list.sort((a, b) => b.computedSize - a.computedSize);
    return list;
  }, [entries, sizeCache]);

  const totalBytes = useMemo(() => {
    return items.reduce((acc, i) => acc + i.computedSize, 0);
  }, [items]);

  const hasUncalculatedDirs = useMemo(() => {
    return entries.some(e => e.isDirectory && sizeCache[e.path] == null && e.size == null);
  }, [entries, sizeCache]);

  if (items.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 p-8">
        <Folder size={48} className="text-zinc-600" />
        <div className="text-sm font-medium">No items to analyze in this directory</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0c0c0e] p-3 gap-2.5">
      {/* Information Header & Uncalculated Sizes Warning */}
      <div className="flex items-center justify-between px-2 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <PieChart size={14} className="text-blue-400" />
          <span>Total Size: <strong className="text-zinc-200">{formatSize(totalBytes)}</strong></span>
          <span>•</span>
          <span>{items.length} items</span>
        </div>
        {hasUncalculatedDirs && (
          <button
            onClick={onCalculateAll}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition text-[11px] font-medium cursor-pointer"
            title="Scan recursive sizes of all subfolders to get accurate visualization"
          >
            <Calculator size={12} />
            <span>Calculate Folder Sizes for Complete Map</span>
          </button>
        )}
      </div>

      {/* Visual Treemap Tiles */}
      <div className="flex-1 overflow-auto flex flex-wrap gap-2 content-start p-1.5 rounded-lg bg-[#111114] border border-zinc-800/80">
        {items.map((item) => {
          const pct = totalBytes > 0 ? (item.computedSize / totalBytes) * 100 : 0;
          const isSelected = selectedPath === item.path;

          let tileStyle = 'bg-zinc-850 border-zinc-700/50 text-zinc-200';
          if (item.isDirectory) {
            tileStyle = 'bg-gradient-to-br from-blue-950/70 to-indigo-950/40 border-blue-500/30 text-blue-200 hover:border-blue-400';
          } else {
            const ext = item.ext?.toLowerCase() || '';
            if (['.splat', '.ksplat', '.spz'].includes(ext)) {
              tileStyle = 'bg-gradient-to-br from-purple-950/70 to-violet-950/40 border-violet-500/30 text-violet-200 hover:border-violet-400';
            } else if (['.gltf', '.glb', '.obj', '.stl', '.ply', '.fbx'].includes(ext)) {
              tileStyle = 'bg-gradient-to-br from-indigo-950/70 to-blue-950/40 border-indigo-500/30 text-indigo-200 hover:border-indigo-400';
            } else if (['.mp4', '.mkv', '.avi', '.mov', '.mp3', '.flac', '.wav'].includes(ext)) {
              tileStyle = 'bg-gradient-to-br from-amber-950/70 to-orange-950/40 border-amber-500/30 text-amber-200 hover:border-amber-400';
            } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
              tileStyle = 'bg-gradient-to-br from-cyan-950/70 to-teal-950/40 border-cyan-500/30 text-cyan-200 hover:border-cyan-400';
            } else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
              tileStyle = 'bg-gradient-to-br from-rose-950/70 to-pink-950/40 border-rose-500/30 text-rose-200 hover:border-rose-400';
            } else {
              tileStyle = 'bg-gradient-to-br from-zinc-900 to-zinc-800/80 border-zinc-700/50 text-zinc-200 hover:border-zinc-500';
            }
          }

          const flexGrow = Math.max(1, Math.min(24, Math.round(pct * 2)));
          const minW = pct > 20 ? 220 : (pct > 5 ? 160 : 120);
          const minH = pct > 20 ? 120 : (pct > 5 ? 85 : 65);

          return (
            <div
              key={item.path}
              onClick={() => {
                onSelect(item.path);
                if (item.isDirectory) {
                  onNavigate(item.path);
                } else {
                  onOpen(item);
                }
              }}
              style={{
                flexGrow,
                flexBasis: `${minW}px`,
                minHeight: `${minH}px`,
              }}
              className={`p-2.5 rounded-lg border transition-all duration-150 cursor-pointer flex flex-col justify-between overflow-hidden relative group select-none shadow-xs ${tileStyle} ${
                isSelected ? 'ring-2 ring-blue-400 shadow-lg' : ''
              }`}
              title={`${item.name}\nSize: ${formatSize(item.computedSize)} (${pct.toFixed(1)}%)\nPath: ${item.path}`}
            >
              <div className="flex items-start justify-between gap-1.5 z-10">
                <div className="flex items-center gap-1.5 min-w-0">
                  {getIcon(item)}
                  <span className="font-medium text-xs truncate leading-snug">{item.name}</span>
                </div>
                {pct > 0.5 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-zinc-300 font-semibold flex-shrink-0">
                    {pct.toFixed(pct >= 10 ? 0 : 1)}%
                  </span>
                )}
              </div>

              <div className="flex items-end justify-between gap-2 z-10 pt-2">
                <div className="text-xs font-semibold tabular-nums text-white">
                  {formatSize(item.computedSize)}
                </div>
                {item.isDirectory && (
                  <span className="text-[10px] text-zinc-400">
                    {(item.dirCount || 0) + (item.fileCount || 0) > 0 ? `${(item.dirCount || 0) + (item.fileCount || 0)} items` : 'folder'}
                  </span>
                )}
                {!item.isDirectory && item.ext && (
                  <span className="text-[10px] uppercase font-mono text-zinc-400">
                    {item.ext.replace('.', '')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

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
  const [splitMode, setSplitMode] = useState<'independent' | 'linked'>(() => {
    try {
      return (localStorage.getItem('jabro-split-mode') as any) || 'independent';
    } catch {
      return 'independent';
    }
  });
  const [isRightLoading, setIsRightLoading] = useState(false);

  // Multi-Tab browsing state
  const [tabs, setTabs] = useState<TabInfo[]>([
    { id: 'tab-1', path: 'H:\\AppDev\\size-browser', history: ['H:\\AppDev\\size-browser'], historyIndex: 0 }
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');

  // Interactive Breadcrumbs & inline path editing
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInputValue, setPathInputValue] = useState('H:\\AppDev\\size-browser');

  // View Mode: Table vs Grid Preview Tiles vs Interactive Treemap
  const [viewMode, setViewMode] = useState<'table' | 'grid' | 'treemap'>(() => {
    try {
      return (localStorage.getItem('jabro-view-mode') as any) || 'grid';
    } catch {
      return 'grid';
    }
  });
  const [rightViewMode, setRightViewMode] = useState<'table' | 'grid' | 'treemap'>('table');
  const [gridTileSize, setGridTileSize] = useState<'small' | 'medium' | 'large'>(() => {
    try {
      return (localStorage.getItem('jabro-grid-size') as any) || 'medium';
    } catch {
      return 'medium';
    }
  });

  const [cacheStats, setCacheStats] = useState<{ count: number; sizeBytes: number; cachePath: string } | null>(null);
  const [showCachePopover, setShowCachePopover] = useState(false);
  const cachePopoverRef = useRef<HTMLDivElement>(null);

  // Space Hogs (Find Largest Files)
  const [showLargestModal, setShowLargestModal] = useState(false);
  const [largestFiles, setLargestFiles] = useState<LargestFileItem[]>([]);
  const [largestLoading, setLargestLoading] = useState(false);
  const [largestFilter, setLargestFilter] = useState('');

  // Customizable Quick Access (pinned folders). Persisted in localStorage.
  const [quickAccess, setQuickAccess] = useState<Array<{ label: string; path: string }>>([]);

  // Virtual Collections (virtual folders without copying/moving files). Persisted in localStorage.
  const [collections, setCollections] = useState<Collection[]>(() => {
    try {
      const saved = localStorage.getItem('jabro-collections');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: 'col-favorites',
        name: 'Favorites',
        color: 'amber',
        paths: [],
        createdAt: new Date().toISOString(),
      }
    ];
  });
  const collectionsRef = useRef<Collection[]>(collections);
  useEffect(() => {
    collectionsRef.current = collections;
  }, [collections]);

  const [collectionModal, setCollectionModal] = useState<{
    isOpen: boolean;
    mode: 'create' | 'edit';
    collectionId?: string;
    name: string;
    color: 'violet' | 'blue' | 'emerald' | 'amber' | 'rose' | 'cyan';
  }>({
    isOpen: false,
    mode: 'create',
    name: '',
    color: 'violet',
  });

  const [collectionCtx, setCollectionCtx] = useState<{
    x: number;
    y: number;
    collection: Collection;
  } | null>(null);
  const collectionMenuRef = useRef<HTMLDivElement>(null);

  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);
  const [pendingAddPaths, setPendingAddPaths] = useState<string[] | null>(null);
  const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('jabro-collections', JSON.stringify(collections));
    } catch (e) {
      console.error('Failed to save collections to localStorage', e);
    }
  }, [collections]);

  // Sidebar state (resizable & collapsible with persistence)
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('jabro-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('jabro-sidebar-width');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 140 && val <= 600) return val;
      }
    } catch {}
    return 224; // default 224px (w-56)
  });

  const isResizingSidebarRef = useRef(false);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('jabro-sidebar-collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingSidebarRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingSidebarRef.current) return;
      const delta = moveEvent.clientX - startX;
      const newWidth = startWidth + delta;
      
      // If dragged smaller than 90px, snap to collapsed!
      if (newWidth < 90) {
        setSidebarCollapsed(true);
        try { localStorage.setItem('jabro-sidebar-collapsed', 'true'); } catch {}
      } else {
        const clamped = Math.max(140, Math.min(550, newWidth));
        setSidebarWidth(clamped);
        setSidebarCollapsed(false);
        try { 
          localStorage.setItem('jabro-sidebar-width', clamped.toString()); 
          localStorage.setItem('jabro-sidebar-collapsed', 'false'); 
        } catch {}
      }
    };

    const onMouseUp = () => {
      isResizingSidebarRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  const handleResetSidebarWidth = useCallback(() => {
    setSidebarWidth(224);
    setSidebarCollapsed(false);
    try {
      localStorage.setItem('jabro-sidebar-width', '224');
      localStorage.setItem('jabro-sidebar-collapsed', 'false');
    } catch {}
  }, []);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [operationStatus, setOperationStatus] = useState('');
  const [bgActivity, setBgActivity] = useState<{ active: boolean; text?: string; subtext?: string } | null>(null);

  useEffect(() => {
    const handleBgActivity = (e: any) => {
      if (e?.detail) {
        setBgActivity(e.detail.active ? e.detail : null);
      }
    };
    window.addEventListener('jabro-bg-activity', handleBgActivity);
    return () => window.removeEventListener('jabro-bg-activity', handleBgActivity);
  }, []);

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
    customDestFileName?: string;
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

  useEffect(() => {
    try {
      localStorage.setItem('jabro-view-mode', viewMode);
    } catch {}
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem('jabro-grid-size', gridTileSize);
    } catch {}
  }, [gridTileSize]);

  useEffect(() => {
    try {
      localStorage.setItem('jabro-split-mode', splitMode);
    } catch {}
  }, [splitMode]);

  const refreshCacheStats = useCallback(async () => {
    if (api?.getThumbnailCacheStats) {
      try {
        const stats = await api.getThumbnailCacheStats();
        setCacheStats(stats);
      } catch {}
    }
  }, []);

  const handleClearCache = useCallback(async () => {
    if (api?.clearThumbnailCache) {
      try {
        const res = await api.clearThumbnailCache();
        if (res?.success) {
          showToast({
            type: 'success',
            title: 'Preview Cache Cleared',
            message: `Deleted ${res.count} cached preview tiles (${formatSize(res.clearedBytes)} freed).`,
          });
          refreshCacheStats();
        }
      } catch (err: any) {
        showToast({ type: 'error', title: 'Clear Cache Failed', message: err?.message || String(err) });
      }
    }
  }, [showToast, refreshCacheStats]);

  const handleOpenCacheFolder = useCallback(async () => {
    if (api?.openThumbnailCacheFolder) {
      api.openThumbnailCacheFolder();
    }
  }, []);

  useEffect(() => {
    refreshCacheStats();
  }, [refreshCacheStats]);

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
    const isCollection = path.startsWith('collection:');
    const trimmed = path.replace(/\\+$/, '');
    const normalized = isCollection ? path : (trimmed.endsWith(':') ? trimmed + '\\' : trimmed);
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
      let list: DirEntry[] = [];
      if (isCollection) {
        const colId = normalized.slice('collection:'.length);
        const col = collectionsRef.current.find(c => c.id === colId);
        list = col && api?.getEntriesStats ? await api.getEntriesStats(col.paths) : [];
      } else {
        list = await api.listDirectory(normalized);
      }

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
    const isCollection = path.startsWith('collection:');
    const trimmed = path.replace(/\\+$/, '');
    const normalized = isCollection ? path : (trimmed.endsWith(':') ? trimmed + '\\' : trimmed);
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
      let list: DirEntry[] = [];
      if (isCollection) {
        const colId = normalized.slice('collection:'.length);
        const col = collectionsRef.current.find(c => c.id === colId);
        list = col && api?.getEntriesStats ? await api.getEntriesStats(col.paths) : [];
      } else {
        list = await api.listDirectory(normalized);
      }

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

    if (api?.getDrives) {
      api.getDrives().then((d: DriveInfo[]) => setDrives(d)).catch(() => {
        setDrives([
          { name: 'C:', path: 'C:\\', size: 1000000000000, freeSpace: 300000000000 },
          { name: 'D:', path: 'D:\\', size: 500000000000, freeSpace: 150000000000 },
        ]);
      });
    } else {
      setDrives([
        { name: 'C:', path: 'C:\\', size: 1000000000000, freeSpace: 300000000000 },
        { name: 'D:', path: 'D:\\', size: 500000000000, freeSpace: 150000000000 },
      ]);
    }
  }, []);

  // Load customizable Quick Access (defaults from main process using proper app.getPath for symlinks/custom locations)
  useEffect(() => {
    const loadQuickAccess = async () => {
      try {
        const defaults = api?.getDefaultQuickAccess ? await api.getDefaultQuickAccess() : [];
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

  // Collection operations (Virtual Folders)
  const addPathsToCollection = useCallback((colId: string, newPaths: string[]) => {
    if (!newPaths || newPaths.length === 0) return;
    setCollections(prev => {
      return prev.map(col => {
        if (col.id !== colId) return col;
        const existingLower = new Set(col.paths.map(p => p.toLowerCase()));
        const toAdd = newPaths.filter(p => !existingLower.has(p.toLowerCase()));
        if (toAdd.length === 0) {
          showToast({
            type: 'info',
            title: 'Already in collection',
            message: `"${col.name}" already contains the selected item(s).`,
          });
          return col;
        }
        showToast({
          type: 'success',
          title: `Added to ${col.name}`,
          message: `Added ${toAdd.length} item${toAdd.length > 1 ? 's' : ''} to virtual collection.`,
        });
        return {
          ...col,
          paths: [...col.paths, ...toAdd],
        };
      });
    });

    const colPath = 'collection:' + colId;
    dirCacheRef.current.delete(colPath);
    if (currentPath === colPath) {
      loadDirectory(colPath);
    }
    if (dualPane && rightCurrentPath === colPath) {
      loadRightDirectory(colPath);
    }
  }, [showToast, currentPath, rightCurrentPath, dualPane, loadDirectory, loadRightDirectory]);

  const removePathFromCollection = useCallback((colId: string, pathToRemove: string) => {
    setCollections(prev => prev.map(col => {
      if (col.id !== colId) return col;
      return {
        ...col,
        paths: col.paths.filter(p => p.toLowerCase() !== pathToRemove.toLowerCase()),
      };
    }));
    showToast({
      type: 'info',
      title: 'Removed from collection',
      message: 'Item removed from virtual collection.',
    });
    const colPath = 'collection:' + colId;
    dirCacheRef.current.delete(colPath);
    if (currentPath === colPath) loadDirectory(colPath);
    if (dualPane && rightCurrentPath === colPath) loadRightDirectory(colPath);
  }, [showToast, currentPath, rightCurrentPath, dualPane, loadDirectory, loadRightDirectory]);

  const cleanMissingFromCollection = useCallback((colId: string) => {
    const col = collectionsRef.current.find(c => c.id === colId);
    if (!col) return;
    const activeEntries = (currentPath === 'collection:' + colId) ? entries : ((rightCurrentPath === 'collection:' + colId) ? rightEntries : []);
    const missingPaths = new Set(activeEntries.filter(e => e.missing).map(e => e.path.toLowerCase()));
    if (missingPaths.size === 0) {
      showToast({
        type: 'info',
        title: 'Collection is clean',
        message: 'No missing or broken paths found.',
      });
      return;
    }
    setCollections(prev => prev.map(c => {
      if (c.id !== colId) return c;
      return {
        ...c,
        paths: c.paths.filter(p => !missingPaths.has(p.toLowerCase())),
      };
    }));
    showToast({
      type: 'success',
      title: 'Cleaned collection',
      message: `Removed ${missingPaths.size} missing file reference(s).`,
    });
    const colPath = 'collection:' + colId;
    dirCacheRef.current.delete(colPath);
    if (currentPath === colPath) loadDirectory(colPath);
    if (dualPane && rightCurrentPath === colPath) loadRightDirectory(colPath);
  }, [entries, rightEntries, currentPath, rightCurrentPath, dualPane, showToast, loadDirectory, loadRightDirectory]);

  const deleteCollection = useCallback((colId: string) => {
    const col = collectionsRef.current.find(c => c.id === colId);
    if (!col) return;
    setCollections(prev => prev.filter(c => c.id !== colId));
    showToast({
      type: 'info',
      title: 'Collection deleted',
      message: `Deleted virtual collection "${col.name}".`,
    });
    const colPath = 'collection:' + colId;
    dirCacheRef.current.delete(colPath);
    if (currentPath === colPath) {
      navigateTo(drives[0]?.path || 'C:\\');
    }
    if (dualPane && rightCurrentPath === colPath) {
      navigateRight(drives[0]?.path || 'C:\\');
    }
  }, [showToast, currentPath, rightCurrentPath, dualPane, drives, navigateTo, navigateRight]);

  const saveCollectionModal = useCallback(() => {
    const trimmedName = collectionModal.name.trim();
    if (!trimmedName) {
      showToast({ type: 'error', title: 'Name required', message: 'Please enter a collection name.' });
      return;
    }
    if (collectionModal.mode === 'create') {
      const newCol: Collection = {
        id: 'col-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        name: trimmedName,
        color: collectionModal.color,
        paths: pendingAddPaths || [],
        createdAt: new Date().toISOString(),
      };
      setCollections(prev => [...prev, newCol]);
      showToast({
        type: 'success',
        title: 'Collection created',
        message: `Created collection "${newCol.name}".`,
      });
      if (pendingAddPaths && pendingAddPaths.length > 0) {
        showToast({
          type: 'info',
          title: 'Items added',
          message: `Added ${pendingAddPaths.length} item(s) to "${newCol.name}".`,
        });
      }
    } else if (collectionModal.mode === 'edit' && collectionModal.collectionId) {
      setCollections(prev => prev.map(c => {
        if (c.id !== collectionModal.collectionId) return c;
        return {
          ...c,
          name: trimmedName,
          color: collectionModal.color,
        };
      }));
      showToast({
        type: 'success',
        title: 'Collection updated',
        message: `Updated "${trimmedName}".`,
      });
      const colPath = 'collection:' + collectionModal.collectionId;
      dirCacheRef.current.delete(colPath);
    }
    setCollectionModal(prev => ({ ...prev, isOpen: false }));
    setPendingAddPaths(null);
  }, [collectionModal, pendingAddPaths, showToast]);

  const handlePickFilesForCollection = useCallback(async (colId: string) => {
    if (api?.selectFiles) {
      try {
        const selectedPaths = await api.selectFiles();
        if (selectedPaths && selectedPaths.length > 0) {
          addPathsToCollection(colId, selectedPaths);
        }
      } catch (e: any) {
        console.error('Failed to select files', e);
      }
    }
  }, [addPathsToCollection]);

  const handleDropToCollection = useCallback(async (e: React.DragEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverCollectionId(null);

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

    if (paths.length > 0) {
      addPathsToCollection(colId, paths);
    }
  }, [addPathsToCollection]);

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

  // Keep path input value in sync with active path
  useEffect(() => {
    setPathInputValue(activeCurrentPath);
  }, [activeCurrentPath]);

  // Keep active tab state synchronized with current path and history
  useEffect(() => {
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, path: currentPath, history, historyIndex } : t));
  }, [currentPath, history, historyIndex, activeTabId]);

  const addNewTab = useCallback(() => {
    const newId = 'tab-' + Date.now();
    const newTab: TabInfo = {
      id: newId,
      path: currentPath,
      history: [currentPath],
      historyIndex: 0,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  }, [currentPath]);

  const closeTab = useCallback((tabId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === tabId);
    const nextTabs = tabs.filter(t => t.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      const nextActive = nextTabs[Math.max(0, idx - 1)] || nextTabs[0];
      if (nextActive) {
        setActiveTabId(nextActive.id);
        setCurrentPath(nextActive.path);
        setHistory(nextActive.history);
        setHistoryIndex(nextActive.historyIndex);
        loadDirectory(nextActive.path);
      }
    }
  }, [tabs, activeTabId, loadDirectory]);

  const switchTab = useCallback((tab: TabInfo) => {
    setActiveTabId(tab.id);
    setCurrentPath(tab.path);
    setHistory(tab.history);
    setHistoryIndex(tab.historyIndex);
    loadDirectory(tab.path);
  }, [loadDirectory]);

  // Space Hogs (Find Largest Files)
  const openLargestFinder = useCallback(async () => {
    setShowLargestModal(true);
    setLargestLoading(true);
    setLargestFilter('');
    try {
      const target = activePaneIsRight ? rightCurrentPath : currentPath;
      if (api?.findLargestFiles) {
        const res = await api.findLargestFiles(target, 50);
        setLargestFiles(res);
      } else {
        const list = (activePaneIsRight ? rightEntries : entries)
          .filter(e => !e.isDirectory && (e.size || 0) > 0)
          .map(e => ({ name: e.name, path: e.path, size: e.size || 0, mtime: e.mtime, ext: e.ext || '' }))
          .sort((a, b) => b.size - a.size);
        setLargestFiles(list);
      }
    } catch (err) {
      console.error('findLargestFiles error:', err);
      setLargestFiles([]);
    } finally {
      setLargestLoading(false);
    }
  }, [activePaneIsRight, rightCurrentPath, currentPath, rightEntries, entries]);

  const filteredLargestFiles = useMemo(() => {
    if (!largestFilter.trim()) return largestFiles;
    const q = largestFilter.toLowerCase().trim();
    return largestFiles.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [largestFiles, largestFilter]);

  const handleConfirmElevation = useCallback(async () => {
    if (!elevationPrompt) return;
    setIsElevating(true);
    try {
      const res = await api.performElevatedFileOp(
        elevationPrompt.sources,
        elevationPrompt.target,
        elevationPrompt.isMove,
        elevationPrompt.action,
        elevationPrompt.newFolderName,
        elevationPrompt.customDestFileName
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

    // Dropping into a virtual collection: adds references without copying/moving on disk
    if (targetDir.startsWith('collection:')) {
      const colId = targetDir.slice('collection:'.length);
      addPathsToCollection(colId, paths);
      return;
    }
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
  }, [activePaneIsRight, rightCurrentPath, currentPath, dualPane, loadDirectory, loadRightDirectory, showToast, dismissToast, addPathsToCollection]);

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

  const openEntry = async (entry: DirEntry, targetPane?: 'left' | 'right') => {
    const pane = targetPane || activePane;
    if (entry.isDirectory) {
      if (dualPane && splitMode === 'independent' && pane === 'right') {
        navigateRight(entry.path);
      } else if (dualPane && splitMode === 'linked' && pane === 'right') {
        navigateTo(entry.path);
        loadRightDirectory(entry.path);
      } else {
        navigateTo(entry.path);
      }
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

  const handleLeftSelect = useCallback((path: string) => {
    setSelected(path);
    setActivePane('left');
    if (dualPane && splitMode === 'linked') {
      const ent = entries.find(e => e.path === path);
      if (ent && ent.isDirectory) {
        loadRightDirectory(ent.path);
      }
    }
  }, [dualPane, splitMode, entries, loadRightDirectory]);

  // Row interactions
  const onRowClick = (entry: DirEntry) => {
    handleLeftSelect(entry.path);
  };
  const onRowDoubleClick = (entry: DirEntry) => openEntry(entry, 'left');

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

  // Max sizes for proportional heatmap bars
  const leftMaxSize = useMemo(() => {
    let m = 0;
    for (const e of visibleEntries) {
      const s = e.isDirectory ? (sizeCache[e.path]?.size ?? e.size ?? 0) : (e.size ?? 0);
      if (s > m) m = s;
    }
    return m > 0 ? m : 1;
  }, [visibleEntries, sizeCache]);

  const rightMaxSize = useMemo(() => {
    let m = 0;
    for (const e of rightVisibleEntries) {
      const s = e.isDirectory ? (sizeCache[e.path]?.size ?? e.size ?? 0) : (e.size ?? 0);
      if (s > m) m = s;
    }
    return m > 0 ? m : 1;
  }, [rightVisibleEntries, sizeCache]);

  // Quick Look cycling through files in active view
  const navigateViewer = useCallback((direction: -1 | 1) => {
    if (!viewer) return;
    const list = activePaneIsRight ? rightVisibleEntries : visibleEntries;
    const currentIndex = list.findIndex(e => e.path === viewer.path);
    if (currentIndex === -1) return;
    const nextIndex = currentIndex + direction;
    if (nextIndex >= 0 && nextIndex < list.length) {
      const nextEntry = list[nextIndex];
      if (activePaneIsRight) setRightSelected(nextEntry.path); else setSelected(nextEntry.path);
      openEntry(nextEntry);
    }
  }, [viewer, activePaneIsRight, rightVisibleEntries, visibleEntries, openEntry]);

  const stats = useMemo(() => {
    const folderCount = entries.filter(e => e.isDirectory).length;
    const fileCount = entries.length - folderCount;
    const filesTotalBytes = entries
      .filter(e => !e.isDirectory)
      .reduce((s, e) => s + (e.size || 0), 0);
    return { folderCount, fileCount, filesTotalBytes };
  }, [entries]);

  // Keyboard shortcuts — respect active pane for nav / refresh / calc / spacebar Quick Look
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '');

      // Spacebar Quick Look toggle
      if (e.code === 'Space' && !isInput) {
        e.preventDefault();
        if (viewer) {
          setViewer(null);
        } else {
          const list = activePaneIsRight ? rightVisibleEntries : visibleEntries;
          const currentSel = activePaneIsRight ? rightSelected : selected;
          const target = list.find(x => x.path === currentSel);
          if (target) {
            openEntry(target);
          }
        }
        return;
      }

      // Quick Look navigation & escape
      if (viewer) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setViewer(null);
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          navigateViewer(1);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          navigateViewer(-1);
          return;
        }
      }

      // Ctrl+T for new tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        addNewTab();
        return;
      }

      // Ctrl+L to focus/edit path bar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        setIsEditingPath(true);
        return;
      }

      // Tab key to cycle active pane in split mode
      if (e.key === 'Tab' && !isInput && dualPane) {
        e.preventDefault();
        setActivePane(prev => prev === 'left' ? 'right' : 'left');
        return;
      }

      // Alt+Arrow navigation shortcuts
      if (e.altKey && e.key === 'ArrowLeft' && !isInput) {
        e.preventDefault();
        activeGoBack();
        return;
      }
      if (e.altKey && e.key === 'ArrowRight' && !isInput) {
        e.preventDefault();
        activeGoForward();
        return;
      }
      if (e.altKey && e.key === 'ArrowUp' && !isInput) {
        e.preventDefault();
        activeGoUp();
        return;
      }

      if (e.key === 'Backspace' && !isInput) {
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
          setIsEditingPath(false);
        }
      }
      if (e.key === 'Enter' && !activePaneIsRight && selected) {
        const ent = entries.find(x => x.path === selected);
        if (ent) openEntry(ent, 'left');
      }
      // Also support Enter to open in the right pane when it is active
      if (e.key === 'Enter' && activePaneIsRight && rightSelected) {
        const ent = rightEntries.find(x => x.path === rightSelected);
        if (ent) openEntry(ent, 'right');
      }
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        if (isInput) return;
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    activeGoUp, activeRefresh, activeCalculateAllVisibleSizes, selected, entries, 
    copyToClipboard, pasteFromClipboard, activePaneIsRight, rightSelected, rightEntries, 
    navigateRight, viewer, activePane, rightVisibleEntries, visibleEntries, navigateViewer, 
    addNewTab, openEntry, toggleSidebar
  ]);

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
    const estimatedMenuHeight = entry ? 280 : 120; // pane ctx is smaller
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

  const closeCtx = () => {
    setCtx(null);
    setSubmenuOpen(null);
  };

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

    if (act === 'save-as') {
      try {
        const res = await api.saveFileAs(entry.path);
        if (res?.canceled) return;
        if (res?.success && res.destDir && res.destFileName) {
          showToast({
            type: 'success',
            title: 'File saved',
            message: `Saved "${res.destFileName}" in ${res.destDir}`,
          });
          const destDirLower = res.destDir.toLowerCase();
          if (currentPath.toLowerCase() === destDirLower) {
            await loadDirectory(currentPath);
            setHighlightedPath(res.destPath || null);
            setTimeout(() => setHighlightedPath(null), 2500);
          }
          if (dualPane && rightCurrentPath.toLowerCase() === destDirLower) {
            await loadRightDirectory(rightCurrentPath);
            setHighlightedPath(res.destPath || null);
            setTimeout(() => setHighlightedPath(null), 2500);
          }
        } else if (res?.requiresElevation && res.destDir) {
          setElevationPrompt({
            sources: [entry.path],
            target: res.destDir,
            isMove: false,
            action: 'copy',
            customDestFileName: res.destFileName,
          });
        } else if (res?.error) {
          showToast({
            type: 'error',
            title: 'Save As failed',
            message: res.error,
          });
        }
      } catch (err: any) {
        showToast({
          type: 'error',
          title: 'Save As failed',
          message: err?.message || String(err),
        });
      }
      return;
    }

    if (act === 'open') openEntry(entry, activePaneIsRight ? 'right' : 'left');
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
      if (collectionCtx && collectionMenuRef.current && !collectionMenuRef.current.contains(event.target as Node)) {
        setCollectionCtx(null);
      }
      if (showCachePopover && cachePopoverRef.current && !cachePopoverRef.current.contains(event.target as Node)) {
        setShowCachePopover(false);
      }
    };

    // Use mousedown so it closes before click handlers on other elements, and doesn't interfere with menu item clicks
    document.addEventListener('mousedown', handleOutsideClick);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [ctx, driveCtx, collectionCtx, showCachePopover]);

  const selectedEntry = entries.find(e => e.path === selected);

  const onRightRowClick = (entry: DirEntry) => {
    setRightSelected(entry.path);
    setActivePane('right');
  };
  const onRightRowDoubleClick = (entry: DirEntry) => {
    setActivePane('right');
    openEntry(entry, 'right');
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

        {/* Sidebar toggle button */}
        <button 
          onClick={toggleSidebar} 
          className={`nav-button ${sidebarCollapsed ? 'text-zinc-500 hover:text-zinc-200' : 'text-blue-400 hover:text-blue-300'}`} 
          title={sidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"} 
          style={{ WebkitAppRegion: 'no-drag' } as any}
        >
          {sidebarCollapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
        </button>

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
            if (next) {
              if (splitMode === 'linked') {
                const selectedDir = entries.find(e => e.path === selected && e.isDirectory);
                if (selectedDir) {
                  loadRightDirectory(selectedDir.path);
                } else if (rightEntries.length === 0) {
                  const firstDir = entries.find(e => e.isDirectory);
                  if (firstDir) {
                    setSelected(firstDir.path);
                    loadRightDirectory(firstDir.path);
                  } else {
                    loadRightDirectory(rightCurrentPath || currentPath);
                  }
                }
              } else {
                if (rightEntries.length === 0) {
                  loadRightDirectory(rightCurrentPath || currentPath);
                }
              }
            }
            setActivePane(next ? 'right' : 'left');
          }} 
          className={`nav-button flex items-center gap-1.5 ${dualPane ? 'bg-zinc-800 text-blue-300 ring-1 ring-blue-500/50' : 'text-zinc-400'}`} 
          style={{ WebkitAppRegion: 'no-drag', width: 'auto', minWidth: '68px', padding: '0 8px' } as any}
          title={dualPane ? "Close split pane" : "Toggle dual pane (split view)"}
        >
          <Columns2 size={13} />
          <span className="text-[10px] font-semibold">Split</span>
        </button>

        {/* Mode selector when Split view is active */}
        {dualPane && (
          <div 
            className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5 text-xs select-none ml-0.5"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <button
              onClick={() => setSplitMode('independent')}
              className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition cursor-pointer ${
                splitMode === 'independent'
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Independent: Browse different folders independently on left and right"
            >
              <Layers size={11} />
              <span>Independent</span>
            </button>
            <button
              onClick={() => {
                setSplitMode('linked');
                const selectedDir = entries.find(e => e.path === selected && e.isDirectory);
                if (selectedDir) {
                  loadRightDirectory(selectedDir.path);
                } else {
                  const firstDir = entries.find(e => e.isDirectory);
                  if (firstDir) {
                    setSelected(firstDir.path);
                    loadRightDirectory(firstDir.path);
                  }
                }
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition cursor-pointer ${
                splitMode === 'linked'
                  ? 'bg-blue-600 text-white shadow-xs font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
              title="Linked: Selecting a folder on one side displays its contents on the other"
            >
              <Link2 size={11} />
              <span>Linked</span>
            </button>
          </div>
        )}

        {/* breathing room so the last button isn't under the OS min/max/close overlay controls on the right */}
        <div className="w-10" style={{ WebkitAppRegion: 'drag' } as any} />

        {/* Draggable area on the RIGHT (under the OS min/max/close overlay controls) */}
        <div className="flex-1 h-full" style={{ WebkitAppRegion: 'drag' } as any} />
      </div>

      {/* Browser-style Multi-Tabs Bar */}
      <div 
        className="flex items-center px-2 pt-1 h-9 box-border bg-[#141416] border-b border-zinc-800 gap-1 overflow-x-auto overflow-y-hidden select-none no-scrollbar flex-shrink-0"
        onWheel={(e) => {
          if (e.deltaY !== 0) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              onClick={() => switchTab(tab)}
              className={`group flex items-center gap-2 px-3 py-1 h-[29px] box-border rounded-t-lg text-xs cursor-pointer border-t border-x transition-all duration-150 max-w-[200px] min-w-[110px] ${
                isActive
                  ? 'bg-[#111113] border-zinc-700/80 text-white font-semibold shadow-xs -mb-[1px] border-b-transparent'
                  : 'bg-zinc-900/40 border-transparent text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}
              title={tab.path}
            >
              {tab.path.startsWith('collection:') ? (
                <Bookmark size={13} className={isActive ? 'text-violet-400 flex-shrink-0' : 'text-zinc-500 flex-shrink-0'} />
              ) : (
                <Folder size={13} className={isActive ? 'text-blue-400 flex-shrink-0' : 'text-zinc-500 flex-shrink-0'} />
              )}
              <span className="truncate flex-1 min-w-0">{getTabTitle(tab.path, collections)}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => closeTab(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded p-0.5 leading-none transition cursor-pointer"
                  title="Close Tab"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          );
        })}
        <button
          onClick={addNewTab}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition ml-0.5 cursor-pointer flex-shrink-0"
          title="Open New Tab (Ctrl+T)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Path bar with interactive breadcrumbs and text edit toggle */}
      <div className="flex items-center gap-2 px-3 h-10 box-border bg-[#111113] border-b border-zinc-800 flex-shrink-0">
        {isEditingPath ? (
          <div className="flex items-center flex-1 min-w-0 h-8 box-border bg-zinc-900 border border-blue-500/70 rounded px-2.5">
            <input
              className="flex-1 h-full bg-transparent text-[13px] font-mono text-zinc-200 outline-none leading-none placeholder:text-zinc-600"
              autoFocus
              value={pathInputValue}
              onChange={(e) => setPathInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  activeNavigate(pathInputValue);
                  setIsEditingPath(false);
                } else if (e.key === 'Escape') {
                  setPathInputValue(activeCurrentPath);
                  setIsEditingPath(false);
                }
              }}
              onBlur={() => setIsEditingPath(false)}
              spellCheck={false}
            />
            <div className="flex items-center gap-0.5 ml-1.5 flex-shrink-0">
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  activeNavigate(pathInputValue);
                  setIsEditingPath(false);
                }}
                className="p-1 rounded hover:bg-zinc-800 text-blue-400 hover:text-blue-300 cursor-pointer"
                title="Navigate (Enter)"
              >
                <ArrowRight size={13} />
              </button>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  navigator.clipboard.writeText(pathInputValue);
                  showToast({ type: 'info', title: 'Path Copied', message: pathInputValue }, 2000);
                }}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                title="Copy path"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center flex-1 min-w-0 h-8 box-border bg-zinc-900/60 border border-zinc-800/80 rounded px-2.5 hover:border-zinc-700/80 transition-colors">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 max-w-full">
              {parseBreadcrumbs(activeCurrentPath, collections).map((b, idx, arr) => {
                const isDrive = /^[a-zA-Z]:$/i.test(b.name);
                const driveMatch = isDrive ? drives.find(d => d.name.toUpperCase() === b.name.toUpperCase()) : null;
                const driveTitle = driveMatch?.label
                  ? `${driveMatch.label} (${b.name}) • ${driveMatch.path}${driveMatch.freeSpace != null && driveMatch.size != null ? ` (${formatSize(driveMatch.freeSpace)} free of ${formatSize(driveMatch.size)})` : ''}`
                  : (driveMatch?.size != null && driveMatch?.freeSpace != null ? `${b.name} (${formatSize(driveMatch.freeSpace)} free of ${formatSize(driveMatch.size)})` : b.fullPath);

                const isCol = b.isCollection;
                const colObj = isCol ? collections.find(c => ('collection:' + c.id) === b.fullPath) : null;
                const colColor = getColColor(colObj?.color);

                return (
                  <React.Fragment key={b.fullPath}>
                    <button
                      onClick={() => {
                        if (!b.isCollectionRoot) activeNavigate(b.fullPath);
                      }}
                      className={`px-1.5 py-0.5 rounded transition text-[12px] font-medium flex items-center whitespace-nowrap ${
                        b.isCollectionRoot
                          ? 'text-zinc-500 cursor-default'
                          : isCol
                            ? `${colColor.textClass} hover:bg-zinc-800 cursor-pointer font-semibold`
                            : 'text-zinc-300 hover:text-white hover:bg-zinc-800 cursor-pointer'
                      }`}
                      title={isDrive ? driveTitle : (isCol ? `Virtual Collection: ${b.name}` : b.fullPath)}
                    >
                      {isDrive && <HardDrive size={12} className="mr-1 text-emerald-400 flex-shrink-0" />}
                      {b.isCollectionRoot && <Layers size={12} className="mr-1 text-violet-400 flex-shrink-0" />}
                      {isCol && <Bookmark size={12} className={`mr-1 ${colColor.textClass} flex-shrink-0`} />}
                      {b.name}
                    </button>
                    {idx < arr.length - 1 && (
                      <ChevronRight size={12} className="text-zinc-600 flex-shrink-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            {activeCurrentPath.startsWith('collection:') && (
              <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePickFilesForCollection(activeCurrentPath.slice('collection:'.length));
                  }}
                  className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium flex items-center gap-1 transition shadow-xs cursor-pointer"
                  title="Add files from disk to this collection"
                >
                  <Plus size={11} />
                  <span>Add files...</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const colId = activeCurrentPath.slice('collection:'.length);
                    const col = collections.find(c => c.id === colId);
                    if (col) {
                      setCollectionModal({
                        isOpen: true,
                        mode: 'edit',
                        collectionId: col.id,
                        name: col.name,
                        color: col.color || 'violet',
                      });
                    }
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium flex items-center gap-1 transition cursor-pointer border border-zinc-700/60"
                  title="Edit collection name & color"
                >
                  <Edit3 size={11} />
                  <span>Edit</span>
                </button>
              </div>
            )}
            {/* Click empty space to edit as text */}
            <div
              className="flex-1 h-full min-h-[20px] cursor-text"
              onClick={() => {
                setPathInputValue(activeCurrentPath);
                setIsEditingPath(true);
              }}
              title="Click to edit path as text"
            />
            {/* Action buttons */}
            <div className="flex items-center gap-0.5 ml-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  setPathInputValue(activeCurrentPath);
                  setIsEditingPath(true);
                }}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                title="Edit path as text (Ctrl+L)"
              >
                <Edit3 size={13} />
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(activeCurrentPath);
                  showToast({ type: 'info', title: 'Path Copied', message: activeCurrentPath }, 2000);
                }}
                className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 cursor-pointer"
                title="Copy full path"
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Collapsed Sidebar Edge Expand Button */}
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="w-5.5 flex items-center justify-center bg-[#111113] hover:bg-[#18181b] border-r border-zinc-800 text-zinc-500 hover:text-blue-400 transition cursor-pointer select-none group flex-shrink-0"
            title="Expand sidebar (Ctrl+B)"
          >
            <PanelLeftOpen size={14} className="group-hover:scale-110 transition-transform" />
          </button>
        )}

        {/* Sidebar */}
        {!sidebarCollapsed && (
          <>
            <div 
              style={{ width: `${sidebarWidth}px`, minWidth: `${sidebarWidth}px`, maxWidth: `${sidebarWidth}px` }}
              className="bg-[#111113] flex flex-col text-sm select-none flex-shrink-0 h-full overflow-hidden"
            >
              {/* Scrollable Upper Area (Quick Access & Drives) */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
                <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500 flex items-center justify-between">
                  <span>QUICK ACCESS</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={addFolderToQuickAccess}
                      className="text-blue-400 hover:text-blue-300 text-lg leading-none px-1"
                      title="Pin a folder to Quick Access"
                    >
                      +
                    </button>
                    <button
                      onClick={toggleSidebar}
                      className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition cursor-pointer"
                      title="Collapse sidebar (Ctrl+B)"
                    >
                      <PanelLeftClose size={13} />
                    </button>
                  </div>
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
                    <Folder size={15} className="text-blue-400 flex-shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </div>
                ))}

                <div className="px-3 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500">THIS PC</div>
                {drives.length > 0 ? drives.map(d => {
                  const driveHoverLabel = d.label ? `${d.label} (${d.name})` : d.name;
                  const driveTooltip = d.size != null && d.freeSpace != null 
                    ? `${driveHoverLabel} • ${d.path} • ${formatSize(d.freeSpace)} free of ${formatSize(d.size)}`
                    : `${driveHoverLabel} • ${d.path}`;

                  return (
                    <div
                      key={d.path}
                      onClick={() => activeNavigate(d.path)}
                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); showDriveCtx(e, d); }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                      onDrop={(e) => handleDropToPath(e, d.path)}
                      className={`mx-1.5 px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer ${(activePaneIsRight ? rightCurrentPath : currentPath).startsWith(d.path) ? 'bg-zinc-800' : 'hover:bg-zinc-900'}`}
                      title={driveTooltip}
                    >
                      <HardDrive size={15} className="text-emerald-400 flex-shrink-0" />
                      <span 
                        className="flex-1 min-w-0 truncate"
                        title={driveHoverLabel}
                      >
                        <span className="font-semibold text-zinc-200" title={driveHoverLabel}>{d.name}</span>
                        {d.label && <span className="ml-1 text-zinc-400" title={driveHoverLabel}>({d.label})</span>}
                      </span>
                      {d.size != null && d.freeSpace != null && (
                        <span className="text-[10px] text-zinc-500 flex-shrink-0 ml-1 whitespace-nowrap" title={driveTooltip}>
                          ({formatSize(d.freeSpace)} free of {formatSize(d.size)})
                        </span>
                      )}
                    </div>
                  );
                }) : (
                  <div className="mx-1.5 px-2.5 py-1 text-zinc-500 text-xs">No drives detected</div>
                )}

                <div className="px-3 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-zinc-500 flex items-center justify-between">
                  <span>COLLECTIONS</span>
                  <button
                    onClick={() => setCollectionModal({ isOpen: true, mode: 'create', name: '', color: 'violet' })}
                    className="text-blue-400 hover:text-blue-300 text-lg leading-none px-1"
                    title="Create new Virtual Collection"
                  >
                    +
                  </button>
                </div>
                {collections.length > 0 ? collections.map(col => {
                  const colColor = getColColor(col.color);
                  const isCurrent = (activePaneIsRight ? rightCurrentPath : currentPath) === ('collection:' + col.id);
                  const isDragOver = dragOverCollectionId === col.id;

                  return (
                    <div
                      key={col.id}
                      onClick={() => activeNavigate('collection:' + col.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        let x = e.clientX;
                        let y = e.clientY;
                        const estimatedMenuHeight = 190;
                        if (y + estimatedMenuHeight > window.innerHeight - 8) {
                          y = Math.max(8, e.clientY - estimatedMenuHeight);
                        }
                        if (ctx) closeCtx();
                        if (driveCtx) closeDriveCtx();
                        setCollectionCtx({ x, y, collection: col });
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        setDragOverCollectionId(col.id);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragOverCollectionId === col.id) {
                          setDragOverCollectionId(null);
                        }
                      }}
                      onDrop={(e) => handleDropToCollection(e, col.id)}
                      className={`mx-1.5 px-2.5 py-1 rounded flex items-center gap-2 cursor-pointer transition-all ${
                        isDragOver
                          ? 'bg-blue-600/30 ring-1 ring-blue-400 scale-[1.01]'
                          : isCurrent
                            ? 'bg-zinc-800'
                            : 'hover:bg-zinc-900'
                      }`}
                      title={`Virtual Collection: ${col.name} (${col.paths.length} items)\nRight-click for options. Drop files here to reference.`}
                    >
                      <Bookmark size={15} className={`${colColor.textClass} flex-shrink-0`} />
                      <span className="flex-1 min-w-0 truncate text-zinc-200 font-medium">
                        {col.name}
                      </span>
                      <span className="text-[10px] px-1.5 py-px rounded-full bg-zinc-800/90 text-zinc-400 flex-shrink-0 tabular-nums border border-zinc-700/50">
                        {col.paths.length}
                      </span>
                    </div>
                  );
                }) : (
                  <div className="mx-1.5 px-2.5 py-1 text-zinc-500 text-xs italic">
                    No collections yet
                  </div>
                )}

                <div className="flex-1" />
              </div>

              {/* Bottom Left Panel - Activity & Status */}
              <div className="border-t border-zinc-800/80 bg-zinc-950/70 p-2.5 flex flex-col gap-1.5 flex-shrink-0">
                <div className="flex items-center justify-between text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
                  <span>Background Tasks</span>
                  {bgActivity?.active ? (
                    <span className="flex items-center gap-1 text-blue-400 normal-case font-medium">
                      <Loader2 size={11} className="animate-spin text-blue-400" />
                      <span>Active</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-400/80 normal-case font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span>Idle</span>
                    </span>
                  )}
                </div>

                {bgActivity?.active ? (
                  <div className="bg-zinc-900/90 rounded border border-blue-500/30 p-2 flex flex-col gap-1 shadow-sm">
                    <div className="flex items-center gap-1.5 text-zinc-200 text-xs font-medium">
                      <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
                      <span className="truncate">{bgActivity.text || 'Generating 3D preview...'}</span>
                    </div>
                    {bgActivity.subtext && (
                      <div className="text-[10px] text-zinc-400 font-mono truncate pl-4" title={bgActivity.subtext}>
                        {bgActivity.subtext}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500 py-0.5 px-0.5 flex items-center justify-between">
                    <span>3D previews ready</span>
                    <Box size={12} className="text-zinc-600" />
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar Resize Handle */}
            <div
              onMouseDown={handleSidebarResizeStart}
              onDoubleClick={handleResetSidebarWidth}
              className="relative w-1 bg-zinc-800/80 hover:bg-blue-500 active:bg-blue-600 transition-colors cursor-col-resize flex-shrink-0 select-none z-10 before:absolute before:-inset-x-1.5 before:top-0 before:bottom-0 before:content-['']"
              title="Drag to resize sidebar, double-click to reset width (224px)"
            />
          </>
        )}

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

            {/* Space Hogs (Find Largest Files) */}
            <button
              onClick={openLargestFinder}
              className="text-[11px] px-2 py-1 rounded flex items-center gap-1.5 transition text-zinc-400 hover:text-amber-400 hover:bg-zinc-800"
              title="Space Hogs — find top 50 largest files in this directory tree"
            >
              <Flame size={13} className="text-amber-400" />
              <span className="hidden md:inline">Space Hogs</span>
            </button>

            {/* Central Preview Cache Info & Management */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowCachePopover(!showCachePopover);
                  refreshCacheStats();
                }}
                className={`text-[11px] px-2 py-1 rounded flex items-center gap-1.5 transition ${
                  showCachePopover ? 'bg-zinc-800 text-blue-400' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                }`}
                title="Central File Preview Cache"
              >
                <Database size={13} />
                <span className="hidden sm:inline">Cache</span>
                {cacheStats && cacheStats.count > 0 && (
                  <span className="text-[10px] px-1 rounded-full bg-blue-500/20 text-blue-300 font-mono">
                    {cacheStats.count}
                  </span>
                )}
              </button>

              {showCachePopover && (
                <div
                  ref={cachePopoverRef}
                  className="absolute right-0 top-full mt-1.5 z-50 w-72 bg-[#18181b] border border-zinc-700/80 rounded-xl shadow-2xl p-3 text-xs flex flex-col gap-2.5 backdrop-blur-md"
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-zinc-800">
                    <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                      <Database size={14} className="text-blue-400" /> Central Preview Cache
                    </span>
                    <button
                      onClick={() => setShowCachePopover(false)}
                      className="text-zinc-400 hover:text-white"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  <div className="space-y-1.5 text-zinc-300 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Cached Previews:</span>
                      <span className="font-medium text-zinc-200">{cacheStats?.count ?? 0} files</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-400">Disk Used:</span>
                      <span className="font-medium text-zinc-200">{formatSize(cacheStats?.sizeBytes ?? 0)}</span>
                    </div>
                    <div className="text-zinc-400 pt-0.5 truncate" title={cacheStats?.cachePath}>
                      Folder: <span className="text-zinc-300 font-mono text-[10px]">{cacheStats?.cachePath || 'Central AppData'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1 border-t border-zinc-800">
                    <button
                      onClick={handleOpenCacheFolder}
                      className="flex-1 py-1.5 px-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center gap-1.5 transition text-[11px]"
                      title="Reveal central thumbnail cache folder in Windows Explorer"
                    >
                      <ExternalLink size={12} /> Open Folder
                    </button>
                    <button
                      onClick={handleClearCache}
                      className="py-1.5 px-2 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 flex items-center justify-center gap-1.5 transition text-[11px]"
                      title="Delete all cached thumbnails to reclaim disk space"
                    >
                      <Trash2 size={12} /> Clear Cache
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Tile Size Adjuster (active in grid view) */}
            {(activePaneIsRight ? rightViewMode : viewMode) === 'grid' && (
              <div className="flex items-center bg-zinc-900/90 border border-zinc-800 rounded p-0.5 text-xs text-zinc-400">
                <button
                  onClick={() => setGridTileSize('small')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
                    gridTileSize === 'small' ? 'bg-zinc-700 text-white shadow-xs' : 'hover:text-zinc-200'
                  }`}
                  title="Small preview tiles (130px)"
                >
                  S
                </button>
                <button
                  onClick={() => setGridTileSize('medium')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
                    gridTileSize === 'medium' ? 'bg-zinc-700 text-white shadow-xs' : 'hover:text-zinc-200'
                  }`}
                  title="Medium preview tiles (170px)"
                >
                  M
                </button>
                <button
                  onClick={() => setGridTileSize('large')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition ${
                    gridTileSize === 'large' ? 'bg-zinc-700 text-white shadow-xs' : 'hover:text-zinc-200'
                  }`}
                  title="Large preview tiles (230px)"
                >
                  L
                </button>
              </div>
            )}

            {/* View Mode Toggle */}
            <div className="flex items-center bg-zinc-900/90 border border-zinc-800 rounded p-0.5 text-zinc-400">
              <button
                onClick={() => {
                  if (activePaneIsRight) setRightViewMode('table'); else setViewMode('table');
                }}
                className={`p-1 rounded transition ${
                  (activePaneIsRight ? rightViewMode : viewMode) === 'table' ? 'bg-zinc-700 text-white shadow-xs' : 'hover:text-zinc-200'
                }`}
                title="List / Table View"
              >
                <List size={14} />
              </button>
              <button
                onClick={() => {
                  if (activePaneIsRight) setRightViewMode('grid'); else setViewMode('grid');
                }}
                className={`p-1 rounded transition ${
                  (activePaneIsRight ? rightViewMode : viewMode) === 'grid' ? 'bg-zinc-700 text-white shadow-xs' : 'hover:text-zinc-200'
                }`}
                title="Grid View with File Preview Tiles"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => {
                  if (activePaneIsRight) setRightViewMode('treemap'); else setViewMode('treemap');
                }}
                className={`p-1 rounded transition ${
                  (activePaneIsRight ? rightViewMode : viewMode) === 'treemap' ? 'bg-zinc-700 text-white shadow-xs' : 'hover:text-zinc-200'
                }`}
                title="Interactive Treemap View"
              >
                <PieChart size={14} />
              </button>
            </div>
          </div>

          {/* The list area - supports dual pane ("second page") */}
          <div className={`flex-1 overflow-hidden list-area ${dualPane ? 'flex flex-row' : 'flex flex-col'}`}>
            {/* Left pane */}
            <div className={`overflow-hidden flex flex-col ${dualPane ? 'w-1/2 border-r border-zinc-800' : 'flex-1'} ${dualPane && activePane === 'left' ? 'ring-1 ring-inset ring-blue-500/30' : ''}`}>
              {/* Optional compact header in split mode */}
              {dualPane && (
                <div 
                  onClick={activateLeft}
                  className={`h-7 px-2.5 flex items-center justify-between text-[11px] border-b border-zinc-800/80 cursor-pointer select-none transition-colors ${
                    activePane === 'left' ? 'bg-[#18181c] text-blue-300' : 'bg-[#121214] text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                    <Folder size={12} className={activePane === 'left' ? 'text-blue-400 flex-shrink-0' : 'text-zinc-500 flex-shrink-0'} />
                    <span className="font-semibold text-zinc-200 truncate">
                      {splitMode === 'linked' ? 'Left Pane (Master)' : 'Left Pane'}
                    </span>
                    <span className="text-[10px] text-zinc-500 truncate" title={currentPath}>
                      {currentPath}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {activePane === 'left' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-semibold mr-1">
                        Active
                      </span>
                    )}
                    <button
                      onClick={goUp}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                      title="Go up one level (Left pane)"
                    >
                      <ArrowUp size={11} />
                    </button>
                    <button
                      onClick={() => loadDirectory(currentPath)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                      title="Refresh Left pane"
                    >
                      <RefreshCw size={10} />
                    </button>
                  </div>
                </div>
              )}
              {isLoading ? (
                <div className="h-full flex items-center justify-center text-zinc-500 pt-4">
                  <RefreshCw className="spinner mr-2" size={18} /> Loading…
                </div>
              ) : visibleEntries.length === 0 ? (
                currentPath.startsWith('collection:') ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-3 p-6 text-center max-w-sm mx-auto">
                    <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shadow-inner">
                      <BookmarkPlus size={28} />
                    </div>
                    <div className="text-base font-semibold text-zinc-200">This Collection is Empty</div>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      Drag & drop files or folders here from other tabs, drives, or File Explorer to add references without moving them.
                    </p>
                    <button
                      onClick={() => handlePickFilesForCollection(currentPath.slice('collection:'.length))}
                      className="mt-1 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                    >
                      <Plus size={14} /> Add files...
                    </button>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 pt-4">
                    <Folder size={40} />
                    <div>Empty folder{filter ? ' (no matches)' : ''}</div>
                  </div>
                )
              ) : viewMode === 'grid' ? (
                <GridView
                  entries={visibleEntries}
                  selectedPath={selected}
                  sizeCache={sizeCache}
                  clipboard={clipboard}
                  highlightedPath={highlightedPath}
                  dragOverFolderPath={dragOverFolderPath}
                  tileSize={gridTileSize}
                  onSelect={(p) => handleLeftSelect(p)}
                  onOpen={(entry) => openEntry(entry, 'left')}
                  onContextMenu={(e, entry) => { setActivePane('left'); setSelected(entry.path); showCtx(e, entry); }}
                  onPaneContextMenu={showLeftPaneCtx}
                  onCalculateFolderSize={calculateFolderSize}
                  onDropToFolder={(e, targetPath) => { handleDropToPath(e, targetPath); setActivePane('left'); }}
                  onPaneDrop={(e) => handlePaneDrop(e, false)}
                  onQuickLook={(entry) => openEntry(entry, 'left')}
                  formatSize={formatSize}
                  formatDate={formatDate}
                />
              ) : viewMode === 'treemap' ? (
                <TreemapView
                  entries={visibleEntries}
                  sizeCache={sizeCache}
                  onNavigate={(p) => navigateTo(p)}
                  onOpen={(e) => openEntry(e, 'left')}
                  onSelect={(p) => handleLeftSelect(p)}
                  selectedPath={selected}
                  onCalculateAll={calculateAllVisibleSizes}
                />
              ) : (
                <div
                  className="file-list h-full overflow-auto"
                  onClick={activateLeft}
                  onContextMenu={showLeftPaneCtx}
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                  onDrop={(e) => handlePaneDrop(e, false)}
                >
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
                                {entry.missing && (
                                  <span className="text-[10px] px-1.5 py-px rounded bg-rose-950/70 text-rose-400 border border-rose-800/50 flex items-center gap-1 font-medium" title="Item not found on disk">
                                    <AlertTriangle size={10} /> missing
                                  </span>
                                )}
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
                </div>
              )}
            </div>

            {/* Right pane (the "second page") - supports both Independent and Linked modes */}
            {dualPane && (
              <div className={`w-1/2 flex flex-col overflow-hidden ${activePane === 'right' ? 'ring-1 ring-inset ring-blue-500/30' : ''}`}>
                {/* Compact header for right pane */}
                <div 
                  onClick={activateRight}
                  className={`h-7 px-2.5 flex items-center justify-between text-[11px] border-b border-zinc-800/80 cursor-pointer select-none transition-colors ${
                    activePane === 'right' ? 'bg-[#18181c] text-blue-300' : 'bg-[#121214] text-zinc-400 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
                    {splitMode === 'linked' ? (
                      <Link2 size={12} className="text-blue-400 flex-shrink-0" />
                    ) : (
                      <Folder size={12} className={activePane === 'right' ? 'text-blue-400 flex-shrink-0' : 'text-zinc-500 flex-shrink-0'} />
                    )}
                    <span className="font-semibold text-zinc-200 truncate">
                      {splitMode === 'linked' ? 'Right Pane (Linked Preview)' : 'Right Pane'}
                    </span>
                    <span className="text-[10px] text-zinc-500 truncate" title={rightCurrentPath}>
                      {splitMode === 'linked'
                        ? (selected ? `Contents of: ${selected.split(/[\\/]/).filter(Boolean).pop() || selected}` : rightCurrentPath)
                        : rightCurrentPath
                      }
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    {activePane === 'right' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 font-semibold mr-1">
                        Active
                      </span>
                    )}
                    {splitMode === 'independent' && (
                      <>
                        <button
                          onClick={goRightUp}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                          title="Go up one level (Right pane)"
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          onClick={() => loadRightDirectory(rightCurrentPath)}
                          className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
                          title="Refresh Right pane"
                        >
                          <RefreshCw size={10} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => setDualPane(false)}
                      className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-rose-400 transition ml-0.5"
                      title="Close right split pane"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </div>

                {isRightLoading ? (
                  <div className="h-full flex items-center justify-center text-zinc-500 pt-4">
                    <RefreshCw className="spinner mr-2" size={18} /> Loading…
                  </div>
                ) : rightVisibleEntries.length === 0 ? (
                  rightCurrentPath.startsWith('collection:') ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-400 gap-3 p-6 text-center max-w-sm mx-auto">
                      <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shadow-inner">
                        <BookmarkPlus size={28} />
                      </div>
                      <div className="text-base font-semibold text-zinc-200">This Collection is Empty</div>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Drag & drop files or folders here from other tabs, drives, or File Explorer to add references without moving them.
                      </p>
                      <button
                        onClick={() => handlePickFilesForCollection(rightCurrentPath.slice('collection:'.length))}
                        className="mt-1 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium flex items-center gap-1.5 transition shadow-sm cursor-pointer"
                      >
                        <Plus size={14} /> Add files...
                      </button>
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 pt-4">
                      <Folder size={40} />
                      <div>{splitMode === 'linked' && !selected ? 'Select a folder on the left to preview contents' : 'Empty'}</div>
                    </div>
                  )
                ) : rightViewMode === 'grid' ? (
                  <GridView
                    entries={rightVisibleEntries}
                    selectedPath={rightSelected}
                    sizeCache={sizeCache}
                    clipboard={clipboard}
                    highlightedPath={highlightedPath}
                    dragOverFolderPath={dragOverFolderPath}
                    tileSize={gridTileSize}
                    onSelect={(p) => { setRightSelected(p); setActivePane('right'); }}
                    onOpen={(entry) => openEntry(entry, 'right')}
                    onContextMenu={(e, entry) => { setActivePane('right'); setRightSelected(entry.path); showCtx(e, entry); }}
                    onPaneContextMenu={showRightPaneCtx}
                    onCalculateFolderSize={calculateFolderSize}
                    onDropToFolder={(e, targetPath) => { handleDropToPath(e, targetPath); setActivePane('right'); }}
                    onPaneDrop={(e) => handlePaneDrop(e, true)}
                    onQuickLook={(entry) => openEntry(entry, 'right')}
                    formatSize={formatSize}
                    formatDate={formatDate}
                  />
                ) : rightViewMode === 'treemap' ? (
                  <TreemapView
                    entries={rightVisibleEntries}
                    sizeCache={sizeCache}
                    onNavigate={(p) => loadRightDirectory(p)}
                    onOpen={(e) => openEntry(e, 'right')}
                    onSelect={(p) => { setRightSelected(p); setActivePane('right'); }}
                    selectedPath={rightSelected}
                    onCalculateAll={calculateAllVisibleSizes}
                  />
                ) : (
                  <div 
                    className="file-list flex-1 overflow-auto"
                    onClick={activateRight}
                    onContextMenu={showRightPaneCtx}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                    onDrop={(e) => handlePaneDrop(e, true)}
                  >
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
                                  {entry.missing && (
                                    <span className="text-[10px] px-1.5 py-px rounded bg-rose-950/70 text-rose-400 border border-rose-800/50 flex items-center gap-1 font-medium" title="Item not found on disk">
                                      <AlertTriangle size={10} /> missing
                                    </span>
                                  )}
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
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Status bar */}
          <div className="statusbar h-7 px-3 text-xs bg-[#18181b] border-t border-zinc-800 flex items-center gap-x-3 text-zinc-400">
            <div>{entries.length} items • {stats.folderCount} folders, {stats.fileCount} files</div>
            <div>Files in view: <span className="text-zinc-200">{formatSize(stats.filesTotalBytes)}</span></div>
            {bgActivity?.active && (
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-950/60 border border-blue-500/30 text-blue-300 text-[11px] max-w-[320px]">
                <Loader2 size={11} className="animate-spin text-blue-400 shrink-0" />
                <span className="truncate font-medium">{bgActivity.text}</span>
                {bgActivity.subtext && <span className="text-zinc-400 truncate max-w-[120px] font-mono">({bgActivity.subtext})</span>}
              </div>
            )}
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
            <div className="ml-auto text-[10px] text-zinc-500 hidden md:flex items-center gap-1.5">
              <span>Ctrl+R = calc all • Click folder size to scan</span>
              {dualPane && (
                <button
                  onClick={() => {
                    const nextMode = splitMode === 'independent' ? 'linked' : 'independent';
                    setSplitMode(nextMode);
                    if (nextMode === 'linked' && selected) {
                      const ent = entries.find(e => e.path === selected && e.isDirectory);
                      if (ent) loadRightDirectory(ent.path);
                    }
                  }}
                  className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer"
                  title="Click to toggle between Independent and Linked split modes"
                >
                  {splitMode === 'linked' ? <Link2 size={10} className="text-blue-400" /> : <Layers size={10} className="text-zinc-400" />}
                  <span>Split: {splitMode === 'linked' ? 'Linked' : 'Independent'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context menu - supports rows and empty-pane (for paste here + new folder) */}
      {ctx && (
        <div ref={menuRef} className="context-menu" style={{ left: ctx.x, top: ctx.y }}>
          {!ctx.entry ? (
            // Pane-level (empty space) menu
            (activePaneIsRight ? rightCurrentPath : currentPath).startsWith('collection:') ? (
              <>
                <div
                  className="context-menu-item flex items-center gap-2"
                  onClick={() => {
                    const colId = (activePaneIsRight ? rightCurrentPath : currentPath).slice('collection:'.length);
                    handlePickFilesForCollection(colId);
                    closeCtx();
                  }}
                >
                  <Plus size={14} className="text-blue-400" />
                  <span>Add files from disk...</span>
                </div>
                <div
                  className="context-menu-item flex items-center gap-2"
                  onClick={() => {
                    const colId = (activePaneIsRight ? rightCurrentPath : currentPath).slice('collection:'.length);
                    cleanMissingFromCollection(colId);
                    closeCtx();
                  }}
                >
                  <RefreshCw size={14} className="text-zinc-400" />
                  <span>Clean missing items</span>
                </div>
                <div
                  className="context-menu-item flex items-center gap-2"
                  onClick={() => {
                    const colId = (activePaneIsRight ? rightCurrentPath : currentPath).slice('collection:'.length);
                    const col = collections.find(c => c.id === colId);
                    if (col) {
                      setCollectionModal({
                        isOpen: true,
                        mode: 'edit',
                        collectionId: col.id,
                        name: col.name,
                        color: col.color || 'violet',
                      });
                    }
                    closeCtx();
                  }}
                >
                  <Edit3 size={14} className="text-amber-400" />
                  <span>Edit Collection</span>
                </div>
              </>
            ) : (
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
            )
          ) : (
            // Row menu
            <>
              <div className="context-menu-item" onClick={() => ctxAction('open')}>
                {ctx.entry.isDirectory ? 'Open' : 'Open file'}
              </div>
              <div className="context-menu-item" onClick={() => ctxAction('explorer')}>
                Show in Explorer
              </div>
              {!ctx.entry.isDirectory && (
                <div className="context-menu-item" onClick={() => ctxAction('save-as')}>
                  <Save size={14} className="text-blue-400" />
                  <span>Save as...</span>
                </div>
              )}
              <div className="border-t border-zinc-700 my-0.5" />

              {/* Virtual Collection Actions */}
              {(activePaneIsRight ? rightCurrentPath : currentPath).startsWith('collection:') && (
                <div
                  className="context-menu-item text-rose-400 hover:text-rose-300 flex items-center gap-2"
                  onClick={() => {
                    const colId = (activePaneIsRight ? rightCurrentPath : currentPath).slice('collection:'.length);
                    removePathFromCollection(colId, ctx.entry!.path);
                    closeCtx();
                  }}
                >
                  <Trash2 size={14} className="text-rose-400" />
                  <span>Remove from Collection</span>
                </div>
              )}

              <div
                className="relative"
                onMouseEnter={() => setSubmenuOpen('collection')}
              >
                <div className="context-menu-item flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <BookmarkPlus size={14} className="text-violet-400" />
                    <span>Add to Collection</span>
                  </div>
                  <ChevronRight size={12} className="text-zinc-500" />
                </div>
                {submenuOpen === 'collection' && (
                  <div
                    className="absolute left-full top-0 ml-1 min-w-[170px] bg-[#18181b] border border-zinc-700/80 rounded-md shadow-2xl py-1 z-50 text-xs"
                    onMouseLeave={() => setSubmenuOpen(null)}
                  >
                    {collections.map(c => {
                      const colColor = getColColor(c.color);
                      const alreadyIn = c.paths.some(p => p.toLowerCase() === ctx.entry!.path.toLowerCase());
                      return (
                        <div
                          key={c.id}
                          className={`context-menu-item flex items-center justify-between ${alreadyIn ? 'text-zinc-500' : ''}`}
                          onClick={() => {
                            addPathsToCollection(c.id, [ctx.entry!.path]);
                            closeCtx();
                          }}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className={`w-2 h-2 rounded-full ${colColor.bgClass} flex-shrink-0`} />
                            <span className="truncate">{c.name}</span>
                          </div>
                          {alreadyIn && <BookmarkCheck size={12} className="text-emerald-400 flex-shrink-0 ml-1" />}
                        </div>
                      );
                    })}
                    <div className="border-t border-zinc-700 my-0.5" />
                    <div
                      className="context-menu-item flex items-center gap-2 text-blue-400 hover:text-blue-300 font-medium"
                      onClick={() => {
                        setPendingAddPaths([ctx.entry!.path]);
                        setCollectionModal({
                          isOpen: true,
                          mode: 'create',
                          name: '',
                          color: 'violet',
                        });
                        closeCtx();
                      }}
                    >
                      <Plus size={13} />
                      <span>New Collection...</span>
                    </div>
                  </div>
                )}
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

      {/* Virtual Collection context menu for sidebar entries */}
      {collectionCtx && (
        <div ref={collectionMenuRef} className="context-menu" style={{ left: collectionCtx.x, top: collectionCtx.y }}>
          <div
            className="context-menu-item flex items-center gap-2"
            onClick={() => {
              activeNavigate('collection:' + collectionCtx.collection.id);
              setCollectionCtx(null);
            }}
          >
            <Folder size={14} className="text-blue-400" />
            <span>Open Collection</span>
          </div>
          <div
            className="context-menu-item flex items-center gap-2"
            onClick={() => {
              const colId = collectionCtx.collection.id;
              setCollectionCtx(null);
              handlePickFilesForCollection(colId);
            }}
          >
            <Plus size={14} className="text-emerald-400" />
            <span>Add Files from Disk...</span>
          </div>
          <div
            className="context-menu-item flex items-center gap-2"
            onClick={() => {
              const col = collectionCtx.collection;
              setCollectionModal({
                isOpen: true,
                mode: 'edit',
                collectionId: col.id,
                name: col.name,
                color: col.color || 'violet',
              });
              setCollectionCtx(null);
            }}
          >
            <Edit3 size={14} className="text-amber-400" />
            <span>Edit Name & Color</span>
          </div>
          <div
            className="context-menu-item flex items-center gap-2"
            onClick={() => {
              const colId = collectionCtx.collection.id;
              cleanMissingFromCollection(colId);
              setCollectionCtx(null);
            }}
          >
            <RefreshCw size={14} className="text-zinc-400" />
            <span>Clean Missing Items</span>
          </div>
          <div className="border-t border-zinc-700 my-0.5" />
          <div
            className="context-menu-item text-rose-400 hover:text-rose-300 flex items-center gap-2"
            onClick={() => {
              const col = collectionCtx.collection;
              setCollectionCtx(null);
              if (window.confirm(`Delete virtual collection "${col.name}"? (Files on disk will NOT be touched)`)) {
                deleteCollection(col.id);
              }
            }}
          >
            <Trash2 size={14} className="text-rose-400" />
            <span>Delete Collection</span>
          </div>
        </div>
      )}

      {/* Integrated Fullscreen Viewer for PDF, 3D, Gaussian Splats, Images, Audio, Video, Code & Text */}
      {viewer && (
        <div
          className="fixed inset-0 bg-[#0c0c0e] z-[9999] flex flex-col overflow-hidden select-none"
        >
          {/* Top Control Header Bar (Integrated with Windows titlebar overlay) */}
          <div 
            className="h-10 box-border flex items-center justify-between px-3 bg-[#18181b] border-b border-zinc-800 text-sm select-none z-50 flex-shrink-0"
            style={{ paddingRight: '145px', WebkitAppRegion: 'drag' } as any}
          >
            {/* Left side: Back button & File info */}
            <div 
              className="flex items-center gap-2 truncate font-medium pr-2 min-w-0"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <button
                onClick={() => setViewer(null)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition cursor-pointer font-medium text-xs border border-zinc-700/60 flex-shrink-0"
                title="Back to files (Esc)"
              >
                <ArrowLeft size={13} />
                <span>Back</span>
                <span className="text-[10px] px-1 py-0.5 bg-black/40 rounded text-zinc-400 font-mono">Esc</span>
              </button>

              <div className="h-4 w-px bg-zinc-700/70 mx-0.5 flex-shrink-0" />

              {viewer.type === 'pdf' && <FileText size={16} className="text-rose-400 flex-shrink-0" />}
              {viewer.type === '3d' && <Box size={16} className="text-indigo-400 flex-shrink-0" />}
              {viewer.type === 'gaussian-splat' && <Sparkles size={16} className="text-violet-400 flex-shrink-0" />}
              {viewer.type === 'image' && <Image size={16} className="text-emerald-400 flex-shrink-0" />}
              {viewer.type === 'video' && <Video size={16} className="text-amber-400 flex-shrink-0" />}
              {viewer.type === 'audio' && <Music size={16} className="text-cyan-400 flex-shrink-0" />}
              {viewer.type === 'text' && <FileCode size={16} className="text-blue-400 flex-shrink-0" />}
              
              <span className="truncate text-zinc-100 font-semibold text-xs">{viewer.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono uppercase tracking-wider flex-shrink-0 border border-zinc-700/40">
                {viewer.type === 'gaussian-splat' ? 'Gaussian Splat' : viewer.type.toUpperCase()}
              </span>
              <span className="hidden xl:inline-block text-[11px] text-zinc-500 truncate max-w-sm font-mono">
                {viewer.path}
              </span>
            </div>

            {/* Middle draggable gap */}
            <div className="flex-1 h-full min-w-4" style={{ WebkitAppRegion: 'drag' } as any} />

            {/* Right side: Actions & Prominent Close button (Safely placed to the left of the Windows titleBarOverlay buttons) */}
            <div 
              className="flex items-center gap-2 flex-shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <button
                onClick={async () => {
                  try {
                    const res = await api.saveFileAs(viewer.path);
                    if (res?.canceled) return;
                    if (res?.success && res.destDir && res.destFileName) {
                      showToast({
                        type: 'success',
                        title: 'File saved',
                        message: `Saved "${res.destFileName}" in ${res.destDir}`,
                      });
                      const destDirLower = res.destDir.toLowerCase();
                      if (currentPath.toLowerCase() === destDirLower) {
                        loadDirectory(currentPath);
                      }
                      if (dualPane && rightCurrentPath.toLowerCase() === destDirLower) {
                        loadRightDirectory(rightCurrentPath);
                      }
                    } else if (res?.requiresElevation && res.destDir) {
                      setElevationPrompt({
                        sources: [viewer.path],
                        target: res.destDir,
                        isMove: false,
                        action: 'copy',
                        customDestFileName: res.destFileName,
                      });
                    } else if (res?.error) {
                      showToast({
                        type: 'error',
                        title: 'Save As failed',
                        message: res.error,
                      });
                    }
                  } catch (err: any) {
                    showToast({
                      type: 'error',
                      title: 'Save As failed',
                      message: err?.message || String(err),
                    });
                  }
                }}
                className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200 transition cursor-pointer font-medium flex items-center gap-1.5 border border-zinc-700/60"
                title="Save a copy of this file to another location or rename"
              >
                <Save size={13} />
                <span>Save as...</span>
              </button>

              <button
                onClick={() => {
                  api.openPath(viewer.path);
                  setViewer(null);
                }}
                className="text-xs px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200 transition cursor-pointer font-medium border border-zinc-700/60"
              >
                Open with default app
              </button>
            </div>
          </div>

          {/* Fullscreen Content Area */}
          <div className="flex-1 w-full h-full min-h-0 bg-[#0a0a0d] flex items-center justify-center relative overflow-hidden">
            {viewer.type === 'image' && (
              <div className="w-full h-full flex items-center justify-center p-4 overflow-hidden">
                <img
                  src={toFileUrl(viewer.path)}
                  alt={viewer.name}
                  className="max-w-full max-h-full object-contain select-none shadow-2xl"
                />
              </div>
            )}
            {viewer.type === 'audio' && (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#0d0d12]">
                <div className="p-8 rounded-2xl bg-[#16161c] border border-zinc-800 flex flex-col items-center gap-6 shadow-2xl max-w-md w-full">
                  <div className="w-24 h-24 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
                    <Music size={40} />
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-zinc-100 text-base">{viewer.name}</div>
                    <div className="text-xs text-zinc-500 font-mono mt-1">{viewer.path}</div>
                  </div>
                  <audio
                    controls
                    autoPlay
                    src={toFileUrl(viewer.path)}
                    className="w-full"
                  />
                </div>
              </div>
            )}
            {viewer.type === 'video' && (
              <div className="w-full h-full flex items-center justify-center p-4 bg-black">
                <video
                  controls
                  autoPlay
                  src={toFileUrl(viewer.path)}
                  className="max-w-full max-h-full object-contain shadow-2xl"
                />
              </div>
            )}
            {viewer.type === 'text' && (
              <div className="w-full h-full flex justify-center p-6 overflow-auto">
                <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-200 w-full max-w-6xl bg-[#141418] p-6 rounded-xl border border-zinc-800/80 shadow-2xl overflow-auto leading-relaxed h-full">
                  {textContent || 'Loading...'}
                </pre>
              </div>
            )}
            {viewer.type === 'pdf' && (
              <div className="w-full h-full flex flex-col overflow-hidden">
                <PdfViewer
                  key={viewer.path}
                  filePath={viewer.path}
                  fileName={viewer.name}
                />
              </div>
            )}
            {(viewer.type === '3d' || viewer.type === 'gaussian-splat') && (
              <div className="w-full h-full flex flex-col overflow-hidden">
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
                      {elevationPrompt.customDestFileName
                        ? `"${elevationPrompt.customDestFileName}"`
                        : (elevationPrompt.sources.length === 1
                            ? `"${elevationPrompt.sources[0].split(/[\\/]/).pop()}"`
                            : `${elevationPrompt.sources.slice(0, 3).map(s => `"${s.split(/[\\/]/).pop()}"`).join(', ')}${elevationPrompt.sources.length > 3 ? ` and ${elevationPrompt.sources.length - 3} more` : ''}`)}
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

      {/* Create / Edit Collection Modal */}
      {collectionModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[10001] flex items-center justify-center p-4">
          <div className="bg-[#18181b] border border-zinc-700/80 rounded-xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-4 text-zinc-100">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Bookmark className="text-violet-400" size={18} />
                <h3 className="font-semibold text-sm">
                  {collectionModal.mode === 'create' ? 'Create Virtual Collection' : 'Edit Collection'}
                </h3>
              </div>
              <button
                onClick={() => {
                  setCollectionModal(prev => ({ ...prev, isOpen: false }));
                  setPendingAddPaths(null);
                }}
                className="text-zinc-400 hover:text-zinc-200 p-1 rounded-md hover:bg-zinc-800"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-zinc-400">Collection Name</label>
              <input
                autoFocus
                type="text"
                value={collectionModal.name}
                placeholder="e.g. Invoices, 3D Assets, Best Photos..."
                onChange={e => setCollectionModal(prev => ({ ...prev, name: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveCollectionModal();
                  if (e.key === 'Escape') {
                    setCollectionModal(prev => ({ ...prev, isOpen: false }));
                    setPendingAddPaths(null);
                  }
                }}
                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-zinc-400">Badge Color</label>
              <div className="flex items-center gap-2.5 pt-0.5">
                {COLLECTION_COLORS.map(col => {
                  const isSelected = collectionModal.color === col.key;
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => setCollectionModal(prev => ({ ...prev, color: col.key }))}
                      className={`w-6 h-6 rounded-full ${col.bgClass} flex items-center justify-center transition-all cursor-pointer ${
                        isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-[#18181b] scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
                      }`}
                      title={col.label}
                    >
                      {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white shadow-xs" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {pendingAddPaths && pendingAddPaths.length > 0 && (
              <div className="text-[11px] text-zinc-400 bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800/80">
                Will add <span className="text-zinc-200 font-semibold">{pendingAddPaths.length}</span> item(s) to this collection.
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setCollectionModal(prev => ({ ...prev, isOpen: false }));
                  setPendingAddPaths(null);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCollectionModal}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-sm transition cursor-pointer"
              >
                {collectionModal.mode === 'create' ? 'Create' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invisible offscreen layer for generating 3D and Splat previews in background */}
      <Background3DSnapshotGenerator entries={dualPane ? [...entries, ...rightEntries] : entries} />
      {/* Invisible background generator for automatic PDF previews */}
      <BackgroundPdfSnapshotGenerator entries={dualPane ? [...entries, ...rightEntries] : entries} />
    </div>
  );
}
