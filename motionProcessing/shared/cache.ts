import { CACHE } from './constants';

interface CacheItem<T> {
    value: T;
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

/**
 * Generic LRU cache with time-based expiration and automatic cleanup.
 * Combines size-based eviction with TTL for optimal memory management.
 */
export class Cache<T> {
    private cache = new Map<string, CacheItem<T>>();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private lastCleanup = Date.now();

    constructor(
        private maxSize: number = CACHE.DEFAULT_MAX_SIZE,
        private maxAge: number = CACHE.DEFAULT_MAX_AGE_MS
    ) {
        this.startCleanupTimer();
    }

    /**
     * Stores value in cache with automatic cleanup if size limit exceeded.
     */
    set(key: string, value: T): void {
        const now = Date.now();

        if (this.shouldPerformCleanup(now)) {
            this.performCleanup();
        }

        this.cache.set(key, this.createCacheItem(value, now));
    }

    /**
     * Retrieves value from cache, updating access statistics and checking expiration.
     */
    get(key: string): T | null {
        const item = this.cache.get(key);
        if (!item) return null;

        const now = Date.now();
        if (this.isItemExpired(item, now)) {
            this.cache.delete(key);
            return null;
        }

        this.updateItemAccess(item, now);
        return item.value;
    }

    /**
     * Returns all non-expired cache values after cleanup.
     */
    getAll(): Map<string, T> {
        this.performCleanup();
        const result = new Map<string, T>();

        this.cache.forEach((item, key) => {
            result.set(key, item.value);
        });

        return result;
    }

    /**
     * Returns most recently added cache entry after cleanup.
     */
    getLatest(): { key: string; value: T } | null {
        this.performCleanup();

        let latestKey: string | null = null;
        let latestValue: T | null = null;
        let latestTimestamp = 0;

        this.cache.forEach((item: CacheItem<T>, key: string) => {
            if (item.timestamp > latestTimestamp) {
                latestKey = key;
                latestValue = item.value;
                latestTimestamp = item.timestamp;
            }
        });

        return latestKey && latestValue !== null ? { key: latestKey, value: latestValue } : null;
    }

    /**
     * Returns current cache size after cleanup.
     */
    size(): number {
        this.performCleanup();
        return this.cache.size;
    }

    /**
     * Clears all cached data.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Performs cleanup and stops background timer.
     */
    cleanup(): void {
        this.stopCleanupTimer();
        this.clear();
    }

    /**
     * Creates cache item with metadata for tracking access patterns.
     */
    private createCacheItem(value: T, timestamp: number): CacheItem<T> {
        return {
            value,
            timestamp,
            accessCount: 0,
            lastAccessed: timestamp
        };
    }

    /**
     * Determines if cleanup should run based on cache size or time elapsed.
     */
    private shouldPerformCleanup(now: number): boolean {
        return this.cache.size >= this.maxSize || (now - this.lastCleanup) > this.maxAge;
    }

    /**
     * Checks if cache item has exceeded maximum age.
     */
    private isItemExpired(item: CacheItem<T>, now: number): boolean {
        return (now - item.timestamp) > this.maxAge;
    }

    /**
     * Updates access statistics for LRU tracking.
     */
    private updateItemAccess(item: CacheItem<T>, now: number): void {
        item.accessCount++;
        item.lastAccessed = now;
    }

    /**
     * Removes expired items and enforces size limits using LRU eviction.
     */
    private performCleanup(): void {
        const now = Date.now();
        const keysToDelete = this.getKeysToDelete(now);

        keysToDelete.forEach(key => this.cache.delete(key));
        this.lastCleanup = now;
    }

    /**
     * Identifies keys for deletion based on expiration and LRU policies.
     */
    private getKeysToDelete(now: number): string[] {
        const expiredKeys = this.getExpiredKeys(now);
        const excessKeys = this.getExcessKeys(expiredKeys);

        return [...expiredKeys, ...excessKeys];
    }

    /**
     * Finds all expired cache entries.
     */
    private getExpiredKeys(now: number): string[] {
        const expiredKeys: string[] = [];

        this.cache.forEach((item, key) => {
            if (this.isItemExpired(item, now)) {
                expiredKeys.push(key);
            }
        });

        return expiredKeys;
    }

    /**
     * Finds excess entries to evict using LRU policy.
     */
    private getExcessKeys(expiredKeys: string[]): string[] {
        const remainingCount = this.cache.size - expiredKeys.length;
        if (remainingCount <= this.maxSize) return [];

        // LRU eviction - remove least recently accessed items
        const remaining = Array.from(this.cache.entries())
            .filter(([key]) => !expiredKeys.includes(key))
            .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed);

        const excessCount = remainingCount - this.maxSize;
        return remaining.slice(0, excessCount).map(([key]) => key);
    }

    /**
     * Starts periodic cleanup timer based on cache configuration.
     */
    private startCleanupTimer(): void {
        const cleanupInterval = Math.min(CACHE.CLEANUP_INTERVAL_MS, this.maxAge);
        this.cleanupInterval = setInterval(() => {
            this.performCleanup();
        }, cleanupInterval);
    }

    /**
     * Stops periodic cleanup timer.
     */
    private stopCleanupTimer(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}