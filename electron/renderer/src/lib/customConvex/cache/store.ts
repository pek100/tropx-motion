/**
 * Encrypted IndexedDB Cache Store with LRU Eviction
 *
 * Per-user isolated databases with automatic encryption/decryption.
 * Implements LRU (Least Recently Used) eviction when storage exceeds limit.
 */

import {
  encrypt,
  decrypt,
  type EncryptedData,
  type WrappedKey,
} from "./encryption";
import { isElectron } from "../../platform";
import { debug } from "../internal/debug";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DB_PREFIX = "tropx_cache_";
const DEK_KEY_PREFIX = "tropx_cache_dek";
const KEK_SESSION_PREFIX = "tropx_cache_kek_session";
const LEASE_PREFIX = "tropx_cache_lease";
const LAST_USER_PREFIX = "tropx_cache_last_user";
const CACHE_STORE = "cache";
const META_STORE = "meta";
const DB_VERSION = 1;

// Cache schema version - bump this when serialization format changes
// This will auto-clear old incompatible caches
const CACHE_SCHEMA_VERSION = 2; // v2: binary-safe serialization (ArrayBuffer support)
const SCHEMA_VERSION_KEY = "schema_version";

const DEFAULT_MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
const EVICTION_BATCH_SIZE = 10; // Evict 10 items at a time

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  key: string;
  data: T;
  version: number; // modifiedAt from server
  cachedAt: number; // when cached locally
  accessedAt: number; // last access time (for LRU)
  size: number; // approximate size in bytes
}

interface StoredEntry {
  key: string;
  encrypted: EncryptedData;
  version: number;
  cachedAt: number;
  accessedAt: number;
  size: number;
}

interface CacheMeta {
  key: string;
  value: number | string;
}

export interface CacheStats {
  totalSize: number;
  entryCount: number;
  oldestAccess: number;
  newestAccess: number;
}

// ─────────────────────────────────────────────────────────────────
// Cache Store Class
// ─────────────────────────────────────────────────────────────────

export class CacheStore {
  private db: IDBDatabase | null = null;
  private userId: string;
  private dek: CryptoKey | null = null;
  private maxSizeBytes: number;

  constructor(userId: string, maxSizeBytes = DEFAULT_MAX_SIZE_BYTES) {
    this.userId = userId;
    this.maxSizeBytes = maxSizeBytes;
  }

  // ─── Initialization ──────────────────────────────────────────────

  /** Open the database and initialize with DEK. */
  async open(dek: CryptoKey): Promise<void> {
    this.dek = dek;
    this.db = await this.openDatabase();

    // Check schema version and clear if incompatible
    await this.checkAndMigrateSchema();
  }

  /** Check schema version and clear cache if it's from an old incompatible version. */
  private async checkAndMigrateSchema(): Promise<void> {
    if (!this.db) return;

    try {
      const storedVersion = await this.getMetaValue(SCHEMA_VERSION_KEY);
      const currentVersion = storedVersion ? Number(storedVersion) : 0;

      debug.cache.log(`Schema check: stored=${currentVersion}, required=${CACHE_SCHEMA_VERSION}`);

      if (currentVersion < CACHE_SCHEMA_VERSION) {
        debug.cache.log(`Schema version mismatch, clearing old cache`);
        // Clear all cached data (old format is incompatible)
        await this.clear();
        // Store new version
        await this.setMetaValue(SCHEMA_VERSION_KEY, CACHE_SCHEMA_VERSION);
        debug.cache.log(`Schema version set to ${CACHE_SCHEMA_VERSION}`);
      } else {
        debug.cache.log(`Schema version OK, cache preserved`);
      }
    } catch (error) {
      debug.cache.error("Schema migration failed:", error);
      // On error, try to clear and set version anyway
      try {
        await this.clear();
        await this.setMetaValue(SCHEMA_VERSION_KEY, CACHE_SCHEMA_VERSION);
      } catch {
        // Ignore secondary errors
      }
    }
  }

