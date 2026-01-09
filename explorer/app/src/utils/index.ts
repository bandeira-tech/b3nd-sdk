import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ExplorerSection } from '../types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

export function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString()
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function parsePathSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

export function joinPath(...segments: string[]): string {
  return '/' + segments.filter(Boolean).join('/')
}

export function getParentPath(path: string): string {
  const segments = parsePathSegments(path)
  return segments.length > 1 ? joinPath(...segments.slice(0, -1)) : '/'
}

export function getFileName(path: string): string {
  const segments = parsePathSegments(path)
  return segments[segments.length - 1] || ''
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function isValidUrl(string: string): boolean {
  try {
    new URL(string)
    return true
  } catch {
    return false
  }
}

/**
 * Sanitize a path to prevent path traversal and other attacks
 *
 * SECURITY FIX: Enhanced sanitization to prevent:
 * - Path traversal via .. sequences
 * - Null byte injection
 * - Backslash-based attacks
 * - URL-encoded attacks
 *
 * @param path - The path to sanitize
 * @returns A safe, normalized path
 */
export function sanitizePath(path: string): string {
  if (!path || typeof path !== 'string') {
    return '/';
  }

  let sanitized = path;

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Convert backslashes to forward slashes
  sanitized = sanitized.replace(/\\/g, '/');

  // Decode common URL-encoded path traversal attempts
  sanitized = sanitized.replace(/%2e/gi, '.');
  sanitized = sanitized.replace(/%2f/gi, '/');
  sanitized = sanitized.replace(/%5c/gi, '/');

  // Remove path traversal sequences
  // This handles ../ and /.., including multiple occurrences
  const segments = sanitized.split('/');
  const safeSegments: string[] = [];

  for (const segment of segments) {
    // Skip empty segments (from multiple slashes)
    if (!segment) continue;
    // Skip current directory references
    if (segment === '.') continue;
    // Handle parent directory references - pop if possible, otherwise skip
    if (segment === '..') {
      if (safeSegments.length > 0) {
        safeSegments.pop();
      }
      continue;
    }
    safeSegments.push(segment);
  }

  // Reconstruct path
  const result = '/' + safeSegments.join('/');

  // Normalize multiple slashes
  return result.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

export const RIG_EXPLORER_BASE_PATH = "/explorer";
export const RIG_WRITER_BASE_PATH = "/writer";
export const RIG_SETTINGS_PATH = "/settings";
export const RIG_ACCOUNTS_PATH = "/accounts";

export function routeForExplorerPath(
  path: string,
  options?: { section?: ExplorerSection; accountKey?: string | null },
): string {
  const section: ExplorerSection = options?.section || "index";
  const normalized = sanitizePath(path);
  const parts = normalized
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean)
    .map((p) => encodeURIComponent(p));

  if (section === "account") {
    const accountKey = options?.accountKey;
    if (!accountKey) {
      if (parts.length > 0) {
        throw new Error("Account key is required for account explorer routes");
      }
      return `${RIG_EXPLORER_BASE_PATH}/account`;
    }
    const accountSegment = encodeURIComponent(accountKey);
    const segments = ["account", accountSegment, ...parts];
    return `${RIG_EXPLORER_BASE_PATH}/${segments.join("/")}`;
  }

  if (!parts.length) return RIG_EXPLORER_BASE_PATH;
  return `${RIG_EXPLORER_BASE_PATH}/${parts.join("/")}`;
}
