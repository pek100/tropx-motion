/**
 * Encrypted Offline Cache
 *
 * Provides client-side caching for Convex queries with:
 * - AES-256-GCM encryption at rest
 * - Per-user IndexedDB storage
 * - LRU eviction (500MB limit)
 * - Offline mutation queuing
 * - Key rotation support
 *
 * Usage:
 * ```tsx
 * // Wrap app with CacheProvider
 * <CacheProvider>
 *   <App />
 * </CacheProvider>
 *
 * // Use cached queries (drop-in replacement for useQuery)
 * const { data, isCached } = useCachedQuery(api.dashboard.getPatientMetricsHistory, { subjectId });
 *
 * // Use offline-aware mutations
 * const { mutate, isOffline } = useCachedMutation(api.sessions.update);
 * ```
 */

// Provider
export { CacheProvider, useCache, useCacheOptional } from "./CacheProvider";
export type { CacheContextValue } from "./CacheProvider";

// Hooks
export { useCachedQuery, generateCacheKey } from "./useCachedQuery";
export type { UseCachedQueryOptions, UseCachedQueryResult } from "./useCachedQuery";

export { useSyncedQuery } from "./useSyncedQuery";
export type { UseSyncedQueryOptions, UseSyncedQueryResult, TimestampEntry } from "./useSyncedQuery";

export { useCachedMutation, usePendingMutations } from "./useCachedMutation";
export type { UseCachedMutationOptions, UseCachedMutationResult } from "./useCachedMutation";

// Imperative query caching (for convex.query() calls)
export { cacheQuery, getCachedData, invalidateCache } from "./cacheQuery";
export type { CacheQueryOptions, CacheQueryResult } from "./cacheQuery";

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
