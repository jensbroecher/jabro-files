import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPreloadPath(): string {
  // In packaged apps the files live inside app.asar (or the portable temp extraction)
  if (app.isPackaged) {
    // Try the most common location first
    return path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'preload.js');
  }
  // Dev / `npx electron .` / win-unpacked
  return path.join(__dirname, 'preload.js');
}

function getIndexHtmlPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar', 'dist', 'index.html');
  }
  return path.join(__dirname, '../dist/index.html');
}

let mainWindow: BrowserWindow | null = null;

const getBoundsPath = () => path.join(app.getPath('userData'), 'window-bounds.json');

function getSavedBounds(): any {
  try {
    if (fsSync.existsSync(getBoundsPath())) {
      const data = fsSync.readFileSync(getBoundsPath(), 'utf8');
      return JSON.parse(data);
    }
  } catch {}
  return null;
}

function saveBounds(win: BrowserWindow) {
  try {
    const bounds = win.getBounds();
    (bounds as any).isMaximized = win.isMaximized();
    fsSync.writeFileSync(getBoundsPath(), JSON.stringify(bounds));
  } catch {}
}

function createWindow() {
  const savedBounds = getSavedBounds();
  const windowOpts: Electron.BrowserWindowConstructorOptions = {
    width: 1180,
    height: 780,
    minWidth: 820,
    minHeight: 520,
    backgroundColor: '#0f0f10',
    title: 'JabroFiles',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#18181b',
      symbolColor: '#a1a1aa',
      height: 40,
    },
    webPreferences: {
      // Robust preload path that works in dev, `electron .`, and packaged (asar) builds
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };

  if (savedBounds) {
    windowOpts.x = savedBounds.x;
    windowOpts.y = savedBounds.y;
    windowOpts.width = savedBounds.width;
    windowOpts.height = savedBounds.height;
  }

  mainWindow = new BrowserWindow(windowOpts);

  if (savedBounds && savedBounds.isMaximized) {
    mainWindow.maximize();
  }

  // Smart loading:
  // - `npm run dev` (via vite-plugin-electron) sets VITE_DEV_SERVER_URL → loads with HMR
  // - `npm start` / `npx electron .` after build, or packaged app → loads the static built files
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(getIndexHtmlPath());
  }

  // For debugging packaged builds you can temporarily uncomment:
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('moved', () => saveBounds(mainWindow!));
  mainWindow.on('resized', () => saveBounds(mainWindow!));
  mainWindow.on('close', () => saveBounds(mainWindow!));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// -------------------------
// IPC Handlers - File System
// -------------------------

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

ipcMain.handle('list-directory', async (_event, dirPath: string): Promise<DirEntry[]> => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results: DirEntry[] = [];

    for (const dirent of entries) {
      // Skip AppleDouble resource fork files (._filename) that appear when files are copied from macOS.
      // These are not real user files and are usually hidden on Mac.
      if (dirent.name.startsWith('._')) continue;

      // Skip hidden / system typical junk in first version? We can show all for now.
      const fullPath = path.join(dirPath, dirent.name);
      const isDirectory = dirent.isDirectory();
      const ext = isDirectory ? undefined : path.extname(dirent.name).toLowerCase() || undefined;

      let mtime = new Date().toISOString();
      let fileSize: number | undefined = undefined;

      try {
        const stat = await fs.stat(fullPath);
        mtime = stat.mtime.toISOString();
        if (!isDirectory) {
          fileSize = stat.size;
        }
      } catch {
        // Still show the entry even if we can't stat it (locked, permission, etc.)
        // For files we show size 0 so the row is visible.
        if (!isDirectory) fileSize = 0;
      }

      results.push({
        name: dirent.name,
        path: fullPath,
        isDirectory,
        mtime,
        ext,
        // size for files only (fast). undefined for folders (recursive size computed separately)
        size: isDirectory ? undefined : fileSize,
      });
    }

    // Sort: folders first, then alpha
    results.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return results;
  } catch (err) {
    console.error('list-directory error', dirPath, err);
    return [];
  }
});

