import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─────────────────────────────────────────────────────────────────
// Date/Time Formatting Utils
// ─────────────────────────────────────────────────────────────────

/**
 * Format milliseconds as human readable duration (e.g., "2m 30.50s", "1h 15m")
 * Shows full precision for seconds (2 decimal places)
 */
export function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000
  const hours = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    if (mins > 0) {
      return secs > 0 ? `${hours}h ${mins}m ${secs.toFixed(2)}s` : `${hours}h ${mins}m`
    }
    return secs > 0 ? `${hours}h ${secs.toFixed(2)}s` : `${hours}h`
  }
  if (mins > 0) {
    return secs > 0 ? `${mins}m ${secs.toFixed(2)}s` : `${mins}m`
  }
  return `${secs.toFixed(2)}s`
}

/**
 * Format timestamp as short date (e.g., "Dec 15, 2025")
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Format timestamp as date with time (e.g., "Dec 15, 2025, 3:45 PM")
 */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format timestamp as time only (e.g., "3:45 PM")
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * Format timestamp as relative time (e.g., "2h ago", "3d ago")
 */
export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(timestamp)
}

// ─────────────────────────────────────────────────────────────────
// Debounce Utility
// ─────────────────────────────────────────────────────────────────

/**
 * Creates a debounced function that delays invoking func until after wait ms
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      func(...args)
      timeoutId = null
    }, wait)
  }
}
