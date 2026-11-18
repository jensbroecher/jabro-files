import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { Writable } from 'node:stream';
import { Client as FtpClient, FileType } from 'basic-ftp';
import SftpClient from 'ssh2-sftp-client';

export type RemoteProtocol = 'sftp' | 'ftp' | 'ftps';
export type RemoteAuthType = 'password' | 'privateKey' | 'agent';

interface EncryptedSecret {
  method: 'safeStorage' | 'plain';
  value: string;
}

interface StoredRemoteConnection {
  id: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  authType: RemoteAuthType;
  password?: EncryptedSecret;
  privateKeyPath?: string;
  passphrase?: EncryptedSecret;
  initialPath?: string;
  rejectUnauthorized?: boolean;
  createdAt: string;
}

export interface RemoteConnectionInput {
  id?: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  authType: RemoteAuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  initialPath?: string;
  rejectUnauthorized?: boolean;
  keepExistingSecrets?: boolean;
}

export interface PublicRemoteConnection {
  id: string;
  name: string;
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  authType: RemoteAuthType;
  privateKeyPath?: string;
  initialPath?: string;
  rejectUnauthorized?: boolean;
  hasPassword: boolean;
  hasPassphrase: boolean;
  connected: boolean;
  lastError?: string;
  createdAt: string;
}

export interface RemoteDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  fileCount?: number;
  dirCount?: number;
  mtime: string;
  ext?: string;
  permissions?: string;
}

export interface TransferProgressInfo {
  line: string;
  current?: number;
  total?: number;
  fileName?: string;
  phase?: string;
  success?: boolean;
  errors?: string[];
}

const REMOTE_URI_RE = /^(sftp|ftps?):\/\/([^/]+)(\/.*)?$/i;

export function isRemoteUri(p: string): boolean {
  return typeof p === 'string' && REMOTE_URI_RE.test(p.trim());
}

export function normalizePosixPath(p: string): string {
  const parts = (p || '/').split('/').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return '/' + stack.join('/');
}

export function parseRemoteUri(p: string): { protocol: RemoteProtocol; connectionId: string; remotePath: string } | null {
  if (!p || typeof p !== 'string') return null;
  const m = REMOTE_URI_RE.exec(p.trim());
  if (!m) return null;
  return {
    protocol: m[1].toLowerCase() as RemoteProtocol,
    connectionId: m[2],
    remotePath: normalizePosixPath(m[3] || '/'),
  };
}

export function buildRemoteUri(protocol: RemoteProtocol, connectionId: string, remotePath: string): string {
  return `${protocol}://${connectionId}${normalizePosixPath(remotePath)}`;
}

function joinPosix(dir: string, name: string): string {
  const cleanDir = normalizePosixPath(dir);
  return cleanDir === '/' ? `/${name}` : `${cleanDir}/${name}`;
}

function dirNamePosix(p: string): string {
  const clean = normalizePosixPath(p);
  if (clean === '/') return '/';
  const idx = clean.lastIndexOf('/');
  return idx <= 0 ? '/' : clean.slice(0, idx);
}

function baseNamePosix(p: string): string {
  const clean = normalizePosixPath(p);
  if (clean === '/') return '/';
  const idx = clean.lastIndexOf('/');
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

function getConnectionsFilePath(): string {
  return path.join(app.getPath('userData'), 'remote-connections.json');
}

function getPreviewTempDir(): string {
  return path.join(os.tmpdir(), 'jabro-remote-preview');
}

function encryptSecret(plain?: string): EncryptedSecret | undefined {
  if (!plain) return undefined;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plain);
      return { method: 'safeStorage', value: buf.toString('base64') };
    }
  } catch (err) {
    console.warn('[Remote] safeStorage encrypt failed, using fallback encoding:', err);
  }
  return { method: 'plain', value: Buffer.from(plain, 'utf8').toString('base64') };
}

function decryptSecret(secret?: EncryptedSecret): string | undefined {
  if (!secret || !secret.value) return undefined;
  try {
    if (secret.method === 'safeStorage') {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(secret.value, 'base64'));
      }
      return undefined;
    }
    return Buffer.from(secret.value, 'base64').toString('utf8');
  } catch (err) {
    console.warn('[Remote] decryptSecret failed:', err);
    return undefined;
  }
}

interface ActiveSession {
  connectionId: string;
  protocol: RemoteProtocol;
  sftp?: SftpClient;
  ftp?: FtpClient;
  queue: Promise<any>;
}

const activeSessions = new Map<string, ActiveSession>();
const lastErrors = new Map<string, string>();
let storedCache: StoredRemoteConnection[] | null = null;

async function loadStoredConnections(): Promise<StoredRemoteConnection[]> {
  if (storedCache) return storedCache;
  const filePath = getConnectionsFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    storedCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    storedCache = [];
  }
  return storedCache;
}

async function saveStoredConnections(list: StoredRemoteConnection[]): Promise<void> {
  storedCache = list;
  const filePath = getConnectionsFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(list, null, 2), 'utf8');
}

function toPublicConnection(c: StoredRemoteConnection): PublicRemoteConnection {
  return {
    id: c.id,
    name: c.name,
    protocol: c.protocol,
    host: c.host,
    port: c.port,
    username: c.username,
    authType: c.authType,
    privateKeyPath: c.privateKeyPath,
    initialPath: c.initialPath,
    rejectUnauthorized: c.rejectUnauthorized,
    hasPassword: Boolean(c.password?.value),
    hasPassphrase: Boolean(c.passphrase?.value),
    connected: activeSessions.has(c.id),
    lastError: lastErrors.get(c.id),
    createdAt: c.createdAt,
  };
}

