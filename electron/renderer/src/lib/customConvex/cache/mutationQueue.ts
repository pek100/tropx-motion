/**
 * Offline Mutation Queue
 *
 * Queues mutations when offline and syncs when connection is restored.
 * Uses IndexedDB for persistence across page reloads.
 *
 * Performance optimizations:
 * - In-memory cache to avoid IndexedDB reads on hot path
 * - Batched writes to reduce I/O overhead
 * - Minimal logging in production
 */

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const QUEUE_DB = "tropx_mutation_queue";
const QUEUE_STORE = "mutations";
const DB_VERSION = 1;

// Set to true for verbose logging (development only)
const DEBUG = false;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MutationStatus = "pending" | "processing" | "failed" | "synced";

/** Field with its timestamp for LWW merging */
export interface TimestampedField {
  value: unknown;
  modifiedAt: number;
}

export interface QueuedMutation {
  id: string;
  userId: string;
  mutationPath: string; // e.g., "recordingSessions.update"
  recordId: string; // Extracted from args for batching same-record mutations
  /** Fields with their timestamps for field-level LWW */
  fields: Record<string, TimestampedField>;
  /** Original args for execution (rebuilt from fields) */
  args: Record<string, unknown>;
  modifiedAt: number; // Latest modifiedAt across all fields
  createdAt: number;
  status: MutationStatus;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: number;
}

export interface MutationQueueStats {
  pending: number;
  processing: number;
  failed: number;
  total: number;
}

type MutationExecutor = (path: string, args: unknown) => Promise<unknown>;

// ─────────────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────────────

/** Error patterns that indicate the mutation will never succeed */
const PERMANENT_ERROR_PATTERNS = [
  "ArgumentValidationError",
  "Object is missing the required field",
  "Validator:",
];

/** Check if an error is permanent (will never succeed on retry) */
function isPermanentError(errorMessage: string): boolean {
  return PERMANENT_ERROR_PATTERNS.some((pattern) =>
    errorMessage.includes(pattern)
  );
}

// ─────────────────────────────────────────────────────────────────
// Record ID Extraction
// ─────────────────────────────────────────────────────────────────

/** Common ID field names to look for when extracting record ID */
const ID_FIELD_NAMES = ["_id", "id", "userId", "sessionId", "notificationId", "inviteId"];

/**
 * Extract record ID from mutation args.
 * Looks for common ID fields and builds a composite key.
 */
function extractRecordId(args: Record<string, unknown>): string {
  const idParts: string[] = [];

  for (const field of ID_FIELD_NAMES) {
    if (args[field] !== undefined) {
      idParts.push(`${field}:${String(args[field])}`);
    }
  }

  // If no ID fields found, use stringified args as fallback
  if (idParts.length === 0) {
    return JSON.stringify(args);
  }

  return idParts.join("|");
}

// ─────────────────────────────────────────────────────────────────
// Mutation Queue Class
// ─────────────────────────────────────────────────────────────────

export class MutationQueue {
  private db: IDBDatabase | null = null;
  private userId: string;
  private executor: MutationExecutor | null = null;
  private isProcessing = false;
  private listeners: Set<() => void> = new Set();

  // In-memory cache to avoid IndexedDB reads on hot path
  private cache: Map<string, QueuedMutation> = new Map();
  private cacheLoaded = false;

  constructor(userId: string) {
    this.userId = userId;
  }

  // ─── Initialization ──────────────────────────────────────────────

  /** Open the queue database and load cache. */
  async open(): Promise<void> {
    this.db = await this.openDatabase();
    // Load all mutations into memory cache
    await this.loadCache();
  }

  /** Load all user mutations into memory cache. */
  private async loadCache(): Promise<void> {
    if (!this.db) return;

    const mutations = await this.getAllFromDB();
    this.cache.clear();
    for (const m of mutations) {
      this.cache.set(m.id, m);
    }
    this.cacheLoaded = true;
    if (DEBUG) console.log(`[MutationQueue] Cache loaded: ${this.cache.size} mutations`);
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.cache.clear();
    this.cacheLoaded = false;
  }

  /** Set the mutation executor (Convex mutation function). */
  setExecutor(executor: MutationExecutor): void {
    this.executor = executor;
  }

