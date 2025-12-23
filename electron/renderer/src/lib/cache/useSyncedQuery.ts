/**
 * useSyncedQuery - Smart cache sync with timestamp-based diffing
 *
 * Flow:
 * 1. Subscribe to timestamps (Convex real-time)
 * 2. Load cached data + signature
 * 3. If server signature !== cached signature → fetch content
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";
import { useCacheOptional } from "./CacheProvider";
import { hashArgs } from "./encryption";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type TimestampEntry = {
  _id: string;
  updatedAt: number;
};

export interface UseSyncedQueryOptions<
  TimestampsQuery extends FunctionReference<"query"> | undefined = undefined
> {
  skip?: boolean;
  timestamps?: TimestampsQuery;
}

export interface UseSyncedQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  isCached: boolean;
  isSyncing: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function generateSignature(ts: TimestampEntry | TimestampEntry[] | null | undefined): string {
  if (!ts) return "";
  if (Array.isArray(ts)) {
    return [...ts].sort((a, b) => a._id.localeCompare(b._id))
      .map(t => `${t._id}:${t.updatedAt}`).join("|");
  }
  return `${ts._id}:${ts.updatedAt}`;
}

function getQueryName(query: FunctionReference<"query">): string {
  const q = query as any;
  return (typeof q?._name === "string" && q._name) ||
         (typeof q?.name === "string" && q.name) ||
         (typeof q?.functionName === "string" && q.functionName) ||
         "unknown";
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

export function useSyncedQuery<
  Query extends FunctionReference<"query">,
  TimestampsQuery extends FunctionReference<"query"> | undefined = undefined
>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
  options: UseSyncedQueryOptions<TimestampsQuery> = {}
): UseSyncedQueryResult<FunctionReturnType<Query>> {
  type T = FunctionReturnType<Query>;

  const cache = useCacheOptional();
  const skip = args === "skip" || options.skip;
  const hasTimestamps = options.timestamps !== undefined;

  const [cachedData, setCachedData] = useState<T | undefined>(undefined);
  const [cachedSignature, setCachedSignature] = useState<string | null>(null); // null = not loaded yet
  const [cacheChecked, setCacheChecked] = useState(false); // true after we've checked cache
  const [error, setError] = useState<Error | null>(null);

  const queryNameRef = useRef(getQueryName(query));
  const cacheKeyRef = useRef<string | null>(null);

  // Stabilize args to prevent infinite re-renders from {} creating new refs
  const argsKey = useMemo(() => {
    if (args === "skip") return "skip";
    try { return JSON.stringify(args); } catch { return "unstable"; }
  }, [args]);

  // ─────────────────────────────────────────────────────────────────
  // 1. Always subscribe to timestamps
  // ─────────────────────────────────────────────────────────────────

  const tsQuery = hasTimestamps && !skip ? options.timestamps : query;
  const serverTs = useQuery(
    tsQuery as any,
    hasTimestamps && !skip ? {} : "skip"
  ) as TimestampEntry | TimestampEntry[] | null | undefined;

  const serverSignature = useMemo(() => generateSignature(serverTs), [serverTs]);

  // ─────────────────────────────────────────────────────────────────
  // 2. Load cache on mount
  // ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Reset on args change
    setCacheChecked(false);
    setCachedData(undefined);
    setCachedSignature(null);

    if (skip) {
      setCacheChecked(true);
      return;
    }

    if (!cache?.isReady || !cache.store) {
      // No cache available, mark as checked (nothing to load)
      setCacheChecked(true);
      return;
    }

    (async () => {
      try {
        const hash = await hashArgs(args);
        const key = queryNameRef.current + ":" + hash;
        cacheKeyRef.current = key;

        const [dataEntry, sigEntry] = await Promise.all([
          cache.store!.get<T>(key),
          cache.store!.get<string>(key + ":sig"),
        ]);

        if (dataEntry?.data !== undefined) setCachedData(dataEntry.data);
        setCachedSignature(sigEntry?.data ?? "");
      } catch (err) {
        console.error("[useSyncedQuery] Cache load error:", err);
      } finally {
        setCacheChecked(true);
      }
    })();
  }, [skip, cache?.isReady, argsKey]);

  // ─────────────────────────────────────────────────────────────────
  // 3. Fetch content when signatures differ
  // ─────────────────────────────────────────────────────────────────

  // serverTs undefined = still loading, anything else = resolved
  const timestampsResolved = serverTs !== undefined;
  // Fetch if: timestamps resolved AND (no cache yet OR signatures differ)
  const shouldFetch = !skip && hasTimestamps && timestampsResolved &&
    (cachedSignature === null || serverSignature !== cachedSignature);

  const freshData = useQuery(
    query as any,
    shouldFetch ? args : "skip"
  ) as T | undefined;

  // ─────────────────────────────────────────────────────────────────
  // 4. Update cache when fresh data arrives
  // ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (skip || freshData === undefined || !cache?.isReady || !cache.store) return;

    (async () => {
      try {
        if (!cacheKeyRef.current) {
          const hash = await hashArgs(args);
          cacheKeyRef.current = queryNameRef.current + ":" + hash;
        }
        const key = cacheKeyRef.current;
        const version = Date.now();

        await Promise.all([
          cache.store!.put(key, freshData, version),
          cache.store!.put(key + ":sig", serverSignature, version),
        ]);

        setCachedData(freshData);
        setCachedSignature(serverSignature);
      } catch (err) {
        console.error("[useSyncedQuery] Cache write error:", err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    })();
  }, [freshData, skip, cache?.isReady, serverSignature, argsKey]);

  // ─────────────────────────────────────────────────────────────────
  // 5. Refetch
  // ─────────────────────────────────────────────────────────────────

  const refetch = useCallback(async () => {
    if (skip || !cache?.store || !cacheKeyRef.current) return;
    try {
      await Promise.all([
        cache.store.delete(cacheKeyRef.current),
        cache.store.delete(cacheKeyRef.current + ":sig"),
      ]);
      setCachedData(undefined);
      setCachedSignature(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [skip, cache?.store]);

  // ─────────────────────────────────────────────────────────────────
  // Return
  // ─────────────────────────────────────────────────────────────────

  const data = freshData ?? cachedData;

  // Never block with loading - show data immediately (cached or fresh), update silently
  // Only "loading" if we truly have nothing yet and are waiting for first data
  const isLoading = !skip && data === undefined && !timestampsResolved && !cacheChecked;

  return {
    data,
    isLoading,
    isCached: cachedData !== undefined && freshData === undefined,
    isSyncing: shouldFetch && freshData === undefined,
    error,
    refetch,
  };
}

export { useCachedQuery, generateCacheKey } from "./useCachedQuery";
