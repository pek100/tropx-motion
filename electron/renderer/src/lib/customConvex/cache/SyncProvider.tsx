/**
 * Central Sync Provider - Unified query cache with proactive sync
 *
 * This provider:
 * 1. Maintains a single queries Map for ALL cached data
 * 2. Proactively syncs core data via timestamps API
 * 3. Supports on-demand caching for any query
 * 4. Persists everything to IndexedDB
 *
 * Cache key format: `${queryName}:${JSON.stringify(args)}`
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { useQuery, useConvex } from "convex/react";
import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";
import { useCacheOptional } from "./CacheProvider";
import { debug } from "../internal/debug";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface TimestampEntry {
  _id: string;
  modifiedAt: number;
  [key: string]: unknown;
}

interface AllTimestamps {
  user: TimestampEntry | null;
  sessions: Array<TimestampEntry & { sessionId: string }>;
  notifications: TimestampEntry[];
  invites: TimestampEntry[];
  userTags: Array<TimestampEntry & { tag: string }>;
  contacts: TimestampEntry[];
}

interface SyncState {
  isInitialized: boolean;
  isSyncing: boolean;
  lastSyncAt: number | null;
  error: Error | null;
}

export interface SyncContextValue {
  /** Get cached query result by key */
  getQuery: (key: string) => unknown | undefined;
  /** Set cached query result (persists to IndexedDB) */
  setQuery: (key: string, data: unknown) => void;
  /** Batch set multiple queries (single state update) */
  setQueryBatch: (updates: Array<{ key: string; data: unknown }>) => void;
  /** Get all cache keys (for optimistic updates) */
  getQueryKeys: () => string[];
  /** Current sync state */
  state: SyncState;
  /** Force a full refresh */
  refresh: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────
// Cache Key Helpers
// ─────────────────────────────────────────────────────────────────

/** Generate cache key for a query with args */
function makeCacheKey(queryName: string, args: Record<string, unknown>): string {
  return `${queryName}:${JSON.stringify(args)}`;
}

// ─────────────────────────────────────────────────────────────────
// Provider Component
// ─────────────────────────────────────────────────────────────────

interface SyncProviderProps {
  children: React.ReactNode;
}

