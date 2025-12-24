---
id: cached-query-system
tags: [cache, query, convex, offline, critical]
related_files: []
checklist: /checklists/cached-query-system.md
doc: /docs/cached-query-system/README.md
status: planning
last_sync: 2024-12-24
---

# Feature Decomposition: Generic Cached Query System

## Tree Structure

```
Cached Query System
├── Server: Auto modifiedAt
│   ├── Audit existing mutations for modifiedAt ✓ atomic
│   ├── Create mutation wrapper helper ✓ atomic
│   └── Migrate mutations to use wrapper ✓ atomic
│
├── Client: Core Cache Hook
│   ├── Cache Key Generation
│   │   ├── Query name extraction ✓ atomic
│   │   └── Args hashing ✓ atomic
│   │
│   ├── Cache Read (immediate)
│   │   ├── Load from IndexedDB ✓ atomic
│   │   ├── Decrypt data ✓ atomic
│   │   └── Handle read errors (fallback) ✓ atomic
│   │
│   ├── Cache Write (on server data)
│   │   ├── Encrypt data ✓ atomic
│   │   ├── Store to IndexedDB ✓ atomic
│   │   └── Handle write errors ✓ atomic
│   │
│   └── State Management
│       ├── Merge cached + server data ✓ atomic
│       ├── Compute isLoading/isCached ✓ atomic
│       └── Error state handling ✓ atomic
│
├── Client: Query Wrappers
│   ├── useQuery wrapper ✓ atomic
│   ├── usePaginatedQuery wrapper ✓ atomic
│   └── useQueries wrapper ✓ atomic
│
├── Client: Export Module
│   ├── Re-export convex/react ✓ atomic
│   └── Override query hooks ✓ atomic
│
├── Migration
│   ├── Update imports across app ✓ atomic
│   ├── Remove useSyncedQuery usage ✓ atomic
│   ├── Remove useCachedQuery usage ✓ atomic
│   └── Remove old cache files ✓ atomic
│
└── Cleanup
    ├── Delete convex/sync.ts ✓ atomic
    ├── Delete old useSyncedQuery.ts ✓ atomic
    ├── Delete old useCachedQuery.ts ✓ atomic
    └── Clean convex/cache.ts (keep KEK only) ✓ atomic
```

## Atomic Units (Implementation Order)

### Phase 1: Server - Auto modifiedAt
1. **audit-mutations** - Scan all mutations, verify modifiedAt is set
2. **mutation-wrapper** - Create `mutationWithTimestamp` helper that auto-sets modifiedAt
3. **migrate-mutations** - Update mutations to use wrapper (or verify manual setting)

### Phase 2: Core Cache Logic
4. **query-name-extract** - Get query function name from reference
5. **args-hash** - Hash args object to stable string (already exists in encryption.ts)
6. **cache-key-gen** - Combine query name + args hash

7. **cache-read** - Async load from IndexedDB via CacheStore
8. **cache-decrypt** - Decrypt using DEK (handled by CacheStore.get)
9. **cache-read-error** - Try/catch, return undefined on error, set error state

10. **cache-encrypt** - Encrypt using DEK (handled by CacheStore.put)
11. **cache-write** - Async write to IndexedDB via CacheStore
12. **cache-write-error** - Try/catch, log error, set error state

13. **state-merge** - Return serverData ?? cachedData
14. **compute-flags** - isLoading, isCached based on state
15. **error-handling** - Surface cache errors without blocking

### Phase 3: Query Wrappers
16. **use-query-wrapper** - Main useQuery with caching
17. **use-paginated-wrapper** - usePaginatedQuery with caching
18. **use-queries-wrapper** - useQueries (batch) with caching

### Phase 4: Export Module
19. **convex-exports** - Create lib/convex.ts with re-exports
20. **hook-overrides** - Export cached versions as useQuery, etc.

### Phase 5: Migration
21. **update-imports** - Change all `from 'convex/react'` to `from '@/lib/convex'`
22. **remove-synced-usage** - Remove useSyncedQuery calls, use plain useQuery
23. **remove-cached-usage** - Remove old useCachedQuery calls
24. **remove-old-files** - Delete deprecated files

### Phase 6: Cleanup
25. **delete-sync-ts** - Remove convex/sync.ts
26. **delete-synced-query** - Remove useSyncedQuery.ts
27. **delete-cached-query** - Remove old useCachedQuery.ts
28. **clean-cache-ts** - Remove getVersions, getVersion from convex/cache.ts
