"use client";

import { ReactNode, useMemo, useEffect, useRef, useCallback } from "react";
import {
  ConvexReactClient,
  useQuery as useConvexQuery,
  useMutation as useConvexMutation,
  useAction,
  useConvex,
  useConvexAuth,
  useConvexConnectionState,
} from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { FunctionReference, OptionalRestArgs, getFunctionName, FunctionArgs, FunctionReturnType } from "convex/server";
import { AutoSignIn } from "../components/auth/AutoSignIn";
import { CacheProvider, SyncProvider, useCacheOptional } from "./cache";
import { useSyncOptional } from "./cache/SyncProvider";
import { isElectron } from "./platform";

// Initialize Convex client
// In Electron, get from preload; in web/dev, use import.meta.env
const convexUrl =
  (typeof window !== 'undefined' && window.electronAPI?.config?.convexUrl) ||
  import.meta.env.VITE_CONVEX_URL;

// Enable verbose logging for auth debugging (check URL param or localStorage)
const isVerboseAuth = typeof window !== 'undefined' && (
  new URLSearchParams(window.location.search).get('verboseAuth') === 'true' ||
  localStorage.getItem('tropx_verbose_auth') === 'true'
);

console.log('[Convex] URL source:', window.electronAPI?.config?.convexUrl ? 'preload' : 'vite env')
console.log('[Convex] CONVEX_URL:', convexUrl ? 'configured' : 'NOT SET')
if (isVerboseAuth) {
  console.log('[Convex] Verbose auth logging enabled');
}

// Only create client if URL is configured
// Enable verbose mode for auth debugging when requested
const convex = convexUrl ? new ConvexReactClient(convexUrl, {
  verbose: isVerboseAuth,
}) : null;

console.log('[Convex] Client created:', !!convex)

interface ConvexClientProviderProps {
  children: ReactNode;
}

// Provider component that wraps app with Convex
export function ConvexClientProvider({ children }: ConvexClientProviderProps) {
  // If Convex is not configured, render children without provider
  if (!convex) {
    console.warn(
      "Convex not configured. Set VITE_CONVEX_URL in .env.local to enable cloud features."
    );
    return <>{children}</>;
  }

  // Use separate storage namespace for Electron to avoid conflicts with web app
  // Web uses default (convex URL), Electron uses "electron"
  const storageNamespace = isElectron() ? "electron" : undefined;

  return (
    <ConvexAuthProvider client={convex} storageNamespace={storageNamespace}>
      <AutoSignIn />
      <CacheProvider>
        <SyncProvider>
          {children}
        </SyncProvider>
      </CacheProvider>
    </ConvexAuthProvider>
  );
}

// Export client for direct usage if needed
export { convex };

// Check if Convex is configured
export function isConvexConfigured(): boolean {
  return !!convexUrl && !!convex;
}

// ─────────────────────────────────────────────────────────────────
// Cache Key Helper
// ─────────────────────────────────────────────────────────────────

/**
 * Get query name from function reference using Convex's built-in utility.
 * Returns format like "recordingSessions:getSession"
 */
function getQueryName(queryRef: FunctionReference<"query">): string {
  // Use Convex's official getFunctionName utility
  return getFunctionName(queryRef);
}

// ─────────────────────────────────────────────────────────────────
// useQuery - Drop-in replacement with unified caching
// ─────────────────────────────────────────────────────────────────

/**
 * Drop-in replacement for Convex's useQuery with unified caching.
 *
 * All queries use the same cache (sync.getQuery/setQuery):
 * - Proactively synced queries are pre-populated by SyncProvider
 * - Other queries are cached on-demand when first fetched
 * - Offline: Returns cached data, never hangs
 *
 * Cache key format: `${queryName}:${JSON.stringify(args)}`
 *
 * @example
 * ```tsx
 * import { useQuery } from "@/lib/convex";
 * const session = useQuery(api.recordingSessions.getSession, { sessionId });
 * ```
 */
export function useQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...args: OptionalRestArgs<Query>
): Query["_returnType"] | undefined {
  const sync = useSyncOptional();
  const cache = useCacheOptional();
  const connectionState = useConvexConnectionState();

  // Handle "skip" argument
  const isSkipped = args[0] === "skip";
  const queryArgs = (isSkipped ? {} : args[0] ?? {}) as Record<string, unknown>;

  // Check if we're offline - use multiple sources for reliability
  // navigator.onLine is false when truly offline (airplane mode, no network)
  // Convex WebSocket state may lag behind actual network status
  // CacheProvider tracks online/offline events
  const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  const convexOffline = connectionState.isWebSocketConnected === false;
  const cacheOffline = cache?.isOnline === false; // Only trust if explicitly false, not undefined
  const isOffline = browserOffline || convexOffline || cacheOffline;

  // Debug: log connection state on first render (only when offline or cache miss for debugging)
  const debugLoggedRef = useRef(false);

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
  const shouldSkip = isSkipped || hasCachedData || isOffline;

  const convexResult = useConvexQuery(
    query,
    shouldSkip ? "skip" : (args[0] as any)
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

  if (isOffline) {
    return undefined;
  }

  return convexResult;
}

// ─────────────────────────────────────────────────────────────────
// useMutation - Generic mutation with queue + optimistic updates
// ─────────────────────────────────────────────────────────────────

/** Common ID field names for extracting record identifiers */
const ID_FIELD_NAMES = ["_id", "id", "userId", "sessionId", "notificationId", "inviteId"];

/**
 * Check if a record matches the given ID fields.
 */
function recordMatchesIds(
  record: Record<string, unknown>,
  idFields: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(idFields)) {
    if (record[key] !== value) return false;
  }
  return true;
}

