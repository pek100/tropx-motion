---
id: encrypted-offline-cache-checklist
tags: [cache, encryption, offline, indexeddb, security]
related_files:
  - convex/schema.ts
  - convex/cache.ts
  - electron/renderer/src/lib/cache/encryption.ts
  - electron/renderer/src/lib/cache/store.ts
  - electron/renderer/src/lib/cache/mutationQueue.ts
  - electron/renderer/src/lib/cache/CacheProvider.tsx
  - electron/renderer/src/lib/cache/useCachedQuery.ts
  - electron/renderer/src/lib/cache/useCachedMutation.ts
doc: /docs/encrypted-offline-cache/README.md
status: complete
last_sync: 2024-12-23
---

# Encrypted Offline Cache - Implementation Checklist

## Phase 1: Backend (Convex)

- [x] **1.1** Schema: Add KEK fields to users table
  - `kekWrapped: v.optional(v.string())` - Base64 encrypted KEK
  - `kekVersion: v.optional(v.number())` - Rotation counter
  - `kekRotatedAt: v.optional(v.number())` - Last rotation timestamp
  - File: `convex/schema.ts`
  - Ref: decomposition.md → Convex Backend → Schema Changes

- [x] **1.2** Create `convex/cache.ts` with KEK management
  - `getOrCreateKEK` - Generate on first call, return existing otherwise
  - `rotateKEK` - Generate new KEK, increment version
  - `getKEKVersion` - Lightweight version check
  - Ref: decomposition.md → Convex Backend → KEK Queries/Mutations

- [x] **1.3** Add freshness queries to `convex/cache.ts`
  - `getVersions` - Return modifiedAt for multiple cache keys
  - Ref: decomposition.md → Convex Backend → Freshness Queries

## Phase 2: Client Encryption

- [x] **2.1** Create `lib/cache/encryption.ts`
  - `generateDEK()` - Generate random AES-256-GCM key
  - `wrapDEK(dek, kek)` - Encrypt DEK with KEK
  - `unwrapDEK(wrapped, kek)` - Decrypt DEK with KEK
  - `encrypt(data, dek)` - Encrypt arbitrary data
  - `decrypt(encrypted, dek)` - Decrypt data
  - `importKEK(base64)` - Import KEK from Convex
  - Ref: decomposition.md → Encryption Layer

## Phase 3: Client Storage

- [x] **3.1** Create `lib/cache/store.ts`
  - IndexedDB wrapper with per-user databases
  - `CacheStore` class with: open, close, put, get, delete, keys, clear
  - Automatic encryption/decryption on read/write
  - Ref: decomposition.md → Storage Layer → Database Management, Cache Store

- [x] **3.2** Add LRU eviction to store
  - Track `accessedAt` on every read
  - Track `size` on every write
  - `evictIfNeeded()` - Remove LRU entries when over 500MB
  - Ref: decomposition.md → Storage Layer → LRU Eviction

- [x] **3.3** Create `lib/cache/mutationQueue.ts`
  - `MutationQueue` class
  - `enqueue(mutation)` - Add to queue with timestamp
  - `getPending()` - Get unsynced mutations
  - `markSynced(id)` - Remove from queue
  - `process()` - Execute pending mutations
  - Ref: decomposition.md → Storage Layer → Mutation Queue

## Phase 4: Client Hooks

- [x] **4.1** Create `lib/cache/CacheProvider.tsx`
  - Context for cache store instance
  - Initialize DEK/KEK on auth
  - Online/offline state management
  - Auto-sync mutation queue on reconnect
  - Auto-rotate KEK check (90 days)
  - Ref: decomposition.md → Query Hook Layer → Cache Provider

- [x] **4.2** Create `lib/cache/useCachedQuery.ts`
  - Return cached data immediately
  - Check freshness in background
  - Update if stale
  - Options: `skip`, `forceRefresh`, `backgroundRevalidate`
  - Ref: decomposition.md → Query Hook Layer → useCachedQuery

- [x] **4.3** Create `lib/cache/useCachedMutation.ts`
  - Execute mutation if online
  - Queue if offline + show warning toast
  - Optimistic update support
  - Ref: decomposition.md → Query Hook Layer → useCachedMutation

- [x] **4.4** Create `lib/cache/index.ts`
  - Export all public APIs

## Phase 5: Integration

- [x] **5.1** Wrap app with CacheProvider
  - Add to `ConvexClientProvider` or `App.tsx`

- [x] **5.2** Update DashboardView to use useCachedQuery
  - `getPatientMetricsHistory`
  - `getSessionAsymmetryEvents`

- [x] **5.3** Update useCurrentUser to use useCachedQuery
  - `getMe`

- [x] **5.4** Update other queries as needed
  - `getContacts` (PatientSearchModal)
  - `listMySessions` (useRecordingSession)
  - `getMyPendingInvitations`, `listForUser`, `getUnreadCount` (NotificationBell)
  - `getTagsWithDefaults` (TagsInput)
  - `getSession` (SaveModal)

## Phase 6: UI

- [x] **6.1** Create offline indicator component (ConnectionStatusBar)
  - Show when offline (red, persists)
  - Show pending mutation count
  - Show "Connected!" (green, auto-hides after 3s)

- [x] **6.2** Add key rotation to settings (SettingsModal)
  - Manual "Rotate Encryption Key" button
  - Confirmation dialog
  - Clear cache option
  - Cache stats display

## Phase 7: Testing

- [ ] **7.1** Test encryption/decryption round-trip
- [ ] **7.2** Test cache hit/miss behavior
- [ ] **7.3** Test offline mutation queue
- [ ] **7.4** Test key rotation
- [ ] **7.5** Test LRU eviction

---

## Progress

- Total tasks: 20
- Completed: 18 (core + integration + UI)
- Remaining: 5 (testing)
- Blocked: 0
