import { contextBridge, ipcRenderer, webUtils } from 'electron';

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileCount?: number;
  dirCount?: number;
  mtime: string;
  ext?: string;
}

export interface SizeResult {
  size: number;
  fileCount: number;
  dirCount: number;
}

export interface DriveInfo {
  name: string;
  path: string;
  label?: string;
  size?: number;
  freeSpace?: number;
}

export interface FileOpItemResult {
  src: string;
  dest?: string;
  name: string;
  success: boolean;
  error?: string;
}

export interface FileOpResult {
  success: boolean;
  requiresElevation?: boolean;
  type?: 'copy' | 'move';
  target?: string;
  sources?: string[];
  items?: FileOpItemResult[];
  summary?: string;
  errors?: string[];
  cancelled?: boolean;
  error?: string;
}

const api = {
  // List immediate children of a directory
  listDirectory: (dirPath: string): Promise<DirEntry[]> => 
    ipcRenderer.invoke('list-directory', dirPath),

  // Recursively compute total size of a folder (can be slow on huge trees)
  getFolderSize: (dirPath: string): Promise<SizeResult> =>
    ipcRenderer.invoke('get-folder-size', dirPath),

  // Native folder picker
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-folder'),

  // Open a file or folder with default app
  openPath: (target: string): Promise<void> =>
    ipcRenderer.invoke('open-path', target),

  // Reveal in Windows Explorer
  showInExplorer: (target: string): Promise<void> =>
    ipcRenderer.invoke('show-in-explorer', target),

  // List available drives (C:, D:, H: etc)
  getDrives: (): Promise<DriveInfo[]> =>
    ipcRenderer.invoke('get-drives'),

  // File operations for copy/cut/paste
  copyFiles: (sources: string[], target: string): Promise<FileOpResult> =>
    ipcRenderer.invoke('copy-files', { sources, target }),
  moveFiles: (sources: string[], target: string): Promise<FileOpResult> =>
    ipcRenderer.invoke('move-files', { sources, target }),

  // Elevated operation via Windows UAC for protected folders (e.g. C:\ root or Program Files)
  performElevatedFileOp: (
    sources: string[],
    target: string,
    isMove?: boolean,
    action?: 'copy' | 'move' | 'createFolder',
    newFolderName?: string
  ): Promise<FileOpResult> =>
    ipcRenderer.invoke('perform-elevated-op', { sources, target, isMove, action, newFolderName }),

  // Create a new folder in the given directory (with unique name "New folder", "New folder (2)" etc.)
  createFolder: (targetDir: string): Promise<any> =>
    ipcRenderer.invoke('create-folder', targetDir),

  // Get default Quick Access folders using proper Electron paths (respects symlinks/custom user folders)
  getDefaultQuickAccess: (): Promise<Array<{ label: string; path: string }>> =>
    ipcRenderer.invoke('get-default-quick-access'),

  // Listen for copy/paste progress (for UI feedback during long operations)
  onCopyProgress: (callback: (data: any) => void): (() => void) => {
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on('copy-progress', handler);
    return () => {
      ipcRenderer.removeListener('copy-progress', handler);
    };
  },

  readTextFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-text-file', filePath),

  detectPlyType: (filePath: string): Promise<'gaussian-splat' | '3d'> =>
    ipcRenderer.invoke('detect-ply-type', filePath),

  openTerminal: (folderPath: string, shell: 'cmd' | 'powershell' = 'cmd'): Promise<void> =>
    ipcRenderer.invoke('open-terminal', folderPath, shell),

  // Support dragging real files from Windows Explorer / desktop into the app (returns full native path for a File from dataTransfer)
  getPathForFile: (file: File): string => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch {}
    // Fallback
    return (file as any).path || '';
  },

  // Optional: platform info
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
