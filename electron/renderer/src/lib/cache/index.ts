/**
 * Unified Cache & Sync System
 *
 * Provides timestamp-based sync with offline caching:
 * - SyncProvider: Unified queries Map for all cached data
 * - Custom useQuery from @/lib/convex handles reactive queries with caching
 * - For imperative queries, use useSyncOptional() + getQuery/setQuery directly
 * - Offline mutation queuing via useCachedMutation
 *
 * Usage:
 * ```tsx
 * // Reactive queries (auto-cached)
 * import { useQuery } from '@/lib/convex';
 * const data = useQuery(api.users.getMe, {});
 *
 * // Imperative queries (manual cache)
 * const sync = useSyncOptional();
 * const cacheKey = `queryName:${JSON.stringify(args)}`;
 * let result = sync?.getQuery(cacheKey);
 * if (!result) {
 *   result = await convex.query(api.someQuery, args);
 *   sync?.setQuery(cacheKey, result);
 * }
 * ```
 */

// Sync Provider (unified cache for queries)
export { SyncProvider, useSync, useSyncOptional } from "./SyncProvider";
export type { SyncContextValue } from "./SyncProvider";

// Cache Provider (offline mutations, security, encryption)
export { CacheProvider, useCache, useCacheOptional } from "./CacheProvider";
export type { CacheContextValue } from "./CacheProvider";

// Offline Mutations
export { useCachedMutation, usePendingMutations } from "./useCachedMutation";
export type { UseCachedMutationOptions, UseCachedMutationResult } from "./useCachedMutation";

// Store (for advanced usage)
export { CacheStore, deleteUserCache, listCacheDatabases } from "./store";
export type { CacheEntry, CacheStats, StoreDEKResult } from "./store";

// Mutation Queue (for advanced usage)
export { MutationQueue, clearMutationQueue } from "./mutationQueue";
export type { QueuedMutation, MutationQueueStats } from "./mutationQueue";

// Fallback Queue (localStorage-based, for when main queue unavailable)
export {
  getFallbackMutations,
  enqueueFallbackMutation,
  removeFallbackMutation,
  clearFallbackMutations,
  getFallbackMutationCount,
  drainFallbackMutations,
} from "./fallbackQueue";
export type { FallbackMutation } from "./fallbackQueue";

// Encryption utilities (for testing/debugging)
export {
  isCryptoAvailable,
  verifyEncryption,
  hashArgs,
} from "./encryption";
