/**
 * Fallback Mutation Queue - localStorage-based queue for when main cache unavailable
 *
 * Used when:
 * - User is offline AND cache not initialized (not signed in)
 * - CacheProvider hasn't loaded yet
 *
 * On CacheProvider init, these mutations are migrated to the main IndexedDB queue.
 */

import { isElectron } from "../../platform";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = "tropx_fallback_mutations";
const MAX_FALLBACK_MUTATIONS = 100; // Prevent localStorage overflow

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface FallbackMutation {
  id: string;
  mutationPath: string;
  args: unknown;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Storage Key
// ─────────────────────────────────────────────────────────────────

function getStorageKey(): string {
  const platform = isElectron() ? "electron" : "web";
  return `${STORAGE_KEY_PREFIX}_${platform}`;
}

// ─────────────────────────────────────────────────────────────────
// Queue Operations
// ─────────────────────────────────────────────────────────────────

/** Get all pending fallback mutations. */
export function getFallbackMutations(): FallbackMutation[] {
  try {
    const key = getStorageKey();
    const stored = localStorage.getItem(key);
    if (!stored) return [];
    return JSON.parse(stored) as FallbackMutation[];
  } catch (error) {
    console.error("[fallbackQueue] Failed to read:", error);
    return [];
  }
}

/** Add a mutation to the fallback queue. Returns mutation id. */
export function enqueueFallbackMutation(
  mutationPath: string,
  args: unknown
): string | null {
  try {
    const mutations = getFallbackMutations();

    // Enforce max limit to prevent storage overflow
    if (mutations.length >= MAX_FALLBACK_MUTATIONS) {
      console.warn("[fallbackQueue] Queue full, dropping oldest mutation");
      mutations.shift();
    }

    const mutation: FallbackMutation = {
      id: `fallback_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      mutationPath,
      args,
      createdAt: Date.now(),
    };

    mutations.push(mutation);

    const key = getStorageKey();
    localStorage.setItem(key, JSON.stringify(mutations));

    return mutation.id;
  } catch (error) {
    console.error("[fallbackQueue] Failed to enqueue:", error);
    return null;
  }
}

/** Remove a mutation from the fallback queue by id. */
export function removeFallbackMutation(id: string): boolean {
  try {
    const mutations = getFallbackMutations();
    const filtered = mutations.filter((m) => m.id !== id);

    if (filtered.length === mutations.length) {
      return false; // Not found
    }

    const key = getStorageKey();
    if (filtered.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(filtered));
    }

    return true;
  } catch (error) {
    console.error("[fallbackQueue] Failed to remove:", error);
    return false;
  }
}

/** Clear all fallback mutations. */
export function clearFallbackMutations(): void {
  try {
    const key = getStorageKey();
    localStorage.removeItem(key);
  } catch (error) {
    console.error("[fallbackQueue] Failed to clear:", error);
  }
}

/** Get count of pending fallback mutations. */
export function getFallbackMutationCount(): number {
  return getFallbackMutations().length;
}

/**
 * Drain all mutations from fallback queue.
 * Returns mutations and clears the queue atomically.
 */
export function drainFallbackMutations(): FallbackMutation[] {
  const mutations = getFallbackMutations();
  if (mutations.length > 0) {
    clearFallbackMutations();
  }
  return mutations;
}