export async function listConnections(): Promise<PublicRemoteConnection[]> {
  const list = await loadStoredConnections();
  return list.map(toPublicConnection);
}

export async function saveConnection(input: RemoteConnectionInput): Promise<PublicRemoteConnection> {
  const list = await loadStoredConnections();
  const existing = input.id ? list.find(c => c.id === input.id) : undefined;
  const id = existing?.id || input.id || `srv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const protocol: RemoteProtocol = input.protocol || 'sftp';
  const defaultPort = protocol === 'sftp' ? 22 : 21;
  const port = Number(input.port) > 0 ? Number(input.port) : defaultPort;

  const passwordSecret = input.password
    ? encryptSecret(input.password)
    : (input.keepExistingSecrets && existing ? existing.password : undefined);

  const passphraseSecret = input.passphrase
    ? encryptSecret(input.passphrase)
    : (input.keepExistingSecrets && existing ? existing.passphrase : undefined);

  const record: StoredRemoteConnection = {
    id,
    name: (input.name || input.host || 'Remote Server').trim(),
    protocol,
    host: (input.host || '').trim(),
    port,
    username: (input.username || '').trim(),
    authType: protocol === 'sftp' ? (input.authType || 'password') : 'password',
    password: passwordSecret,
    privateKeyPath: input.privateKeyPath?.trim() || undefined,
    passphrase: passphraseSecret,
    initialPath: input.initialPath?.trim() || '/',
    rejectUnauthorized: Boolean(input.rejectUnauthorized),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  // Disconnect existing active session if editing an open connection
  if (existing) {
    await disconnectConnection(id);
  }
  lastErrors.delete(id);

  const next = existing
    ? list.map(c => (c.id === id ? record : c))
    : [...list, record];
  await saveStoredConnections(next);
  return toPublicConnection(record);
}

export async function deleteConnection(connectionId: string): Promise<boolean> {
  await disconnectConnection(connectionId);
  lastErrors.delete(connectionId);
  const list = await loadStoredConnections();
  const next = list.filter(c => c.id !== connectionId);
  await saveStoredConnections(next);
  return true;
}

async function resolveConnectMaterial(input: RemoteConnectionInput): Promise<{
  protocol: RemoteProtocol;
  host: string;
  port: number;
  username: string;
  authType: RemoteAuthType;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  initialPath: string;
  rejectUnauthorized: boolean;
}> {
  const list = await loadStoredConnections();
  const existing = input.id ? list.find(c => c.id === input.id) : undefined;
  const password = input.password || (input.keepExistingSecrets && existing ? decryptSecret(existing.password) : undefined);
  const passphrase = input.passphrase || (input.keepExistingSecrets && existing ? decryptSecret(existing.passphrase) : undefined);
  const protocol = input.protocol || 'sftp';
  return {
    protocol,
    host: (input.host || '').trim(),
    port: Number(input.port) > 0 ? Number(input.port) : (protocol === 'sftp' ? 22 : 21),
    username: (input.username || '').trim(),
    authType: protocol === 'sftp' ? (input.authType || 'password') : 'password',
    password,
    privateKeyPath: input.privateKeyPath?.trim() || existing?.privateKeyPath,
    passphrase,
    initialPath: input.initialPath?.trim() || '/',
    rejectUnauthorized: Boolean(input.rejectUnauthorized),
  };
}

async function createRawClient(mat: Awaited<ReturnType<typeof resolveConnectMaterial>>): Promise<{
  sftp?: SftpClient;
  ftp?: FtpClient;
  resolvedInitialPath: string;
}> {
  if (!mat.host) throw new Error('Host is required.');

  if (mat.protocol === 'sftp') {
    const sftp = new SftpClient();
    const connectOpts: SftpClient.ConnectOptions = {
      host: mat.host,
      port: mat.port,
      username: mat.username || undefined,
      readyTimeout: 15000,
      retries: 1,
    };

    if (mat.authType === 'privateKey') {
      if (!mat.privateKeyPath) {
        throw new Error('Private key file path is required for key authentication.');
      }
      connectOpts.privateKey = await fs.readFile(mat.privateKeyPath);
      if (mat.passphrase) connectOpts.passphrase = mat.passphrase;
    } else if (mat.authType === 'agent') {
      connectOpts.agent = process.env.SSH_AUTH_SOCK;
      if (!connectOpts.agent && process.platform === 'win32') {
        connectOpts.agent = 'pageant';
      }
    } else {
      connectOpts.password = mat.password || '';
    }

    await sftp.connect(connectOpts);
    let resolvedInitialPath = normalizePosixPath(mat.initialPath || '/');
    try {
      if (!mat.initialPath || mat.initialPath === '.' || mat.initialPath === '~') {
        resolvedInitialPath = normalizePosixPath(await sftp.cwd());
      } else {
        const exists = await sftp.exists(resolvedInitialPath);
        if (!exists) resolvedInitialPath = normalizePosixPath(await sftp.cwd());
      }
    } catch {
      resolvedInitialPath = '/';
    }
    return { sftp, resolvedInitialPath };
  }

  // FTP or FTPS
  const ftp = new FtpClient(20000);
  await ftp.access({
    host: mat.host,
    port: mat.port,
    user: mat.username || 'anonymous',
    password: mat.password || 'anonymous@',
    secure: mat.protocol === 'ftps',
    secureOptions: mat.protocol === 'ftps'
      ? { rejectUnauthorized: mat.rejectUnauthorized }
      : undefined,
  });

  let resolvedInitialPath = normalizePosixPath(mat.initialPath || '/');
  try {
    if (!mat.initialPath || mat.initialPath === '.') {
      resolvedInitialPath = normalizePosixPath(await ftp.pwd());
    } else {
      await ftp.cd(resolvedInitialPath);
      resolvedInitialPath = normalizePosixPath(await ftp.pwd());
    }
  } catch {
    try {
      resolvedInitialPath = normalizePosixPath(await ftp.pwd());
    } catch {
      resolvedInitialPath = '/';
    }
  }
  return { ftp, resolvedInitialPath };
}

export async function testConnection(input: RemoteConnectionInput): Promise<{ success: boolean; resolvedPath?: string; error?: string }> {
  const mat = await resolveConnectMaterial(input);
  let created: { sftp?: SftpClient; ftp?: FtpClient; resolvedInitialPath: string } | null = null;
  try {
    created = await createRawClient(mat);
    return { success: true, resolvedPath: created.resolvedInitialPath };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  } finally {
    try { await created?.sftp?.end(); } catch {}
    try { created?.ftp?.close(); } catch {}
  }
}

async function getStoredById(connectionId: string): Promise<StoredRemoteConnection> {
  const list = await loadStoredConnections();
  const found = list.find(c => c.id === connectionId);
  if (!found) {
    throw new Error(`Remote server "${connectionId}" was not found.`);
  }
  return found;
}

async function createSessionFromStored(stored: StoredRemoteConnection): Promise<ActiveSession> {
  const mat = await resolveConnectMaterial({
    id: stored.id,
    name: stored.name,
    protocol: stored.protocol,
    host: stored.host,
    port: stored.port,
    username: stored.username,
    authType: stored.authType,
    privateKeyPath: stored.privateKeyPath,
    initialPath: stored.initialPath,
    rejectUnauthorized: stored.rejectUnauthorized,
    keepExistingSecrets: true,
  });
  const created = await createRawClient(mat);
  const session: ActiveSession = {
    connectionId: stored.id,
    protocol: stored.protocol,
    sftp: created.sftp,
    ftp: created.ftp,
    queue: Promise.resolve(),
  };
  activeSessions.set(stored.id, session);
  lastErrors.delete(stored.id);
  return session;
}

async function ensureSession(connectionId: string): Promise<ActiveSession> {
  const existing = activeSessions.get(connectionId);
  if (existing) {
    if (existing.protocol === 'sftp' && existing.sftp) {
      return existing;
    }
    if ((existing.protocol === 'ftp' || existing.protocol === 'ftps') && existing.ftp && !existing.ftp.closed) {
      return existing;
    }
    activeSessions.delete(connectionId);
  }
  const stored = await getStoredById(connectionId);
  try {
    return await createSessionFromStored(stored);
  } catch (err: any) {
    lastErrors.set(connectionId, err?.message || String(err));
    throw err;
  }
}

async function runSerialized<T>(connectionId: string, fn: (session: ActiveSession) => Promise<T>): Promise<T> {
  let session = await ensureSession(connectionId);
  const run = async (): Promise<T> => {
    try {
      return await fn(session);
    } catch (err: any) {
      const msg = String(err?.message || err || '');
      const isDropped =
        (session.ftp && session.ftp.closed) ||
        /No SFTP connection|Not connected|ECONNRESET|EPIPE|ETIMEDOUT|Connection lost|closed|socket/i.test(msg);
      if (!isDropped) throw err;

      // Reconnect once transparently
      await disconnectConnection(connectionId);
      session = await ensureSession(connectionId);
      return await fn(session);
    }
  };

  const next = session.queue.then(run, run);
  session.queue = next.catch(() => {});
  return next;
}

export async function connectConnection(connectionId: string): Promise<{
  success: boolean;
  rootUri?: string;
  initialUri?: string;
  error?: string;
}> {
  try {
    const stored = await getStoredById(connectionId);
    await disconnectConnection(connectionId);
    const mat = await resolveConnectMaterial({
      id: stored.id,
      name: stored.name,
      protocol: stored.protocol,
      host: stored.host,
      port: stored.port,
      username: stored.username,
      authType: stored.authType,
      privateKeyPath: stored.privateKeyPath,
      initialPath: stored.initialPath,
      rejectUnauthorized: stored.rejectUnauthorized,
      keepExistingSecrets: true,
    });
    const created = await createRawClient(mat);
    const session: ActiveSession = {
      connectionId: stored.id,
      protocol: stored.protocol,
      sftp: created.sftp,
      ftp: created.ftp,
      queue: Promise.resolve(),
    };
    activeSessions.set(stored.id, session);
    lastErrors.delete(stored.id);
    return {
      success: true,
      rootUri: buildRemoteUri(stored.protocol, stored.id, '/'),
      initialUri: buildRemoteUri(stored.protocol, stored.id, created.resolvedInitialPath),
    };
  } catch (err: any) {
    const message = err?.message || String(err);
    lastErrors.set(connectionId, message);
    return { success: false, error: message };
  }
}

export async function disconnectConnection(connectionId: string): Promise<void> {
  const session = activeSessions.get(connectionId);
  if (!session) return;
  activeSessions.delete(connectionId);
  try { await session.sftp?.end(); } catch {}
  try { session.ftp?.close(); } catch {}
}

export async function disconnectAll(): Promise<void> {
  const ids = Array.from(activeSessions.keys());
  await Promise.all(ids.map(id => disconnectConnection(id)));
}

function formatRights(rights?: { user: string; group: string; other: string }): string | undefined {
  if (!rights) return undefined;
  return `${rights.user || '---'}${rights.group || '---'}${rights.other || '---'}`;
}

export async function listRemoteDirectory(uri: string): Promise<RemoteDirEntry[]> {
  const parsed = parseRemoteUri(uri);
  if (!parsed) throw new Error(`Invalid remote URI: ${uri}`);

  return runSerialized(parsed.connectionId, async (session) => {
    const results: RemoteDirEntry[] = [];

    if (session.sftp) {
      const list = await session.sftp.list(parsed.remotePath);
      for (const item of list) {
        if (!item.name || item.name === '.' || item.name === '..') continue;
        const itemPath = joinPosix(parsed.remotePath, item.name);
        let isDirectory = item.type === 'd';
        let size = item.size;
        if (item.type === 'l') {
          try {
            const st = await session.sftp.stat(itemPath);
            isDirectory = st.isDirectory;
            size = st.size;
          } catch {
            // Broken symlink or inaccessible target; treat as file
          }
        }
        const ext = isDirectory ? undefined : (path.posix.extname(item.name).toLowerCase() || undefined);
        results.push({
          name: item.name,
          path: buildRemoteUri(parsed.protocol, parsed.connectionId, itemPath),
          isDirectory,
          size: isDirectory ? undefined : size,
          mtime: new Date(item.modifyTime || Date.now()).toISOString(),
          ext,
          permissions: formatRights(item.rights),
        });
      }
      return results;
    }

    if (session.ftp) {
      const list = await session.ftp.list(parsed.remotePath);
      for (const item of list) {
        if (!item.name || item.name === '.' || item.name === '..') continue;
        const isDirectory = item.isDirectory || item.type === FileType.Directory;
        const itemPath = joinPosix(parsed.remotePath, item.name);
        const ext = isDirectory ? undefined : (path.posix.extname(item.name).toLowerCase() || undefined);
        results.push({
          name: item.name,
          path: buildRemoteUri(parsed.protocol, parsed.connectionId, itemPath),
          isDirectory,
          size: isDirectory ? undefined : (item.size ?? 0),
          mtime: (item.modifiedAt || new Date()).toISOString(),
          ext,
        });
      }
      return results;
    }

    throw new Error('Remote session is not initialized.');
  });
}

export async function getRemoteFolderSize(uri: string): Promise<{ size: number; fileCount: number; dirCount: number }> {
  const parsed = parseRemoteUri(uri);
  if (!parsed) throw new Error(`Invalid remote URI: ${uri}`);

  return runSerialized(parsed.connectionId, async (session) => {
    let totalSize = 0;
    let fileCount = 0;
    let dirCount = 0;
    const visited = new Set<string>();
    const stack: string[] = [parsed.remotePath];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (session.sftp) {
        let list: SftpClient.FileInfo[] = [];
        try {
          list = await session.sftp.list(current);
        } catch {
          continue;
        }
        for (const item of list) {
          if (!item.name || item.name === '.' || item.name === '..') continue;
          if (item.type === 'l') continue; // skip symlinks to avoid cycles
          const child = joinPosix(current, item.name);
          if (item.type === 'd') {
            dirCount++;
            stack.push(child);
          } else {
            fileCount++;
            totalSize += item.size || 0;
          }
        }
      } else if (session.ftp) {
        let list: Awaited<ReturnType<FtpClient['list']>> = [];
        try {
          list = await session.ftp.list(current);
        } catch {
          continue;
        }
        for (const item of list) {
          if (!item.name || item.name === '.' || item.name === '..') continue;
          if (item.isSymbolicLink) continue;
          const child = joinPosix(current, item.name);
          if (item.isDirectory || item.type === FileType.Directory) {
            dirCount++;
            stack.push(child);
          } else {
            fileCount++;
            totalSize += item.size || 0;
          }
        }
      }
    }

    return { size: totalSize, fileCount, dirCount };
  });
}

export async function createRemoteFolder(parentUri: string, customName?: string): Promise<string> {
  const parsed = parseRemoteUri(parentUri);
  if (!parsed) throw new Error(`Invalid remote URI: ${parentUri}`);

  return runSerialized(parsed.connectionId, async (session) => {
    const existingNames = new Set<string>();
    if (session.sftp) {
      const list = await session.sftp.list(parsed.remotePath);
      for (const item of list) existingNames.add(item.name);
    } else if (session.ftp) {
      const list = await session.ftp.list(parsed.remotePath);
      for (const item of list) existingNames.add(item.name);
    }

    const base = (customName || 'New folder').trim();
    let candidate = base;
    let counter = 1;
    while (existingNames.has(candidate)) {
      candidate = `${base} (${counter})`;
      counter++;
    }

    const targetPosix = joinPosix(parsed.remotePath, candidate);
    if (session.sftp) {
      await session.sftp.mkdir(targetPosix, true);
    } else if (session.ftp) {
      const cwdBefore = await session.ftp.pwd().catch(() => '/');
      await session.ftp.ensureDir(targetPosix);
      await session.ftp.cd(cwdBefore).catch(() => {});
    }

    return buildRemoteUri(parsed.protocol, parsed.connectionId, targetPosix);
  });
}

export async function renameRemoteItem(uri: string, newName: string): Promise<{ success: boolean; oldPath: string; newPath: string }> {
  const parsed = parseRemoteUri(uri);
  if (!parsed) throw new Error(`Invalid remote URI: ${uri}`);
  const cleanName = newName.trim().replace(/[\\/]/g, '');
  if (!cleanName || cleanName === '.' || cleanName === '..') {
    throw new Error('Invalid file or folder name.');
  }
  const destPosix = joinPosix(dirNamePosix(parsed.remotePath), cleanName);
  const newUri = buildRemoteUri(parsed.protocol, parsed.connectionId, destPosix);
  if (destPosix === parsed.remotePath) {
    return { success: true, oldPath: uri, newPath: newUri };
  }

  await runSerialized(parsed.connectionId, async (session) => {
    if (session.sftp) {
      const exists = await session.sftp.exists(destPosix);
      if (exists) throw new Error(`An item named "${cleanName}" already exists.`);
      await session.sftp.rename(parsed.remotePath, destPosix);
    } else if (session.ftp) {
      await session.ftp.rename(parsed.remotePath, destPosix);
    }
  });

  return { success: true, oldPath: uri, newPath: newUri };
}

async function deletePosixItem(session: ActiveSession, remotePath: string): Promise<void> {
  if (session.sftp) {
    const kind = await session.sftp.exists(remotePath);
    if (!kind) return;
    if (kind === 'd') {
      await session.sftp.rmdir(remotePath, true);
    } else {
      await session.sftp.delete(remotePath);
    }
    return;
  }

  if (session.ftp) {
    const parent = dirNamePosix(remotePath);
    const name = baseNamePosix(remotePath);
    const list = await session.ftp.list(parent);
    const match = list.find(i => i.name === name);
    if (match && (match.isDirectory || match.type === FileType.Directory)) {
      await session.ftp.removeDir(remotePath);
    } else {
      await session.ftp.remove(remotePath);
    }
  }
}

export async function deleteRemoteItems(uris: string[]): Promise<{
  success: boolean;
  items: Array<{ path: string; name: string; success: boolean; error?: string }>;
  summary: string;
  errors: string[];
}> {
  const results: Array<{ path: string; name: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (const uri of uris) {
    const parsed = parseRemoteUri(uri);
    const name = baseNamePosix(parsed?.remotePath || uri);
    if (!parsed) {
      const msg = `Invalid remote path: ${uri}`;
      errors.push(msg);
      results.push({ path: uri, name, success: false, error: msg });
      continue;
    }
    try {
      await runSerialized(parsed.connectionId, async (session) => {
        await deletePosixItem(session, parsed.remotePath);
      });
      results.push({ path: uri, name, success: true });
    } catch (err: any) {
      const msg = err?.message || String(err);
      errors.push(`Failed to delete "${name}": ${msg}`);
      results.push({ path: uri, name, success: false, error: msg });
    }
  }

  const okCount = results.filter(r => r.success).length;
  const failCount = results.length - okCount;
  const summary = failCount === 0
    ? (okCount === 1 ? `Deleted "${results[0].name}" from server` : `Deleted ${okCount} items from server`)
    : `Deleted ${okCount} of ${results.length} items (${failCount} failed).`;

  return { success: failCount === 0, items: results, summary, errors };
}

async function downloadFtpToBuffer(ftp: FtpClient, remotePath: string, maxBytes?: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (maxBytes && total + buf.length > maxBytes) {
        callback(new Error('FILE_TOO_LARGE'));
        return;
      }
      total += buf.length;
      chunks.push(buf);
      callback();
    },
  });
  await ftp.downloadTo(writable, remotePath);
  return Buffer.concat(chunks);
}

export async function readRemoteTextFile(uri: string, maxBytes = 1024 * 1024): Promise<string> {
  const parsed = parseRemoteUri(uri);
  if (!parsed) throw new Error(`Invalid remote URI: ${uri}`);

  return runSerialized(parsed.connectionId, async (session) => {
    if (session.sftp) {
      const st = await session.sftp.stat(parsed.remotePath);
      if (st.size > maxBytes) {
        return '[File too large to preview as text. Download or "Save as..." to inspect locally.]';
      }
      const data = await session.sftp.get(parsed.remotePath);
      if (Buffer.isBuffer(data)) return data.toString('utf8');
      return String(data || '');
    }

    if (session.ftp) {
      try {
        const size = await session.ftp.size(parsed.remotePath).catch(() => 0);
        if (size > maxBytes) {
          return '[File too large to preview as text. Download or "Save as..." to inspect locally.]';
        }
        const buf = await downloadFtpToBuffer(session.ftp, parsed.remotePath, maxBytes);
        return buf.toString('utf8');
      } catch (err: any) {
        if (err?.message === 'FILE_TOO_LARGE') {
          return '[File too large to preview as text. Download or "Save as..." to inspect locally.]';
        }
        throw err;
      }
    }

    throw new Error('Remote session unavailable.');
  });
}

export async function downloadRemoteToLocalFile(
  remoteUri: string,
  localDestPath: string,
  onProgress?: (info: TransferProgressInfo) => void
): Promise<void> {
  const parsed = parseRemoteUri(remoteUri);
  if (!parsed) throw new Error(`Invalid remote URI: ${remoteUri}`);

  await fs.mkdir(path.dirname(localDestPath), { recursive: true });
  const fileName = baseNamePosix(parsed.remotePath);

  await runSerialized(parsed.connectionId, async (session) => {
    if (session.sftp) {
      let lastPct = -1;
      await session.sftp.fastGet(parsed.remotePath, localDestPath, {
        step: (transferred, _chunk, total) => {
          if (onProgress && total > 0) {
            const pct = Math.floor((transferred / total) * 100);
            if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
              lastPct = pct;
              onProgress({ line: `Downloading ${fileName} (${pct}%)`, fileName, phase: 'downloading' });
            }
          }
        },
      });
    } else if (session.ftp) {
      session.ftp.trackProgress((info) => {
        if (onProgress) {
          onProgress({
            line: `Downloading ${fileName} (${Math.round(info.bytes / 1024)} KB)...`,
            fileName,
            phase: 'downloading',
          });
        }
      });
      try {
        await session.ftp.downloadTo(localDestPath, parsed.remotePath);
      } finally {
        session.ftp.trackProgress();
      }
    }
  });
}

export async function downloadRemoteToTempPreview(remoteUri: string): Promise<string> {
  const parsed = parseRemoteUri(remoteUri);
  if (!parsed) throw new Error(`Invalid remote URI: ${remoteUri}`);
  const tempDir = getPreviewTempDir();
  await fs.mkdir(tempDir, { recursive: true });
  const hash = crypto.createHash('sha1').update(remoteUri).digest('hex').slice(0, 12);
  const safeName = baseNamePosix(parsed.remotePath).replace(/[<>:"/\\|?*]/g, '_');
  const localTempPath = path.join(tempDir, `${hash}_${safeName}`);
  await downloadRemoteToLocalFile(remoteUri, localTempPath);
  return localTempPath;
}

async function uploadLocalFileToRemote(
  session: ActiveSession,
  localSrcPath: string,
  remoteDestPosix: string,
  onProgress?: (info: TransferProgressInfo) => void
): Promise<void> {
  const fileName = path.basename(localSrcPath);
  if (session.sftp) {
    let lastPct = -1;
    await session.sftp.fastPut(localSrcPath, remoteDestPosix, {
      step: (transferred, _chunk, total) => {
        if (onProgress && total > 0) {
          const pct = Math.floor((transferred / total) * 100);
          if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
            lastPct = pct;
            onProgress({ line: `Uploading ${fileName} (${pct}%)`, fileName, phase: 'uploading' });
          }
        }
      },
    });
  } else if (session.ftp) {
    session.ftp.trackProgress((info) => {
      if (onProgress) {
        onProgress({
          line: `Uploading ${fileName} (${Math.round(info.bytes / 1024)} KB)...`,
          fileName,
          phase: 'uploading',
        });
      }
    });
    try {
      await session.ftp.uploadFrom(localSrcPath, remoteDestPosix);
    } finally {
      session.ftp.trackProgress();
    }
  }
}

async function getUniqueRemoteDestPosix(
  session: ActiveSession,
  targetDirPosix: string,
  name: string,
  isSameDir: boolean
): Promise<string> {
  const existingNames = new Set<string>();
  try {
    if (session.sftp) {
      const list = await session.sftp.list(targetDirPosix);
      for (const item of list) existingNames.add(item.name);
    } else if (session.ftp) {
      const list = await session.ftp.list(targetDirPosix);
      for (const item of list) existingNames.add(item.name);
    }
  } catch {}

  if (!existingNames.has(name) && !isSameDir) {
    return joinPosix(targetDirPosix, name);
  }
  const ext = path.posix.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  let candidate = isSameDir ? `${base} - Copy${ext}` : name;
  let counter = 2;
  while (existingNames.has(candidate)) {
    candidate = isSameDir ? `${base} - Copy (${counter})${ext}` : `${base} (${counter})${ext}`;
    counter++;
  }
  return joinPosix(targetDirPosix, candidate);
}

async function uploadLocalRecursive(
  session: ActiveSession,
  localPath: string,
  remoteDestPosix: string,
  onProgress?: (info: TransferProgressInfo) => void
): Promise<void> {
  const st = await fs.stat(localPath);
  if (st.isDirectory()) {
    if (session.sftp) {
      await session.sftp.mkdir(remoteDestPosix, true);
    } else if (session.ftp) {
      const cwdBefore = await session.ftp.pwd().catch(() => '/');
      await session.ftp.ensureDir(remoteDestPosix);
      await session.ftp.cd(cwdBefore).catch(() => {});
    }
    const children = await fs.readdir(localPath);
    for (const child of children) {
      await uploadLocalRecursive(session, path.join(localPath, child), joinPosix(remoteDestPosix, child), onProgress);
    }
  } else {
    await uploadLocalFileToRemote(session, localPath, remoteDestPosix, onProgress);
  }
}

async function downloadRemoteRecursive(
  session: ActiveSession,
  protocol: RemoteProtocol,
  connectionId: string,
  remotePath: string,
  localDestPath: string,
  onProgress?: (info: TransferProgressInfo) => void
): Promise<void> {
  let isDir = false;
  if (session.sftp) {
    const st = await session.sftp.stat(remotePath);
    isDir = st.isDirectory;
  } else if (session.ftp) {
    const parent = dirNamePosix(remotePath);
    const name = baseNamePosix(remotePath);
    const list = await session.ftp.list(parent);
    const found = list.find(i => i.name === name);
    isDir = Boolean(found && (found.isDirectory || found.type === FileType.Directory));
  }

  if (isDir) {
    await fs.mkdir(localDestPath, { recursive: true });
    let names: string[] = [];
    if (session.sftp) {
      const list = await session.sftp.list(remotePath);
      names = list.filter(i => i.name !== '.' && i.name !== '..').map(i => i.name);
    } else if (session.ftp) {
      const list = await session.ftp.list(remotePath);
      names = list.filter(i => i.name !== '.' && i.name !== '..').map(i => i.name);
    }
    for (const name of names) {
      await downloadRemoteRecursive(
        session,
        protocol,
        connectionId,
        joinPosix(remotePath, name),
        path.join(localDestPath, name),
        onProgress
      );
    }
  } else {
    await fs.mkdir(path.dirname(localDestPath), { recursive: true });
    const fileName = baseNamePosix(remotePath);
    if (session.sftp) {
      let lastPct = -1;
      await session.sftp.fastGet(remotePath, localDestPath, {
        step: (transferred, _chunk, total) => {
          if (onProgress && total > 0) {
            const pct = Math.floor((transferred / total) * 100);
            if (pct !== lastPct && (pct % 5 === 0 || pct === 100)) {
              lastPct = pct;
              onProgress({ line: `Downloading ${fileName} (${pct}%)`, fileName, phase: 'downloading' });
            }
          }
        },
      });
    } else if (session.ftp) {
      session.ftp.trackProgress((info) => {
        if (onProgress) {
          onProgress({
            line: `Downloading ${fileName} (${Math.round(info.bytes / 1024)} KB)...`,
            fileName,
            phase: 'downloading',
          });
        }
      });
      try {
        await session.ftp.downloadTo(localDestPath, remotePath);
      } finally {
        session.ftp.trackProgress();
      }
    }
  }
}

export async function transferLocalToRemote(
  localSources: string[],
  targetRemoteDirUri: string,
  isMove: boolean,
  removeLocalFn: (p: string) => Promise<void>,
  onProgress?: (info: TransferProgressInfo) => void
) {
  const parsed = parseRemoteUri(targetRemoteDirUri);
  if (!parsed) throw new Error(`Invalid remote target URI: ${targetRemoteDirUri}`);

  const results: Array<{ src: string; dest?: string; name: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (let i = 0; i < localSources.length; i++) {
    const src = localSources[i];
    const name = path.basename(src);
    onProgress?.({
      line: `${isMove ? 'Moving' : 'Uploading'} ${name} (${i + 1}/${localSources.length})...`,
      current: i + 1,
      total: localSources.length,
      fileName: name,
      phase: 'uploading',
    });

    try {
      await fs.access(src);
      const destUri = await runSerialized(parsed.connectionId, async (session) => {
        const destPosix = await getUniqueRemoteDestPosix(session, parsed.remotePath, name, false);
        await uploadLocalRecursive(session, src, destPosix, onProgress);
        return buildRemoteUri(parsed.protocol, parsed.connectionId, destPosix);
      });
      if (isMove) {
        await removeLocalFn(src);
      }
      results.push({ src, dest: destUri, name: baseNamePosix(destUri), success: true });
    } catch (err: any) {
      const msg = err?.message || String(err);
      errors.push(`Failed to upload "${name}": ${msg}`);
      results.push({ src, name, success: false, error: msg });
    }
  }

  const okCount = results.filter(r => r.success).length;
  const failCount = results.length - okCount;
  const summary = failCount === 0
    ? (okCount === 1 ? `Uploaded "${results[0].name}"` : `Uploaded ${okCount} items`)
    : `Uploaded ${okCount} of ${results.length} items (${failCount} failed).`;
  onProgress?.({ line: summary, phase: failCount === 0 ? 'complete' : 'partial', success: failCount === 0, errors });

  return {
    success: failCount === 0,
    type: isMove ? 'move' : 'copy',
    target: targetRemoteDirUri,
    items: results,
    summary,
    errors,
  };
}

export async function transferRemoteToLocal(
  remoteSources: string[],
  targetLocalDir: string,
  isMove: boolean,
  getUniqueLocalDestFn: (dir: string, name: string, isSame: boolean) => Promise<string>,
  onProgress?: (info: TransferProgressInfo) => void
) {
  await fs.mkdir(targetLocalDir, { recursive: true });
  const results: Array<{ src: string; dest?: string; name: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (let i = 0; i < remoteSources.length; i++) {
    const srcUri = remoteSources[i];
    const parsed = parseRemoteUri(srcUri);
    const name = baseNamePosix(parsed?.remotePath || srcUri);
    onProgress?.({
      line: `${isMove ? 'Moving' : 'Downloading'} ${name} (${i + 1}/${remoteSources.length})...`,
      current: i + 1,
      total: remoteSources.length,
      fileName: name,
      phase: 'downloading',
    });

    if (!parsed) {
      const msg = `Invalid remote URI: ${srcUri}`;
      errors.push(msg);
      results.push({ src: srcUri, name, success: false, error: msg });
      continue;
    }

    try {
      const destLocal = await getUniqueLocalDestFn(targetLocalDir, name, false);
      await runSerialized(parsed.connectionId, async (session) => {
        await downloadRemoteRecursive(session, parsed.protocol, parsed.connectionId, parsed.remotePath, destLocal, onProgress);
        if (isMove) {
          await deletePosixItem(session, parsed.remotePath);
        }
      });
      results.push({ src: srcUri, dest: destLocal, name: path.basename(destLocal), success: true });
    } catch (err: any) {
      const msg = err?.message || String(err);
      errors.push(`Failed to download "${name}": ${msg}`);
      results.push({ src: srcUri, name, success: false, error: msg });
    }
  }

  const okCount = results.filter(r => r.success).length;
  const failCount = results.length - okCount;
  const summary = failCount === 0
    ? (okCount === 1 ? `Downloaded "${results[0].name}"` : `Downloaded ${okCount} items`)
    : `Downloaded ${okCount} of ${results.length} items (${failCount} failed).`;
  onProgress?.({ line: summary, phase: failCount === 0 ? 'complete' : 'partial', success: failCount === 0, errors });

  return {
    success: failCount === 0,
    type: isMove ? 'move' : 'copy',
    target: targetLocalDir,
    items: results,
    summary,
    errors,
  };
}

export async function transferRemoteToRemote(
  remoteSources: string[],
  targetRemoteDirUri: string,
  isMove: boolean,
  onProgress?: (info: TransferProgressInfo) => void
) {
  const targetParsed = parseRemoteUri(targetRemoteDirUri);
  if (!targetParsed) throw new Error(`Invalid remote target URI: ${targetRemoteDirUri}`);

  const results: Array<{ src: string; dest?: string; name: string; success: boolean; error?: string }> = [];
  const errors: string[] = [];

  for (let i = 0; i < remoteSources.length; i++) {
    const srcUri = remoteSources[i];
    const srcParsed = parseRemoteUri(srcUri);
    const name = baseNamePosix(srcParsed?.remotePath || srcUri);
    onProgress?.({
      line: `${isMove ? 'Moving' : 'Copying'} ${name} (${i + 1}/${remoteSources.length})...`,
      current: i + 1,
      total: remoteSources.length,
      fileName: name,
      phase: isMove ? 'moving' : 'copying',
    });

    if (!srcParsed) {
      const msg = `Invalid remote URI: ${srcUri}`;
      errors.push(msg);
      results.push({ src: srcUri, name, success: false, error: msg });
      continue;
    }

    try {
      const sameServer = srcParsed.connectionId === targetParsed.connectionId;
      const sameFolder = sameServer && dirNamePosix(srcParsed.remotePath) === targetParsed.remotePath;

      if (sameServer && isMove && sameFolder) {
        results.push({ src: srcUri, dest: srcUri, name, success: true });
        continue;
      }

      if (sameServer && isMove) {
        const destUri = await runSerialized(targetParsed.connectionId, async (session) => {
          const destPosix = await getUniqueRemoteDestPosix(session, targetParsed.remotePath, name, false);
          if (session.sftp) {
            await session.sftp.rename(srcParsed.remotePath, destPosix);
          } else if (session.ftp) {
            await session.ftp.rename(srcParsed.remotePath, destPosix);
          }
          return buildRemoteUri(targetParsed.protocol, targetParsed.connectionId, destPosix);
        });
        results.push({ src: srcUri, dest: destUri, name: baseNamePosix(destUri), success: true });
      } else {
        // Relay via temp directory (handles same-server copy and cross-server copy/move)
        const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jabro-relay-'));
        try {
          const stagedItem = path.join(stageDir, name);
          await runSerialized(srcParsed.connectionId, async (session) => {
            await downloadRemoteRecursive(session, srcParsed.protocol, srcParsed.connectionId, srcParsed.remotePath, stagedItem, onProgress);
          });
          const destUri = await runSerialized(targetParsed.connectionId, async (session) => {
            const destPosix = await getUniqueRemoteDestPosix(session, targetParsed.remotePath, name, sameFolder);
            await uploadLocalRecursive(session, stagedItem, destPosix, onProgress);
            return buildRemoteUri(targetParsed.protocol, targetParsed.connectionId, destPosix);
          });
          if (isMove) {
            await runSerialized(srcParsed.connectionId, async (session) => {
              await deletePosixItem(session, srcParsed.remotePath);
            });
          }
          results.push({ src: srcUri, dest: destUri, name: baseNamePosix(destUri), success: true });
        } finally {
          try { await fs.rm(stageDir, { recursive: true, force: true }); } catch {}
        }
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      errors.push(`Failed to ${isMove ? 'move' : 'copy'} "${name}": ${msg}`);
      results.push({ src: srcUri, name, success: false, error: msg });
    }
  }

  const okCount = results.filter(r => r.success).length;
  const failCount = results.length - okCount;
  const summary = failCount === 0
    ? (okCount === 1 ? `${isMove ? 'Moved' : 'Copied'} "${results[0].name}"` : `${isMove ? 'Moved' : 'Copied'} ${okCount} items`)
    : `${isMove ? 'Moved' : 'Copied'} ${okCount} of ${results.length} items (${failCount} failed).`;
  onProgress?.({ line: summary, phase: failCount === 0 ? 'complete' : 'partial', success: failCount === 0, errors });

  return {
    success: failCount === 0,
    type: isMove ? 'move' : 'copy',
    target: targetRemoteDirUri,
    items: results,
    summary,
    errors,
  };
}

export async function cleanupPreviewTempDir(): Promise<void> {
  try {
    const dir = getPreviewTempDir();
    if (fsSync.existsSync(dir)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  } catch {}
}
