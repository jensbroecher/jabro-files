import { app, BrowserWindow, dialog, ipcMain, shell, protocol, net, session, nativeImage, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable SharedArrayBuffer feature for WebAssembly workers and allow local file access
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');
app.commandLine.appendSwitch('allow-file-access-from-files');

// Register privileged custom scheme for streaming local media, PDFs, and 3D assets
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'jabro-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

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
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed.width === 'number' && typeof parsed.height === 'number') {
        // Discard invalid/tiny dimensions
        if (parsed.width < 400 || parsed.height < 300) return null;
        // Discard minimized coordinates on Windows (e.g. -32000)
        if (parsed.x !== undefined && (parsed.x < -10000 || parsed.y < -10000)) {
          return null;
        }
        // Verify that the window bounds intersect at least one active display
        try {
          const displays = screen.getAllDisplays();
          const isVisible = displays.some((d) => {
            const db = d.bounds;
            return (
              parsed.x >= db.x - 200 &&
              parsed.x < db.x + db.width &&
              parsed.y >= db.y - 100 &&
              parsed.y < db.y + db.height
            );
          });
          if (!isVisible) return null;
        } catch {}
        return parsed;
      }
    }
  } catch {}
  return null;
}

function saveBounds(win: BrowserWindow) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.isMaximized() ? (win.getNormalBounds ? win.getNormalBounds() : win.getBounds()) : win.getBounds();
    const data = {
      ...bounds,
      isMaximized: win.isMaximized(),
    };
    fsSync.writeFileSync(getBoundsPath(), JSON.stringify(data));
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
      plugins: true, // Enables Chromium's built-in PDF viewer plugin
      webSecurity: false, // Ensures local WASM, Draco workers, and textures load without origin restrictions
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
    const loadDev = () => {
      mainWindow?.loadURL(devServerUrl).catch((err) => {
        console.warn('[Main] Dev server connect failed, retrying in 350ms...', err);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            loadDev();
          }
        }, 350);
      });
    };
    loadDev();
  } else {
    mainWindow.loadFile(getIndexHtmlPath()).catch((err) => {
      console.error('[Main] Failed to load index.html:', err);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Main] did-fail-load: ${errorDescription} (${errorCode}) for ${validatedURL}`);
    if (devServerUrl && validatedURL && validatedURL.includes('localhost')) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          console.log('[Main] Dev server retry on did-fail-load...');
          mainWindow.loadURL(devServerUrl).catch(() => {});
        }
      }, 500);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Main] Render process gone:', details);
    if (details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer LOG ${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.on('moved', () => saveBounds(mainWindow!));
  mainWindow.on('resized', () => saveBounds(mainWindow!));
  mainWindow.on('close', () => saveBounds(mainWindow!));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Enable Cross-Origin Isolation for high-performance zero-copy WebAssembly multi-threading (used by Gaussian Splatting)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Embedder-Policy': ['require-corp'],
      },
    });
  });

  // Protocol handler for streaming local assets, 3D models, Gaussian splats, and PDFs
  protocol.handle('jabro-media', async (request) => {
    let targetPath = '';
    try {
      const url = new URL(request.url);
      targetPath = url.searchParams.get('path') || '';
      if (!targetPath) {
        let pathname = decodeURIComponent(url.pathname);
        if (process.platform === 'win32' && pathname.startsWith('/') && /^[a-zA-Z]:/.test(pathname.slice(1))) {
          pathname = pathname.slice(1);
        }
        targetPath = pathname;
      }

      if (targetPath) {
        if (targetPath.startsWith('\\\\?\\')) {
          targetPath = targetPath.slice(4);
        } else if (targetPath.startsWith('//?/')) {
          targetPath = targetPath.slice(4);
        }
        targetPath = path.normalize(targetPath);
      }

      const stat = await fs.stat(targetPath);
      const ext = path.extname(targetPath).toLowerCase();
      const headers = new Headers();

      let mimeType = '';
      if (ext === '.pdf') mimeType = 'application/pdf';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.png') mimeType = 'image/png';
      else if (ext === '.webp') mimeType = 'image/webp';
      else if (ext === '.gif') mimeType = 'image/gif';
      else if (ext === '.svg') mimeType = 'image/svg+xml';
      else if (ext === '.bmp') mimeType = 'image/bmp';
      else if (ext === '.ico') mimeType = 'image/x-icon';
      else if (ext === '.tga') mimeType = 'image/x-tga';
      else if (ext === '.dds') mimeType = 'image/vnd-ms.dds';
      else if (ext === '.glb') mimeType = 'model/gltf-binary';
      else if (ext === '.gltf') mimeType = 'model/gltf+json';
      else if (ext === '.wasm') mimeType = 'application/wasm';
      else if (ext === '.js') mimeType = 'application/javascript';
      else if (ext === '.obj') mimeType = 'text/plain';
      else if (ext === '.stl' || ext === '.ply' || ext === '.splat' || ext === '.ksplat' || ext === '.spz' || ext === '.fbx') {
        mimeType = 'application/octet-stream';
      }

      if (mimeType) headers.set('content-type', mimeType);
      headers.set('access-control-allow-origin', '*');
      headers.set('access-control-expose-headers', 'Content-Length, Content-Range, Accept-Ranges');
      headers.set('accept-ranges', 'bytes');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');

      const range = request.headers.get('range');
      let status = 200;
      let nodeStream: any;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        if (!isNaN(start) && start < stat.size) {
          const chunkEnd = Math.min(end, stat.size - 1);
          const chunkLength = chunkEnd - start + 1;
          headers.set('content-length', chunkLength.toString());
          headers.set('content-range', `bytes ${start}-${chunkEnd}/${stat.size}`);
          status = 206;
          nodeStream = fsSync.createReadStream(targetPath, { start, end: chunkEnd });
        } else {
          headers.set('content-length', stat.size.toString());
          nodeStream = fsSync.createReadStream(targetPath);
        }
      } else {
        headers.set('content-length', stat.size.toString());
        nodeStream = fsSync.createReadStream(targetPath);
      }

      const webStream = Readable.toWeb(nodeStream);
      return new Response(webStream as any, {
        status,
        headers,
      });
    } catch (err: any) {
      console.error('jabro-media protocol error for path:', targetPath, err);
      return new Response('File not found: ' + (err?.message || 'Not found'), { status: 404 });
    }
  });

  // Fast detector to distinguish 3D Gaussian Splats (.ply) from standard polygon meshes (.ply)
  ipcMain.handle('detect-ply-type', async (_event, filePath: string): Promise<'gaussian-splat' | '3d'> => {
    try {
      const handle = await fs.open(filePath, 'r');
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, 4096, 0);
      await handle.close();
      const headerStr = buffer.toString('utf8', 0, bytesRead);
      if (
        headerStr.includes('f_dc_') ||
        headerStr.includes('opacity') ||
        headerStr.includes('scale_0') ||
        headerStr.includes('rot_0') ||
        headerStr.includes('packed_position')
      ) {
        return 'gaussian-splat';
      }
      return '3d';
    } catch (err) {
      console.error('detect-ply-type error:', err);
      return '3d';
    }
  });

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

// Recursively find top largest files (Space Hogs) in a directory tree
async function findLargestFilesRecursive(
  rootPath: string,
  limit = 50,
  maxFilesToScan = 50000
): Promise<Array<{ name: string; path: string; size: number; mtime: string; ext: string }>> {
  const largestFiles: Array<{ name: string; path: string; size: number; mtime: string; ext: string }> = [];
  const dirQueue: string[] = [rootPath];
  let scannedCount = 0;

  while (dirQueue.length > 0 && scannedCount < maxFilesToScan) {
    const current = dirQueue.shift();
    if (!current) break;

    let dirents;
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      if (dirent.name.startsWith('._') || dirent.name === '$RECYCLE.BIN' || dirent.name === 'System Volume Information') {
        continue;
      }

      const p = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        dirQueue.push(p);
      } else if (dirent.isFile()) {
        scannedCount++;
        try {
          const st = await fs.stat(p);
          const ext = path.extname(dirent.name);
          const entry = {
            name: dirent.name,
            path: p,
            size: st.size,
            mtime: st.mtime.toISOString(),
            ext,
          };

          if (largestFiles.length < limit) {
            largestFiles.push(entry);
            largestFiles.sort((a, b) => b.size - a.size);
          } else if (st.size > largestFiles[largestFiles.length - 1].size) {
            largestFiles.pop();
            largestFiles.push(entry);
            largestFiles.sort((a, b) => b.size - a.size);
          }
        } catch {}
      }
    }
  }

  return largestFiles;
}

ipcMain.handle('find-largest-files', async (_event, { dirPath, limit }: { dirPath: string; limit?: number }) => {
  try {
    return await findLargestFilesRecursive(dirPath, limit || 50);
  } catch (err) {
    console.error('find-largest-files failed', dirPath, err);
    return [];
  }
});

// Helper functions for copy / move
function normalizeTargetDirectory(target: string): string {
  let trimmed = (target || '').trim();
  trimmed = trimmed.replace(/^["']|["']$/g, '');
  if (/^[A-Za-z]:$/.test(trimmed)) {
    trimmed += '\\';
  }
  return trimmed;
}

function friendlyErrorMessage(err: any, itemPath: string): string {
  const code = err?.code;
  const name = path.basename(itemPath);
  if (code === 'EBUSY') {
    return `"${name}" is locked or currently open in another program.`;
  }
  if (code === 'EPERM' || code === 'EACCES') {
    return `Permission denied for "${name}". You may need administrator rights, or the file/folder is write-protected.`;
  }
  if (code === 'ENOENT') {
    return `"${name}" could not be found or the destination folder does not exist.`;
  }
  if (code === 'ENOSPC') {
    return `Not enough free disk space on the target drive to copy "${name}".`;
  }
  if (code === 'EINVAL') {
    return `The file name or path "${name}" contains characters not supported by Windows.`;
  }
  if (err?.message?.includes('robocopy failed')) {
    return `Folder copy failed for "${name}" (${err.message}).`;
  }
  return err?.message || `Failed to process "${name}".`;
}

async function getUniqueDestination(targetDir: string, originalName: string, isSameFolder: boolean): Promise<string> {
  const parsed = path.parse(originalName);
  const base = parsed.name || originalName;
  const ext = parsed.ext || '';

  const initialDest = path.join(targetDir, originalName);
  try {
    await fs.access(initialDest);
    // Already exists, must uniquify
  } catch {
    // Free to use
    return initialDest;
  }

  let counter = 1;
  while (counter < 9999) {
    const candidateName = isSameFolder && counter === 1
      ? `${base} - Copy${ext}`
      : `${base} (${counter})${ext}`;
    const candidatePath = path.join(targetDir, candidateName);
    try {
      await fs.access(candidatePath);
      counter++;
    } catch {
      return candidatePath;
    }
  }
  return path.join(targetDir, `${base}_${Date.now()}${ext}`);
}

async function copySingleFile(src: string, dest: string): Promise<void> {
  const destDir = path.dirname(dest);
  await fs.mkdir(destDir, { recursive: true });

  // Clear read-only attribute on destination if it already exists
  try {
    await fs.chmod(dest, 0o666);
  } catch {}

  let lastErr: any = null;
  // Retry loop for transient locks (e.g. antivirus scanner or indexer)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.copyFile(src, dest);
      lastErr = null;
      break;
    } catch (err: any) {
      lastErr = err;
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        try { await fs.chmod(dest, 0o666); } catch {}
      }
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
      }
    }
  }

  // Fallback to stream copy if copyFile still failed
  if (lastErr) {
    try {
      await new Promise<void>((resolve, reject) => {
        const reader = fsSync.createReadStream(src);
        const writer = fsSync.createWriteStream(dest, { flags: 'w' });
        reader.on('error', reject);
        writer.on('error', reject);
        writer.on('finish', resolve);
        reader.pipe(writer);
      });
      lastErr = null;
    } catch (streamErr) {
      throw lastErr || streamErr;
    }
  }

  // Preserve timestamps if possible
  try {
    const srcStat = await fs.stat(src);
    await fs.utimes(dest, srcStat.atime, srcStat.mtime);
  } catch {}
}

async function copyFolder(src: string, dest: string): Promise<void> {
  const cleanSrc = src.replace(/[\\/]+$/, '');
  const cleanDest = dest.replace(/[\\/]+$/, '');

  if (process.platform === 'win32') {
    let robocopyFailed = false;
    let robocopyErr: any = null;

    try {
      await new Promise<void>((resolve, reject) => {
        // Robocopy: /E (recursive), /COPY:DAT (data, attributes, timestamps),
        // /R:1 (1 retry), /W:1 (1 sec wait), /MT:8 (multithreaded), /IS (include same),
        // /NFL /NDL /NP (reduce log noise while still capturing errors)
        const args = [cleanSrc, cleanDest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/MT:8', '/IS', '/NFL', '/NDL', '/NP'];
        // Notice: do NOT use windowsVerbatimArguments: true so Node properly quotes paths with spaces!
        const child = spawn('robocopy', args);

        child.stdout?.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line && mainWindow) {
            mainWindow.webContents.send('copy-progress', { line: line.substring(0, 120) });
          }
        });

        child.stderr?.on('data', (data: Buffer) => {
          const line = data.toString().trim();
          if (line && mainWindow) {
            mainWindow.webContents.send('copy-progress', { line: 'ERR: ' + line.substring(0, 110) });
          }
        });

        child.on('close', (code: number) => {
          // Robocopy exit code bitmask: 0-7 are success/partial states, >=8 is fatal error
          if (code >= 8) {
            reject(new Error(`robocopy failed with exit code ${code}`));
          } else {
            resolve();
          }
        });

        child.on('error', (err) => {
          reject(err);
        });
      });
    } catch (err) {
      robocopyFailed = true;
      robocopyErr = err;
    }

    if (!robocopyFailed) return;
    console.warn('robocopy failed, falling back to fs.cp:', robocopyErr?.message);
  }

  // Built-in recursive copy fallback
  await fs.cp(src, dest, { recursive: true, force: true });
}

async function copyItem(src: string, dest: string): Promise<void> {
  const stat = await fs.stat(src);
  if (stat.isDirectory()) {
    await copyFolder(src, dest);
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: `Copied folder: ${path.basename(dest)}` });
    }
  } else {
    await copySingleFile(src, dest);
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: `Copied file: ${path.basename(dest)}` });
    }
  }
}

async function removeItem(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch (err) {
    try {
      await fs.chmod(p, 0o666);
      await fs.rm(p, { recursive: true, force: true });
    } catch {
      throw err;
    }
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

interface ElevatedItem {
  src?: string;
  dest: string;
  action?: 'copy' | 'move' | 'createFolder';
  isDirectory?: boolean;
}

async function performElevatedOperation(params: {
  sources?: string[];
  target: string;
  isMove?: boolean;
  action?: 'copy' | 'move' | 'createFolder';
  newFolderName?: string;
}): Promise<{
  success: boolean;
  cancelled?: boolean;
  items?: Array<{ src?: string; dest: string; name: string; success: boolean; error?: string }>;
  error?: string;
  summary?: string;
}> {
  if (process.platform !== 'win32') {
    throw new Error('Administrator elevation is only supported on Windows.');
  }

  const targetDir = normalizeTargetDirectory(params.target);
  const isMove = !!params.isMove;
  const isCreateFolder = params.action === 'createFolder';

  const items: ElevatedItem[] = [];

  if (isCreateFolder) {
    const folderName = params.newFolderName || 'New folder';
    let dest = path.join(targetDir, folderName);
    let counter = 1;
    while (true) {
      try {
        await fs.access(dest);
        dest = path.join(targetDir, `${folderName} (${counter})`);
        counter++;
      } catch {
        break;
      }
    }
    items.push({
      dest,
      action: 'createFolder',
      isDirectory: true,
    });
  } else if (params.sources && params.sources.length > 0) {
    for (const src of params.sources) {
      const name = path.basename(src);
      let isDirectory = false;
      try {
        const st = await fs.stat(src);
        isDirectory = st.isDirectory();
      } catch {}

      const isSameFolder = path.dirname(path.resolve(src)).toLowerCase() === path.resolve(targetDir).toLowerCase();
      const dest = await getUniqueDestination(targetDir, name, isSameFolder && !isMove);

      items.push({
        src,
        dest,
        action: isMove ? 'move' : 'copy',
        isDirectory,
      });
    }
  }

  if (items.length === 0) {
    return { success: true, items: [] };
  }

  const jobId = `jabro_elevated_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const configFile = path.join(os.tmpdir(), `${jobId}_config.json`);
  const scriptFile = path.join(os.tmpdir(), `${jobId}_worker.ps1`);
  const resultFile = path.join(os.tmpdir(), `${jobId}_result.json`);

  const configPayload = {
    isMove,
    targetDir,
    items,
    resultFile,
  };

  await fs.writeFile(configFile, JSON.stringify(configPayload, null, 2), 'utf8');

  const psScript = `
param([string]$ConfigPath)

$result = @{
    success = $false
    items = @()
    error = $null
}

try {
    $raw = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8)
    $cfg = $raw | ConvertFrom-Json
    $resPath = [string]$cfg.resultFile

    if (-not (Test-Path -LiteralPath $cfg.targetDir)) {
        New-Item -ItemType Directory -LiteralPath $cfg.targetDir -Force | Out-Null
    }

    foreach ($item in $cfg.items) {
        $src = [string]$item.src
        $dest = [string]$item.dest
        $act = [string]$item.action
        $isDir = [bool]$item.isDirectory

        try {
            if ($act -eq 'createFolder') {
                New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null
            } elseif ($act -eq 'move') {
                if (Test-Path -LiteralPath $dest) {
                    Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
                }
                Move-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop
            } else {
                if ($isDir) {
                    if (-not (Test-Path -LiteralPath $dest)) {
                        New-Item -ItemType Directory -LiteralPath $dest -Force | Out-Null
                    }
                    $cleanSrc = $src.TrimEnd('\\', '/')
                    $cleanDest = $dest.TrimEnd('\\', '/')
                    $rcArgs = @($cleanSrc, $cleanDest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/IS', '/NFL', '/NDL', '/NP')
                    $rcProc = Start-Process -FilePath "robocopy.exe" -ArgumentList $rcArgs -Wait -NoNewWindow -PassThru
                    if ($rcProc.ExitCode -ge 8) {
                        Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force -ErrorAction Stop
                    }
                } else {
                    Copy-Item -LiteralPath $src -Destination $dest -Force -ErrorAction Stop
                }
            }

            $result.items += @{
                src = $src
                dest = $dest
                name = [System.IO.Path]::GetFileName($dest)
                success = $true
            }
        } catch {
            $result.items += @{
                src = $src
                dest = $dest
                name = [System.IO.Path]::GetFileName($src)
                success = $false
                error = $_.Exception.Message
            }
        }
    }

    $failed = ($result.items | Where-Object { -not $_.success }).Count
    if ($failed -eq 0) {
        $result.success = $true
    } else {
        $result.success = $false
        $result.error = "Some items failed to copy with administrator rights."
    }
} catch {
    $result.success = $false
    $result.error = $_.Exception.Message
} finally {
    if ($resPath) {
        $out = $result | ConvertTo-Json -Depth 5
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($resPath, $out, $utf8NoBom)
    }
}
`;

  await fs.writeFile(scriptFile, psScript, 'utf8');

  const launcherCmd = `
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ArgumentList @(
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', '${scriptFile.replace(/'/g, "''")}',
      '${configFile.replace(/'/g, "''")}'
  );
  if ($p.ExitCode -ne 0) {
    exit $p.ExitCode;
  }
} catch {
  [Console]::Error.WriteLine('UAC_CANCELLED');
  exit 1223;
}
`;

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', launcherCmd], {
      windowsHide: true,
    });

    let stderr = '';
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', async (code) => {
      try {
        if (code === 1223 || stderr.includes('UAC_CANCELLED') || stderr.includes('canceled by the user')) {
          resolve({
            success: false,
            cancelled: true,
            summary: 'Operation cancelled by user.'
          });
          return;
        }

        let resultData: any = null;
        try {
          if (fsSync.existsSync(resultFile)) {
            const raw = await fs.readFile(resultFile, 'utf8');
            resultData = JSON.parse(raw.replace(/^\uFEFF/, ''));
          }
        } catch (e) {
          console.error('Failed to read elevated result file:', e);
        }

        if (resultData && resultData.success) {
          resolve({
            success: true,
            items: resultData.items,
            summary: isCreateFolder
              ? `Created folder "${path.basename(items[0]?.dest)}"`
              : `Successfully ${isMove ? 'moved' : 'copied'} ${resultData.items?.length || 1} items with administrator privileges.`
          });
        } else {
          const errMsg = resultData?.error || `Elevation process exited with code ${code}`;
          resolve({
            success: false,
            error: errMsg,
            items: resultData?.items || []
          });
        }
      } finally {
        try { await fs.unlink(configFile); } catch {}
        try { await fs.unlink(scriptFile); } catch {}
        try { await fs.unlink(resultFile); } catch {}
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

ipcMain.handle('perform-elevated-op', async (_e, params) => {
  return performElevatedOperation(params);
});

ipcMain.handle('copy-files', async (_e, { sources, target }: { sources: string[]; target: string }) => {
  let targetDir = normalizeTargetDirectory(target);
  try {
    const tStat = await fs.stat(targetDir);
    if (!tStat.isDirectory()) {
      targetDir = path.dirname(targetDir);
    }
  } catch {}

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (mkdirErr: any) {
    if (mkdirErr.code === 'EPERM' || mkdirErr.code === 'EACCES') {
      return {
        success: false,
        requiresElevation: true,
        type: 'copy',
        target: targetDir,
        sources,
        summary: `Administrator permission is required to copy to "${targetDir}".`,
        errors: [`Permission denied creating or accessing "${targetDir}".`]
      };
    }
  }

  const results: Array<{ src: string; dest?: string; name: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (let idx = 0; idx < sources.length; idx++) {
    const src = sources[idx];
    const name = path.basename(src);

    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', {
        line: `Copying ${name} (${idx + 1}/${sources.length})...`,
        current: idx + 1,
        total: sources.length,
        fileName: name,
        phase: 'copying'
      });
    }

    try {
      try {
        await fs.access(src);
      } catch {
        throw new Error(`Source "${name}" does not exist or cannot be accessed.`);
      }

      const isSameFolder = path.dirname(path.resolve(src)).toLowerCase() === path.resolve(targetDir).toLowerCase();
      const dest = await getUniqueDestination(targetDir, name, isSameFolder);

      await copyItem(src, dest);
      results.push({ src, dest, name: path.basename(dest), success: true });
    } catch (err: any) {
      const friendlyMsg = friendlyErrorMessage(err, src);
      errors.push(friendlyMsg);
      results.push({ src, name, success: false, error: friendlyMsg });
      console.error(`Error copying ${src} to ${targetDir}:`, err);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  let summary = '';
  if (failureCount === 0) {
    summary = successCount === 1 
      ? `Successfully copied "${results[0]?.name}"` 
      : `Successfully copied ${successCount} items`;
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: summary, phase: 'complete', success: true });
    }
  } else if (successCount === 0) {
    summary = `Failed to copy ${sources.length === 1 ? `"${path.basename(sources[0])}"` : `${sources.length} items`}: ${errors[0]}`;
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: summary, phase: 'failed', success: false, errors });
    }
    const isPermissionError = errors.some(e => e.includes('Permission denied') || e.includes('administrator'));
    if (isPermissionError) {
      return {
        success: false,
        requiresElevation: true,
        type: 'copy',
        target: targetDir,
        sources,
        summary: `Administrator permission is required to copy to "${targetDir}".`,
        errors
      };
    }
    throw new Error(summary);
  } else {
    summary = `Copied ${successCount} of ${sources.length} items (${failureCount} failed).`;
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: summary, phase: 'partial', success: false, errors });
    }
  }

  return {
    success: failureCount === 0,
    type: 'copy',
    target: targetDir,
    items: results,
    summary,
    errors
  };
});

