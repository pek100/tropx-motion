/**
 * Custom Convex - Offline-first wrapper around Convex
 *
 * Usage:
 * ```tsx
 * import { useQuery, useMutation, ConvexClientProvider } from "@/lib/customConvex";
 *
 * // In app root:
 * <ConvexClientProvider>{children}</ConvexClientProvider>
 *
 * // In components:
 * const data = useQuery(api.users.getMe, {});
 * const mutate = useMutation(api.users.update);
 * ```
 */

// ─────────────────────────────────────────────────────────────────
// Hooks (main consumer API)
// ─────────────────────────────────────────────────────────────────

export { useQuery, useMutation } from "./hooks";

// ─────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────

export { ConvexClientProvider, isConvexConfigured } from "./provider";

// ─────────────────────────────────────────────────────────────────
// Connectivity
// ─────────────────────────────────────────────────────────────────

export { useConnectivity, useIsOnline } from "./internal/connectivity";

// ─────────────────────────────────────────────────────────────────
// Cache (for advanced usage)
// ─────────────────────────────────────────────────────────────────

export {
  // Providers & hooks
  useCache,
  useCacheOptional,
  useSync,
  useSyncOptional,
  // Store
  CacheStore,
  deleteUserCache,
  listCacheDatabases,
  // Mutation queue
  MutationQueue,
  clearMutationQueue,
  // Fallback queue
  getFallbackMutations,
  enqueueFallbackMutation,
  clearFallbackMutations,
  drainFallbackMutations,
  // Encryption
  isCryptoAvailable,
  verifyEncryption,
} from "./cache";

export type {
  CacheContextValue,
  SyncContextValue,
  CacheEntry,
  CacheStats,
  QueuedMutation,
  MutationQueueStats,
  FallbackMutation,
} from "./cache";

// ─────────────────────────────────────────────────────────────────
// Re-exports from convex/react (for convenience)
// ─────────────────────────────────────────────────────────────────

export { useAction, useConvex, useConvexAuth } from "convex/react";

// Re-export types
export type { OptionalRestArgs, FunctionReference } from "convex/server";

// Export the client for direct access if needed
export { convexClient } from "./internal/client";