/**
 * Apply field updates to a record, returning new record if changed.
 */
function applyFieldsToRecord(
  record: Record<string, unknown>,
  updateFields: Record<string, unknown>
): Record<string, unknown> {
  return { ...record, ...updateFields };
}

/**
 * Apply optimistic update to cached data by finding records with matching IDs.
 * Searches through all cached queries and updates matching records.
 */
function applyOptimisticUpdate(
  sync: ReturnType<typeof useSyncOptional>,
  mutationPath: string,
  args: Record<string, unknown>
): void {
  if (!sync) {
    console.log(`[optimistic] No sync context`);
    return;
  }

  // Extract ID fields from args
  const idFields: Record<string, unknown> = {};
  for (const field of ID_FIELD_NAMES) {
    if (args[field] !== undefined) {
      idFields[field] = args[field];
    }
  }

  // No ID fields - can't match records
  if (Object.keys(idFields).length === 0) {
    console.log(`[optimistic] No ID fields found in args`);
    return;
  }

  // Get fields to update (exclude ID fields)
  const updateFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (!ID_FIELD_NAMES.includes(key)) {
      updateFields[key] = value;
    }
  }

  // No update fields - nothing to do
  if (Object.keys(updateFields).length === 0) {
    console.log(`[optimistic] No update fields found`);
    return;
  }

  // Get module from mutation path (e.g., "users:setContactStar" → "users")
  const module = mutationPath.split(":")[0];

  // Get all cache keys and filter by module
  const allKeys = sync.getQueryKeys();
  const relevantKeys = allKeys.filter((key) => key.startsWith(`${module}:`));

  console.log(`[optimistic] Module: ${module}, idFields:`, idFields, `updateFields:`, updateFields);
  console.log(`[optimistic] Relevant cache keys:`, relevantKeys);

  // Collect all updates for batch processing
  const batchUpdates: Array<{ key: string; data: unknown }> = [];

  for (const cacheKey of relevantKeys) {
    const cachedData = sync.getQuery(cacheKey);
    if (!cachedData) continue;

    let updated = false;
    let newData: unknown = cachedData;

    // Handle array of records
    if (Array.isArray(cachedData)) {
      const newArray = cachedData.map((item) => {
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          if (recordMatchesIds(record, idFields)) {
            updated = true;
            return applyFieldsToRecord(record, updateFields);
          }
        }
        return item;
      });
      if (updated) {
        newData = newArray;
      }
    }
    // Handle single record
    else if (typeof cachedData === "object" && cachedData !== null) {
      const record = cachedData as Record<string, unknown>;
      if (recordMatchesIds(record, idFields)) {
        updated = true;
        newData = applyFieldsToRecord(record, updateFields);
      }
    }

    if (updated) {
      console.log(`[optimistic] Will update cache key: ${cacheKey}`);
      batchUpdates.push({ key: cacheKey, data: newData });
    }
  }

  // Apply all updates in a single batch (one state update)
  if (batchUpdates.length > 0) {
    sync.setQueryBatch(batchUpdates);
    console.log(`[optimistic] Batch updated ${batchUpdates.length} cache entries`);
  }
}

/**
 * Generic mutation hook with:
 * - Optimistic cache updates (instant UI)
 * - Queue-based Convex sync (fire & forget)
 *
 * The mutation is processed asynchronously via the queue.
 * UI updates immediately via optimistic update, no need to await.
 *
 * @example
 * ```tsx
 * const setContactStar = useMutation(api.users.setContactStar);
 * setContactStar({ userId, starred: true }); // Fire & forget
 * ```
 */
export function useMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation
): (args: FunctionArgs<Mutation>) => void {
  const sync = useSyncOptional();
  const cache = useCacheOptional();
  const convexMutation = useConvexMutation(mutation);

  // Get mutation path for queue
  const getMutationPath = useCallback((): string => {
    try {
      return getFunctionName(mutation);
    } catch {
      return String(mutation);
    }
  }, [mutation]);

  const mutate = useCallback(
    (args: FunctionArgs<Mutation>): void => {
      const now = Date.now();
      const argsRecord = args as Record<string, unknown>;
      const mutationPath = getMutationPath();

      console.log(`[useMutation] ${mutationPath}`, { args: argsRecord });

      // Add modifiedAt timestamp for LWW
      const argsWithTimestamp = { ...argsRecord, modifiedAt: now };

      // 1. Apply optimistic update to cache
      if (sync) {
        try {
          applyOptimisticUpdate(sync, mutationPath, argsRecord);
        } catch (e) {
          console.error(`[useMutation] Optimistic update failed:`, e);
        }
      }

      // 2. Add to queue (fire & forget - queue processes in background)
      if (cache?.mutationQueue) {
        cache.mutationQueue.enqueue(mutationPath, argsWithTimestamp).catch((e) => {
          console.error(`[useMutation] Failed to enqueue:`, e);
        });
      } else {
        // Fallback: send directly if no queue
        convexMutation(argsWithTimestamp as FunctionArgs<Mutation>).catch((e) => {
          console.error(`[useMutation] Direct mutation failed:`, e);
        });
      }
    },
    [sync, cache?.mutationQueue, convexMutation, getMutationPath]
  );

  return mutate;
}

// ─────────────────────────────────────────────────────────────────
// Re-exports from convex/react
// ─────────────────────────────────────────────────────────────────

export { useAction, useConvex, useConvexAuth };

// Re-export types
export type { OptionalRestArgs, FunctionReference } from "convex/server";
