/**
 * Offline Mutation Queue
 *
 * Queues mutations when offline and syncs when connection is restored.
 * Uses IndexedDB for persistence across page reloads.
 */

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const QUEUE_DB = "tropx_mutation_queue";
const QUEUE_STORE = "mutations";
const DB_VERSION = 1;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MutationStatus = "pending" | "processing" | "failed" | "synced";

export interface QueuedMutation {
  id: string;
  userId: string;
  mutationPath: string; // e.g., "recordingSessions.update"
  args: unknown;
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
// Mutation Queue Class
// ─────────────────────────────────────────────────────────────────

export class MutationQueue {
  private db: IDBDatabase | null = null;
  private userId: string;
  private executor: MutationExecutor | null = null;
  private isProcessing = false;
  private listeners: Set<() => void> = new Set();

  constructor(userId: string) {
    this.userId = userId;
  }

  // ─── Initialization ──────────────────────────────────────────────

  /** Open the queue database. */
  async open(): Promise<void> {
    this.db = await this.openDatabase();
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
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

  /** Add a mutation to the queue. */
  async enqueue(mutationPath: string, args: unknown): Promise<string> {
    if (!this.db) {
      throw new Error("Mutation queue not initialized");
    }

    const mutation: QueuedMutation = {
      id: generateId(),
      userId: this.userId,
      mutationPath,
      args,
      createdAt: Date.now(),
      status: "pending",
      attempts: 0,
    };

    await this.putMutation(mutation);
    this.notifyListeners();

    return mutation.id;
  }

  /** Get all pending mutations for current user. */
  async getPending(): Promise<QueuedMutation[]> {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(QUEUE_STORE, "readonly");
      const store = tx.objectStore(QUEUE_STORE);
      const index = store.index("userId");
      const request = index.getAll(this.userId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const mutations = request.result as QueuedMutation[];
        resolve(
          mutations
            .filter((m) => m.status === "pending" || m.status === "failed")
            .sort((a, b) => a.createdAt - b.createdAt)
        );
      };
    });
  }

  /** Get queue statistics. */
  async getStats(): Promise<MutationQueueStats> {
    if (!this.db) {
      return { pending: 0, processing: 0, failed: 0, total: 0 };
    }

    const mutations = await this.getAllForUser();
    return {
      pending: mutations.filter((m) => m.status === "pending").length,
      processing: mutations.filter((m) => m.status === "processing").length,
      failed: mutations.filter((m) => m.status === "failed").length,
      total: mutations.length,
    };
  }

  /** Remove a mutation from the queue. */
  async remove(id: string): Promise<void> {
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
    const mutations = await this.getAllForUser();
    const synced = mutations.filter((m) => m.status === "synced");

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
      throw new Error("Mutation executor not set");
    }

    if (this.isProcessing) {
      return { success: 0, failed: 0 };
    }

    this.isProcessing = true;
    let success = 0;
    let failed = 0;

    try {
      const pending = await this.getPending();

      for (const mutation of pending) {
        // Mark as processing
        await this.updateStatus(mutation.id, "processing");

        try {
          await this.executor(mutation.mutationPath, mutation.args);
          await this.updateStatus(mutation.id, "synced");
          success++;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          await this.markFailed(mutation.id, errorMessage);
          failed++;
        }
      }

      // Clean up synced mutations
      await this.clearSynced();
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

  private async getMutation(id: string): Promise<QueuedMutation | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(QUEUE_STORE, "readonly");
      const store = tx.objectStore(QUEUE_STORE);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result ?? null);
    });
  }

  private async getAllForUser(): Promise<QueuedMutation[]> {
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

  private async putMutation(mutation: QueuedMutation): Promise<void> {
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
    const mutation = await this.getMutation(id);
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
    const mutation = await this.getMutation(id);
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
