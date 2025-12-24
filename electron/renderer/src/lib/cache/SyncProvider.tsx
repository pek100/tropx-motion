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
 * Examples:
 *   - users:getMe:{}
 *   - recordingSessions:getSession:{"sessionId":"abc123"}
 *   - recordingMetrics:getMetrics:{"sessionId":"abc123"}
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
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";
import { useCacheOptional } from "./CacheProvider";

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
    if (!cache?.store) return;

    const loadFromCache = async () => {
      try {
        // Load query cache keys list
        const queryList = await cache.store!.get<string[]>("sync:queries:list");
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
        }

        setState((s) => ({ ...s, isInitialized: true }));
      } catch (err) {
        console.error("[SyncProvider] Failed to load from cache:", err);
        setState((s) => ({ ...s, isInitialized: true, error: err as Error }));
      }
    };

    loadFromCache();
  }, [cache?.store]);

  // ─── Set query (internal with version tracking) ────────────────

  const setQueryInternal = useCallback((key: string, data: unknown, version: number) => {
    // Update in-memory cache
    setQueries((prev) => {
      const next = new Map(prev);
      next.set(key, data);
      return next;
    });
    cachedVersions.current.set(key, version);

    // Persist to IndexedDB
    if (cache?.store) {
      cache.store.put(`sync:query:${key}`, data, version).catch((err) => {
        console.error("[SyncProvider] Failed to persist query:", err);
      });
    }
  }, [cache?.store]);

  // ─── Update query list in persistent cache ─────────────────────

  const persistQueryList = useCallback(async () => {
    if (!cache?.store) return;
    const keys = Array.from(queries.keys());
    await cache.store.put("sync:queries:list", keys, Date.now());
  }, [cache?.store, queries]);

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
          const cacheKey = makeCacheKey("users:getMe", {});
          const cachedVersion = cachedVersions.current.get(cacheKey);
          if (cachedVersion !== timestamps.user.modifiedAt) {
            const freshUser = await convex.query(api.fetchById.getMe, {});
            if (freshUser) {
              setQueryInternal(cacheKey, freshUser, timestamps.user.modifiedAt);
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

        // Remove deleted sessions from cache
        for (const key of cachedVersions.current.keys()) {
          if (key.startsWith("recordingSessions:getSession:") && !serverSessionKeys.has(key)) {
            setQueries((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            cachedVersions.current.delete(key);
            if (cache?.store) {
              await cache.store.delete(`sync:query:${key}`);
            }
          }
        }

        // Fetch changed sessions
        if (sessionsToFetch.length > 0) {
          const freshSessions = await convex.query(
            api.fetchById.getSessionsBySessionIds,
            { sessionIds: sessionsToFetch }
          );
          if (freshSessions) {
            for (const session of freshSessions) {
              if (session) {
                const sessionId = (session as any).sessionId;
                const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId });
                const ts = timestamps.sessions.find((t) => t.sessionId === sessionId);
                if (ts) {
                  setQueryInternal(cacheKey, session, ts.modifiedAt);
                }
              }
            }
          }
        }

        // Cache list queries (searchSessions, listMySessions)
        // These return all sessions - rebuild from cached individual sessions
        const allSessions: unknown[] = [];
        for (const ts of timestamps.sessions) {
          const cacheKey = makeCacheKey("recordingSessions:getSession", { sessionId: ts.sessionId });
          const session = queries.get(cacheKey);
          if (session) {
            allSessions.push(session);
          }
        }
        // Cache searchSessions with default args
        setQueryInternal(
          makeCacheKey("recordingSessions:searchSessions", {}),
          { sessions: allSessions, nextCursor: null },
          Date.now()
        );
        setQueryInternal(
          makeCacheKey("recordingSessions:listMySessions", {}),
          allSessions,
          Date.now()
        );

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

        // Remove deleted notifications
        for (const key of cachedVersions.current.keys()) {
          if (key.startsWith("notifications:get:") && !serverNotificationKeys.has(key)) {
            setQueries((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            cachedVersions.current.delete(key);
            if (cache?.store) {
              await cache.store.delete(`sync:query:${key}`);
            }
          }
        }

        // Fetch changed notifications
        if (notificationsToFetch.length > 0) {
          const freshNotifications = await convex.query(
            api.fetchById.getNotificationsByIds,
            { notificationIds: notificationsToFetch }
          );
          if (freshNotifications) {
            for (const notification of freshNotifications) {
              if (notification) {
                const id = (notification as any)._id;
                const cacheKey = makeCacheKey("notifications:get", { id });
                const ts = timestamps.notifications.find((t) => t._id === id);
                if (ts) {
                  setQueryInternal(cacheKey, notification, ts.modifiedAt);
                }
              }
            }
          }
        }

        // Cache notifications list
        const allNotifications: unknown[] = [];
        for (const ts of timestamps.notifications) {
          const cacheKey = makeCacheKey("notifications:get", { id: ts._id });
          const notification = queries.get(cacheKey);
          if (notification) {
            allNotifications.push(notification);
          }
        }
        setQueryInternal(
          makeCacheKey("notifications:listForUser", {}),
          allNotifications,
          Date.now()
        );
        // Also cache unread count
        const unreadCount = allNotifications.filter((n: any) => !n?.read).length;
        setQueryInternal(
          makeCacheKey("notifications:getUnreadCount", {}),
          unreadCount,
          Date.now()
        );

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

        // Remove deleted invites
        for (const key of cachedVersions.current.keys()) {
          if (key.startsWith("invites:get:") && !serverInviteKeys.has(key)) {
            setQueries((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            cachedVersions.current.delete(key);
            if (cache?.store) {
              await cache.store.delete(`sync:query:${key}`);
            }
          }
        }

        // Fetch changed invites
        if (invitesToFetch.length > 0) {
          const freshInvites = await convex.query(
            api.fetchById.getInvitesByIds,
            { inviteIds: invitesToFetch }
          );
          if (freshInvites) {
            for (const invite of freshInvites) {
              if (invite) {
                const id = (invite as any)._id;
                const cacheKey = makeCacheKey("invites:get", { id });
                const ts = timestamps.invites.find((t) => t._id === id);
                if (ts) {
                  setQueryInternal(cacheKey, invite, ts.modifiedAt);
                }
              }
            }
          }
        }

        // Cache invites lists
        const allInvites: unknown[] = [];
        for (const ts of timestamps.invites) {
          const cacheKey = makeCacheKey("invites:get", { id: ts._id });
          const invite = queries.get(cacheKey);
          if (invite) {
            allInvites.push(invite);
          }
        }
        setQueryInternal(
          makeCacheKey("invites:getMyInvites", {}),
          allInvites,
          Date.now()
        );
        const pendingInvites = allInvites.filter((i: any) => i?.status === "pending");
        setQueryInternal(
          makeCacheKey("invites:getMyPendingInvitations", {}),
          pendingInvites,
          Date.now()
        );

        // ─── Sync contacts ───
        const contactsToFetch: Id<"users">[] = [];
        const serverContactKeys = new Set<string>();

        for (const ts of timestamps.contacts) {
          if (!ts) continue;
          const cacheKey = makeCacheKey("users:getContact", { id: ts._id });
          serverContactKeys.add(cacheKey);
          const cachedVersion = cachedVersions.current.get(cacheKey);
          if (cachedVersion !== ts.modifiedAt) {
            contactsToFetch.push(ts._id as Id<"users">);
          }
        }

        // Remove deleted contacts
        for (const key of cachedVersions.current.keys()) {
          if (key.startsWith("users:getContact:") && !serverContactKeys.has(key)) {
            setQueries((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            cachedVersions.current.delete(key);
            if (cache?.store) {
              await cache.store.delete(`sync:query:${key}`);
            }
          }
        }

        // Fetch changed contacts
        if (contactsToFetch.length > 0) {
          const freshContacts = await convex.query(
            api.fetchById.getUsersByIds,
            { userIds: contactsToFetch }
          );
          if (freshContacts) {
            for (const contact of freshContacts) {
              if (contact) {
                const id = (contact as any)._id;
                const cacheKey = makeCacheKey("users:getContact", { id });
                const ts = timestamps.contacts.find((t) => t?._id === id);
                if (ts) {
                  setQueryInternal(cacheKey, contact, ts.modifiedAt);
                }
              }
            }
          }
        }

        // Cache contacts list
        const allContacts: unknown[] = [];
        for (const ts of timestamps.contacts) {
          if (!ts) continue;
          const cacheKey = makeCacheKey("users:getContact", { id: ts._id });
          const contact = queries.get(cacheKey);
          if (contact) {
            allContacts.push(contact);
          }
        }
        setQueryInternal(
          makeCacheKey("users:getContacts", {}),
          allContacts,
          Date.now()
        );

        // ─── Sync user tags ───
        // Tags are simpler - just cache the list
        const allTags = timestamps.userTags.map((t) => ({ _id: t._id, tag: t.tag }));
        setQueryInternal(
          makeCacheKey("tags:getUserTags", {}),
          allTags,
          Date.now()
        );

        // Persist the query list
        await persistQueryList();

        setState((s) => ({
          ...s,
          isSyncing: false,
          lastSyncAt: Date.now(),
          error: null,
        }));
      } catch (err) {
        console.error("[SyncProvider] Sync failed:", err);
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
    // Update the persisted query list
    if (cache?.store) {
      cache.store.get<string[]>("sync:queries:list").then((entry) => {
        const keys = new Set(entry?.data ?? []);
        keys.add(key);
        cache.store!.put("sync:queries:list", Array.from(keys), Date.now());
      });
    }
  }, [setQueryInternal, cache?.store]);

  // ─── Refresh ───────────────────────────────────────────────────

  const refresh = useCallback(() => {
    cachedVersions.current.clear();
    setQueries(new Map());
  }, []);

  // ─── Context value ─────────────────────────────────────────────

  const value = useMemo<SyncContextValue>(
    () => ({
      getQuery: (key) => queries.get(key),
      setQuery,
      state,
      refresh,
    }),
    [queries, setQuery, state, refresh]
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
