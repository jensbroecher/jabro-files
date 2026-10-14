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

export function isWindowsDrive(name: string): boolean {
  return IS_WIN && /^[a-zA-Z]:$/.test(name);
}

/** True if the string looks like an absolute filesystem path on this platform. */
export function isAbsolutePath(p: string): boolean {
  const s = p.trim();
  if (IS_WIN) return /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[\w]/.test(s);
  return s.startsWith('/');
}

/** Last path segment (file or folder name). Falls back to the input for roots. */
export function baseName(p: string): string {
  const parts = p.split(SEP_RE).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

/** Directory portion of a path (without trailing separator). Returns '' if none. */
export function dirName(p: string): string {
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
 * Virtual "collection:" paths are returned untouched.
 */
export function normalizeDirPath(p: string): string {
  if (p.startsWith('collection:')) return p;
  const trimmed = p.replace(TRAILING_SEP_RE, '');
  if (IS_WIN) return trimmed.endsWith(':') ? trimmed + '\\' : trimmed;
  return trimmed === '' && p.startsWith('/') ? '/' : trimmed;
}

/** Parent directory of a path, or null if it is already a root. */
export function parentPath(p: string): string | null {
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
  return dir.endsWith('\\') || dir.endsWith('/') ? dir + name : dir + SEP + name;
}

export function pathsEqual(a: string, b: string): boolean {
  return CASE_INSENSITIVE ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function withTrailingSep(p: string): string {
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

/** Split a filesystem path into clickable breadcrumb segments. */
export function pathBreadcrumbs(pathStr: string): Breadcrumb[] {
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
