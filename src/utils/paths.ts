// Platform-aware path helpers for the renderer. The renderer cannot use node:path,
// so everything here is plain string handling keyed off the platform exposed by the preload.

const api = (typeof window !== 'undefined' ? (window as any).api : null) as any;

const detectedPlatform: string =
  api?.platform ||
  (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform) ? 'win32'
    : typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'darwin'
    : 'linux');

export const PLATFORM = detectedPlatform;
export const IS_WIN = PLATFORM === 'win32';
export const IS_MAC = PLATFORM === 'darwin';
export const SEP = IS_WIN ? '\\' : '/';

// Windows and default macOS volumes are case-insensitive; Linux is case-sensitive.
const CASE_INSENSITIVE = PLATFORM !== 'linux';

const SEP_RE = IS_WIN ? /[\\/]+/ : /\/+/;
const TRAILING_SEP_RE = IS_WIN ? /[\\/]+$/ : /\/+$/;

/** User's home directory (provided by the main process). */
export const HOME_DIR: string = api?.homeDir || (IS_WIN ? 'C:\\' : '/');

/** Modifier key label for shortcut hints, e.g. "Ctrl" or "⌘". */
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

/** Modifier held during drag & drop to force a copy (Ctrl on Windows/Linux, Option on macOS). */
export const COPY_MOD_LABEL = IS_MAC ? 'Option' : 'Ctrl';
export const isCopyModifier = (e: { ctrlKey: boolean; altKey: boolean }): boolean =>
  IS_MAC ? e.altKey : e.ctrlKey;

/** Name of the OS file manager, for menu labels. */
export const FILE_MANAGER_NAME = IS_WIN ? 'Explorer' : IS_MAC ? 'Finder' : 'File Manager';

export type RemoteProtocol = 'sftp' | 'ftp' | 'ftps';

export interface ParsedRemoteUri {
  protocol: RemoteProtocol;
  connectionId: string;
  remotePath: string;
}

const REMOTE_URI_RE = /^(sftp|ftps?):\/\/([^/]+)(\/.*)?$/i;

export function isRemotePath(p: string): boolean {
  return typeof p === 'string' && REMOTE_URI_RE.test(p.trim());
}

export function normalizePosixPath(p: string): string {
  const parts = (p || '/').split('/').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return '/' + stack.join('/');
}

export function parseRemoteUri(p: string): ParsedRemoteUri | null {
  if (!p || typeof p !== 'string') return null;
  const m = REMOTE_URI_RE.exec(p.trim());
  if (!m) return null;
  const protocol = m[1].toLowerCase() as RemoteProtocol;
  const connectionId = m[2];
  const remotePath = normalizePosixPath(m[3] || '/');
  return { protocol, connectionId, remotePath };
}

export function buildRemoteUri(protocol: RemoteProtocol, connectionId: string, remotePath: string): string {
  const clean = normalizePosixPath(remotePath);
  return `${protocol}://${connectionId}${clean}`;
}

export function isWindowsDrive(name: string): boolean {
  return IS_WIN && /^[a-zA-Z]:$/.test(name);
}

/** True if the string looks like an absolute local filesystem path on this platform. */
export function isAbsolutePath(p: string): boolean {
  const s = p.trim();
  if (IS_WIN) return /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[\w]/.test(s);
  return s.startsWith('/');
}

