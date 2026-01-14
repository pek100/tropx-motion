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
import { useMutation, useQuery, useConvex, useConvexAuth } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
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
  storeLease,
  getLease,
  clearLease,
  isLeaseValid as checkLeaseValid,
  getLeaseDaysRemaining,
  storeLastUserId,
  getLastUserId,
  clearLastUserId,
} from "./store";
import { MutationQueue, clearMutationQueue } from "./mutationQueue";
import { drainFallbackMutations, clearFallbackMutations } from "./fallbackQueue";

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

  // Lease info (30-day sliding window for offline access)
  leaseValidUntil: number | null;
  leaseDaysRemaining: number;
  isLeaseExpired: boolean;
}

const CacheContext = createContext<CacheContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────

interface CacheProviderProps {
  children: ReactNode;
}

export function CacheProvider({ children }: CacheProviderProps) {
  // Use Convex auth directly - this works offline as it reads from localStorage JWT
  // DO NOT use useCurrentUser() here as it depends on SyncProvider which is our child
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { toast } = useToast();
  const convex = useConvex();
  const isOnline = useIsOnline();

  // Query user only when online and authenticated (used to store user ID)
  const onlineUser = useQuery(
    api.users.getMe,
    isOnline && isAuthenticated ? {} : "skip"
  );

  // State
  const [isReady, setIsReady] = useState(false);
  const [pendingMutations, setPendingMutations] = useState(0);
  const [pendingModules, setPendingModules] = useState<Set<string>>(new Set());
  const [kekVersion, setKekVersion] = useState(0);
  const [needsRotation, setNeedsRotation] = useState(false);

  // Lease state
  const [leaseValidUntil, setLeaseValidUntil] = useState<number | null>(null);
  const [leaseDaysRemaining, setLeaseDaysRemaining] = useState(0);
  const [isLeaseExpired, setIsLeaseExpired] = useState(false);

  // Refs
  const storeRef = useRef<CacheStore | null>(null);
  const queueRef = useRef<MutationQueue | null>(null);
  const initializingRef = useRef(false);
  const wasOnlineRef = useRef(isOnline);

  // Mutations
  const getOrCreateKEK = useMutation(api.cache.getOrCreateKEK);
  const rotateKEKMutation = useMutation(api.cache.rotateKEK);
  const refreshLeaseMutation = useMutation(api.cache.refreshLease);

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

  // Sync and refresh lease when transitioning from offline → online
  useEffect(() => {
    if (isOnline && !wasOnlineRef.current) {
      debug.cache.log("Back online - syncing mutations and refreshing lease");

      // Sync pending mutations
      if (queueRef.current) {
        syncMutations();
      }

      // Refresh the sliding lease (use stored user ID)
      const storedUserId = getLastUserId();
      if (storedUserId) {
        refreshLeaseMutation({})
          .then((result) => {
            setLeaseValidUntil(result.validUntil);
            setLeaseDaysRemaining(result.daysRemaining);
            setIsLeaseExpired(false);
            storeLease(storedUserId, {
              validUntil: result.validUntil,
              daysRemaining: result.daysRemaining,
              updatedAt: Date.now(),
            });
            debug.cache.log(`Lease refreshed: ${result.daysRemaining} days remaining`);
          })
          .catch((error) => {
            debug.cache.error("Failed to refresh lease:", error);
          });
      }
    }
    wasOnlineRef.current = isOnline;
  }, [isOnline, syncMutations, refreshLeaseMutation]);

  // Helper to safely get user ID from the union type
  const onlineUserId = onlineUser && '_id' in onlineUser ? String(onlineUser._id) : null;

  // Store user ID when we get it from online query
  useEffect(() => {
    if (onlineUserId) {
      storeLastUserId(onlineUserId);
      debug.cache.log("Stored user ID for offline bootstrap");
    }
  }, [onlineUserId]);

  // ─── Initialization ──────────────────────────────────────────────

  useEffect(() => {
    // FAST: Always try stored user ID first (available immediately)
    const storedUserId = getLastUserId();

    // Determine effective user ID - prioritize stored ID for instant init
    let effectiveUserId: string | null = storedUserId;

    // If no stored ID, we need to wait for online user data
    if (!effectiveUserId) {
      if (onlineUserId) {
        effectiveUserId = onlineUserId;
      } else if (!isOnline) {
        // Offline with no stored ID - can't initialize
        return;
      } else if (isAuthLoading) {
        // Online, no stored ID, auth loading - wait
        return;
      } else if (!isAuthenticated) {
        // Online, not authenticated - nothing to do
        return;
      }
      // Online, authenticated, but user query not resolved yet - wait
      if (!effectiveUserId) return;
    }

    if (initializingRef.current) return;

    const initCache = async () => {
      initializingRef.current = true;
      debug.cache.log("Starting initialization...");

      try {
        if (!isCryptoAvailable()) {
          debug.cache.warn("Web Crypto not available");
          return;
        }

        const userId = effectiveUserId!;
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

        // Initialize encryption (returns false if lease expired)
        const encryptionReady = await initializeEncryption(userId);

        // Only set ready if cache store is available
        // When lease expired, mutation queue works but cache doesn't
        setIsReady(encryptionReady !== false);
      } catch (error) {
        console.error("[CacheProvider] ❌ Initialization failed:", error);
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
  }, [isAuthenticated, isAuthLoading, onlineUserId, convex, isOnline]);

  /**
   * Initialize encryption - CACHE-FIRST approach
   *
   * 1. If we have local KEK + DEK → open cache immediately
   * 2. If online → refresh from server in background (don't block)
   * 3. If no local credentials → must fetch from server (first-time setup)
   */
  const initializeEncryption = async (userId: string) => {
    console.log("[CacheProvider] ─── initializeEncryption START ───");

    const existingWrappedDEK = await getWrappedDEK(userId);
    const sessionKEK = getSessionKEK(userId);

    console.log("[CacheProvider] Local credentials:", {
      hasDEK: !!existingWrappedDEK,
      dekVersion: existingWrappedDEK?.version,
      hasKEK: !!sessionKEK,
      kekVersion: sessionKEK?.kekVersion,
    });

    // ─── FAST PATH: Use cached credentials immediately ───
    if (existingWrappedDEK && sessionKEK) {
      console.log("[CacheProvider] Fast path: using cached credentials");

      // Check lease validity
      const localLease = getLease(userId);
      if (localLease) {
        const leaseValid = checkLeaseValid(userId);
        if (!leaseValid) {
          console.log("[CacheProvider] Lease expired - cache access denied");
          setIsLeaseExpired(true);
          setLeaseValidUntil(localLease.validUntil);
          setLeaseDaysRemaining(0);
          return false;
        }
        const daysRemaining = getLeaseDaysRemaining(userId);
        setLeaseValidUntil(localLease.validUntil);
        setLeaseDaysRemaining(daysRemaining);
        setIsLeaseExpired(false);
      } else {
        // No lease yet - allow access (legacy or first use)
        setIsLeaseExpired(false);
        setLeaseDaysRemaining(30);
      }

      // Open cache immediately with cached credentials
      try {
        const kek = await importKEK(sessionKEK.kekWrapped);
        const dek = await unwrapDEK(existingWrappedDEK, kek);

        const store = new CacheStore(userId);
        await store.open(dek);
        storeRef.current = store;

        setKekVersion(sessionKEK.kekVersion);
        console.log("[CacheProvider] ✓ Cache ready (fast path)");

        // Background: refresh from server if online (don't await)
        if (isOnline) {
          refreshFromServer(userId, sessionKEK.kekVersion).catch((e) => {
            debug.cache.log("Background refresh failed (non-critical):", e);
          });
        }

        return true;
      } catch (error) {
        console.error("[CacheProvider] Fast path failed, falling back to server:", error);
        // Fall through to server path
      }
    }

    // ─── SLOW PATH: First-time setup or cache corrupted - need server ───
    console.log("[CacheProvider] Slow path: fetching from server");

    if (!isOnline) {
      console.error("[CacheProvider] Cannot initialize - offline with no cached credentials");
      return false;
    }

    try {
      let kekResult: Awaited<ReturnType<typeof getOrCreateKEK>>;

      if (existingWrappedDEK) {
        kekResult = await getOrCreateKEK({});
      } else {
        const newKEK = await generateKEK();
        const newKEKBase64 = await exportKey(newKEK);
        kekResult = await getOrCreateKEK({ newKekIfMissing: newKEKBase64 });
      }

      if (!kekResult.kekWrapped) {
        throw new Error("Failed to get or create KEK");
      }

      // Store credentials locally for next time
      storeSessionKEK(userId, {
        kekWrapped: kekResult.kekWrapped,
        kekVersion: kekResult.kekVersion
      });

      // Store lease
      if (kekResult.validUntil) {
        storeLease(userId, {
          validUntil: kekResult.validUntil,
          daysRemaining: kekResult.daysRemaining,
          updatedAt: Date.now(),
        });
        setLeaseValidUntil(kekResult.validUntil);
        setLeaseDaysRemaining(kekResult.daysRemaining);
        setIsLeaseExpired(false);
      }

      setKekVersion(kekResult.kekVersion);
      setNeedsRotation(kekResult.needsRotation);

      // Initialize DEK
      const kek = await importKEK(kekResult.kekWrapped);
      let dek: CryptoKey;

      if (existingWrappedDEK && existingWrappedDEK.version === kekResult.kekVersion) {
        dek = await unwrapDEK(existingWrappedDEK, kek);
      } else {
        // Generate new DEK (first time or version mismatch)
        if (existingWrappedDEK) {
          await deleteUserCache(userId);
        }
        dek = await generateDEK();
        const wrappedDEK = await wrapDEK(dek, kek, kekResult.kekVersion);
        await storeWrappedDEK(userId, wrappedDEK);
      }

      const store = new CacheStore(userId);
      await store.open(dek);
      storeRef.current = store;

      console.log("[CacheProvider] ✓ Cache ready (slow path)");
      return true;
    } catch (error) {
      console.error("[CacheProvider] Server initialization failed:", error);
      return false;
    }
  };

  /**
   * Background refresh from server - updates KEK/lease without blocking
   */
  const refreshFromServer = async (userId: string, currentKekVersion: number) => {
    try {
      const kekResult = await getOrCreateKEK({});

      if (!kekResult.kekWrapped) return;

      // Update session KEK
      storeSessionKEK(userId, {
        kekWrapped: kekResult.kekWrapped,
        kekVersion: kekResult.kekVersion
      });

      // Update lease
      if (kekResult.validUntil) {
        storeLease(userId, {
          validUntil: kekResult.validUntil,
          daysRemaining: kekResult.daysRemaining,
          updatedAt: Date.now(),
        });
        setLeaseValidUntil(kekResult.validUntil);
        setLeaseDaysRemaining(kekResult.daysRemaining);
      }

      setNeedsRotation(kekResult.needsRotation);

      // If KEK version changed, we need to re-wrap DEK (rare)
      if (kekResult.kekVersion !== currentKekVersion) {
        debug.cache.warn(`KEK version changed: ${currentKekVersion} → ${kekResult.kekVersion}`);
        // User will need to refresh for new KEK to take effect
        // Don't disrupt current session
      }

      debug.cache.log("Background refresh complete");
    } catch (error) {
      // Non-critical - we already have working cache
      throw error;
    }
  };

  // ─── Actions ─────────────────────────────────────────────────────

  const clearCache = useCallback(async () => {
    const userId = onlineUserId ?? getLastUserId();
    if (!userId) return;

    // Clear cache store
    await storeRef.current?.clear();
    clearSessionKEK(userId);
    clearLease(userId);
    clearLastUserId();

    // Clear mutation queue (IndexedDB)
    queueRef.current?.close();
    await clearMutationQueue();

    // Clear fallback mutations (localStorage)
    clearFallbackMutations();

    // Reset lease state
    setLeaseValidUntil(null);
    setLeaseDaysRemaining(0);
    setIsLeaseExpired(true);

    debug.cache.log("All local cache data cleared");
    toast({
      title: "Cache cleared",
      description: "All local cache and pending mutations have been cleared.",
    });
  }, [onlineUserId, toast]);

  const rotateKey = useCallback(async () => {
    // Key rotation requires being online with user data
    if (!onlineUserId) return;
    const userId = onlineUserId;

    try {
      const newKEK = await generateKEK();
      const newKEKBase64 = await exportKey(newKEK);

      const result = await rotateKEKMutation({ newKekWrapped: newKEKBase64 });

      const store = storeRef.current;
      if (store && store.isOpen()) {
        const existingWrappedDEK = await getWrappedDEK(userId);
        if (existingWrappedDEK) {
          store.close();

          const dek = await generateDEK();
          const wrappedDEK = await wrapDEK(dek, newKEK, result.kekVersion);
          await storeWrappedDEK(userId, wrappedDEK);

          await store.open(dek);
          await store.clear();
        }
      }

      setKekVersion(result.kekVersion);
      setNeedsRotation(false);

      // Update lease info from rotation result
      if (result.validUntil) {
        storeLease(userId, {
          validUntil: result.validUntil,
          daysRemaining: result.daysRemaining,
          updatedAt: Date.now(),
        });
        setLeaseValidUntil(result.validUntil);
        setLeaseDaysRemaining(result.daysRemaining);
        setIsLeaseExpired(false);
      }

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
  }, [onlineUserId, rotateKEKMutation, toast]);

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
      // Lease info
      leaseValidUntil,
      leaseDaysRemaining,
      isLeaseExpired,
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
      leaseValidUntil,
      leaseDaysRemaining,
      isLeaseExpired,
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