ipcMain.handle('move-files', async (_e, { sources, target }: { sources: string[]; target: string }) => {
  let targetDir = normalizeTargetDirectory(target);
  try {
    const tStat = await fs.stat(targetDir);
    if (!tStat.isDirectory()) {
      targetDir = path.dirname(targetDir);
    }
  } catch {}

  try {
    await fs.mkdir(targetDir, { recursive: true });
  } catch (mkdirErr: any) {
    if (mkdirErr.code === 'EPERM' || mkdirErr.code === 'EACCES') {
      return {
        success: false,
        requiresElevation: true,
        type: 'move',
        target: targetDir,
        sources,
        summary: `Administrator permission is required to move to "${targetDir}".`,
        errors: [`Permission denied creating or accessing "${targetDir}".`]
      };
    }
  }

  const results: Array<{ src: string; dest?: string; name: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (let idx = 0; idx < sources.length; idx++) {
    const src = sources[idx];
    const name = path.basename(src);

    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', {
        line: `Moving ${name} (${idx + 1}/${sources.length})...`,
        current: idx + 1,
        total: sources.length,
        fileName: name,
        phase: 'moving'
      });
    }

    try {
      try {
        await fs.access(src);
      } catch {
        throw new Error(`Source "${name}" does not exist or cannot be accessed.`);
      }

      const isSameFolder = path.dirname(path.resolve(src)).toLowerCase() === path.resolve(targetDir).toLowerCase();
      // Moving to the exact same folder is a safe no-op
      if (isSameFolder) {
        results.push({ src, dest: src, name, success: true });
        continue;
      }

      const dest = await getUniqueDestination(targetDir, name, false);

      let moved = false;
      try {
        await fs.rename(src, dest);
        moved = true;
      } catch (renameErr: any) {
        // Cross-volume (EXDEV) or locked rename: fall back to copy + remove
        if (renameErr.code === 'EXDEV' || renameErr.code === 'EPERM' || renameErr.code === 'EBUSY') {
          await copyItem(src, dest);
          await removeItem(src);
          moved = true;
        } else {
          throw renameErr;
        }
      }

      if (moved) {
        results.push({ src, dest, name: path.basename(dest), success: true });
      }
    } catch (err: any) {
      const friendlyMsg = friendlyErrorMessage(err, src);
      errors.push(friendlyMsg);
      results.push({ src, name, success: false, error: friendlyMsg });
      console.error(`Error moving ${src} to ${targetDir}:`, err);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  let summary = '';
  if (failureCount === 0) {
    summary = successCount === 1 
      ? `Successfully moved "${results[0]?.name}"` 
      : `Successfully moved ${successCount} items`;
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: summary, phase: 'complete', success: true });
    }
  } else if (successCount === 0) {
    summary = `Failed to move ${sources.length === 1 ? `"${path.basename(sources[0])}"` : `${sources.length} items`}: ${errors[0]}`;
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: summary, phase: 'failed', success: false, errors });
    }
    const isPermissionError = errors.some(e => e.includes('Permission denied') || e.includes('administrator'));
    if (isPermissionError) {
      return {
        success: false,
        requiresElevation: true,
        type: 'move',
        target: targetDir,
        sources,
        summary: `Administrator permission is required to move to "${targetDir}".`,
        errors
      };
    }
    throw new Error(summary);
  } else {
    summary = `Moved ${successCount} of ${sources.length} items (${failureCount} failed).`;
    if (mainWindow) {
      mainWindow.webContents.send('copy-progress', { line: summary, phase: 'partial', success: false, errors });
    }
  }

  return {
    success: failureCount === 0,
    type: 'move',
    target: targetDir,
    items: results,
    summary,
    errors
  };
});