/** Last path segment (file or folder name). Falls back to the input for roots. */
export function baseName(p: string): string {
  const remote = parseRemoteUri(p);
  if (remote) {
    const parts = remote.remotePath.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '/';
  }
  const parts = p.split(SEP_RE).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** Directory portion of a path (without trailing separator). Returns '' if none. */
export function dirName(p: string): string {
  const remote = parseRemoteUri(p);
  if (remote) {
    if (remote.remotePath === '/') return '';
    const idx = remote.remotePath.lastIndexOf('/');
    const parent = idx <= 0 ? '/' : remote.remotePath.slice(0, idx);
    return buildRemoteUri(remote.protocol, remote.connectionId, parent);
  }
  const trimmed = p.replace(TRAILING_SEP_RE, '');
  const idx = IS_WIN
    ? Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
    : trimmed.lastIndexOf('/');
  if (idx < 0) return '';
  if (idx === 0) return SEP; // "/foo" -> "/"
  const dir = trimmed.slice(0, idx);
  return IS_WIN && /^[a-zA-Z]:$/.test(dir) ? dir + '\\' : dir;
}

/**
 * Normalize a directory path for navigation / cache keys:
 * strips trailing separators but keeps roots intact ("C:\" on Windows, "/" elsewhere).
 * Virtual "collection:" and remote ("sftp://", "ftp://", "ftps://") paths are normalized appropriately.
 */
export function normalizeDirPath(p: string): string {
  if (p.startsWith('collection:')) return p;
  const remote = parseRemoteUri(p);
  if (remote) {
    return buildRemoteUri(remote.protocol, remote.connectionId, remote.remotePath);
  }
  const trimmed = p.replace(TRAILING_SEP_RE, '');
  if (IS_WIN) return trimmed.endsWith(':') ? trimmed + '\\' : trimmed;
  return trimmed === '' && p.startsWith('/') ? '/' : trimmed;
}

/** Parent directory of a path, or null if it is already a root. */
export function parentPath(p: string): string | null {
  if (p.startsWith('collection:')) return null;
  const remote = parseRemoteUri(p);
  if (remote) {
    if (remote.remotePath === '/') return null;
    const parts = remote.remotePath.split('/').filter(Boolean);
    const parentRemote = parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/');
    return buildRemoteUri(remote.protocol, remote.connectionId, parentRemote);
  }
  const parts = p.split(SEP_RE).filter(Boolean);
  // Windows: "C:" is the root. POSIX: "/" is the root, so a single segment still has a parent.
  if (parts.length <= (IS_WIN ? 1 : 0)) return null;
  const parent = parts.slice(0, -1);
  if (IS_WIN) {
    // UNC: \\server\share\... keep the leading double separator
    if (p.startsWith('\\\\')) return '\\\\' + parent.join('\\') + '\\';
    return parent.join('\\') + '\\';
  }
  return '/' + parent.join('/');
}

export function joinPath(dir: string, name: string): string {
  const remote = parseRemoteUri(dir);
  if (remote) {
    const joined = remote.remotePath === '/' ? `/${name}` : `${remote.remotePath}/${name}`;
    return buildRemoteUri(remote.protocol, remote.connectionId, joined);
  }
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + SEP + name;
}

export function pathsEqual(a: string, b: string): boolean {
  if (isRemotePath(a) || isRemotePath(b)) {
    return normalizeDirPath(a) === normalizeDirPath(b);
  }
  return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function withTrailingSep(p: string): string {
  if (isRemotePath(p)) return p.endsWith('/') ? p : p + '/';
  return p.endsWith(SEP) ? p : p + SEP;
}

/** True if `child` equals `ancestor` or is located inside it. */
export function isSameOrInside(child: string, ancestor: string): boolean {
  if (pathsEqual(child, ancestor)) return true;
  const a = withTrailingSep(ancestor);
  const c = child.length >= a.length ? child.slice(0, a.length) : child;
  return pathsEqual(c, a);
}

/**
 * Key identifying the volume a path lives on. Used to decide whether a drag-drop
 * is a move (same volume) or a copy (different volume).
 */
export function volumeKey(p: string): string {
  const remote = parseRemoteUri(p);
  if (remote) {
    return `${remote.protocol}://${remote.connectionId}`;
  }
  if (IS_WIN) {
    if (p.startsWith('\\\\')) {
      const [server, share] = p.slice(2).split(/[\\/]+/);
      return `\\\\${server}\\${share || ''}`.toLowerCase();
    }
    return (p[0] || '').toLowerCase();
  }
  if (IS_MAC || PLATFORM === 'linux') {
    const m = /^\/(Volumes|mnt|media)\/([^/]+)/.exec(p);
    if (m) return `/${m[1]}/${m[2]}`;
    const run = /^\/run\/media\/([^/]+)\/([^/]+)/.exec(p);
    if (run) return `/run/media/${run[1]}/${run[2]}`;
  }
  return '/';
}

export interface Breadcrumb {
  name: string;
  fullPath: string;
}

/** Split a filesystem path (or remote URI) into clickable breadcrumb segments. */
export function pathBreadcrumbs(pathStr: string, remoteRootLabel?: string): Breadcrumb[] {
  const remote = parseRemoteUri(pathStr);
  if (remote) {
    const rootUri = buildRemoteUri(remote.protocol, remote.connectionId, '/');
    const out: Breadcrumb[] = [{ name: remoteRootLabel || `${remote.protocol.toUpperCase()} /`, fullPath: rootUri }];
    const parts = remote.remotePath.split('/').filter(Boolean);
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      out.push({ name: part, fullPath: buildRemoteUri(remote.protocol, remote.connectionId, acc) });
    }
    return out;
  }

  if (IS_WIN) {
    const parts = pathStr.replace(/\//g, '\\').split('\\').filter(Boolean);
    const out: Breadcrumb[] = [];
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === 0 && /^[a-zA-Z]:$/.test(part)) {
        acc = part + '\\';
      } else {
        acc = acc ? (acc.endsWith('\\') ? acc + part : acc + '\\' + part) : part;
      }
      out.push({ name: part, fullPath: acc });
    }
    return out.length > 0 ? out : [{ name: pathStr, fullPath: pathStr }];
  }

  const parts = pathStr.split('/').filter(Boolean);
  const out: Breadcrumb[] = [{ name: '/', fullPath: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    out.push({ name: part, fullPath: acc });
  }
  return out;
}