  /** Get a value from the meta store. */
  private async getMetaValue(key: string): Promise<string | number | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(META_STORE, "readonly");
      const store = tx.objectStore(META_STORE);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result as CacheMeta | undefined;
        resolve(result?.value ?? null);
      };
    });
  }

  /** Set a value in the meta store. */
  private async setMetaValue(key: string, value: string | number): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      const request = store.put({ key, value });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.dek = null;
  }

  /** Check if store is ready. */
  isOpen(): boolean {
    return this.db !== null && this.dek !== null;
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const dbName = `${DB_PREFIX}${this.userId}`;
      const request = indexedDB.open(dbName, DB_VERSION);

      request.onerror = () => reject(request.error);

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Cache store with accessedAt index for LRU
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          const cacheStore = db.createObjectStore(CACHE_STORE, {
            keyPath: "key",
          });
          cacheStore.createIndex("accessedAt", "accessedAt", { unique: false });
          cacheStore.createIndex("cachedAt", "cachedAt", { unique: false });
        }

        // Meta store for stats
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
    });
  }

  // ─── CRUD Operations ─────────────────────────────────────────────

  /** Store a cache entry (encrypts automatically). */
  async put<T>(
    key: string,
    data: T,
    version: number
  ): Promise<void> {
    if (!this.db || !this.dek) {
      throw new Error("Cache store not initialized");
    }

    const encrypted = await encrypt(data, this.dek);
    const size = this.estimateSize(encrypted);
    const now = Date.now();

    const entry: StoredEntry = {
      key,
      encrypted,
      version,
      cachedAt: now,
      accessedAt: now,
      size,
    };

    await this.putEntry(entry);
    await this.evictIfNeeded();
  }

  /** Get a cache entry (decrypts automatically). */
  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.db || !this.dek) {
      throw new Error("Cache store not initialized");
    }

    const stored = await this.getEntry(key);
    if (!stored) return null;

    try {
      const data = await decrypt<T>(stored.encrypted, this.dek);

      // Update access time (async, don't block)
      this.updateAccessTime(key).catch(console.error);

      return {
        key: stored.key,
        data,
        version: stored.version,
        cachedAt: stored.cachedAt,
        accessedAt: stored.accessedAt,
        size: stored.size,
      };
    } catch (error) {
      // Decryption failed - likely key mismatch, remove corrupted entry
      console.error(`Failed to decrypt cache entry ${key}:`, error);
      await this.delete(key);
      return null;
    }
  }

  /** Delete a cache entry. */
  async delete(key: string): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readwrite");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /** Check if a key exists and get its version. */
  async getVersion(key: string): Promise<number | null> {
    if (!this.db) return null;

    const stored = await this.getEntry(key);
    return stored?.version ?? null;
  }

  /** Get all cache keys. */
  async keys(): Promise<string[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readonly");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as string[]);
    });
  }

  /** Clear all entries. */
  async clear(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readwrite");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  // ─── LRU Eviction ────────────────────────────────────────────────

  /** Get current cache statistics. */
  async getStats(): Promise<CacheStats> {
    if (!this.db) {
      return { totalSize: 0, entryCount: 0, oldestAccess: 0, newestAccess: 0 };
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readonly");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entries = request.result as StoredEntry[];
        if (entries.length === 0) {
          resolve({
            totalSize: 0,
            entryCount: 0,
            oldestAccess: 0,
            newestAccess: 0,
          });
          return;
        }

        const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
        const accessTimes = entries.map((e) => e.accessedAt);

        resolve({
          totalSize,
          entryCount: entries.length,
          oldestAccess: Math.min(...accessTimes),
          newestAccess: Math.max(...accessTimes),
        });
      };
    });
  }

  /** Evict LRU entries if over size limit. */
  async evictIfNeeded(): Promise<number> {
    const stats = await this.getStats();
    if (stats.totalSize <= this.maxSizeBytes) return 0;

    let evicted = 0;
    let currentSize = stats.totalSize;

    while (currentSize > this.maxSizeBytes * 0.9) {
      // Evict to 90% capacity
      const lruEntries = await this.getLRUEntries(EVICTION_BATCH_SIZE);
      if (lruEntries.length === 0) break;

      for (const entry of lruEntries) {
        await this.delete(entry.key);
        currentSize -= entry.size;
        evicted++;
      }
    }

    if (evicted > 0) {
      debug.cache.log(`Evicted ${evicted} LRU entries`);
    }

    return evicted;
  }

  /** Get N least recently used entries. */
  private async getLRUEntries(count: number): Promise<StoredEntry[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readonly");
      const store = tx.objectStore(CACHE_STORE);
      const index = store.index("accessedAt");
      const request = index.openCursor();

      const entries: StoredEntry[] = [];

      request.onerror = () => reject(request.error);
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && entries.length < count) {
          entries.push(cursor.value);
          cursor.continue();
        } else {
          resolve(entries);
        }
      };
    });
  }

  // ─── Internal Helpers ────────────────────────────────────────────

  private async putEntry(entry: StoredEntry): Promise<void> {
    if (!this.db) {
      throw new Error("Cache store not initialized");
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readwrite");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.put(entry);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async getEntry(key: string): Promise<StoredEntry | null> {
    if (!this.db) {
      return null; // Return null if store closed (race condition safe)
    }

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(CACHE_STORE, "readonly");
      const store = tx.objectStore(CACHE_STORE);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  private async updateAccessTime(key: string): Promise<void> {
    // Silent return if store is closed (called async from get())
    if (!this.db) return;

    const entry = await this.getEntry(key);
    if (!entry || !this.db) return; // Check again after async operation

    entry.accessedAt = Date.now();
    await this.putEntry(entry);
  }

  private estimateSize(encrypted: EncryptedData): number {
    // Approximate size: ciphertext + IV + JSON overhead
    return encrypted.ciphertext.length + encrypted.iv.length + 100;
  }
}

// ─────────────────────────────────────────────────────────────────
// Key Storage (localStorage for reliability, platform-scoped)
// ─────────────────────────────────────────────────────────────────

/** Get localStorage key for wrapped DEK (platform-specific to avoid conflicts). */
function getDEKStorageKey(userId: string): string {
  const platform = isElectron() ? "electron" : "web";
  return `${DEK_KEY_PREFIX}_${platform}_${userId}`;
}

export interface StoreDEKResult {
  success: boolean;
  error?: string;
}

/** Store wrapped DEK for a user (synchronous, uses localStorage). */
export async function storeWrappedDEK(
  userId: string,
  wrappedDEK: WrappedKey
): Promise<StoreDEKResult> {
  try {
    const key = getDEKStorageKey(userId);
    debug.cache.log(`Storing DEK with version: ${wrappedDEK.version}`);
    localStorage.setItem(key, JSON.stringify(wrappedDEK));
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    debug.cache.error("Failed to store DEK:", message);

    // Handle QuotaExceededError specifically
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      return { success: false, error: "Storage quota exceeded. Clear browser data to continue." };
    }

    return { success: false, error: message };
  }
}

