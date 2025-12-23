---
id: encrypted-offline-cache-decomposition
tags: [cache, encryption, offline, architecture]
related_files: []
checklist: /checklists/encrypted-offline-cache.md
doc: /docs/encrypted-offline-cache/README.md
status: in-progress
last_sync: 2024-12-23
---

# Feature Decomposition: Encrypted Offline Cache

```
Encrypted Offline Cache
├── Encryption Layer
│   ├── KEK Management (Convex-side)
│   │   ├── Generate KEK on first sign-in ✓ atomic
│   │   ├── Store KEK in users table ✓ atomic
│   │   ├── Rotate KEK (manual trigger) ✓ atomic
│   │   ├── Rotate KEK (auto 90-day check) ✓ atomic
│   │   └── Fetch KEK on sign-in ✓ atomic
│   ├── DEK Management (Client-side)
│   │   ├── Generate DEK on first cache init ✓ atomic
│   │   ├── Wrap DEK with KEK ✓ atomic
│   │   ├── Unwrap DEK with KEK ✓ atomic
│   │   ├── Store wrapped DEK in IndexedDB ✓ atomic
│   │   └── Re-wrap DEK on KEK rotation ✓ atomic
│   └── Data Encryption
│       ├── Encrypt data with DEK (AES-GCM) ✓ atomic
│       └── Decrypt data with DEK (AES-GCM) ✓ atomic
│
├── Storage Layer (IndexedDB)
│   ├── Database Management
│   │   ├── Create per-user database ✓ atomic
│   │   ├── Open existing database ✓ atomic
│   │   ├── Delete user database ✓ atomic
│   │   └── List all user databases ✓ atomic
│   ├── Cache Store
│   │   ├── Put entry (key, data, metadata) ✓ atomic
│   │   ├── Get entry by key ✓ atomic
│   │   ├── Delete entry ✓ atomic
│   │   ├── Check entry exists ✓ atomic
│   │   └── Get all keys ✓ atomic
│   ├── LRU Eviction
│   │   ├── Track access time on read ✓ atomic
│   │   ├── Calculate total cache size ✓ atomic
│   │   ├── Find least-recently-used entries ✓ atomic
│   │   └── Evict until under limit ✓ atomic
│   └── Mutation Queue (Offline Writes)
│       ├── Queue mutation with timestamp ✓ atomic
│       ├── Get pending mutations ✓ atomic
│       ├── Mark mutation as synced ✓ atomic
│       ├── Delete synced mutations ✓ atomic
│       └── Retry failed mutations ✓ atomic
│
├── Freshness Layer
│   ├── Version Tracking
│   │   ├── Store modifiedAt with cached data ✓ atomic
│   │   ├── Fetch server modifiedAt (lightweight query) ✓ atomic
│   │   └── Compare versions ✓ atomic
│   └── Revalidation
│       ├── Check freshness on query ✓ atomic
│       ├── Return cached if fresh ✓ atomic
│       ├── Fetch and update if stale ✓ atomic
│       └── Background revalidation option ✓ atomic
│
├── Query Hook Layer
│   ├── useCachedQuery Hook
│   │   ├── Initialize cache on mount ✓ atomic
│   │   ├── Return cached data immediately ✓ atomic
│   │   ├── Trigger freshness check ✓ atomic
│   │   ├── Update state when fresh data arrives ✓ atomic
│   │   ├── Handle loading/error states ✓ atomic
│   │   └── Skip cache option (force refresh) ✓ atomic
│   ├── useCachedMutation Hook
│   │   ├── Execute mutation optimistically ✓ atomic
│   │   ├── Queue if offline ✓ atomic
│   │   ├── Show offline warning ✓ atomic
│   │   ├── Sync when online ✓ atomic
│   │   └── Handle conflicts ✓ atomic
│   └── Cache Provider
│       ├── Initialize encryption on auth ✓ atomic
│       ├── Provide cache context ✓ atomic
│       ├── Handle online/offline events ✓ atomic
│       └── Sync mutation queue on reconnect ✓ atomic
│
└── Convex Backend
    ├── Schema Changes
    │   ├── Add kekWrapped to users table ✓ atomic
    │   ├── Add kekVersion to users table ✓ atomic
    │   └── Add kekRotatedAt to users table ✓ atomic
    ├── KEK Queries/Mutations
    │   ├── getOrCreateKEK query ✓ atomic
    │   ├── rotateKEK mutation ✓ atomic
    │   └── getKEKVersion query ✓ atomic
    └── Freshness Queries
        ├── getModifiedAt (generic) ✓ atomic
        └── Per-table freshness endpoints ✓ atomic
```

## Atomic Units Summary

| # | Unit | Parent | Priority |
|---|------|--------|----------|
| 1 | Generate KEK on first sign-in | KEK Management | P0 |
| 2 | Store KEK in users table | KEK Management | P0 |
| 3 | Rotate KEK (manual) | KEK Management | P1 |
| 4 | Rotate KEK (auto 90-day) | KEK Management | P2 |
| 5 | Fetch KEK on sign-in | KEK Management | P0 |
| 6 | Generate DEK | DEK Management | P0 |
| 7 | Wrap DEK with KEK | DEK Management | P0 |
| 8 | Unwrap DEK with KEK | DEK Management | P0 |
| 9 | Store wrapped DEK | DEK Management | P0 |
| 10 | Re-wrap DEK on rotation | DEK Management | P1 |
| 11 | Encrypt data (AES-GCM) | Data Encryption | P0 |
| 12 | Decrypt data (AES-GCM) | Data Encryption | P0 |
| 13-16 | Database Management | Storage Layer | P0 |
| 17-21 | Cache Store CRUD | Storage Layer | P0 |
| 22-25 | LRU Eviction | Storage Layer | P0 |
| 26-30 | Mutation Queue | Storage Layer | P1 |
| 31-33 | Version Tracking | Freshness Layer | P0 |
| 34-37 | Revalidation | Freshness Layer | P0 |
| 38-43 | useCachedQuery | Hook Layer | P0 |
| 44-48 | useCachedMutation | Hook Layer | P1 |
| 49-52 | CacheProvider | Hook Layer | P0 |