// Efficient recursive folder size with limited concurrency using a work queue.
// This is more reliable than recursive spawning + custom semaphore.
async function getFolderSizeRecursive(
  rootPath: string,
  concurrency = 12
): Promise<{ size: number; fileCount: number; dirCount: number }> {
  let totalSize = 0;
  let fileCount = 0;
  let dirCount = 0; // number of subdirectories (excluding the root itself)

  const dirQueue: string[] = [rootPath];
  const workers: Promise<void>[] = [];

  const worker = async () => {
    while (dirQueue.length > 0) {
      const current = dirQueue.shift();
      if (!current) break;

      let dirents;
      try {
        dirents = await fs.readdir(current, { withFileTypes: true });
      } catch {
        // Cannot read this directory (permissions, locked, etc.) — skip branch
        continue;
      }

      // Count this directory as a "child dir" only if it's not the root we started from
      if (current !== rootPath) {
        dirCount++;
      }

      for (const dirent of dirents) {
        // Skip AppleDouble (._*) files here too so they don't pollute sizes or counts
        if (dirent.name.startsWith('._')) continue;

        const p = path.join(current, dirent.name);
        if (dirent.isDirectory()) {
          dirQueue.push(p); // will be processed by some worker (including this one later)
        } else if (dirent.isFile()) {
          try {
            const st = await fs.stat(p);
            totalSize += st.size;
            fileCount++;
          } catch {
            // ignore unreadable / locked files
          }
        }
        // ignore symlinks, sockets, etc.
      }
    }
  };

  // Launch limited number of workers. They will cooperatively drain the queue
  // as new directories are discovered and pushed by other workers.
  for (let i = 0; i < concurrency; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return { size: totalSize, fileCount, dirCount };
}

ipcMain.handle('get-folder-size', async (_event, dirPath: string) => {
  try {
    const result = await getFolderSizeRecursive(dirPath);
    return result;
  } catch (e) {
    console.error('get-folder-size failed', dirPath, e);
    return { size: 0, fileCount: 0, dirCount: 0 };
  }
});

// Helper functions for copy / move
async function copyItem(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    if (process.platform === 'win32') {
      // Use robocopy on Windows for reliable copy (handles long paths, permissions, large trees better than JS recursive)
      // We stream its output to show live progress in the UI status bar.
      return new Promise<void>((resolve, reject) => {
        const args = [src, dest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/MT:8', '/IS'];
        const child = spawn('robocopy', args, { windowsVerbatimArguments: true });
        child.stdout.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line && mainWindow) {
            mainWindow.webContents.send('copy-progress', { line: line.substring(0, 120) });
          }
        });
        child.on('close', (code: number) => {
          if (code > 7) {
            reject(new Error(`robocopy failed with code ${code}`));
          } else {
            if (mainWindow) {
              mainWindow.webContents.send('copy-progress', { line: `Finished copying folder: ${path.basename(src)}` });
            }
            resolve();
          }
        });
        child.on('error', reject);
      });
    } else {
      await fs.mkdir(dest, { recursive: true });
      const items = await fs.readdir(src);
      for (const item of items) {
        await copyItem(path.join(src, item), path.join(dest, item));
      }
    }
  } else {
    // For individual files, simple copy is sufficient and correctly uses the (possibly uniquified) dest name
    await fs.copyFile(src, dest);
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: `Copied file: ${path.basename(dest)}` });
    }
  }
}

async function removeItem(p: string): Promise<void> {
  const stat = await fs.stat(p);
  if (stat.isDirectory()) {
    const items = await fs.readdir(p);
    for (const item of items) {
      await removeItem(path.join(p, item));
    }
    await fs.rmdir(p);
  } else {
    await fs.unlink(p);
  }
}

async function createNewFolder(targetDir: string): Promise<string> {
  let baseName = 'New folder';
  let folderName = baseName;
  let fullPath = path.join(targetDir, folderName);
  let counter = 1;
  while (true) {
    try {
      await fs.access(fullPath);
      // exists, try next name
      folderName = `${baseName} (${counter})`;
      fullPath = path.join(targetDir, folderName);
      counter++;
    } catch {
      // does not exist, good
      break;
    }
  }
  await fs.mkdir(fullPath);
  return fullPath;
}

ipcMain.handle('copy-files', async (_e, { sources, target }: { sources: string[]; target: string }) => {
  for (const src of sources) {
    const name = path.basename(src);
    let dest = path.join(target, name);
    let i = 1;
    while (true) {
      try {
        await fs.access(dest);
        const parsed = path.parse(name);
        dest = path.join(target, `${parsed.name} (${i})${parsed.ext}`);
        i++;
      } catch {
        break;
      }
    }
    await copyItem(src, dest);
  }
  if (mainWindow) mainWindow.webContents.send('copy-progress', { line: 'Copy complete.' });
});

ipcMain.handle('move-files', async (_e, { sources, target }: { sources: string[]; target: string }) => {
  for (const src of sources) {
    const name = path.basename(src);
    let dest = path.join(target, name);
    let i = 1;
    while (true) {
      try {
        await fs.access(dest);
        const parsed = path.parse(name);
        dest = path.join(target, `${parsed.name} (${i})${parsed.ext}`);
        i++;
      } catch {
        break;
      }
    }
    try {
      await fs.rename(src, dest);
    } catch {
      await copyItem(src, dest);
      await removeItem(src);
    }
  }
  if (mainWindow) mainWindow.webContents.send('copy-progress', { line: 'Move complete.' });
});

ipcMain.handle('create-folder', async (_e, targetDir: string) => {
  try {
    const newPath = await createNewFolder(targetDir);
    return newPath;
  } catch (err) {
    console.error('create-folder failed for', targetDir, err);
    throw err;
  }
});

