/**
 * Cache Provider - Context for encrypted offline cache
 *
 * Manages:
 * - DEK/KEK initialization on auth
 * - Online/offline state
 * - Mutation queue sync on reconnect
 * - Auto KEK rotation check (90 days)
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useConvex } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import {
  generateDEK,
  generateKEK,
  exportKey,
  importKEK,
  wrapDEK,
  unwrapDEK,
  isCryptoAvailable,
} from "./encryption";
import {
  CacheStore,
  storeWrappedDEK,
  getWrappedDEK,
  deleteUserCache,
  storeSessionKEK,
  getSessionKEK,
  clearSessionKEK,
} from "./store";
import { MutationQueue } from "./mutationQueue";
import { drainFallbackMutations } from "./fallbackQueue";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface CacheContextValue {
  // State
  isReady: boolean;
  isOnline: boolean;
  pendingMutations: number;

  // Store access
  store: CacheStore | null;
  mutationQueue: MutationQueue | null;

  // Actions
  clearCache: () => Promise<void>;
  rotateKey: () => Promise<void>;
  syncMutations: () => Promise<{ success: number; failed: number }>;

  // KEK info
  kekVersion: number;
  needsRotation: boolean;
}

const CacheContext = createContext<CacheContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────

interface CacheProviderProps {
  children: ReactNode;
}

export function CacheProvider({ children }: CacheProviderProps) {
  const { user, isAuthenticated } = useCurrentUser();
  const { toast } = useToast();
  const convex = useConvex();

  // State
  const [isReady, setIsReady] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [kekVersion, setKekVersion] = useState(0);
  const [needsRotation, setNeedsRotation] = useState(false);

  // Refs
  const storeRef = useRef<CacheStore | null>(null);
  const queueRef = useRef<MutationQueue | null>(null);
  const initializingRef = useRef(false);

  // Mutations
  const getOrCreateKEK = useMutation(api.cache.getOrCreateKEK);
  const rotateKEKMutation = useMutation(api.cache.rotateKEK);

  // ─── Initialization ──────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated || !user?._id || initializingRef.current) return;

    const initCache = async () => {
      initializingRef.current = true;

      try {
        if (!isCryptoAvailable()) {
          console.warn("[CacheProvider] Web Crypto not available");
          return;
        }

        // Convert Convex ID to string to ensure compatibility
        const userId = String(user._id);

        // Initialize mutation queue
        const queue = new MutationQueue(userId);
        await queue.open();
        queueRef.current = queue;

        // Set up mutation executor
        queue.setExecutor(async (path, args) => {
          // Parse path like "recordingSessions.update" to call Convex mutation
          const parts = path.split(".");
          if (parts.length !== 2) {
            throw new Error(`Invalid mutation path: ${path}`);
          }
          // Use convex client to call mutation
          const mutationRef = (api as any)[parts[0]]?.[parts[1]];
          if (!mutationRef) {
            throw new Error(`Unknown mutation: ${path}`);
          }
          return convex.mutation(mutationRef, args as any);
        });

        // Subscribe to queue changes
        queue.subscribe(async () => {
          const stats = await queue.getStats();
          setPendingMutations(stats.pending + stats.failed);
        });

        // Migrate any fallback mutations to main queue
        const fallbackMutations = drainFallbackMutations();
        if (fallbackMutations.length > 0) {
          console.log(
            `[CacheProvider] Migrating ${fallbackMutations.length} fallback mutations`
          );
          for (const mutation of fallbackMutations) {
            await queue.enqueue(mutation.mutationPath, mutation.args);
          }
        }

        // Get initial pending count
        const stats = await queue.getStats();
        setPendingMutations(stats.pending + stats.failed);

        // Initialize encryption
        await initializeEncryption(userId);

        setIsReady(true);
      } catch (error) {
        console.error("[CacheProvider] Initialization failed:", error);
      } finally {
        initializingRef.current = false;
      }
    };

    initCache();

    return () => {
      storeRef.current?.close();
      queueRef.current?.close();
      storeRef.current = null;
      queueRef.current = null;
      setIsReady(false);
      // Note: Don't clear session KEK on unmount - it's needed for page refreshes
      // It will be cleared on logout via clearCache or naturally on session end
    };
  }, [isAuthenticated, user?._id, convex]);

  const initializeEncryption = async (userId: string) => {
    console.log(`[CacheProvider] initializeEncryption for user: ${userId}`);

    // Check for existing wrapped DEK
    const existingWrappedDEK = await getWrappedDEK(userId);
    console.log(`[CacheProvider] Existing DEK: ${existingWrappedDEK ? `yes (v${existingWrappedDEK.version})` : 'no'}`);

    // Check for session-cached KEK (for offline support)
    const sessionKEK = getSessionKEK(userId);
    console.log(`[CacheProvider] Session KEK: ${sessionKEK ? `yes (v${sessionKEK.kekVersion})` : 'no'}`);

    // Try to get KEK from server, fall back to session cache if offline
    let kekWrapped: string;
    let kekVersionNum: number;
    let needsRotationFlag = false;

    try {
      // Try server first
      let kekResult: Awaited<ReturnType<typeof getOrCreateKEK>>;

      if (existingWrappedDEK) {
        console.log("[CacheProvider] Path: existing DEK, fetching KEK from server");
        kekResult = await getOrCreateKEK({});
      } else {
        console.log("[CacheProvider] Path: no DEK, generating new KEK");
        const newKEK = await generateKEK();
        const newKEKBase64 = await exportKey(newKEK);
        kekResult = await getOrCreateKEK({ newKekIfMissing: newKEKBase64 });
      }

      if (!kekResult.kekWrapped) {
        throw new Error("Failed to get or create KEK");
      }

      kekWrapped = kekResult.kekWrapped;
      kekVersionNum = kekResult.kekVersion;
      needsRotationFlag = kekResult.needsRotation;

      // Cache KEK for this session (enables offline access)
      storeSessionKEK(userId, { kekWrapped, kekVersion: kekVersionNum });
      console.log(`[CacheProvider] KEK from server: version=${kekVersionNum}, needsRotation=${needsRotationFlag}`);
    } catch (error) {
      // Server fetch failed - try session cache
      console.log("[CacheProvider] Server KEK fetch failed, trying session cache:", error);

      if (sessionKEK && existingWrappedDEK) {
        // Use session-cached KEK for offline access
        console.log(`[CacheProvider] Using session-cached KEK (v${sessionKEK.kekVersion})`);
        kekWrapped = sessionKEK.kekWrapped;
        kekVersionNum = sessionKEK.kekVersion;
      } else {
        // No session KEK or no DEK - can't initialize offline
        console.warn("[CacheProvider] No session KEK available, cache unavailable offline");
        throw error;
      }
    }

    setKekVersion(kekVersionNum);
    setNeedsRotation(needsRotationFlag);

    // Import KEK
    const kek = await importKEK(kekWrapped);

    let dek: CryptoKey;

    if (existingWrappedDEK) {
      // Check if KEK version matches
      if (existingWrappedDEK.version !== kekVersionNum) {
        // KEK was rotated on another device, need to re-initialize
        console.log(`[CacheProvider] KEK version mismatch (local=${existingWrappedDEK.version}, server=${kekVersionNum}), clearing cache`);
        await deleteUserCache(userId);
        // Generate new DEK with new KEK
        dek = await generateDEK();
        const wrappedDEK = await wrapDEK(dek, kek, kekVersionNum);
        const storeResult = await storeWrappedDEK(userId, wrappedDEK);
        if (!storeResult.success) {
          throw new Error(`Failed to store DEK: ${storeResult.error}`);
        }
      } else {
        // Unwrap existing DEK
        console.log("[CacheProvider] KEK version matches, unwrapping existing DEK");
        dek = await unwrapDEK(existingWrappedDEK, kek);
      }
    } else {
      // Generate new DEK
      console.log("[CacheProvider] Generating new DEK");
      dek = await generateDEK();
      const wrappedDEK = await wrapDEK(dek, kek, kekVersionNum);
      const storeResult = await storeWrappedDEK(userId, wrappedDEK);
      if (!storeResult.success) {
        throw new Error(`Failed to store DEK: ${storeResult.error}`);
      }
    }

    // Open cache store with DEK
    console.log("[CacheProvider] Opening cache store");
    const store = new CacheStore(userId);
    await store.open(dek);
    storeRef.current = store;
    console.log("[CacheProvider] Encryption initialized successfully");
  };

  // ─── Online/Offline Handling ─────────────────────────────────────

  // Define syncMutations before the effect that uses it
  const syncMutations = useCallback(async () => {
    if (!queueRef.current) {
      return { success: 0, failed: 0 };
    }

    try {
      const result = await queueRef.current.process();

      if (result.success > 0) {
        toast({
          title: "Changes synced",
          description: `${result.success} pending change(s) synced successfully.`,
        });
      }

      if (result.failed > 0) {
        toast({
          title: "Sync errors",
          description: `${result.failed} change(s) failed to sync.`,
          variant: "destructive",
        });
      }

      return result;
    } catch (error) {
      console.error("[CacheProvider] Sync failed:", error);
      return { success: 0, failed: 0 };
    }
  }, [toast]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Sync mutations when back online
      if (queueRef.current) {
        syncMutations();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncMutations]);

  // ─── Actions ─────────────────────────────────────────────────────

  const clearCache = useCallback(async () => {
    if (!user?._id) return;
    const userId = String(user._id);

    await storeRef.current?.clear();
    // Also clear session KEK for full logout
    clearSessionKEK(userId);
    toast({
      title: "Cache cleared",
      description: "Local cache has been cleared.",
    });
  }, [user?._id, toast]);

  const rotateKey = useCallback(async () => {
    if (!user?._id) return;

    try {
      // Generate new KEK
      const newKEK = await generateKEK();
      const newKEKBase64 = await exportKey(newKEK);

      // Rotate on server
      const result = await rotateKEKMutation({ newKekWrapped: newKEKBase64 });

      // Re-wrap existing DEK with new KEK
      const store = storeRef.current;
      if (store && store.isOpen()) {
        const existingWrappedDEK = await getWrappedDEK(user._id);
        if (existingWrappedDEK) {
          // Import old KEK to get DEK, then re-wrap with new KEK
          // For simplicity, we'll regenerate DEK (clears cache on this device)
          store.close();

          const dek = await generateDEK();
          const wrappedDEK = await wrapDEK(dek, newKEK, result.kekVersion);
          await storeWrappedDEK(user._id, wrappedDEK);

          await store.open(dek);
          await store.clear();
        }
      }

      setKekVersion(result.kekVersion);
      setNeedsRotation(false);

      toast({
        title: "Encryption key rotated",
        description: "Your encryption key has been rotated. Cache has been cleared.",
      });
    } catch (error) {
      console.error("[CacheProvider] Key rotation failed:", error);
      toast({
        title: "Key rotation failed",
        description: "Failed to rotate encryption key. Please try again.",
        variant: "destructive",
      });
    }
  }, [user?._id, rotateKEKMutation, toast]);

  // ─── Context Value ───────────────────────────────────────────────

  const value = useMemo<CacheContextValue>(
    () => ({
      isReady,
      isOnline,
      pendingMutations,
      store: storeRef.current,
      mutationQueue: queueRef.current,
      clearCache,
      rotateKey,
      syncMutations,
      kekVersion,
      needsRotation,
    }),
    [
      isReady,
      isOnline,
      pendingMutations,
      clearCache,
      rotateKey,
      syncMutations,
      kekVersion,
      needsRotation,
    ]
  );

  return (
    <CacheContext.Provider value={value}>{children}</CacheContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

export function useCache(): CacheContextValue {
  const context = useContext(CacheContext);
  if (!context) {
    throw new Error("useCache must be used within a CacheProvider");
  }
  return context;
}

/** Safe version that returns null if not in provider. */
export function useCacheOptional(): CacheContextValue | null {
  return useContext(CacheContext);
}
