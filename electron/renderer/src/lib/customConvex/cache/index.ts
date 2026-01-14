/**
 * Cache Module Exports
 */

// Providers
export { SyncProvider, useSync, useSyncOptional } from "./SyncProvider";
export type { SyncContextValue } from "./SyncProvider";

export { CacheProvider, useCache, useCacheOptional } from "./CacheProvider";
export type { CacheContextValue } from "./CacheProvider";

// Store
export { CacheStore, deleteUserCache, listCacheDatabases } from "./store";
export type { CacheEntry, CacheStats, StoreDEKResult } from "./store";

// Lease
export {
  storeLease,
  getLease,
  clearLease,
  isLeaseValid,
  getLeaseDaysRemaining,
} from "./store";
export type { LeaseInfo } from "./store";

// Last User ID (for offline bootstrap)
export {
  storeLastUserId,
  getLastUserId,
  clearLastUserId,
} from "./store";

// Mutation Queue
export { MutationQueue, clearMutationQueue } from "./mutationQueue";
export type { QueuedMutation, MutationQueueStats } from "./mutationQueue";

// Fallback Queue
export {
  getFallbackMutations,
  enqueueFallbackMutation,
  removeFallbackMutation,
  clearFallbackMutations,
  getFallbackMutationCount,
  drainFallbackMutations,
} from "./fallbackQueue";
export type { FallbackMutation } from "./fallbackQueue";

// Encryption
export {
  isCryptoAvailable,
  verifyEncryption,
  hashArgs,
} from "./encryption";