ipcMain.handle('create-folder', async (_e, targetDir: string) => {
  try {
    const newPath = await createNewFolder(targetDir);
    return newPath;
  } catch (err: any) {
    console.error('create-folder failed for', targetDir, err);
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      return {
        success: false,
        requiresElevation: true,
        target: targetDir,
        error: 'Administrator permission required to create folder here.'
      };
    }
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
  // 1. Primary: Query Windows logical disks with volume names, capacity, and available space using WMI/CIM
  try {
    const { stdout } = await execAsync(
      'powershell -NoProfile -Command "@(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, VolumeName, Description, Size, FreeSpace) | ConvertTo-Json"'
    );
    const disks = JSON.parse(stdout || '[]');
    const arr = Array.isArray(disks) ? disks : [disks];
    const results = arr
      .filter((d: any) => d?.DeviceID && /^[A-Za-z]:/i.test(d.DeviceID))
      .map((d: any) => {
        let label = (d.VolumeName && typeof d.VolumeName === 'string' && d.VolumeName.trim()) ? d.VolumeName.trim() : undefined;
        if (!label) {
          if (d.Description === 'Removable Disk') label = 'Removable Disk';
          else if (d.Description === 'Local Fixed Disk') label = 'Local Disk';
          else if (d.Description && typeof d.Description === 'string' && d.Description.trim()) label = d.Description.trim();
        }
        return {
          name: d.DeviceID.replace(/\\$/, ''),  // e.g. "C:"
          path: d.DeviceID.endsWith('\\') ? d.DeviceID : (d.DeviceID + '\\'),
          label,
          size: d.Size != null && d.Size > 0 ? Number(d.Size) : undefined,
          freeSpace: d.FreeSpace != null ? Number(d.FreeSpace) : undefined,
        };
      });
    if (results.length > 0) return results;
  } catch (e) {
    console.error('get-drives CIM query failed, trying fallback', e);
  }

  // 2. Fallback: check common drives directly with fs.access
  const common = ['C:\\', 'D:\\', 'E:\\', 'F:\\', 'G:\\', 'H:\\'];
  const existing: Array<{ name: string; path: string; label?: string; size?: number; freeSpace?: number }> = [];
  for (const p of common) {
    try {
      await fs.access(p);
      const key = p[0];
      existing.push({ name: key + ':', path: p });
    } catch {}
  }
  return existing.length ? existing : [{ name: 'C:', path: 'C:\\' }];
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

// -------------------------------------------------------------
// Central Thumbnail Cache & File Preview System
// -------------------------------------------------------------

const THUMBNAIL_CACHE_DIR = path.join(app.getPath('userData'), 'thumbnails_cache');

try {
  fsSync.mkdirSync(THUMBNAIL_CACHE_DIR, { recursive: true });
} catch (err) {
  console.error('Failed to initialize thumbnail cache dir:', err);
}

const PREVIEWABLE_EXTENSIONS = new Set([
  // Images
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.ico', '.svg', '.tif', '.tiff', '.jfif', '.avif',
  // Videos
  '.mp4', '.mov', '.mkv', '.avi', '.wmv', '.webm', '.m4v', '.flv',
  // Documents
  '.pdf',
  // 3D Models
  '.glb', '.gltf', '.obj', '.stl', '.ply', '.fbx',
  // Gaussian Splats
  '.splat', '.ksplat', '.spz',
]);

function getThumbnailCacheKey(filePath: string, mtime: string, size?: number): string {
  return crypto.createHash('sha256').update(`${filePath}:${mtime}:${size || 0}:256`).digest('hex');
}

function getCachedThumbnailUrl(cachedPath: string): string {
  return `jabro-media://localhost?path=${encodeURIComponent(cachedPath)}`;
}

class ThumbnailWorkerQueue {
  private queue: Array<() => Promise<void>> = [];
  private activeCount = 0;
  private readonly maxConcurrency = 6;
  private inFlight = new Map<string, Promise<{ url?: string; hasPreview: boolean }>>();

  enqueue(key: string, fn: () => Promise<{ url?: string; hasPreview: boolean }>): Promise<{ url?: string; hasPreview: boolean }> {
    if (this.inFlight.has(key)) {
      return this.inFlight.get(key)!;
    }

    const promise = new Promise<{ url?: string; hasPreview: boolean }>((resolve) => {
      const task = async () => {
        try {
          const res = await fn();
          resolve(res);
        } catch (err) {
          console.error('[ThumbnailQueue] task failed for key', key, err);
          resolve({ hasPreview: false });
        } finally {
          this.activeCount--;
          this.inFlight.delete(key);
          this.dispatch();
        }
      };

      this.queue.push(task);
      this.dispatch();
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  private dispatch() {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        this.activeCount++;
        nextTask();
      }
    }
  }
}

const thumbnailQueue = new ThumbnailWorkerQueue();

async function generateThumbnailFile(filePath: string, cachedPath: string, ext: string): Promise<boolean> {
  const isDirectImage = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.ico', '.jfif'].includes(ext);

  try {
    await fs.mkdir(path.dirname(cachedPath), { recursive: true });
  } catch {}

  // 1. Direct native image decoding (ultra-fast for common raster images)
  if (isDirectImage) {
    try {
      const img = nativeImage.createFromPath(filePath);
      if (!img.isEmpty()) {
        const size = img.getSize();
        if (size.width > 0 && size.height > 0) {
          const maxDim = 256;
          let width = size.width;
          let height = size.height;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const resized = img.resize({ width: Math.max(1, width), height: Math.max(1, height), quality: 'good' });
          const jpegBuf = resized.toJPEG(82);
          await fs.writeFile(cachedPath, jpegBuf);
          return true;
        }
      }
    } catch (e) {
      // Fallback to shell thumbnail
    }
  }

  // 2. Windows shell thumbnail provider (nativeImage.createThumbnailFromPath)
  // Handles videos (.mp4, .mkv, .avi, etc.), PDFs, and images that createFromPath couldn't decode
  try {
    if (typeof nativeImage.createThumbnailFromPath === 'function') {
      const thumb = await nativeImage.createThumbnailFromPath(filePath, { width: 256, height: 256 });
      if (!thumb.isEmpty()) {
        const thumbSize = thumb.getSize();
        let processedThumb = thumb;
        if (thumbSize.width > 0 && thumbSize.height > 0 && thumbSize.width !== thumbSize.height) {
          const minDim = Math.min(thumbSize.width, thumbSize.height);
          const cropX = Math.round((thumbSize.width - minDim) / 2);
          const cropY = Math.round((thumbSize.height - minDim) / 2);
          processedThumb = thumb.crop({ x: cropX, y: cropY, width: minDim, height: minDim });
        }
        const jpegBuf = processedThumb.toJPEG(82);
        await fs.writeFile(cachedPath, jpegBuf);
        return true;
      }
    }
  } catch (e) {
    // Shell thumbnail failed
  }

  return false;
}

ipcMain.handle('get-thumbnail', async (_e, { filePath, mtime, size }: { filePath: string; mtime: string; size?: number }): Promise<{ url?: string; hasPreview: boolean }> => {
  if (!filePath) return { hasPreview: false };
  const ext = path.extname(filePath).toLowerCase();
  if (!PREVIEWABLE_EXTENSIONS.has(ext)) {
    return { hasPreview: false };
  }

  const cacheKey = getThumbnailCacheKey(filePath, mtime, size);
  const cachedPath = path.join(THUMBNAIL_CACHE_DIR, `${cacheKey}.jpg`);

  // Fast disk check
  if (fsSync.existsSync(cachedPath)) {
    return { url: getCachedThumbnailUrl(cachedPath), hasPreview: true };
  }

  return thumbnailQueue.enqueue(cacheKey, async () => {
    // Check again in case another worker just finished it
    if (fsSync.existsSync(cachedPath)) {
      return { url: getCachedThumbnailUrl(cachedPath), hasPreview: true };
    }

    const success = await generateThumbnailFile(filePath, cachedPath, ext);
    if (success) {
      return { url: getCachedThumbnailUrl(cachedPath), hasPreview: true };
    }
    return { hasPreview: false };
  });
});

ipcMain.handle('get-thumbnails-batch', async (_e, items: Array<{ filePath: string; mtime: string; size?: number }>): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  if (!Array.isArray(items)) return result;

  for (const item of items) {
    if (!item?.filePath) continue;
    const ext = path.extname(item.filePath).toLowerCase();
    if (!PREVIEWABLE_EXTENSIONS.has(ext)) continue;

    const cacheKey = getThumbnailCacheKey(item.filePath, item.mtime, item.size);
    const cachedPath = path.join(THUMBNAIL_CACHE_DIR, `${cacheKey}.jpg`);
    if (fsSync.existsSync(cachedPath)) {
      result[item.filePath] = getCachedThumbnailUrl(cachedPath);
    }
  }

  return result;
});

// Fast snippet reader for text & code previews (reads up to first ~800 bytes)
ipcMain.handle('read-file-snippet', async (_e, filePath: string, maxChars = 240): Promise<string> => {
  try {
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(buffer, 0, 1024, 0);
    await handle.close();
    const str = buffer.toString('utf8', 0, bytesRead);
    return str.slice(0, maxChars);
  } catch {
    return '';
  }
});

// Thumbnail cache statistics
ipcMain.handle('get-thumbnail-cache-stats', async (): Promise<{ count: number; sizeBytes: number; cachePath: string }> => {
  try {
    const files = await fs.readdir(THUMBNAIL_CACHE_DIR);
    let totalSize = 0;
    let count = 0;
    for (const f of files) {
      if (f.endsWith('.jpg') || f.endsWith('.webp')) {
        count++;
        try {
          const st = await fs.stat(path.join(THUMBNAIL_CACHE_DIR, f));
          totalSize += st.size;
        } catch {}
      }
    }
    return { count, sizeBytes: totalSize, cachePath: THUMBNAIL_CACHE_DIR };
  } catch {
    return { count: 0, sizeBytes: 0, cachePath: THUMBNAIL_CACHE_DIR };
  }
});

// Clear thumbnail cache
ipcMain.handle('clear-thumbnail-cache', async (): Promise<{ success: boolean; count: number; clearedBytes: number }> => {
  try {
    const files = await fs.readdir(THUMBNAIL_CACHE_DIR);
    let clearedBytes = 0;
    let count = 0;
    for (const f of files) {
      if (f.endsWith('.jpg') || f.endsWith('.webp')) {
        const fp = path.join(THUMBNAIL_CACHE_DIR, f);
        try {
          const st = await fs.stat(fp);
          clearedBytes += st.size;
          await fs.unlink(fp);
          count++;
        } catch {}
      }
    }
    return { success: true, count, clearedBytes };
  } catch (err: any) {
    console.error('Failed to clear thumbnail cache:', err);
    return { success: false, count: 0, clearedBytes: 0 };
  }
});

ipcMain.handle('open-thumbnail-cache-folder', async (): Promise<void> => {
  try {
    await shell.openPath(THUMBNAIL_CACHE_DIR);
  } catch (err) {
    console.error('Failed to open thumbnail cache folder:', err);
  }
});

// Save a direct rendered snapshot (e.g. from 3D viewer or Gaussian Splat canvas) to the central thumbnail cache
ipcMain.handle('save-thumbnail-cache', async (_e, { filePath, dataUrl, mtime, size }: { filePath: string; dataUrl: string; mtime?: string; size?: number }): Promise<boolean> => {
  try {
    if (!filePath || !dataUrl) return false;
    let base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(base64Data, 'base64');

    let statMtime = mtime;
    let statSize = size;
    if (!statMtime || statSize == null) {
      try {
        const st = await fs.stat(filePath);
        statMtime = st.mtime.toISOString();
        statSize = st.size;
      } catch {
        statMtime = new Date().toISOString();
        statSize = 0;
      }
    }

    const cacheKey = getThumbnailCacheKey(filePath, statMtime, statSize);
    const cachedPath = path.join(THUMBNAIL_CACHE_DIR, `${cacheKey}.jpg`);
    await fs.mkdir(path.dirname(cachedPath), { recursive: true });

    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return false;

    // Center-square crop to ensure 1:1 aspect ratio with zero distortion or squishing
    const imgSize = img.getSize();
    let squareImg = img;
    if (imgSize.width > 0 && imgSize.height > 0 && imgSize.width !== imgSize.height) {
      const minDim = Math.min(imgSize.width, imgSize.height);
      const cropX = Math.round((imgSize.width - minDim) / 2);
      const cropY = Math.round((imgSize.height - minDim) / 2);
      squareImg = img.crop({ x: cropX, y: cropY, width: minDim, height: minDim });
    }

    const jpegBuf = squareImg.resize({ width: 256, height: 256, quality: 'best' }).toJPEG(85);
    await fs.writeFile(cachedPath, jpegBuf);
    return true;
  } catch (err) {
    console.error('save-thumbnail-cache failed:', err);
    return false;
  }
});

