import { contextBridge, ipcRenderer } from 'electron';

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
  copyFiles: (sources: string[], target: string): Promise<void> =>
    ipcRenderer.invoke('copy-files', { sources, target }),
  moveFiles: (sources: string[], target: string): Promise<void> =>
    ipcRenderer.invoke('move-files', { sources, target }),

  // Create a new folder in the given directory (with unique name "New folder", "New folder (2)" etc.)
  createFolder: (targetDir: string): Promise<string> =>
    ipcRenderer.invoke('create-folder', targetDir),

  // Get default Quick Access folders using proper Electron paths (respects symlinks/custom user folders)
  getDefaultQuickAccess: (): Promise<Array<{ label: string; path: string }>> =>
    ipcRenderer.invoke('get-default-quick-access'),

  // Listen for copy/paste progress (for UI feedback during long operations)
  onCopyProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('copy-progress', (_event, data) => callback(data));
  },

  readTextFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-text-file', filePath),

  openTerminal: (folderPath: string, shell: 'cmd' | 'powershell' = 'cmd'): Promise<void> =>
    ipcRenderer.invoke('open-terminal', folderPath, shell),

  // Optional: platform info
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