  /** Subscribe to queue changes. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach((l) => l());
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(QUEUE_DB, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(QUEUE_STORE)) {
          const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
          store.createIndex("userId", "userId", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    });
  }

  // ─── Queue Operations ────────────────────────────────────────────

  /**
   * Add a mutation to the queue with field-level LWW merging.
   * If a pending mutation exists for the same mutationPath + recordId,
   * fields are merged using last-write-wins based on modifiedAt.
   */
  async enqueue(mutationPath: string, args: unknown): Promise<string> {
    if (!this.db) {
      throw new Error("Mutation queue not initialized");
    }

    const now = Date.now();
    const argsRecord = args as Record<string, unknown>;
    const recordId = extractRecordId(argsRecord);

    if (DEBUG) console.log(`[MutationQueue] Enqueue: ${mutationPath}, recordId: ${recordId}`);

    // Build timestamped fields from args
    const newFields: Record<string, TimestampedField> = {};
    for (const [key, value] of Object.entries(argsRecord)) {
      newFields[key] = { value, modifiedAt: now };
    }

    // Check for existing mutation with same path + recordId (pending or processing)
    // Uses in-memory cache for fast lookup
    const existing = this.findMergeableInCache(mutationPath, recordId);

    if (existing) {
      if (DEBUG) console.log(`[MutationQueue] Merging with existing: ${existing.id}`);
      // Merge fields using LWW
      const mergedFields = { ...existing.fields };
      for (const [key, newField] of Object.entries(newFields)) {
        const existingField = mergedFields[key];
        // Overwrite if new field is newer or field doesn't exist
        if (!existingField || newField.modifiedAt > existingField.modifiedAt) {
          mergedFields[key] = newField;
        }
      }

      // Rebuild args from merged fields
      const mergedArgs: Record<string, unknown> = {};
      let latestModifiedAt = existing.modifiedAt;
      for (const [key, field] of Object.entries(mergedFields)) {
        mergedArgs[key] = field.value;
        if (field.modifiedAt > latestModifiedAt) {
          latestModifiedAt = field.modifiedAt;
        }
      }

      // Update existing mutation - reset to pending so it gets (re)processed
      existing.fields = mergedFields;
      existing.args = mergedArgs;
      existing.modifiedAt = latestModifiedAt;
      existing.status = "pending"; // Reset to pending for reprocessing

      await this.putMutation(existing);
      this.notifyListeners();

      // Auto-process queue after update
      this.scheduleProcess();

      return existing.id;
    }

    // No existing mutation - create new one
    if (DEBUG) console.log(`[MutationQueue] New mutation: ${recordId}`);
    const mutation: QueuedMutation = {
      id: generateId(),
      userId: this.userId,
      mutationPath,
      recordId,
      fields: newFields,
      args: argsRecord,
      modifiedAt: now,
      createdAt: now,
      status: "pending",
      attempts: 0,
    };

    await this.putMutation(mutation);
    this.notifyListeners();

    // Auto-process queue after enqueue
    this.scheduleProcess();

    return mutation.id;
  }

  /** Schedule queue processing (immediate via microtask) */
  private processScheduled = false;
  private scheduleProcess(): void {
    if (this.processScheduled) return; // Already scheduled
    this.processScheduled = true;
    queueMicrotask(() => {
      this.processScheduled = false;
      this.process().catch((e) => {
        console.error("[MutationQueue] Auto-process failed:", e);
      });
    });
  }

  /** Find a mergeable mutation by path and recordId using in-memory cache (sync, fast) */
  private findMergeableInCache(
    mutationPath: string,
    recordId: string
  ): QueuedMutation | null {
    // Fast in-memory lookup
    for (const m of this.cache.values()) {
      if (
        m.mutationPath === mutationPath &&
        m.recordId === recordId &&
        (m.status === "pending" || m.status === "processing")
      ) {
        return m;
      }
    }
    return null;
  }

