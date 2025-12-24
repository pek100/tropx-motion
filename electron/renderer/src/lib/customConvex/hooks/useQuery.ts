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

  // Handle "skip" argument
  const isSkipped = args[0] === "skip";
  const queryArgs = (isSkipped ? {} : args[0] ?? {}) as Record<string, unknown>;

  // Generate cache key: queryName:argsJson
  const cacheKey = useMemo(() => {
    if (isSkipped) return null;
    try {
      const queryName = getQueryName(query);
      return `${queryName}:${JSON.stringify(queryArgs)}`;
    } catch {
      return null;
    }
  }, [query, queryArgs, isSkipped]);

  // Extract module from cache key (e.g., "users:getContacts:{}" → "users")
  const queryModule = useMemo(() => {
    if (!cacheKey) return null;
    return cacheKey.split(":")[0];
  }, [cacheKey]);

  // Check if this module has pending mutations (optimistic updates in flight)
  const hasPendingForModule = queryModule
    ? cache?.pendingModules?.has(queryModule) ?? false
    : false;

  // Get cached data (works for both proactive and on-demand cache)
  const cachedData = useMemo(() => {
    if (!sync || !cacheKey) return undefined;
    return sync.getQuery(cacheKey);
  }, [sync, cacheKey]);

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