export function SyncProvider({ children }: SyncProviderProps) {
  const convex = useConvex();
  const cache = useCacheOptional();

  // Single unified cache for ALL queries
  const [queries, setQueries] = useState<Map<string, unknown>>(new Map());

  // Track versions (modifiedAt) for timestamp comparison
  const cachedVersions = useRef<Map<string, number>>(new Map());

  const [state, setState] = useState<SyncState>({
    isInitialized: false,
    isSyncing: false,
    lastSyncAt: null,
    error: null,
  });

  // ─── Load from persistent cache on mount ───────────────────────

  useEffect(() => {
    if (!cache?.store) {
      debug.sync.log("Waiting for cache store...");
      return;
    }

    const loadFromCache = async () => {
      debug.sync.log("─── Loading from cache START ───");
      try {
        const queryList = await cache.store!.get<string[]>("sync:queries:list");
        debug.sync.log(`Query list: ${queryList?.data?.length ?? 0} keys`);

        if (queryList?.data) {
          const loadedQueries = new Map<string, unknown>();
          for (const key of queryList.data) {
            const cached = await cache.store!.get<unknown>(`sync:query:${key}`);
            if (cached) {
              loadedQueries.set(key, cached.data);
              cachedVersions.current.set(key, cached.version);
            }
          }
          setQueries(loadedQueries);
          debug.sync.log(`Loaded ${loadedQueries.size} cached queries`);

          const keys = Array.from(loadedQueries.keys()).slice(0, 5);
          debug.sync.log("Sample keys:", keys);
        } else {
          debug.sync.log("No cached queries found");
        }

        setState((s) => ({ ...s, isInitialized: true }));
        debug.sync.log("─── Loading from cache COMPLETE ───");
      } catch (err) {
        debug.sync.error("Failed to load from cache:", err);
        setState((s) => ({ ...s, isInitialized: true, error: err as Error }));
      }
    };

    loadFromCache();
  }, [cache?.store]);

  // ─── Set query (internal with version tracking) ────────────────

  const setQueryInternal = useCallback((key: string, data: unknown, version: number) => {
    setQueries((prev) => {
      const next = new Map(prev);
      next.set(key, data);
      return next;
    });
    cachedVersions.current.set(key, version);

    if (cache?.store) {
      cache.store.put(`sync:query:${key}`, data, version).catch((err) => {
        debug.sync.error("Failed to persist query:", err);
      });
    }
  }, [cache?.store]);

  // ─── Update query list in persistent cache ─────────────────────

  const queriesRef = useRef(queries);
  queriesRef.current = queries;

  const persistQueryList = useCallback(async () => {
    if (!cache?.store) return;
    const keys = Array.from(queriesRef.current.keys());
    await cache.store.put("sync:queries:list", keys, Date.now());
  }, [cache?.store]);

  // ─── Subscribe to centralized timestamps ───────────────────────

  const timestamps = useQuery(api.timestamps.getAll) as AllTimestamps | undefined;

  // ─── Compare and fetch changed items ───────────────────────────

  useEffect(() => {
    if (!timestamps || !convex) return;

    const syncData = async () => {
      setState((s) => ({ ...s, isSyncing: true }));

      try {
        // ─── Sync user ───
        if (timestamps.user) {
          const userCacheKey = makeCacheKey("users:getMe", {});
          const cachedVersion = cachedVersions.current.get(userCacheKey);
          if (cachedVersion !== timestamps.user.modifiedAt) {
            const freshUser = await convex.query(api.fetchById.getMe, {});
            if (freshUser) {
              setQueryInternal(userCacheKey, freshUser, timestamps.user.modifiedAt);
            }
            const freshContacts = await convex.query(api.users.getContacts, {});
            if (freshContacts) {
              setQueryInternal(
                makeCacheKey("users:getContacts", {}),
                freshContacts,
                timestamps.user.modifiedAt
              );
            }
          }
        }

        // ─── Sync sessions ───
        const sessionsToFetch: string[] = [];
        const serverSessionKeys = new Set<string>();

        for (const ts of timestamps.sessions) {
          const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId: ts.sessionId });
          serverSessionKeys.add(cacheKey);
          const cachedVersion = cachedVersions.current.get(cacheKey);
          if (cachedVersion !== ts.modifiedAt) {
            sessionsToFetch.push(ts.sessionId);
          }
        }

        // Collect keys to delete first (avoid modifying while iterating)
        const sessionKeysToDelete = [...cachedVersions.current.keys()].filter(
          (key) => key.startsWith("recordingSessions:getSession:") && !serverSessionKeys.has(key)
        );

        // Fetch changed sessions
        const freshSessionMap = new Map<string, unknown>();
        if (sessionsToFetch.length > 0) {
          const freshSessions = await convex.query(
            api.fetchById.getSessionsBySessionIds,
            { sessionIds: sessionsToFetch }
          );
          if (freshSessions) {
            for (const session of freshSessions) {
              if (session) {
                const sessionId = (session as any).sessionId;
                freshSessionMap.set(sessionId, session);
              }
            }
          }
        }

        // Build list from fresh data (priority) + cached data (fallback)
        // This avoids reading from stale React state
        const allSessions: unknown[] = [];
        for (const ts of timestamps.sessions) {
          const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId: ts.sessionId });
          const session = freshSessionMap.get(ts.sessionId) ?? queries.get(cacheKey);
          if (session) {
            allSessions.push(session);
          }
        }

        // Single atomic state update for sessions
        setQueries((prev) => {
          const next = new Map(prev);

          // Update individual sessions with fresh data
          for (const [sessionId, session] of freshSessionMap) {
            const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId });
            next.set(cacheKey, session);
            const ts = timestamps.sessions.find((t) => t.sessionId === sessionId);
            if (ts) {
              cachedVersions.current.set(cacheKey, ts.modifiedAt);
            }
          }

          // Delete removed sessions
          for (const key of sessionKeysToDelete) {
            next.delete(key);
            cachedVersions.current.delete(key);
          }

          // Update list caches
          // Note: searchSessions is NOT cached here - it returns enriched SessionSummary format
          // which requires owner/subject lookups. Let Convex subscription handle it.
          next.set(makeCacheKey("recordingSessions:listMySessions", {}), allSessions);

          return next;
        });

        // Persist to IndexedDB (fire-and-forget)
        if (cache?.store) {
          for (const [sessionId, session] of freshSessionMap) {
            const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId });
            const ts = timestamps.sessions.find((t) => t.sessionId === sessionId);
            if (ts) {
              cache.store.put(`sync:query:${cacheKey}`, session, ts.modifiedAt).catch(() => {});
            }
          }
          for (const key of sessionKeysToDelete) {
            cache.store.delete(`sync:query:${key}`).catch(() => {});
          }
          // Note: searchSessions is NOT persisted - uses Convex subscription for enriched format
          cache.store.put(
            `sync:query:${makeCacheKey("recordingSessions:listMySessions", {})}`,
            allSessions,
            Date.now()
          ).catch(() => {});
        }

        // ─── Sync dashboard data for cached subjects ───
        // Use fresh data + cached data pattern (same as lists) to avoid stale closure
        const subjectIds = new Set<string>();
        for (const ts of timestamps.sessions) {
          const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId: ts.sessionId });
          const session = (freshSessionMap.get(ts.sessionId) ?? queries.get(cacheKey)) as { subjectId?: string } | undefined;
          if (session?.subjectId) {
            subjectIds.add(session.subjectId);
          }
        }
        if (timestamps.user?._id) {
          subjectIds.add(timestamps.user._id);
        }

        if (subjectIds.size > 0) {
          debug.sync.log(`Syncing dashboard data for ${subjectIds.size} subjects`);
          for (const subjectId of subjectIds) {
            try {
              const dashboardCacheKey = makeCacheKey("dashboard:getPatientMetricsHistory", { subjectId });
              const metricsHistory = await convex.query(api.dashboard.getPatientMetricsHistory, {
                subjectId: subjectId as Id<"users">,
              });
              if (metricsHistory) {
                setQueryInternal(dashboardCacheKey, metricsHistory, Date.now());
              }
            } catch (err) {
              debug.sync.warn(`Failed to sync dashboard for ${subjectId}:`, err);
            }
          }
        }

        try {
          const patientsList = await convex.query(api.dashboard.getPatientsList, {});
          if (patientsList) {
            setQueryInternal(
              makeCacheKey("dashboard:getPatientsList", {}),
              patientsList,
              Date.now()
            );
          }
        } catch (err) {
          debug.sync.warn("Failed to sync patients list:", err);
        }

        // Sync asymmetry events only for sessions that changed (not all sessions)
        for (const sessionId of sessionsToFetch) {
          try {
            const asymmetryCacheKey = makeCacheKey("recordingMetrics:getSessionAsymmetryEvents", { sessionId });
            const asymmetryEvents = await convex.query(api.recordingMetrics.getSessionAsymmetryEvents, {
              sessionId,
            });
            setQueryInternal(asymmetryCacheKey, asymmetryEvents, Date.now());
          } catch {
            // Don't log - these may not exist for all sessions
          }
        }

        // ─── Sync notifications ───
        const notificationsToFetch: Id<"notifications">[] = [];
        const serverNotificationKeys = new Set<string>();

        for (const ts of timestamps.notifications) {
          const cacheKey = makeCacheKey("notifications:get", { id: ts._id });
          serverNotificationKeys.add(cacheKey);
          const cachedVersion = cachedVersions.current.get(cacheKey);
          if (cachedVersion !== ts.modifiedAt) {
            notificationsToFetch.push(ts._id as Id<"notifications">);
          }
        }

        // Collect keys to delete first
        const notificationKeysToDelete = [...cachedVersions.current.keys()].filter(
          (key) => key.startsWith("notifications:get:") && !serverNotificationKeys.has(key)
        );

        // Fetch changed notifications
        const freshNotificationMap = new Map<string, unknown>();
        if (notificationsToFetch.length > 0) {
          const freshNotifications = await convex.query(
            api.fetchById.getNotificationsByIds,
            { notificationIds: notificationsToFetch }
          );
          if (freshNotifications) {
            for (const notification of freshNotifications) {
              if (notification) {
                const id = (notification as any)._id;
                freshNotificationMap.set(id, notification);
              }
            }
          }
        }

        // Build list from fresh data + cached data
        const allNotifications: unknown[] = [];
        for (const ts of timestamps.notifications) {
          const cacheKey = makeCacheKey("notifications:get", { id: ts._id });
          const notification = freshNotificationMap.get(ts._id) ?? queries.get(cacheKey);
          if (notification) {
            allNotifications.push(notification);
          }
        }
        const unreadCount = allNotifications.filter((n: any) => !n?.read).length;

        // Single atomic state update for notifications
        setQueries((prev) => {
          const next = new Map(prev);

          // Update individual notifications
          for (const [id, notification] of freshNotificationMap) {
            const cacheKey = makeCacheKey("notifications:get", { id });
            next.set(cacheKey, notification);
            const ts = timestamps.notifications.find((t) => t._id === id);
            if (ts) {
              cachedVersions.current.set(cacheKey, ts.modifiedAt);
            }
          }

          // Delete removed notifications
          for (const key of notificationKeysToDelete) {
            next.delete(key);
            cachedVersions.current.delete(key);
          }

          // Update list caches
          next.set(makeCacheKey("notifications:listForUser", {}), allNotifications);
          next.set(makeCacheKey("notifications:getUnreadCount", {}), unreadCount);

          return next;
        });

        // Persist to IndexedDB
        if (cache?.store) {
          for (const [id, notification] of freshNotificationMap) {
            const cacheKey = makeCacheKey("notifications:get", { id });
            const ts = timestamps.notifications.find((t) => t._id === id);
            if (ts) {
              cache.store.put(`sync:query:${cacheKey}`, notification, ts.modifiedAt).catch(() => {});
            }
          }
          for (const key of notificationKeysToDelete) {
            cache.store.delete(`sync:query:${key}`).catch(() => {});
          }
          cache.store.put(
            `sync:query:${makeCacheKey("notifications:listForUser", {})}`,
            allNotifications,
            Date.now()
          ).catch(() => {});
          cache.store.put(
            `sync:query:${makeCacheKey("notifications:getUnreadCount", {})}`,
            unreadCount,
            Date.now()
          ).catch(() => {});
        }

        // ─── Sync invites ───
        const invitesToFetch: Id<"invites">[] = [];
        const serverInviteKeys = new Set<string>();

        for (const ts of timestamps.invites) {
          const cacheKey = makeCacheKey("invites:get", { id: ts._id });
          serverInviteKeys.add(cacheKey);
          const cachedVersion = cachedVersions.current.get(cacheKey);
          if (cachedVersion !== ts.modifiedAt) {
            invitesToFetch.push(ts._id as Id<"invites">);
          }
        }

        // Collect keys to delete first
        const inviteKeysToDelete = [...cachedVersions.current.keys()].filter(
          (key) => key.startsWith("invites:get:") && !serverInviteKeys.has(key)
        );

        // Fetch changed invites
        const freshInviteMap = new Map<string, unknown>();
        if (invitesToFetch.length > 0) {
          const freshInvites = await convex.query(
            api.fetchById.getInvitesByIds,
            { inviteIds: invitesToFetch }
          );
          if (freshInvites) {
            for (const invite of freshInvites) {
              if (invite) {
                const id = (invite as any)._id;
                freshInviteMap.set(id, invite);
              }
            }
          }
        }

        // Build list from fresh data + cached data
        const allInvites: unknown[] = [];
        for (const ts of timestamps.invites) {
          const cacheKey = makeCacheKey("invites:get", { id: ts._id });
          const invite = freshInviteMap.get(ts._id) ?? queries.get(cacheKey);
          if (invite) {
            allInvites.push(invite);
          }
        }
        const pendingInvites = allInvites.filter((i: any) => i?.status === "pending");

        // Single atomic state update for invites
        setQueries((prev) => {
          const next = new Map(prev);

          // Update individual invites
          for (const [id, invite] of freshInviteMap) {
            const cacheKey = makeCacheKey("invites:get", { id });
            next.set(cacheKey, invite);
            const ts = timestamps.invites.find((t) => t._id === id);
            if (ts) {
              cachedVersions.current.set(cacheKey, ts.modifiedAt);
            }
          }

          // Delete removed invites
          for (const key of inviteKeysToDelete) {
            next.delete(key);
            cachedVersions.current.delete(key);
          }

          // Update list caches
          next.set(makeCacheKey("invites:getMyInvites", {}), allInvites);
          next.set(makeCacheKey("invites:getMyPendingInvitations", {}), pendingInvites);

          return next;
        });

        // Persist to IndexedDB
        if (cache?.store) {
          for (const [id, invite] of freshInviteMap) {
            const cacheKey = makeCacheKey("invites:get", { id });
            const ts = timestamps.invites.find((t) => t._id === id);
            if (ts) {
              cache.store.put(`sync:query:${cacheKey}`, invite, ts.modifiedAt).catch(() => {});
            }
          }
          for (const key of inviteKeysToDelete) {
            cache.store.delete(`sync:query:${key}`).catch(() => {});
          }
          cache.store.put(
            `sync:query:${makeCacheKey("invites:getMyInvites", {})}`,
            allInvites,
            Date.now()
          ).catch(() => {});
          cache.store.put(
            `sync:query:${makeCacheKey("invites:getMyPendingInvitations", {})}`,
            pendingInvites,
            Date.now()
          ).catch(() => {});
        }

        // Note: tags.getTagsWithDefaults is synced via normal Convex subscription
        // (not proactively synced here - requires category/usageCount from DB)

        await persistQueryList();

        setState((s) => ({
          ...s,
          isSyncing: false,
          lastSyncAt: Date.now(),
          error: null,
        }));
      } catch (err) {
        debug.sync.error("Sync failed:", err);
        setState((s) => ({
          ...s,
          isSyncing: false,
          error: err as Error,
        }));
      }
    };

    syncData();
  }, [timestamps, convex, cache?.store, setQueryInternal, persistQueryList]);

  // ─── Public setQuery (for on-demand caching) ───────────────────

  const setQuery = useCallback((key: string, data: unknown) => {
    setQueryInternal(key, data, Date.now());
    if (cache?.store) {
      cache.store.get<string[]>("sync:queries:list").then((entry) => {
        const keys = new Set(entry?.data ?? []);
        keys.add(key);
        cache.store!.put("sync:queries:list", Array.from(keys), Date.now());
      });
    }
  }, [setQueryInternal, cache?.store]);

  const setQueryBatch = useCallback((updates: Array<{ key: string; data: unknown }>) => {
    if (updates.length === 0) return;

    const now = Date.now();

    setQueries((prev) => {
      const next = new Map(prev);
      for (const { key, data } of updates) {
        next.set(key, data);
        cachedVersions.current.set(key, now);
      }
      return next;
    });

    if (cache?.store) {
      Promise.all(
        updates.map(({ key, data }) =>
          cache.store!.put(`sync:query:${key}`, data, now)
        )
      ).catch((err) => {
        debug.sync.error("Failed to persist batch:", err);
      });
    }
  }, [cache?.store]);

  // ─── Refresh ───────────────────────────────────────────────────

  const refresh = useCallback(() => {
    cachedVersions.current.clear();
    setQueries(new Map());
  }, []);

  // ─── Get all query keys ─────────────────────────────────────────

  const getQueryKeys = useCallback(() => {
    return Array.from(queries.keys());
  }, [queries]);

  // ─── Get query ─────────────────────────────────────────────────
  // Note: We intentionally include `queries` in deps so consumers re-render
  // when cache updates. The Map.get() is O(1) so this is cheap.

  const getQuery = useCallback((key: string): unknown | undefined => {
    return queries.get(key);
  }, [queries]);

  // ─── Context value ─────────────────────────────────────────────

  const value = useMemo<SyncContextValue>(
    () => ({
      getQuery,
      setQuery,
      setQueryBatch,
      getQueryKeys,
      state,
      refresh,
    }),
    [getQuery, setQuery, setQueryBatch, getQueryKeys, state, refresh]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

// ─────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────

export function useSync(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSync must be used within a SyncProvider");
  }
  return context;
}

export function useSyncOptional(): SyncContextValue | null {
  return useContext(SyncContext);
}