  /** Get all pending mutations for current user (from cache, sync). */
  getPending(): QueuedMutation[] {
    if (!this.cacheLoaded) return [];

    return Array.from(this.cache.values())
      .filter((m) => m.status === "pending" || m.status === "failed")
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Get queue statistics (from cache, sync). */
  getStats(): MutationQueueStats {
    if (!this.cacheLoaded) {
      return { pending: 0, processing: 0, failed: 0, total: 0 };
    }

    const mutations = Array.from(this.cache.values());
    return {
      pending: mutations.filter((m) => m.status === "pending").length,
      processing: mutations.filter((m) => m.status === "processing").length,
      failed: mutations.filter((m) => m.status === "failed").length,
      total: mutations.length,
    };
  }

  /** Remove a mutation from the queue. */
  async remove(id: string): Promise<void> {
    // Update cache first (sync)
    this.cache.delete(id);

    // Then persist to IndexedDB (async)
    if (!this.db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = this.db!.transaction(QUEUE_STORE, "readwrite");
      const store = tx.objectStore(QUEUE_STORE);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    this.notifyListeners();
  }

  /** Clear all synced mutations. */
  async clearSynced(): Promise<void> {
    const synced = Array.from(this.cache.values()).filter((m) => m.status === "synced");

    for (const mutation of synced) {
      await this.remove(mutation.id);
    }
  }

  // ─── Processing ──────────────────────────────────────────────────

  /**
   * Process all pending mutations.
   * Should be called when connection is restored.
   */
  async process(): Promise<{ success: number; failed: number }> {
    if (!this.executor) {
      if (DEBUG) console.warn("[MutationQueue] No executor set");
      return { success: 0, failed: 0 };
    }

    if (this.isProcessing) {
      return { success: 0, failed: 0 };
    }

    this.isProcessing = true;
    let success = 0;
    let failed = 0;
    let needsReprocess = false;

    try {
      const pending = this.getPending();
      if (pending.length === 0) {
        return { success: 0, failed: 0 };
      }

      if (DEBUG) console.log(`[MutationQueue] Processing ${pending.length} mutations`);

      for (const mutation of pending) {
        const originalModifiedAt = mutation.modifiedAt;

        // Mark as processing
        await this.updateStatus(mutation.id, "processing");

        try {
          await this.executor(mutation.mutationPath, mutation.args);

          // Check if mutation was modified during execution (merged with newer data)
          const current = this.cache.get(mutation.id);
          if (current && current.modifiedAt > originalModifiedAt) {
            // Mutation was updated during execution - reset to pending for reprocess
            if (DEBUG) console.log(`[MutationQueue] Will reprocess: ${mutation.id}`);
            await this.updateStatus(mutation.id, "pending");
            needsReprocess = true;
          } else {
            await this.updateStatus(mutation.id, "synced");
            success++;
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          console.error(`[MutationQueue] Failed: ${mutation.mutationPath}`, errorMessage);

          if (isPermanentError(errorMessage)) {
            // Permanent error - remove mutation (will never succeed)
            console.warn(`[MutationQueue] Removing permanently failed mutation: ${mutation.id}`);
            await this.remove(mutation.id);
          } else {
            // Temporary error - mark failed for retry
            await this.markFailed(mutation.id, errorMessage);
          }
          failed++;
        }
      }

      // Clean up synced mutations
      await this.clearSynced();

      // Schedule reprocess for mutations that were updated during execution
      if (needsReprocess) {
        this.scheduleProcess();
      }

      // Schedule retry for failed mutations (with delay)
      if (failed > 0) {
        setTimeout(() => this.scheduleProcess(), 5000);
      }
    } finally {
      this.isProcessing = false;
      this.notifyListeners();
    }

    return { success, failed };
  }

  /** Retry a specific failed mutation. */
  async retry(id: string): Promise<boolean> {
    if (!this.executor) return false;

    const mutation = await this.getMutation(id);
    if (!mutation || mutation.status !== "failed") return false;

    await this.updateStatus(id, "processing");

    try {
      await this.executor(mutation.mutationPath, mutation.args);
      await this.updateStatus(id, "synced");
      await this.remove(id);
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.markFailed(id, errorMessage);
      return false;
    }
  }

  // ─── Internal Helpers ────────────────────────────────────────────

  /** Get mutation from cache (sync, fast). */
  private getMutation(id: string): QueuedMutation | null {
    return this.cache.get(id) ?? null;
  }

  /** Get all mutations from IndexedDB (used only for initial load). */
  private async getAllFromDB(): Promise<QueuedMutation[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(QUEUE_STORE, "readonly");
      const store = tx.objectStore(QUEUE_STORE);
      const index = store.index("userId");
      const request = index.getAll(this.userId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as QueuedMutation[]);
    });
  }

  /** Write mutation to both cache and IndexedDB. */
  private async putMutation(mutation: QueuedMutation): Promise<void> {
    // Update cache first (sync)
    this.cache.set(mutation.id, mutation);

    // Then persist to IndexedDB (async)
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(QUEUE_STORE, "readwrite");
      const store = tx.objectStore(QUEUE_STORE);
      const request = store.put(mutation);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  private async updateStatus(
    id: string,
    status: MutationStatus
  ): Promise<void> {
    const mutation = this.cache.get(id);
    if (!mutation) return;

    mutation.status = status;
    if (status === "processing") {
      mutation.lastAttemptAt = Date.now();
      mutation.attempts++;
    }

    await this.putMutation(mutation);
    this.notifyListeners();
  }

  private async markFailed(id: string, error: string): Promise<void> {
    const mutation = this.cache.get(id);
    if (!mutation) return;

    mutation.status = "failed";
    mutation.lastError = error;
    mutation.lastAttemptAt = Date.now();

    await this.putMutation(mutation);
    this.notifyListeners();
  }
}

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Delete the entire mutation queue database. */
export async function clearMutationQueue(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(QUEUE_DB);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
