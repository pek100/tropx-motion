"use client";

import { ReactNode, useMemo, useEffect, useRef } from "react";
import {
  ConvexReactClient,
  useQuery as useConvexQuery,
  useMutation,
  useAction,
  useConvex,
  useConvexAuth,
  useConvexConnectionState,
} from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { FunctionReference, OptionalRestArgs, getFunctionName } from "convex/server";
import { AutoSignIn } from "../components/auth/AutoSignIn";
import { CacheProvider, SyncProvider } from "./cache";
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
  const connectionState = useConvexConnectionState();

  // Handle "skip" argument
  const isSkipped = args[0] === "skip";
  const queryArgs = (isSkipped ? {} : args[0] ?? {}) as Record<string, unknown>;

  // Check if we're offline
  const isOffline = connectionState.isWebSocketConnected === false;

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
  const prevConvexResultRef = useRef<unknown>(undefined);
  useEffect(() => {
    if (!sync || !cacheKey || convexResult === undefined) return;
    // Only save if result changed (avoid infinite loops)
    if (prevConvexResultRef.current === convexResult) return;
    prevConvexResultRef.current = convexResult;
    sync.setQuery(cacheKey, convexResult);
  }, [sync, cacheKey, convexResult]);

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
// Re-exports from convex/react
// ─────────────────────────────────────────────────────────────────

export { useMutation, useAction, useConvex, useConvexAuth };

// Re-export types
export type { OptionalRestArgs, FunctionReference } from "convex/server";
