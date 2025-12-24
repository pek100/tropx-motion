/**
 * Cache Provider - Context for encrypted offline cache
 *
 * Manages:
 * - DEK/KEK initialization on auth
 * - Mutation queue sync on reconnect
 * - Auto KEK rotation check (90 days)
 *
 * Note: Online/offline state is handled by ConnectivityProvider
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
import { api } from "../../../../../../convex/_generated/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import { useIsOnline } from "../internal/connectivity";
import { debug } from "../internal/debug";
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
  const isOnline = useIsOnline();

  // State
  const [isReady, setIsReady] = useState(false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [pendingModules, setPendingModules] = useState<Set<string>>(new Set());
  const [kekVersion, setKekVersion] = useState(0);
  const [needsRotation, setNeedsRotation] = useState(false);

  // Refs
  const storeRef = useRef<CacheStore | null>(null);
  const queueRef = useRef<MutationQueue | null>(null);
  const initializingRef = useRef(false);
  const wasOnlineRef = useRef(isOnline);

  // Mutations
  const getOrCreateKEK = useMutation(api.cache.getOrCreateKEK);
  const rotateKEKMutation = useMutation(api.cache.rotateKEK);

  // ─── Sync mutations when coming back online ────────────────────

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
      debug.cache.error("Sync failed:", error);
      return { success: 0, failed: 0 };
    }
  }, [toast]);

  // Sync when transitioning from offline → online
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current && queueRef.current) {
      debug.cache.log("Back online - syncing mutations");
      syncMutations();
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, syncMutations]);

  // ─── Initialization ──────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated || !user?._id || initializingRef.current) return;

    const initCache = async () => {
      initializingRef.current = true;
      debug.cache.log("Starting initialization...");

      try {
        if (!isCryptoAvailable()) {
          debug.cache.warn("Web Crypto not available");
          return;
        }

        const userId = String(user._id);
        debug.cache.log("User ID:", userId);

        // Initialize mutation queue
        debug.cache.log("Opening mutation queue...");
        const queue = new MutationQueue(userId);
        await queue.open();
        queueRef.current = queue;
        debug.cache.log("Mutation queue opened");

        // Set up mutation executor with timeout
        queue.setExecutor(async (path, args) => {
          const parts = path.split(":");
          if (parts.length !== 2) {
            throw new Error(`Invalid mutation path: ${path}`);
          }
          const mutationRef = (api as any)[parts[0]]?.[parts[1]];
          if (!mutationRef) {
            throw new Error(`Unknown mutation: ${path}`);
          }

          const timeoutMs = 10000;
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Mutation timeout - will retry")), timeoutMs)
          );

          return Promise.race([
            convex.mutation(mutationRef, args as any),
            timeoutPromise,
          ]);
        });

        // Subscribe to queue changes
        queue.subscribe(() => {
          const stats = queue.getStats();
          setPendingMutations(stats.pending + stats.failed);

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

        // Get initial pending count
        const stats = queue.getStats();
        setPendingMutations(stats.pending + stats.failed);

        // Process any pending mutations from previous session
        if (stats.pending > 0) {
          queue.process().catch((e) => {
            debug.cache.error("Failed to process pending:", e);
          });
        }

        // Initialize encryption
        await initializeEncryption(userId);

        setIsReady(true);
      } catch (error) {
        debug.cache.error("Initialization failed:", error);
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
    };
  }, [isAuthenticated, user?._id, convex]);

  const initializeEncryption = async (userId: string) => {
    debug.cache.log("─── initializeEncryption START ───");
    debug.cache.log("User ID:", userId);

    const existingWrappedDEK = await getWrappedDEK(userId);
    debug.cache.log("Local DEK:", existingWrappedDEK ? `version=${existingWrappedDEK.version}` : "NOT FOUND");

    const sessionKEK = getSessionKEK(userId);
    debug.cache.log("Session KEK:", sessionKEK ? `yes (v${sessionKEK.kekVersion})` : "no");

    let kekWrapped: string;
    let kekVersionNum: number;
    let needsRotationFlag = false;

    try {
      let kekResult: Awaited<ReturnType<typeof getOrCreateKEK>>;

      if (existingWrappedDEK) {
        debug.cache.log("→ Path A: existing local DEK, fetching server KEK...");
        kekResult = await getOrCreateKEK({});
      } else {
        debug.cache.log("→ Path B: no local DEK, generating new KEK...");
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

      storeSessionKEK(userId, { kekWrapped, kekVersion: kekVersionNum });
      debug.cache.log(`Server KEK: version=${kekVersionNum}, needsRotation=${needsRotationFlag}`);

      if (existingWrappedDEK && existingWrappedDEK.version !== kekVersionNum) {
        debug.cache.warn("⚠️ VERSION MISMATCH - cache will be cleared!");
      }
    } catch (error) {
      debug.cache.log("Server KEK fetch failed, trying session cache:", error);

      if (sessionKEK && existingWrappedDEK) {
        debug.cache.log(`Using session-cached KEK (v${sessionKEK.kekVersion})`);
        kekWrapped = sessionKEK.kekWrapped;
        kekVersionNum = sessionKEK.kekVersion;
      } else {
        debug.cache.warn("No session KEK available, cache unavailable offline");
        throw error;
      }
    }

    setKekVersion(kekVersionNum);
    setNeedsRotation(needsRotationFlag);

    const kek = await importKEK(kekWrapped);
    let dek: CryptoKey;

    if (existingWrappedDEK) {
      if (existingWrappedDEK.version !== kekVersionNum) {
        debug.cache.warn("⚠️ KEK VERSION MISMATCH!");
        debug.cache.warn(`  Local DEK wrapped with KEK v${existingWrappedDEK.version}`);
        debug.cache.warn(`  Server KEK is v${kekVersionNum}`);
        debug.cache.warn("  → Clearing cache and regenerating DEK...");
        await deleteUserCache(userId);
        dek = await generateDEK();
        const wrappedDEK = await wrapDEK(dek, kek, kekVersionNum);
        const storeResult = await storeWrappedDEK(userId, wrappedDEK);
        if (!storeResult.success) {
          throw new Error(`Failed to store DEK: ${storeResult.error}`);
        }
        debug.cache.log(`New DEK stored with version ${kekVersionNum}`);
      } else {
        debug.cache.log("✓ KEK version matches, unwrapping existing DEK...");
        dek = await unwrapDEK(existingWrappedDEK, kek);
        debug.cache.log("✓ DEK unwrapped successfully");
      }
    } else {
      debug.cache.log("First time setup - generating new DEK...");
      dek = await generateDEK();
      const wrappedDEK = await wrapDEK(dek, kek, kekVersionNum);
      const storeResult = await storeWrappedDEK(userId, wrappedDEK);
      if (!storeResult.success) {
        throw new Error(`Failed to store DEK: ${storeResult.error}`);
      }
      debug.cache.log(`New DEK stored with version ${kekVersionNum}`);
    }

    debug.cache.log("Opening cache store");
    const store = new CacheStore(userId);
    await store.open(dek);
    storeRef.current = store;
    debug.cache.log("─── initializeEncryption COMPLETE ───");
  };

  // ─── Actions ─────────────────────────────────────────────────────

  const clearCache = useCallback(async () => {
    if (!user?._id) return;
    const userId = String(user._id);

    await storeRef.current?.clear();
    clearSessionKEK(userId);
    toast({
      title: "Cache cleared",
      description: "Local cache has been cleared.",
    });
  }, [user?._id, toast]);

  const rotateKey = useCallback(async () => {
    if (!user?._id) return;

    try {
      const newKEK = await generateKEK();
      const newKEKBase64 = await exportKey(newKEK);

      const result = await rotateKEKMutation({ newKekWrapped: newKEKBase64 });

      const store = storeRef.current;
      if (store && store.isOpen()) {
        const existingWrappedDEK = await getWrappedDEK(user._id);
        if (existingWrappedDEK) {
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
      debug.cache.error("Key rotation failed:", error);
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
// Hooks
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
