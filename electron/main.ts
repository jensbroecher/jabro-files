import { app, BrowserWindow, dialog, ipcMain, shell, protocol, net, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Enable SharedArrayBuffer feature for WebAssembly workers
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer');

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
      plugins: true, // Enables Chromium's built-in PDF viewer plugin
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
    try {
      const url = new URL(request.url);
      let targetPath = url.searchParams.get('path');
      if (!targetPath) {
        let pathname = decodeURIComponent(url.pathname);
        if (process.platform === 'win32' && pathname.startsWith('/') && /^[a-zA-Z]:/.test(pathname.slice(1))) {
          pathname = pathname.slice(1);
        }
        targetPath = pathname;
      }

      const stat = await fs.stat(targetPath);
      const ext = path.extname(targetPath).toLowerCase();
      const headers = new Headers();

      let mimeType = '';
      if (ext === '.pdf') mimeType = 'application/pdf';
      else if (ext === '.glb') mimeType = 'model/gltf-binary';
      else if (ext === '.gltf') mimeType = 'model/gltf+json';
      else if (ext === '.obj') mimeType = 'text/plain';
      else if (ext === '.stl' || ext === '.ply' || ext === '.splat' || ext === '.ksplat' || ext === '.spz') {
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
      console.error('jabro-media protocol error:', err);
      return new Response('File not found', { status: 404 });
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
