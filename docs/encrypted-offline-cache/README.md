---
id: encrypted-offline-cache
tags: [cache, encryption, offline, indexeddb, security, performance]
related_files:
  - convex/schema.ts
  - convex/cache.ts
  - electron/renderer/src/lib/cache/encryption.ts
  - electron/renderer/src/lib/cache/store.ts
  - electron/renderer/src/lib/cache/mutationQueue.ts
  - electron/renderer/src/lib/cache/CacheProvider.tsx
  - electron/renderer/src/lib/cache/useCachedQuery.ts
  - electron/renderer/src/lib/cache/useCachedMutation.ts
checklist: /checklists/encrypted-offline-cache.md
doc: /docs/encrypted-offline-cache/README.md
status: in-progress
last_sync: 2024-12-23
---

# Encrypted Offline Cache System

## Overview

Client-side caching system for Convex queries with AES-GCM encryption. Enables offline access to medical/rehabilitation data while maintaining security.

## Goals

1. **Reduce Convex reads** - Skip fetch if cached data is fresh
2. **Offline access** - View data without network connection
3. **Security** - Encrypt cached medical data at rest
4. **Offline mutations** - Queue writes, sync when online (with warning)

## Architecture

### Two-Layer Key Architecture

```
KEK (Key Encryption Key)     → Stored in Convex (rotatable)
    ↓ wraps
DEK (Data Encryption Key)    → Stored locally in IndexedDB
    ↓ encrypts
Cached Data                  → Encrypted in per-user IndexedDB
```

**Benefits:**
- Key rotation only re-wraps DEK (~256 bits), not all cached data
- Fast rotation, no data migration needed
- Old devices can't decrypt after rotation

### Storage

- Per-user IndexedDB: `tropx_cache_{userId}`
- LRU eviction at 500MB
- Encrypted with AES-256-GCM

### Freshness

- `modifiedAt` timestamp comparison
- Client sends version, server returns 304 or new data
- Background revalidation option

## API

```typescript
// Drop-in replacement for useQuery
const data = useCachedQuery(api.dashboard.getPatientMetricsHistory, { subjectId });

// Offline-aware mutations with warning
const { mutate, isOffline } = useCachedMutation(api.sessions.update);
```

## File Structure

```
convex/
  cache.ts                    # KEK management + freshness queries
  schema.ts                   # + kekWrapped, kekVersion, kekRotatedAt

electron/renderer/src/lib/cache/
  encryption.ts               # Web Crypto API (AES-GCM)
  store.ts                    # IndexedDB with LRU eviction
  mutationQueue.ts            # Offline mutation queue
  CacheProvider.tsx           # Context provider
  useCachedQuery.ts           # Query hook
  useCachedMutation.ts        # Mutation hook
  index.ts                    # Exports
```

## Security Considerations

- KEK stored in Convex (only accessible to authenticated user)
- DEK never leaves device unencrypted
- All cached data encrypted at rest
- Key rotation invalidates other devices
- Cache cleared if decryption fails (corruption/tampering)
