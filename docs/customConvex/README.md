---
id: custom-convex-refactor
tags: [convex, cache, offline, sync, refactor]
related_files: [
  electron/renderer/src/lib/customConvex/index.ts,
  electron/renderer/src/lib/customConvex/provider.tsx,
  electron/renderer/src/lib/customConvex/hooks/useQuery.ts,
  electron/renderer/src/lib/customConvex/hooks/useMutation.ts,
  electron/renderer/src/lib/customConvex/cache/SyncProvider.tsx,
  electron/renderer/src/lib/customConvex/cache/CacheProvider.tsx,
  electron/renderer/src/lib/customConvex/internal/connectivity.ts
]
checklist: /checklists/custom-convex-refactor.md
status: in-progress
last_sync: 2024-12-24
---

# Custom Convex Refactor

## Overview

Refactoring the monolithic `convex.tsx` and scattered cache code into a well-organized module structure with proper separation of concerns.

## Goals

1. **Clean module structure** - Split 414-line monolith into focused files
2. **Single connectivity source** - Replace 3 redundant detection systems with one
3. **Less aggressive polling** - 10s interval instead of 2s, with debouncing
4. **Remove dead code** - Delete 4 unused files
5. **No debug logs in production** - Wrap with debug flag

## Structure

```
/lib/customConvex/
├── index.ts                    # Main exports
├── provider.tsx                # ConvexClientProvider
│
├── /hooks/
│   ├── useQuery.ts             # Custom useQuery with caching
│   ├── useMutation.ts          # Custom useMutation with queue + optimistic
│   └── index.ts
│
├── /cache/
│   ├── CacheProvider.tsx       # Encryption, DEK/KEK management
│   ├── SyncProvider.tsx        # Proactive sync, query cache
│   ├── store.ts                # IndexedDB wrapper
│   ├── mutationQueue.ts        # Offline mutation queue
│   ├── encryption.ts           # Crypto utilities
│   ├── fallbackQueue.ts        # localStorage fallback
│   └── index.ts
│
├── /internal/
│   ├── client.ts               # Convex client singleton
│   ├── optimistic.ts           # Optimistic update logic
│   ├── connectivity.ts         # Unified connectivity detection
│   └── debug.ts                # Debug logging (dev only)
```

## Connectivity Design

### Current Problems
- ConnectionStatusBar: HEAD poll every 2s → NS_BINDING_ABORTED spam
- CacheProvider: navigator.onLine events
- useQuery: Triple-check (navigator + Convex WS + cache.isOnline)

### New Design
- Single `ConnectivityProvider` in `/internal/connectivity.ts`
- Poll interval: 10 seconds (configurable)
- Debounce: 2 consecutive failures before "offline"
- Backoff: 5s → 10s → 20s → 30s (cap) on failures
- Browser events as hints only (trigger immediate check, don't change state)
- Proper AbortController cleanup

## Migration

Consumer imports change from:
```tsx
import { useQuery, useMutation } from "@/lib/convex";
import { useCacheOptional, useSyncOptional } from "@/lib/cache";
```

To:
```tsx
import { useQuery, useMutation, useCacheOptional, useSyncOptional } from "@/lib/customConvex";
```
