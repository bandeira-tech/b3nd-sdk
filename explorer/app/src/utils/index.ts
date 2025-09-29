import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

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
  let timeout: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
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

export function sanitizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}
