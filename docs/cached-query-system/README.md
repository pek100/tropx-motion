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

# Generic Cached Query System

## Overview

Replace all Convex query mechanisms with a single, generic cached query system that:
- Returns cached data immediately (no loading flash)
- Subscribes to Convex real-time updates
- Updates cache when fresh data arrives
- Stores raw encrypted data
- Works offline with session KEK

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Component                           │
│                                                             │
│   const { data, isCached } = useQuery(api.users.getMe)     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    lib/convex.ts                            │
│                                                             │
│   export { cachedUseQuery as useQuery } from './cache'     │
│   export { useMutation, useConvex, ... } from 'convex/react'│
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 lib/cache/useQuery.ts                       │
│                                                             │
│   1. Generate cache key (queryName + hash(args))           │
│   2. Load from cache immediately → return cached data      │
│   3. Subscribe to Convex real-time                         │
│   4. On server data → update cache → update UI             │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
        ┌───────────────────┐  ┌───────────────────┐
        │   CacheStore      │  │   Convex Client   │
        │   (IndexedDB)     │  │   (Real-time)     │
        │   Encrypted       │  │                   │
        └───────────────────┘  └───────────────────┘
```

## API

### useQuery
```typescript
import { useQuery } from '@/lib/convex';

// Simple usage (same as before)
const data = useQuery(api.users.getMe);

// With extended info
const { data, isLoading, isCached, error } = useQuery(api.users.getMe);

// With args
const { data } = useQuery(api.sessions.get, { id: sessionId });

// With skip
const { data } = useQuery(api.sessions.get, sessionId ? { id: sessionId } : "skip");
```

### Return Type
```typescript
interface UseQueryResult<T> {
  data: T | undefined;      // Cached or server data
  isLoading: boolean;       // True if no data yet (cache miss + server pending)
  isCached: boolean;        // True if showing cached, server pending
  error: Error | null;      // Cache read/write errors (non-blocking)
}
```

## Key Decisions

1. **No special timestamp queries** - Convex real-time subscription IS the sync
2. **Raw storage** - Store data exactly as received, just encrypted
3. **Graceful degradation** - Cache errors fall back to server-only
4. **Type preservation** - Full TypeScript support via Convex generics

## Files

| File | Purpose |
|------|---------|
| `lib/convex.ts` | Re-exports convex/react with cached overrides |
| `lib/cache/useQuery.ts` | Main cached useQuery hook |
| `lib/cache/usePaginatedQuery.ts` | Cached usePaginatedQuery |
| `lib/cache/useQueries.ts` | Cached useQueries (batch) |
| `lib/cache/CacheProvider.tsx` | Encryption context (existing) |
| `lib/cache/store.ts` | IndexedDB operations (existing) |

## Deleted Files (after migration)

- `convex/sync.ts` - Individual timestamp queries
- `lib/cache/useSyncedQuery.ts` - Old sync hook
- `lib/cache/useCachedQuery.ts` - Old cache hook
- `convex/cache.ts` getVersions/getVersion - Unused queries
