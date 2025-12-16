---
id: quaternion-storage-decomposition
tags: [database, convex, recording, quaternion, storage]
related_files: []
checklist: /checklists/quaternion-storage.md
doc: /docs/quaternion-storage/README.md
status: in-progress
last_sync: 2024-12-15
---

# Quaternion Storage - Decomposition

```
Feature: Convex Quaternion Storage

Convex Quaternion Storage
├── 1. Schema Layer
│   ├── 1.1 recordings table schema ✓ atomic
│   ├── 1.2 raw_recordings table schema ✓ atomic
│   └── 1.3 Delete old schema/data ✓ atomic
│
├── 2. Data Processing Layer
│   ├── 2.1 Gap Detection
│   │   ├── 2.1.1 Calculate expected timestamps from sample rate ✓ atomic
│   │   ├── 2.1.2 Detect gaps between consecutive samples ✓ atomic
│   │   └── 2.1.3 Classify gap size (small vs large) ✓ atomic
│   │
│   ├── 2.2 Gap Filling
│   │   ├── 2.2.1 SLERP interpolation for small gaps ✓ atomic
│   │   └── 2.2.2 Hold-last for large gaps ✓ atomic
│   │
│   ├── 2.3 Quaternion Packing
│   │   ├── 2.3.1 Flatten quaternions to array [w,x,y,z,...] ✓ atomic
│   │   ├── 2.3.2 Detect active joints ✓ atomic
│   │   └── 2.3.3 Build sparse flag index arrays ✓ atomic
│   │
│   └── 2.4 Chunking
│       ├── 2.4.1 Split samples into 6000-sample chunks ✓ atomic
│       └── 2.4.2 Calculate chunk metadata (index, total) ✓ atomic
│
├── 3. Upload Layer
│   ├── 3.1 Convex Mutations
│   │   ├── 3.1.1 createRecordingChunk mutation ✓ atomic
│   │   ├── 3.1.2 createRawRecordingChunk mutation ✓ atomic
│   │   └── 3.1.3 Validation in mutations ✓ atomic
│   │
│   ├── 3.2 Upload Service
│   │   ├── 3.2.1 Process recording through pipeline ✓ atomic
│   │   ├── 3.2.2 Upload chunks sequentially ✓ atomic
│   │   └── 3.2.3 Track upload progress ✓ atomic
│   │
│   └── 3.3 Retry & Offline
│       ├── 3.3.1 Detect connection state ✓ atomic
│       ├── 3.3.2 Queue failed uploads in memory ✓ atomic
│       ├── 3.3.3 Retry on reconnection ✓ atomic
│       └── 3.3.4 Toast notifications ✓ atomic
│
├── 4. Load/Decode Layer
│   ├── 4.1 Convex Queries
│   │   ├── 4.1.1 getRecordingSession query ✓ atomic
│   │   └── 4.1.2 listRecordingSessions query ✓ atomic
│   │
│   ├── 4.2 Reassembly
│   │   ├── 4.2.1 Fetch all chunks by sessionId ✓ atomic
│   │   ├── 4.2.2 Sort and concatenate quaternion arrays ✓ atomic
│   │   └── 4.2.3 Merge sparse flag arrays with offset ✓ atomic
│   │
│   └── 4.3 Decode to Angles
│       ├── 4.3.1 Unpack flat array to quaternion objects ✓ atomic
│       ├── 4.3.2 Convert quaternions to angles ✓ atomic
│       └── 4.3.3 Apply flag metadata to output ✓ atomic
│
├── 5. UI Integration
│   ├── 5.1 Save button handler ✓ atomic
│   ├── 5.2 Upload progress indicator ✓ atomic
│   └── 5.3 Connection status awareness ✓ atomic
│
└── 6. Maintenance
    ├── 6.1 TTL cron job for raw_recordings ✓ atomic
    └── 6.2 One-time: clear old schema data ✓ atomic
```

## Atomic Units Summary

| # | Unit | Parent | File |
|---|------|--------|------|
| 1.1 | recordings table schema | Schema Layer | convex/schema.ts |
| 1.2 | raw_recordings table schema | Schema Layer | convex/schema.ts |
| 1.3 | Delete old schema/data | Schema Layer | - |
| 2.1.1 | Calculate expected timestamps | Gap Detection | GapValidator.ts |
| 2.1.2 | Detect gaps | Gap Detection | GapValidator.ts |
| 2.1.3 | Classify gap size | Gap Detection | GapValidator.ts |
| 2.2.1 | SLERP interpolation | Gap Filling | GapFiller.ts |
| 2.2.2 | Hold-last | Gap Filling | GapFiller.ts |
| 2.3.1 | Flatten quaternions | Quaternion Packing | QuaternionCodec.ts |
| 2.3.2 | Detect active joints | Quaternion Packing | QuaternionCodec.ts |
| 2.3.3 | Build sparse flags | Quaternion Packing | QuaternionCodec.ts |
| 2.4.1 | Split into chunks | Chunking | Chunker.ts |
| 2.4.2 | Calculate chunk metadata | Chunking | Chunker.ts |
| 3.1.1 | createRecordingChunk | Convex Mutations | recordings.ts |
| 3.1.2 | createRawRecordingChunk | Convex Mutations | rawRecordings.ts |
| 3.1.3 | Validation | Convex Mutations | recordings.ts |
| 3.2.1 | Process pipeline | Upload Service | UploadService.ts |
| 3.2.2 | Upload chunks | Upload Service | UploadService.ts |
| 3.2.3 | Track progress | Upload Service | UploadService.ts |
| 3.3.1 | Detect connection | Retry & Offline | OfflineHandler.ts |
| 3.3.2 | Queue uploads | Retry & Offline | OfflineHandler.ts |
| 3.3.3 | Retry on reconnect | Retry & Offline | OfflineHandler.ts |
| 3.3.4 | Toast notifications | Retry & Offline | OfflineHandler.ts |
| 4.1.1 | getRecordingSession | Convex Queries | recordings.ts |
| 4.1.2 | listRecordingSessions | Convex Queries | recordings.ts |
| 4.2.1 | Fetch chunks | Reassembly | QuaternionCodec.ts |
| 4.2.2 | Concatenate arrays | Reassembly | QuaternionCodec.ts |
| 4.2.3 | Merge flag arrays | Reassembly | QuaternionCodec.ts |
| 4.3.1 | Unpack to quaternions | Decode | QuaternionCodec.ts |
| 4.3.2 | Convert to angles | Decode | QuaternionCodec.ts |
| 4.3.3 | Apply flag metadata | Decode | QuaternionCodec.ts |
| 5.1 | Save button handler | UI Integration | App.tsx |
| 5.2 | Upload progress | UI Integration | App.tsx |
| 5.3 | Connection awareness | UI Integration | useRecordingUpload.ts |
| 6.1 | TTL cron job | Maintenance | crons.ts |
| 6.2 | Clear old data | Maintenance | - |