/** Get wrapped DEK for a user. */
export async function getWrappedDEK(
  userId: string
): Promise<WrappedKey | null> {
  try {
    const key = getDEKStorageKey(userId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as WrappedKey;
    return parsed;
  } catch (error) {
    debug.cache.error("Failed to get DEK:", error);
    return null;
  }
}

/** Delete wrapped DEK for a user. */
export async function deleteWrappedDEK(userId: string): Promise<void> {
  try {
    const key = getDEKStorageKey(userId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error("[deleteWrappedDEK] Failed to delete DEK:", error);
  }
}

// ─────────────────────────────────────────────────────────────────
// Database Management
// ─────────────────────────────────────────────────────────────────

/** Delete a user's entire cache database. */
export async function deleteUserCache(userId: string): Promise<void> {
  const dbName = `${DB_PREFIX}${userId}`;
  await deleteDatabase(dbName);
  await deleteWrappedDEK(userId);
}

/** List all user cache databases. */
export async function listCacheDatabases(): Promise<string[]> {
  if (!indexedDB.databases) {
    // Firefox doesn't support databases(), return empty
    return [];
  }

  const dbs = await indexedDB.databases();
  return dbs
    .filter((db) => db.name?.startsWith(DB_PREFIX))
    .map((db) => db.name!.replace(DB_PREFIX, ""));
}

async function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// ─────────────────────────────────────────────────────────────────
// KEK Cache (localStorage for offline support across app restarts)
// ─────────────────────────────────────────────────────────────────
// Note: KEK is stored in localStorage (same as JWT) to enable offline
// access across app restarts. Security analysis:
// - If attacker has XSS, they can read cache directly anyway
// - KEK only protects local data, not server data
// - For Electron apps, sessionStorage provides no real security benefit

export interface SessionKEK {
  kekWrapped: string;
  kekVersion: number;
}

/** Get localStorage key for KEK. */
function getKEKStorageKey(userId: string): string {
  const platform = isElectron() ? "electron" : "web";
  return `${KEK_SESSION_PREFIX}_${platform}_${userId}`;
}

/** Store KEK in localStorage (survives app restart for offline access). */
export function storeSessionKEK(userId: string, kek: SessionKEK): void {
  try {
    const key = getKEKStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(kek));
  } catch (error) {
    debug.cache.error("Failed to store KEK:", error);
  }
}

/** Get KEK from localStorage. */
export function getSessionKEK(userId: string): SessionKEK | null {
  try {
    const key = getKEKStorageKey(userId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as SessionKEK;
  } catch (error) {
    debug.cache.error("Failed to get KEK:", error);
    return null;
  }
}

/** Clear KEK (on logout). */
export function clearSessionKEK(userId: string): void {
  try {
    const key = getKEKStorageKey(userId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error("[clearSessionKEK] Failed to clear KEK:", error);
  }
}

// ─────────────────────────────────────────────────────────────────
// Lease Validity Storage (localStorage for persistence across sessions)
// ─────────────────────────────────────────────────────────────────

export interface LeaseInfo {
  validUntil: number;
  daysRemaining: number;
  updatedAt: number;
}

/** Get localStorage key for lease info. */
function getLeaseStorageKey(userId: string): string {
  const platform = isElectron() ? "electron" : "web";
  return `${LEASE_PREFIX}_${platform}_${userId}`;
}

/** Store lease validity info (survives app close). */
export function storeLease(userId: string, lease: LeaseInfo): void {
  try {
    const key = getLeaseStorageKey(userId);
    localStorage.setItem(key, JSON.stringify(lease));
  } catch (error) {
    debug.cache.error("Failed to store lease:", error);
  }
}

/** Get stored lease validity info. */
export function getLease(userId: string): LeaseInfo | null {
  try {
    const key = getLeaseStorageKey(userId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    return JSON.parse(stored) as LeaseInfo;
  } catch (error) {
    debug.cache.error("Failed to get lease:", error);
    return null;
  }
}

/** Clear lease info. */
export function clearLease(userId: string): void {
  try {
    const key = getLeaseStorageKey(userId);
    localStorage.removeItem(key);
  } catch (error) {
    console.error("[clearLease] Failed to clear lease:", error);
  }
}

/** Check if the stored lease is still valid. */
export function isLeaseValid(userId: string): boolean {
  const lease = getLease(userId);
  if (!lease) return false;
  return Date.now() < lease.validUntil;
}

/** Get days remaining on the lease (0 if expired or not found). */
export function getLeaseDaysRemaining(userId: string): number {
  const lease = getLease(userId);
  if (!lease) return 0;
  const msRemaining = lease.validUntil - Date.now();
  if (msRemaining <= 0) return 0;
  return Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
}

// ─────────────────────────────────────────────────────────────────
// Last User ID Storage (for offline bootstrap)
// ─────────────────────────────────────────────────────────────────

/** Get localStorage key for last user ID. */
function getLastUserStorageKey(): string {
  const platform = isElectron() ? "electron" : "web";
  return `${LAST_USER_PREFIX}_${platform}`;
}

/** Store the last known user ID (for offline bootstrap). */
export function storeLastUserId(userId: string): void {
  try {
    const key = getLastUserStorageKey();
    localStorage.setItem(key, userId);
  } catch (error) {
    debug.cache.error("Failed to store user ID:", error);
  }
}

/** Get the last known user ID (for offline bootstrap). */
export function getLastUserId(): string | null {
  try {
    const key = getLastUserStorageKey();
    return localStorage.getItem(key);
  } catch (error) {
    debug.cache.error("Failed to get user ID:", error);
    return null;
  }
}

/** Clear the last user ID (on logout). */
export function clearLastUserId(): void {
  try {
    const key = getLastUserStorageKey();
    localStorage.removeItem(key);
  } catch (error) {
    debug.cache.error("Failed to clear user ID:", error);
  }
}
