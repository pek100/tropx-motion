/**
 * useCachedQuery - Drop-in replacement for useQuery with offline caching
 *
 * Features:
 * - Returns cached data immediately
 * - Checks freshness in background
 * - Updates cache and UI when fresh data arrives
 * - Works offline (returns cached data)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useConvex, useConvexConnectionState } from "convex/react";
import { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import { useCacheOptional } from "./CacheProvider";
import { hashArgs } from "./encryption";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Create stable string key from args for use in dependency arrays. */
function stableArgsKey(args: unknown): string {
  if (args === "skip") return "__skip__";
  try {
    return JSON.stringify(args);
  } catch {
    return "__unstringifiable__";
  }
}

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface UseCachedQueryOptions {
  /** Skip the query entirely (same as useQuery "skip"). */
  skip?: boolean;
  /** Force refresh from server, ignoring cache. */
  forceRefresh?: boolean;
  /** Revalidate in background even if cache is fresh. */
  backgroundRevalidate?: boolean;
  /** Max age in ms before cache is considered stale. */
  maxAge?: number;
}

export interface UseCachedQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isCached: boolean;
  isStale: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

/**
 * Query with local caching.
 *
 * Usage:
 * ```tsx
 * const { data, isLoading, isCached } = useCachedQuery(
 *   api.dashboard.getPatientMetricsHistory,
 *   { subjectId }
 * );
 * ```
 */
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  options: UseCachedQueryOptions = {}
): UseCachedQueryResult<FunctionReturnType<Query>> {
  type T = FunctionReturnType<Query>;

  const cache = useCacheOptional();
  const convex = useConvex();
  const connectionState = useConvexConnectionState();

  const [cachedData, setCachedData] = useState<T | undefined>(undefined);
  const [isCached, setIsCached] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [isLoadingCache, setIsLoadingCache] = useState(true); // Start true until cache checked
  const [error, setError] = useState<Error | null>(null);
  const [justReconnected, setJustReconnected] = useState(false);

  const cacheKeyRef = useRef<string | null>(null);
  const wasConnectedRef = useRef(connectionState.isWebSocketConnected);

  const skip = args === "skip" || options.skip;

  // Detect when we come back online - mark as needing refresh
  useEffect(() => {
    const isConnected = connectionState.isWebSocketConnected;
    const wasConnected = wasConnectedRef.current;

    if (isConnected && !wasConnected) {
      // Just reconnected - force refresh
      setJustReconnected(true);
      setIsStale(true);
    }

    wasConnectedRef.current = isConnected;
  }, [connectionState.isWebSocketConnected]);

  // Clear justReconnected flag after data refreshes
  useEffect(() => {
    if (justReconnected && !isStale) {
      setJustReconnected(false);
    }
  }, [justReconnected, isStale]);

  // Stable key for dependency arrays (prevents re-running effects on every render)
  const argsKey = useMemo(() => stableArgsKey(args), [args]);

  // Extract query name once (stable reference)
  const queryName = useMemo(() => {
    try {
      const q = query as any;
      if (q && typeof q._name === "string" && q._name) return q._name;
      if (q && typeof q.name === "string" && q.name) return q.name;
      if (q && typeof q.functionName === "string" && q.functionName) return q.functionName;
    } catch {
      // Ignore
    }
    return "unknown";
  }, [query]);

  // Generate cache key from query path + args
  const getCacheKey = useCallback(async (): Promise<string | null> => {
    if (skip) return null;

    let argsHash: string;
    try {
      argsHash = await hashArgs(args);
    } catch {
      argsHash = "error";
    }

    return queryName + ":" + argsHash;
  }, [queryName, argsKey, skip]); // Use argsKey instead of args for stable deps

  // Load from cache on mount or when args change
  useEffect(() => {
    // Reset state when args change
    setCachedData(undefined);
    setIsCached(false);
    setIsStale(false);
    setIsLoadingCache(true);

    if (skip) {
      setIsLoadingCache(false);
      return;
    }

    if (!cache?.isReady || !cache.store) {
      // Cache not ready yet, will re-run when it is
      return;
    }

    const loadFromCache = async () => {
      try {
        const key = await getCacheKey();
        if (!key) {
          setIsLoadingCache(false);
          return;
        }

        cacheKeyRef.current = key;

        const entry = await cache.store!.get<T>(key);
        if (entry) {
          setCachedData(entry.data);
          setIsCached(true);

          // Check if stale
          const age = Date.now() - entry.cachedAt;
          const maxAge = options.maxAge ?? 5 * 60 * 1000; // 5 min default
          setIsStale(age > maxAge);
        }
      } catch (err) {
        console.error("[useCachedQuery] Cache read error:", err);
      } finally {
        setIsLoadingCache(false);
      }
    };

    loadFromCache();
  }, [skip, cache?.isReady, cache?.store, argsKey, queryName, options.maxAge]);

  // Use Convex query for fresh data
  // Skip if we have cache and don't need refresh, unless offline check fails
  const shouldFetchFresh =
    !skip && (options.forceRefresh || !isCached || isStale || options.backgroundRevalidate);

  const freshData = useQuery(
    query,
    shouldFetchFresh && !skip ? (args as FunctionArgs<Query>) : "skip"
  );

  // Update cache when fresh data arrives
  useEffect(() => {
    if (freshData === undefined || skip || !cache?.isReady || !cache.store) return;

    const updateCache = async () => {
      try {
        const key = await getCacheKey();
        if (!key) return;

        // Get version (modifiedAt) - for now use current time
        // In production, this would come from the server response
        const version = Date.now();

        await cache.store!.put(key, freshData, version);
        setCachedData(freshData as T);
        setIsCached(true);
        setIsStale(false);
      } catch (err) {
        console.error("[useCachedQuery] Cache write error:", err);
      }
    };

    updateCache();
  }, [freshData, skip, cache?.isReady, cache?.store, argsKey, queryName]);

  // Refetch function
  const refetch = useCallback(async () => {
    if (skip) return;

    try {
      const key = await getCacheKey();
      if (!key || !cache?.store) return;

      // Clear cache for this key to force refetch
      await cache.store.delete(key);
      setCachedData(undefined);
      setIsCached(false);
      setIsStale(false);

      // The useQuery will automatically refetch
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [skip, argsKey, queryName, cache?.store]);

  // Determine loading state:
  // - Loading if cache check in progress
  // - Loading if no cached data AND no fresh data yet
  const isLoading = !skip && (isLoadingCache || (cachedData === undefined && freshData === undefined));

  // Return cached data if available, otherwise fresh data
  const data = cachedData ?? freshData;

  return {
    data,
    isLoading,
    isCached,
    isStale,
    error,
    refetch,
  };
}

// ─────────────────────────────────────────────────────────────────
// Utility: Cache key generator for manual cache operations
// ─────────────────────────────────────────────────────────────────

export async function generateCacheKey(
  queryName: string,
  args: unknown
): Promise<string> {
  const argsHash = await hashArgs(args);
  return `${queryName}:${argsHash}`;
}
