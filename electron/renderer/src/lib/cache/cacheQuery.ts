/**
 * cacheQuery - Utility for caching imperative (non-hook) Convex queries
 *
 * Use this for queries called with convex.query() directly, like:
 * - Loading recording data on demand
 * - One-time data fetches in useEffect
 *
 * For reactive queries (useQuery pattern), use useCachedQuery hook instead.
 */

import type { CacheStore } from "./store";
import { hashArgs } from "./encryption";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface CacheQueryOptions {
  /** Skip cache lookup, always fetch fresh. */
  forceRefresh?: boolean;
  /** Max age in ms before cache is considered stale. Default: 5 minutes. */
  maxAge?: number;
}

export interface CacheQueryResult<T> {
  data: T;
  fromCache: boolean;
  cachedAt?: number;
}

// ─────────────────────────────────────────────────────────────────
// Main Function
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a query with caching support.
 *
 * @param store - CacheStore instance (from useCache context)
 * @param queryName - Unique name for this query (e.g., "recordingChunks.getSessionWithChunks")
 * @param args - Query arguments (used for cache key generation)
 * @param fetcher - Function that actually fetches the data from Convex
 * @param options - Cache options
 *
 * @example
 * ```typescript
 * const result = await cacheQuery(
 *   store,
 *   "recordingChunks.getSessionWithChunks",
 *   { sessionId },
 *   () => convex.query(api.recordingChunks.getSessionWithChunks, { sessionId })
 * );
 * ```
 */
export async function cacheQuery<T>(
  store: CacheStore | null,
  queryName: string,
  args: unknown,
  fetcher: () => Promise<T>,
  options: CacheQueryOptions = {}
): Promise<CacheQueryResult<T>> {
  const { forceRefresh = false, maxAge = 5 * 60 * 1000 } = options;

  // If no store available, just fetch directly
  if (!store || !store.isOpen()) {
    const data = await fetcher();
    return { data, fromCache: false };
  }

  // Generate cache key
  const argsHash = await hashArgs(args);
  const cacheKey = `${queryName}:${argsHash}`;

  // Try to get from cache (unless force refresh)
  if (!forceRefresh) {
    try {
      const cached = await store.get<T>(cacheKey);
      if (cached) {
        const age = Date.now() - cached.cachedAt;
        if (age <= maxAge) {
          // Cache hit and fresh
          return {
            data: cached.data,
            fromCache: true,
            cachedAt: cached.cachedAt,
          };
        }
        // Cache hit but stale - we'll refresh but could return stale data
        // For now, we fetch fresh to ensure consistency
      }
    } catch (error) {
      console.error("[cacheQuery] Cache read error:", error);
    }
  }

  // Fetch fresh data
  const data = await fetcher();

  // Store in cache
  try {
    await store.put(cacheKey, data, Date.now());
  } catch (error) {
    console.error("[cacheQuery] Cache write error:", error);
  }

  return { data, fromCache: false };
}

/**
 * Get data from cache only (no fetch).
 * Useful for checking if data exists before deciding to fetch.
 */
export async function getCachedData<T>(
  store: CacheStore | null,
  queryName: string,
  args: unknown
): Promise<T | null> {
  if (!store || !store.isOpen()) return null;

  try {
    const argsHash = await hashArgs(args);
    const cacheKey = `${queryName}:${argsHash}`;
    const cached = await store.get<T>(cacheKey);
    return cached?.data ?? null;
  } catch (error) {
    console.error("[getCachedData] Cache read error:", error);
    return null;
  }
}

/**
 * Invalidate cached data for a specific query.
 */
export async function invalidateCache(
  store: CacheStore | null,
  queryName: string,
  args: unknown
): Promise<void> {
  if (!store || !store.isOpen()) return;

  try {
    const argsHash = await hashArgs(args);
    const cacheKey = `${queryName}:${argsHash}`;
    await store.delete(cacheKey);
  } catch (error) {
    console.error("[invalidateCache] Cache delete error:", error);
  }
}
