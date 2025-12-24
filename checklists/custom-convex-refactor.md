---
id: custom-convex-refactor
tags: [convex, cache, offline, sync, refactor]
related_files: [
  electron/renderer/src/lib/convex.tsx,
  electron/renderer/src/lib/cache/CacheProvider.tsx,
  electron/renderer/src/lib/cache/SyncProvider.tsx,
  electron/renderer/src/components/ConnectionStatusBar.tsx
]
doc: /docs/customConvex/README.md
status: in-progress
last_sync: 2024-12-24
---

# Custom Convex Refactor Checklist

## Phase 1: Create New Structure
- [ ] 1.1 Create `/lib/customConvex/` folder structure
- [ ] 1.2 Create `/internal/debug.ts` - debug logging utility
- [ ] 1.3 Create `/internal/client.ts` - Convex client singleton
- [ ] 1.4 Create `/internal/connectivity.ts` - unified connectivity provider
- [ ] 1.5 Create `/internal/optimistic.ts` - optimistic update utilities

## Phase 2: Migrate Hooks
- [ ] 2.1 Create `/hooks/useQuery.ts` - extract from convex.tsx
- [ ] 2.2 Create `/hooks/useMutation.ts` - extract from convex.tsx
- [ ] 2.3 Create `/hooks/index.ts` - exports

## Phase 3: Migrate Cache
- [ ] 3.1 Move `CacheProvider.tsx` to `/cache/` (remove online/offline state)
- [ ] 3.2 Move `SyncProvider.tsx` to `/cache/`
- [ ] 3.3 Move `store.ts` to `/cache/`
- [ ] 3.4 Move `mutationQueue.ts` to `/cache/`
- [ ] 3.5 Move `encryption.ts` to `/cache/`
- [ ] 3.6 Move `fallbackQueue.ts` to `/cache/`
- [ ] 3.7 Create `/cache/index.ts` - exports

## Phase 4: Root Files
- [ ] 4.1 Create `/provider.tsx` - ConvexClientProvider
- [ ] 4.2 Create `/index.ts` - main exports

## Phase 5: Update Imports
- [ ] 5.1 Update all `@/lib/convex` imports → `@/lib/customConvex`
- [ ] 5.2 Update all `@/lib/cache` imports → `@/lib/customConvex`
- [ ] 5.3 Update `ConnectionStatusBar.tsx` to use new connectivity

## Phase 6: Cleanup
- [ ] 6.1 Delete old `/lib/convex.tsx`
- [ ] 6.2 Delete old `/lib/cache/` folder
- [ ] 6.3 Delete dead files: `useCachedQuery.ts`, `useSyncedQuery.ts`, `cacheQuery.ts`, `useCachedMutation.ts`
- [ ] 6.4 Remove console.logs (use debug utility instead)

## Phase 7: Verify
- [ ] 7.1 Build passes (`npm run build:renderer`)
- [ ] 7.2 Test online mode works
- [ ] 7.3 Test offline mode works
- [ ] 7.4 Verify no HEAD request spam in console
