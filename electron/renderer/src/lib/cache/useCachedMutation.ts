/**
 * useCachedMutation - Offline-aware mutation hook
 *
 * Features:
 * - Executes mutation if online
 * - Queues mutation if offline (with warning toast)
 * - Supports optimistic updates
 * - Auto-syncs when back online
 */

import { useState, useCallback } from "react";
import { useMutation, useConvex } from "convex/react";
import { FunctionReference, FunctionArgs, FunctionReturnType } from "convex/server";
import { useCacheOptional } from "./CacheProvider";
import { useToast } from "@/hooks/use-toast";
import { enqueueFallbackMutation, getFallbackMutationCount } from "./fallbackQueue";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface UseCachedMutationOptions<T> {
  /** Optimistic update function. Called immediately before mutation. */
  onOptimisticUpdate?: (args: T) => void;
  /** Called when mutation succeeds (online or after sync). */
  onSuccess?: (result: unknown) => void;
  /** Called when mutation fails. */
  onError?: (error: Error) => void;
  /** Custom offline message. */
  offlineMessage?: string;
}

export interface UseCachedMutationResult<Args, Result> {
  mutate: (args: Args) => Promise<Result | null>;
  mutateAsync: (args: Args) => Promise<Result>;
  isLoading: boolean;
  isOffline: boolean;
  error: Error | null;
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

/**
 * Mutation with offline queuing.
 *
 * Usage:
 * ```tsx
 * const { mutate, isOffline } = useCachedMutation(
 *   api.recordingSessions.update,
 *   {
 *     onSuccess: () => console.log('Updated!'),
 *     offlineMessage: 'Changes will sync when online',
 *   }
 * );
 *
 * await mutate({ sessionId, notes: 'Updated notes' });
 * ```
 */
export function useCachedMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  options: UseCachedMutationOptions<FunctionArgs<Mutation>> = {}
): UseCachedMutationResult<FunctionArgs<Mutation>, FunctionReturnType<Mutation>> {
  type Args = FunctionArgs<Mutation>;
  type Result = FunctionReturnType<Mutation>;

  const cache = useCacheOptional();
  const { toast } = useToast();
  const convexMutation = useMutation(mutation);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const isOffline = cache ? !cache.isOnline : !navigator.onLine;

  // Get mutation path from function reference
  const getMutationPath = useCallback((): string => {
    const name = (mutation as any)._name || String(mutation);
    // Convert "api.recordingSessions.update" format to "recordingSessions.update"
    return name.replace(/^api\./, "").replace(/:/g, ".");
  }, [mutation]);

  /**
   * Execute mutation. Returns null if queued offline.
   */
  const mutate = useCallback(
    async (args: Args): Promise<Result | null> => {
      setError(null);
      setIsLoading(true);

      try {
        // Optimistic update
        if (options.onOptimisticUpdate) {
          options.onOptimisticUpdate(args);
        }

        if (isOffline) {
          const mutationPath = getMutationPath();

          if (cache?.mutationQueue) {
            // Main queue available - use it
            await cache.mutationQueue.enqueue(mutationPath, args);

            toast({
              title: "You're offline",
              description:
                options.offlineMessage ||
                "Your changes will be saved and synced when you're back online.",
              variant: "default",
            });
          } else {
            // Main queue unavailable - use fallback localStorage queue
            const fallbackId = enqueueFallbackMutation(mutationPath, args);

            if (fallbackId) {
              toast({
                title: "Changes may be lost",
                description:
                  "Sign in as soon as possible to sync your data.",
                variant: "destructive",
              });
            } else {
              // Fallback queue also failed (localStorage full)
              toast({
                title: "Cannot save changes",
                description:
                  "Storage is full. Your changes could not be saved.",
                variant: "destructive",
              });
            }
          }

          setIsLoading(false);
          return null;
        }

        // Execute online
        const result = await convexMutation(args);

        if (options.onSuccess) {
          options.onSuccess(result);
        }

        setIsLoading(false);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsLoading(false);

        if (options.onError) {
          options.onError(error);
        }

        throw error;
      }
    },
    [
      isOffline,
      cache?.mutationQueue,
      convexMutation,
      getMutationPath,
      options,
      toast,
    ]
  );

  /**
   * Execute mutation. Throws if offline (use mutate for offline queuing).
   */
  const mutateAsync = useCallback(
    async (args: Args): Promise<Result> => {
      if (isOffline) {
        throw new Error("Cannot execute mutation while offline");
      }

      setError(null);
      setIsLoading(true);

      try {
        const result = await convexMutation(args);

        if (options.onSuccess) {
          options.onSuccess(result);
        }

        setIsLoading(false);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setIsLoading(false);

        if (options.onError) {
          options.onError(error);
        }

        throw error;
      }
    },
    [isOffline, convexMutation, options]
  );

  return {
    mutate,
    mutateAsync,
    isLoading,
    isOffline,
    error,
  };
}

// ─────────────────────────────────────────────────────────────────
// Utility: Direct mutation queue access
// ─────────────────────────────────────────────────────────────────

/**
 * Hook to access pending mutations count and sync status.
 * Includes both main queue and fallback queue counts.
 */
export function usePendingMutations() {
  const cache = useCacheOptional();

  const mainQueueCount = cache?.pendingMutations ?? 0;
  const fallbackCount = getFallbackMutationCount();

  return {
    pendingCount: mainQueueCount + fallbackCount,
    mainQueueCount,
    fallbackCount,
    isOnline: cache?.isOnline ?? navigator.onLine,
    sync: cache?.syncMutations ?? (async () => ({ success: 0, failed: 0 })),
  };
}
