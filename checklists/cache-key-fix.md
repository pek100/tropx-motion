---
id: cache-key-fix
tags: [cache, sync, convex, validation, critical]
related_files:
  - electron/renderer/src/lib/customConvex/cache/SyncProvider.tsx
  - electron/renderer/src/lib/customConvex/hooks/useQuery.ts
  - electron/renderer/src/hooks/useRecordingSession.ts
  - electron/renderer/src/components/NotificationBell.tsx
  - electron/renderer/src/components/LoadModal.tsx
  - electron/renderer/src/components/TagsInput.tsx
status: in-progress
last_sync: 2025-01-14
---

# Phase 1: Fix Cache Key Mismatches

## Goal
Ensure frontend useQuery calls use identical args to SyncProvider cache keys, enabling proper real-time sync.

## Mismatches to Fix

| Query | SyncProvider | Frontend | File |
|-------|-------------|----------|------|
| `listMySessions` | `{}` | `{limit:50}` | useRecordingSession.ts |
| `listForUser` | `{}` | `{limit:20}` | NotificationBell.tsx |
| `searchSessions` | `{}` | `{search,subjectId,limit,cursor}` | LoadModal.tsx |

## Checklist

### 1. Frontend: Remove limit args
- [x] 1.1 `useRecordingSession.ts` - Remove `limit: 50` from `listMySessions`
- [x] 1.2 `NotificationBell.tsx` - Remove `limit: 20` from `listForUser`
- [x] 1.3 `TagsInput.tsx` - Remove `limit: 20` from `getTagsWithDefaults`

### 2. Backend: Make queries work without limits
- [x] 2.1 `recordingSessions.ts` - Make `listMySessions` + `listSessionsOfMe` use collect()
- [x] 2.2 `notifications.ts` - Make `listForUser` use collect()
- [x] 2.3 `tags.ts` - Make `getTagsWithDefaults` + `getUserTags` use collect()

### 3. Simplify useQuery logic
- [x] 3.1 Remove `isSimpleArgs` heuristic - was fragile
- [x] 3.2 Always subscribe to Convex when online (stale-while-revalidate)
- [x] 3.3 Prefer Convex result over cache (handles updates/deletions)

### 4. SyncProvider cleanup
- [x] 4.1 Remove stale `tags:getUserTags` sync (frontend uses `getTagsWithDefaults`)
- [x] 4.2 `devices.getMyDevices` - OK without sync (infrequent changes)

### 5. Test
- [ ] 5.1 Test sessions list syncs on add/delete
- [ ] 5.2 Test notifications sync on new notification
- [ ] 5.3 Test LoadModal reflects deletions in real-time

## Notes
- Phase 2 will add proper count + lazy loading
- This phase focuses on making existing queries sync correctly
