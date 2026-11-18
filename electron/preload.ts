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
  missing?: boolean;
  permissions?: string;
}

export interface RemoteConnectionInput {
  id?: string;
  name: string;
  protocol: 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'agent';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  initialPath?: string;
  rejectUnauthorized?: boolean;
  keepExistingSecrets?: boolean;
}

export interface RemoteConnectionInfo {
  id: string;
  name: string;
  protocol: 'sftp' | 'ftp' | 'ftps';
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'agent';
  privateKeyPath?: string;
  initialPath?: string;
  rejectUnauthorized?: boolean;
  hasPassword: boolean;
  hasPassphrase: boolean;
  connected: boolean;
  lastError?: string;
  createdAt: string;
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

export interface SaveAsResult {
  canceled?: boolean;
  success?: boolean;
  sourcePath?: string;
  destPath?: string;
  destDir?: string;
  destFileName?: string;
  requiresElevation?: boolean;
  error?: string;
}

const api = {
  // List immediate children of a directory
  listDirectory: (dirPath: string): Promise<DirEntry[]> => 
    ipcRenderer.invoke('list-directory', dirPath),

  // Recursively compute total size of a folder (can be slow on huge trees)
  getFolderSize: (dirPath: string): Promise<SizeResult> =>
    ipcRenderer.invoke('get-folder-size', dirPath),

  // Find top largest files (Space Hogs)
  findLargestFiles: (dirPath: string, limit = 50): Promise<Array<{ name: string; path: string; size: number; mtime: string; ext: string }>> =>
    ipcRenderer.invoke('find-largest-files', { dirPath, limit }),

  // Native folder picker
  selectFolder: (): Promise<string | null> =>
    ipcRenderer.invoke('select-folder'),

  // Open a file or folder with default app
  openPath: (target: string): Promise<void> =>
    ipcRenderer.invoke('open-path', target),

  // Reveal in the OS file manager (Explorer / Finder)
  showInExplorer: (target: string): Promise<void> =>
    ipcRenderer.invoke('show-in-explorer', target),

  // List available drives / volumes (C:, D: ... on Windows; / and /Volumes/* on macOS)
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
    action?: 'copy' | 'move' | 'createFolder' | 'delete' | 'rename',
    newFolderName?: string,
    customDestFileName?: string,
    newName?: string
  ): Promise<FileOpResult> =>
    ipcRenderer.invoke('perform-elevated-op', { sources, target, isMove, action, newFolderName, customDestFileName, newName }),

  // Create a new folder in the given directory (with unique name "New folder", "New folder (2)" etc.)
  createFolder: (targetDir: string): Promise<any> =>
    ipcRenderer.invoke('create-folder', targetDir),

  // Delete files or folders (moves to OS Trash by default unless permanent=true, or deletes from remote server)
  deleteItems: (paths: string[], permanent = false): Promise<{
    success: boolean;
    requiresElevation?: boolean;
    action?: 'delete';
    sources?: string[];
    target?: string;
    items: Array<{ path: string; name: string; success: boolean; error?: string }>;
    summary: string;
    errors: string[];
  }> =>
    ipcRenderer.invoke('delete-items', { paths, permanent }),

  // Rename a file or folder (local or remote)
  renameItem: (targetPath: string, newName: string): Promise<{
    success: boolean;
    oldPath?: string;
    newPath?: string;
    requiresElevation?: boolean;
    action?: 'rename';
    sources?: string[];
    target?: string;
    newName?: string;
    error?: string;
  }> =>
    ipcRenderer.invoke('rename-item', { targetPath, newName }),

  // Remote FTP / FTPS / SFTP operations
  remoteListConnections: (): Promise<RemoteConnectionInfo[]> =>
    ipcRenderer.invoke('remote:list-connections'),
  remoteSaveConnection: (input: RemoteConnectionInput): Promise<RemoteConnectionInfo> =>
    ipcRenderer.invoke('remote:save-connection', input),
  remoteDeleteConnection: (connectionId: string): Promise<boolean> =>
    ipcRenderer.invoke('remote:delete-connection', connectionId),
  remoteTestConnection: (input: RemoteConnectionInput): Promise<{ success: boolean; resolvedPath?: string; error?: string }> =>
    ipcRenderer.invoke('remote:test-connection', input),
  remoteConnect: (connectionId: string): Promise<{ success: boolean; rootUri?: string; initialUri?: string; error?: string }> =>
    ipcRenderer.invoke('remote:connect', connectionId),
  remoteDisconnect: (connectionId: string): Promise<void> =>
    ipcRenderer.invoke('remote:disconnect', connectionId),
  remoteSelectKeyFile: (): Promise<string | null> =>
    ipcRenderer.invoke('remote:select-key-file'),

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

  // Listen for native application menu actions
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const handler = (_event: any, action: string) => callback(action);
    ipcRenderer.on('menu-action', handler);
    return () => {
      ipcRenderer.removeListener('menu-action', handler);
    };
  },

  readTextFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-text-file', filePath),

  readBinaryFile: (filePath: string): Promise<Uint8Array | null> =>
    ipcRenderer.invoke('read-binary-file', filePath),

  detectPlyType: (filePath: string): Promise<'gaussian-splat' | '3d'> =>
    ipcRenderer.invoke('detect-ply-type', filePath),

  // `shell` is only honored on Windows; macOS/Linux open the default terminal
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

  // Central Thumbnail Cache & Previews
  getThumbnail: (filePath: string, mtime: string, size?: number): Promise<{ url?: string; hasPreview: boolean }> =>
    ipcRenderer.invoke('get-thumbnail', { filePath, mtime, size }),

  getThumbnailsBatch: (items: Array<{ filePath: string; mtime: string; size?: number }>): Promise<Record<string, string>> =>
    ipcRenderer.invoke('get-thumbnails-batch', items),

  readFileSnippet: (filePath: string, maxChars?: number): Promise<string> =>
    ipcRenderer.invoke('read-file-snippet', filePath, maxChars),

  getThumbnailCacheStats: (): Promise<{ count: number; sizeBytes: number; cachePath: string }> =>
    ipcRenderer.invoke('get-thumbnail-cache-stats'),

  clearThumbnailCache: (): Promise<{ success: boolean; count: number; clearedBytes: number }> =>
    ipcRenderer.invoke('clear-thumbnail-cache'),

  openThumbnailCacheFolder: (): Promise<void> =>
    ipcRenderer.invoke('open-thumbnail-cache-folder'),

  saveThumbnailCache: (filePath: string, dataUrl: string, mtime?: string, size?: number): Promise<boolean> =>
    ipcRenderer.invoke('save-thumbnail-cache', { filePath, dataUrl, mtime, size }),

  // Prompt user with native Save As dialog and copy the file to the chosen location/name
  saveFileAs: (sourcePath: string): Promise<SaveAsResult> =>
    ipcRenderer.invoke('save-file-as', sourcePath),

  // Collections (Virtual Folders) support
  selectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('select-files'),

  getEntriesStats: (filePaths: string[]): Promise<any[]> =>
    ipcRenderer.invoke('get-entries-stats', filePaths),

  // Platform info and the user's home directory (initial folder for the file browser)
  platform: process.platform,
  homeDir: ipcRenderer.sendSync('get-home-dir') as string,
};

contextBridge.exposeInMainWorld('api', api);

declare global {
  interface Window {
    api: typeof api;
  }
}