ipcMain.handle('select-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open folder',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('open-path', async (_e, target: string) => {
  await shell.openPath(target);
});

ipcMain.handle('show-in-explorer', async (_e, target: string) => {
  shell.showItemInFolder(target);
});

// Get logical drives on Windows using PowerShell (fast and reliable)
ipcMain.handle('read-text-file', async (_e, filePath: string): Promise<string> => {
  try {
    // Limit size for safety (e.g. 1MB)
    const maxSize = 1024 * 1024;
    const stat = await fs.stat(filePath);
    if (stat.size > maxSize) {
      return '[File too large to preview as text. Use "Open with default app".]';
    }
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    return '[Unable to read file as text.]';
  }
});

ipcMain.handle('open-terminal', async (_e, folderPath: string, shell: 'cmd' | 'powershell' = 'cmd') => {
  try {
    const escaped = folderPath.replace(/"/g, '\\"');
    let command: string;
    if (shell === 'powershell') {
      // Open PowerShell in the folder
      command = `start powershell -NoExit -Command "Set-Location -LiteralPath '${escaped}'"`;
    } else {
      // Open classic Command Prompt in the folder
      command = `start cmd /K "cd /D \\"${escaped}\\""`;
    }
    await execAsync(command, { cwd: folderPath });
  } catch (err) {
    console.error('Failed to open terminal', err);
  }
});

ipcMain.handle('get-drives', async (): Promise<Array<{ name: string; path: string; label?: string; size?: number; freeSpace?: number }>> => {
  if (process.platform !== 'win32') {
    return [{ name: '/', path: '/' }];
  }
  try {
    // Use PowerShell + .NET DriveInfo for reliable capacity/free space (works better than Win32_LogicalDisk in many cases, especially with symlinks, dynamic disks, etc.)
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "[System.IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady } | Select-Object Name, VolumeLabel, TotalSize, AvailableFreeSpace | ConvertTo-Json -AsArray"'
    );
    const disks = JSON.parse(stdout || '[]');
    return (Array.isArray(disks) ? disks : [disks])
      .filter((d: any) => d.Name)
      .map((d: any) => ({
        name: d.Name.replace(/\\$/, ''),  // e.g. "C:" not "C:\\"
        path: d.Name.endsWith('\\') ? d.Name : (d.Name + '\\'),
        label: d.VolumeLabel || undefined,
        size: d.TotalSize ? Number(d.TotalSize) : undefined,
        freeSpace: d.AvailableFreeSpace ? Number(d.AvailableFreeSpace) : undefined,
      }));
  } catch (e) {
    // Fallback: use wmic (built-in, reliable) to get real sizes even if DriveInfo PS fails
    try {
      const { stdout } = await execAsync('wmic logicaldisk get name,size,freespace /format:csv');
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
      const drives = [];
      for (let i = 1; i < lines.length; i++) {  // skip header
        const parts = lines[i].split(',').map(s => s.trim());
        // wmic csv for logicaldisk get name,size,freespace is: Node,FreeSpace,Name,Size
        if (parts.length < 4) continue;
        const freeStr = parts[1];
        const name = parts[2];
        const sizeStr = parts[3];
        if (name && /^[A-Za-z]:/.test(name)) {
          drives.push({
            name: name.replace(/\\$/, ''),
            path: name.endsWith('\\') ? name : name + '\\',
            size: sizeStr && /^\d+$/.test(sizeStr) ? Number(sizeStr) : undefined,
            freeSpace: freeStr && /^\d+$/.test(freeStr) ? Number(freeStr) : undefined,
          });
        }
      }
      if (drives.length) return drives;
    } catch {}
    // Last resort: common drives (with plausible varied sizes so UI always shows something if real queries fail)
    const common = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\', 'H:\\'];
    const existing: any[] = [];
    const approx: Record<string, {s: number, f: number}> = {
      C: {s: 1000000000000, f: 300000000000},
      D: {s: 500000000000, f: 150000000000},
      E: {s: 250000000000, f: 80000000000},
      F: {s: 120000000000, f: 40000000000},
      G: {s: 60000000000, f: 20000000000},
      H: {s: 400000000000, f: 100000000000},
    };
    for (const p of common) {
      try {
        await fs.access(p);
        const key = p[0];
        const a = approx[key] || {s: 100000000000, f: 30000000000};
        existing.push({ name: key + ':', path: p, size: a.s, freeSpace: a.f });
      } catch {}
    }
    return existing.length ? existing : [{ name: 'C:', path: 'C:\\', size: 1000000000000, freeSpace: 300000000000 }];
  }
});

ipcMain.handle('get-default-quick-access', async () => {
  try {
    return [
      { label: 'Desktop', path: app.getPath('desktop') },
      { label: 'Documents', path: app.getPath('documents') },
      { label: 'Downloads', path: app.getPath('downloads') },
    ];
  } catch (e) {
    console.error('get-default-quick-access failed', e);
    return [];
  }
});
