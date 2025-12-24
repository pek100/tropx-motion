/**
 * Custom useMutation Hook
 *
 * Drop-in replacement for Convex's useMutation with:
 * - Optimistic cache updates (instant UI)
 * - Queue-based Convex sync (fire & forget)
 * - LWW timestamp support
 */

import { useCallback } from "react";
import { useMutation as useConvexMutation } from "convex/react";
import { FunctionReference, FunctionArgs, getFunctionName } from "convex/server";
import { useSyncOptional } from "../cache/SyncProvider";
import { useCacheOptional } from "../cache/CacheProvider";
import { applyOptimisticUpdate } from "../internal/optimistic";
import { debug } from "../internal/debug";

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

/**
 * Generic mutation hook with:
 * - Optimistic cache updates (instant UI)
 * - Queue-based Convex sync (fire & forget)
 *
 * The mutation is processed asynchronously via the queue.
 * UI updates immediately via optimistic update, no need to await.
 *
 * @example
 * ```tsx
 * const setContactStar = useMutation(api.users.setContactStar);
 * setContactStar({ userId, starred: true }); // Fire & forget
 * ```
 */
export function useMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation
): (args: FunctionArgs<Mutation>) => void {
  const sync = useSyncOptional();
  const cache = useCacheOptional();
  const convexMutation = useConvexMutation(mutation);

  // Get mutation path for queue
  const getMutationPath = useCallback((): string => {
    try {
      return getFunctionName(mutation);
    } catch {
      return String(mutation);
    }
  }, [mutation]);

  const mutate = useCallback(
    (args: FunctionArgs<Mutation>): void => {
      const now = Date.now();
      const argsRecord = args as Record<string, unknown>;
      const mutationPath = getMutationPath();

      debug.mutation.log(`${mutationPath}`, { args: argsRecord });

      // Add modifiedAt timestamp for LWW
      const argsWithTimestamp = { ...argsRecord, modifiedAt: now };

      // 1. Apply optimistic update to cache
      if (sync) {
        try {
          applyOptimisticUpdate(sync, mutationPath, argsRecord);
        } catch (e) {
          debug.mutation.error("Optimistic update failed:", e);
        }
      }

      // 2. Add to queue (fire & forget - queue processes in background)
      if (cache?.mutationQueue) {
        cache.mutationQueue.enqueue(mutationPath, argsWithTimestamp).catch((e) => {
          debug.mutation.error("Failed to enqueue:", e);
        });
      } else {
        // Fallback: send directly if no queue
        convexMutation(argsWithTimestamp as FunctionArgs<Mutation>).catch((e) => {
          debug.mutation.error("Direct mutation failed:", e);
        });
      }
    },
    [sync, cache?.mutationQueue, convexMutation, getMutationPath]
  );

  return mutate;
}
