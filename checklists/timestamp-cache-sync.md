---
id: timestamp-cache-sync
tags: [cache, sync, offline, convex, performance]
related_files: [
  convex/schema.ts,
  convex/sync.ts,
  electron/renderer/src/lib/cache/useSyncedQuery.ts,
  electron/renderer/src/lib/cache/index.ts
]
doc: /docs/timestamp-cache-sync/README.md
status: completed
last_sync: 2024-12-23
---

# Timestamp-Based Cache Sync

## Overview
Replace current cache strategy with timestamp-based diff sync:
- Convex real-time for lightweight timestamps
- Full data fetched only on diff
- Single `useSyncedQuery` decorator for lists and single items

## Checklist

### Phase 1: Schema & Backend
- [x] 1.1 Add `updatedAt` field to `users` table in schema.ts
- [x] 1.2 Add `updatedAt` field to `notifications` table in schema.ts
- [x] 1.3 Add `updatedAt` field to `invites` table in schema.ts
- [x] 1.4 Create `convex/sync.ts` with timestamp queries:
  - [x] 1.4.1 `getUserTimestamp` - returns user's updatedAt
  - [x] 1.4.2 `getContactsTimestamp` - returns user doc timestamp (contacts embedded)
  - [x] 1.4.3 `getSessionTimestamps` - returns sessions with modifiedAt
  - [x] 1.4.4 `getNotificationTimestamps` - returns notifications with updatedAt
  - [x] 1.4.5 `getInviteTimestamps` - returns invites with updatedAt
  - [x] 1.4.6 `getTagTimestamps` - returns tags with lastUsedAt
- [x] 1.5 Update mutations to set `updatedAt` on changes:
  - [x] 1.5.1 users.ts - all contact mutations + profile updates
  - [x] 1.5.2 notifications.ts - markRead, markAllRead, create
  - [x] 1.5.3 invites.ts - all invite mutations
  - [x] 1.5.4 admin.ts - setUserRole, archiveUser, restoreUser, permanentlyDeleteUser
  - [x] 1.5.5 cleanup.ts - contact removal during cleanup

### Phase 2: Cache Hook
- [x] 2.1 Create `useSyncedQuery.ts` with:
  - [x] 2.1.1 Type definitions and interfaces
  - [x] 2.1.2 Single item pattern (no timestamps option)
  - [x] 2.1.3 List pattern with timestamp signature diffing
  - [x] 2.1.4 Cache read/write integration with metadata
  - [x] 2.1.5 Reconnection detection for stale marking
  - [x] 2.1.6 isSyncing state for UI feedback
- [x] 2.2 Update `cache/index.ts` exports

### Phase 3: Migration
- [x] 3.1 Update `PatientSearchModal.tsx` to use `useSyncedQuery`
- [x] 3.2 Update `NotificationBell.tsx` to use `useSyncedQuery`
- [x] 3.3 Update `SaveModal.tsx` to use `useSyncedQuery`
- [x] 3.4 Update `TagsInput.tsx` to use `useSyncedQuery`
- [x] 3.5 Update `DashboardView.tsx` to use `useSyncedQuery`
- [x] 3.6 Update `useRecordingSession.ts` to use `useSyncedQuery`

### Phase 4: Testing & Cleanup
- [x] 4.1 TypeScript type check passes
- [ ] 4.2 Test offline → online sync behavior (manual)
- [ ] 4.3 Test new item detection (manual)
- [x] 4.4 Keep `useCachedQuery` for imperative use (cacheQuery)
- [x] 4.5 Build verification - no new errors

## Architecture

```
useSyncedQuery(query, args, options?)
│
├─ options.timestamps provided? (LIST PATTERN)
│  │
│  ├─ 1. Return cached data immediately
│  ├─ 2. Subscribe to timestamps query (real-time)
│  ├─ 3. Generate signature from timestamps
│  ├─ 4. Compare signature with cached signature
│  │     ├─ Signatures differ → fetch full data
│  │     └─ Signatures match → use cached data
│  └─ 5. Update cache with data + metadata
│
└─ No timestamps option (SINGLE PATTERN)
   │
   ├─ 1. Return cached data immediately
   ├─ 2. Subscribe to query (real-time)
   └─ 3. Update cache when data changes
```

## Files Modified

### Backend (Convex)
- `convex/schema.ts` - Added `updatedAt` to users, notifications, invites
- `convex/sync.ts` - NEW - Timestamp queries
- `convex/users.ts` - Added `updatedAt` to all mutations
- `convex/notifications.ts` - Added `updatedAt` to mutations
- `convex/invites.ts` - Added `updatedAt` to all mutations
- `convex/admin.ts` - Added `updatedAt` to user mutations
- `convex/cleanup.ts` - Added `updatedAt` to contact removal

### Frontend (Renderer)
- `lib/cache/useSyncedQuery.ts` - NEW - Smart sync hook
- `lib/cache/index.ts` - Export useSyncedQuery
- `components/PatientSearchModal.tsx` - Migrated
- `components/NotificationBell.tsx` - Migrated
- `components/SaveModal.tsx` - Migrated
- `components/TagsInput.tsx` - Migrated
- `components/dashboard/DashboardView.tsx` - Migrated
- `hooks/useRecordingSession.ts` - Migrated
