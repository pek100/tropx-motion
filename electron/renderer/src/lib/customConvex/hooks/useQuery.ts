/**
 * Custom useQuery Hook
 *
 * Drop-in replacement for Convex's useQuery with:
 * - Unified caching via SyncProvider
 * - Offline support via ConnectivityProvider
 * - Proactively synced queries return cached data
 * - On-demand queries are cached when first fetched
 */

import { useMemo, useEffect, useRef } from "react";
import { useQuery as useConvexQuery } from "convex/react";
import { FunctionReference, OptionalRestArgs, getFunctionName } from "convex/server";
import { useSyncOptional } from "../cache/SyncProvider";
import { useCacheOptional } from "../cache/CacheProvider";
import { useIsOnline } from "../internal/connectivity";
import { debug } from "../internal/debug";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Get query name from function reference */
function getQueryName(queryRef: FunctionReference<"query">): string {
  return getFunctionName(queryRef);
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

/** Stable empty object to avoid new reference on every render */
const EMPTY_ARGS = {} as Record<string, unknown>;

/**
 * Drop-in replacement for Convex's useQuery with unified caching.
 *
 * Cache key format: `${queryName}:${JSON.stringify(args)}`
 *
 * @example
 * ```tsx
 * import { useQuery } from "@/lib/customConvex";
 * const session = useQuery(api.recordingSessions.getSession, { sessionId });
 * ```
 */
export function useQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgs<Query>
): Query["_returnType"] | undefined {
  const sync = useSyncOptional();
  const cache = useCacheOptional();
  const isOnline = useIsOnline();

  // Handle "skip" argument - use stable reference for empty args
  const isSkipped = args[0] === "skip";
  const queryArgs = isSkipped ? EMPTY_ARGS : (args[0] ?? EMPTY_ARGS) as Record<string, unknown>;

  // Stable args string for memo dependency (avoid object reference issues)
  const argsString = useMemo(() => {
    if (isSkipped) return null;
    try {
      return JSON.stringify(queryArgs);
    } catch {
      return null;
    }
  }, [isSkipped, queryArgs]);

  // Generate cache key: queryName:argsJson
  const cacheKey = useMemo(() => {
    if (argsString === null) return null;
    try {
      return `${getQueryName(query)}:${argsString}`;
    } catch {
      return null;
    }
  }, [query, argsString]);

  // Extract module from cache key (simple string op, no memo needed)
  const queryModule = cacheKey ? cacheKey.split(":")[0] : null;

  // Check if this module has pending mutations (optimistic updates in flight)
  const hasPendingForModule = queryModule
    ? cache?.pendingModules?.has(queryModule) ?? false
    : false;

  // Get cached data - sync.getQuery is stable via useCallback in SyncProvider
  const cachedData = cacheKey ? sync?.getQuery(cacheKey) : undefined;
  const hasCachedData = cachedData !== undefined;

  // Skip Convex if: explicitly skipped, have cached data, or offline
  const shouldSkip = isSkipped || hasCachedData || !isOnline;

  const convexResult = useConvexQuery(
    query,
    shouldSkip ? "skip" : (args[0] as Parameters<typeof useConvexQuery>[1])
  );

  // Save to cache when fresh data arrives
  // BUT skip if there are pending mutations for this module (preserve optimistic updates)
  const prevConvexResultRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (!sync || !cacheKey || convexResult === undefined) return;
    // Skip if pending mutations - optimistic update takes priority
    if (hasPendingForModule) return;
    // Only save if result changed (avoid infinite loops)
    if (prevConvexResultRef.current === convexResult) return;
    prevConvexResultRef.current = convexResult;
    sync.setQuery(cacheKey, convexResult);
  }, [sync, cacheKey, convexResult, hasPendingForModule]);

  // Return: skip → cached → convex → undefined (offline)
  if (isSkipped) {
    return undefined;
  }

  if (hasCachedData) {
    return cachedData as Query["_returnType"];
  }

  if (!isOnline) {
    return undefined;
  }

  return convexResult;
}
