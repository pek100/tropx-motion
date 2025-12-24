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
  /** Modules (e.g., "users") with pending/processing mutations */
  pendingModules: Set<string>;

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
  const [pendingModules, setPendingModules] = useState<Set<string>>(new Set());
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
      console.log("[CacheProvider] Starting initialization...");

      try {
        if (!isCryptoAvailable()) {
          console.warn("[CacheProvider] Web Crypto not available");
          return;
        }

        // Convert Convex ID to string to ensure compatibility
        const userId = String(user._id);
        console.log("[CacheProvider] User ID:", userId);

        // Initialize mutation queue
        console.log("[CacheProvider] Opening mutation queue...");
        const queue = new MutationQueue(userId);
        await queue.open();
        queueRef.current = queue;
        console.log("[CacheProvider] Mutation queue opened");

        // Set up mutation executor with timeout
        queue.setExecutor(async (path, args) => {
          // Parse path like "users:setContactStar" (colon-separated from getFunctionName)
          const parts = path.split(":");
          if (parts.length !== 2) {
            throw new Error(`Invalid mutation path: ${path}`);
          }
          // Use convex client to call mutation
          const mutationRef = (api as any)[parts[0]]?.[parts[1]];
          if (!mutationRef) {
            throw new Error(`Unknown mutation: ${path}`);
          }

          // Add timeout to prevent waiting forever when offline
          const timeoutMs = 10000; // 10 seconds
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Mutation timeout - will retry")), timeoutMs)
          );

          return Promise.race([
            convex.mutation(mutationRef, args as any),
            timeoutPromise,
          ]);
        });

        // Subscribe to queue changes (sync methods for fast UI updates)
        queue.subscribe(() => {
          const stats = queue.getStats();
          setPendingMutations(stats.pending + stats.failed);

          // Track which modules have pending mutations
          const pending = queue.getPending();
          const currentModules = new Set(
            pending.map((m) => m.mutationPath.split(":")[0])
          );

          setPendingModules(currentModules);
        });

        // Migrate any fallback mutations to main queue
        const fallbackMutations = drainFallbackMutations();
        for (const mutation of fallbackMutations) {
          await queue.enqueue(mutation.mutationPath, mutation.args);
        }

        // Get initial pending count (sync after cache is loaded)
        const stats = queue.getStats();
        setPendingMutations(stats.pending + stats.failed);

        // Process any pending mutations from previous session
        if (stats.pending > 0) {
          queue.process().catch((e) => {
            console.error("[CacheProvider] Failed to process pending:", e);
          });
        }

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
    console.log(`[CacheProvider] ─── initializeEncryption START ───`);
    console.log(`[CacheProvider] User ID: ${userId}`);

    // Check for existing wrapped DEK
    const existingWrappedDEK = await getWrappedDEK(userId);
    console.log(`[CacheProvider] Local DEK: ${existingWrappedDEK ? `version=${existingWrappedDEK.version}` : 'NOT FOUND'}`);

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
        console.log("[CacheProvider] → Path A: existing local DEK, fetching server KEK...");
        kekResult = await getOrCreateKEK({});
        console.log("[CacheProvider] → Server response:", JSON.stringify(kekResult));
      } else {
        console.log("[CacheProvider] → Path B: no local DEK, generating new KEK...");
        const newKEK = await generateKEK();
        const newKEKBase64 = await exportKey(newKEK);
        kekResult = await getOrCreateKEK({ newKekIfMissing: newKEKBase64 });
        console.log("[CacheProvider] → Server response:", JSON.stringify({ ...kekResult, kekWrapped: '[REDACTED]' }));
      }

      if (!kekResult.kekWrapped) {
        throw new Error("Failed to get or create KEK");
      }

      kekWrapped = kekResult.kekWrapped;
      kekVersionNum = kekResult.kekVersion;
      needsRotationFlag = kekResult.needsRotation;

      // Cache KEK for this session (enables offline access)
      storeSessionKEK(userId, { kekWrapped, kekVersion: kekVersionNum });
      console.log(`[CacheProvider] Server KEK: version=${kekVersionNum}, needsRotation=${needsRotationFlag}`);

      // Log version comparison
      if (existingWrappedDEK) {
        console.log(`[CacheProvider] Version comparison: local DEK v${existingWrappedDEK.version} vs server KEK v${kekVersionNum}`);
        if (existingWrappedDEK.version !== kekVersionNum) {
          console.warn(`[CacheProvider] ⚠️ VERSION MISMATCH - cache will be cleared!`);
        }
      }
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
        console.warn(`[CacheProvider] ⚠️ KEK VERSION MISMATCH!`);
        console.warn(`[CacheProvider]   Local DEK wrapped with KEK v${existingWrappedDEK.version}`);
        console.warn(`[CacheProvider]   Server KEK is v${kekVersionNum}`);
        console.warn(`[CacheProvider]   → Clearing cache and regenerating DEK...`);
        await deleteUserCache(userId);
        // Generate new DEK with new KEK
        dek = await generateDEK();
        const wrappedDEK = await wrapDEK(dek, kek, kekVersionNum);
        const storeResult = await storeWrappedDEK(userId, wrappedDEK);
        if (!storeResult.success) {
          throw new Error(`Failed to store DEK: ${storeResult.error}`);
        }
        console.log(`[CacheProvider] New DEK stored with version ${kekVersionNum}`);
      } else {
        // Unwrap existing DEK
        console.log("[CacheProvider] ✓ KEK version matches, unwrapping existing DEK...");
        dek = await unwrapDEK(existingWrappedDEK, kek);
        console.log("[CacheProvider] ✓ DEK unwrapped successfully");
      }
    } else {
      // Generate new DEK
      console.log("[CacheProvider] First time setup - generating new DEK...");
      dek = await generateDEK();
      const wrappedDEK = await wrapDEK(dek, kek, kekVersionNum);
      const storeResult = await storeWrappedDEK(userId, wrappedDEK);
      if (!storeResult.success) {
        throw new Error(`Failed to store DEK: ${storeResult.error}`);
      }
      console.log(`[CacheProvider] New DEK stored with version ${kekVersionNum}`);
    }

    // Open cache store with DEK
    console.log("[CacheProvider] Opening cache store");
    const store = new CacheStore(userId);
    await store.open(dek);
    storeRef.current = store;
    console.log(`[CacheProvider] ─── initializeEncryption COMPLETE ───`);
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
      pendingModules,
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
      pendingModules,
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
