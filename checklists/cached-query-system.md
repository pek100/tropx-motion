---
id: cached-query-system
tags: [cache, query, convex, offline, critical]
related_files: [
  electron/renderer/src/lib/convex.ts,
  electron/renderer/src/lib/cache/useQuery.ts,
  electron/renderer/src/lib/cache/CacheProvider.tsx,
  electron/renderer/src/lib/cache/store.ts
]
checklist: /checklists/cached-query-system.md
doc: /docs/cached-query-system/README.md
status: planning
last_sync: 2024-12-24
---

# Cached Query System - Implementation Checklist

## Phase 1: Server - Auto modifiedAt
- [ ] 1.1 Audit mutations for modifiedAt usage
- [ ] 1.2 Create mutation helper (or verify Convex approach)
- [ ] 1.3 Ensure all mutations set modifiedAt

## Phase 2: Core Cache Logic
- [ ] 2.1 Create cache key generation (query name + args hash)
- [ ] 2.2 Create core useCachedQuery hook
  - [ ] 2.2.1 Immediate cache read on mount
  - [ ] 2.2.2 Convex subscription
  - [ ] 2.2.3 Cache write on server data
  - [ ] 2.2.4 State management (data, isLoading, isCached, error)
  - [ ] 2.2.5 Error handling (fallback + surface)

## Phase 3: Query Wrappers
- [ ] 3.1 Create useQuery wrapper
- [ ] 3.2 Create usePaginatedQuery wrapper
- [ ] 3.3 Create useQueries wrapper (batch)

## Phase 4: Export Module
- [ ] 4.1 Create lib/convex.ts
- [ ] 4.2 Re-export all from convex/react
- [ ] 4.3 Override useQuery, usePaginatedQuery, useQueries

## Phase 5: Migration
- [ ] 5.1 Update imports: convex/react → @/lib/convex
  - [ ] 5.1.1 Components
  - [ ] 5.1.2 Hooks
  - [ ] 5.1.3 Other files
- [ ] 5.2 Remove useSyncedQuery usage (replace with useQuery)
- [ ] 5.3 Remove old useCachedQuery usage
- [ ] 5.4 Remove timestamp options from all calls

## Phase 6: Cleanup
- [ ] 6.1 Delete convex/sync.ts
- [ ] 6.2 Delete lib/cache/useSyncedQuery.ts
- [ ] 6.3 Delete lib/cache/useCachedQuery.ts (old version)
- [ ] 6.4 Clean convex/cache.ts (remove getVersions, getVersion)
- [ ] 6.5 Update lib/cache/index.ts exports

## Phase 7: Testing
- [ ] 7.1 Build passes
- [ ] 7.2 App loads with cached data
- [ ] 7.3 Real-time updates work
- [ ] 7.4 Offline mode works (within session)
- [ ] 7.5 Cache errors handled gracefully

## Notes

### Existing code to reuse:
- `CacheProvider.tsx` - encryption context, session KEK
- `store.ts` - CacheStore class, IndexedDB operations
- `encryption.ts` - hashArgs function

### Key files to modify:
- `lib/cache/index.ts` - update exports
- All components/hooks using useQuery

### Convex auto-modifiedAt:
Convex doesn't have built-in triggers. Options:
1. Manual: Set modifiedAt in each mutation (current approach)
2. Wrapper: Create `mutationWithTimestamp` helper
3. Accept: If already done manually, just verify

Recommendation: Verify current state first, then decide.
