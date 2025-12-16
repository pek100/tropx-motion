---
id: quaternion-storage
tags: [database, convex, recording, quaternion, storage]
related_files:
  - convex/schema.ts
  - convex/recordings.ts
  - convex/rawRecordings.ts
  - convex/crons.ts
  - shared/QuaternionCodec.ts
  - motionProcessing/recording/GapValidator.ts
  - motionProcessing/recording/GapFiller.ts
  - motionProcessing/recording/Chunker.ts
  - electron/renderer/src/lib/recording/UploadService.ts
  - electron/renderer/src/lib/recording/OfflineHandler.ts
  - electron/renderer/src/hooks/useRecordingUpload.ts
checklist: /checklists/quaternion-storage.md
doc: /docs/quaternion-storage/README.md
status: in-progress
last_sync: 2024-12-15
---

# Convex Quaternion Storage

## Overview

Store motion capture recordings in Convex with full quaternion data instead of pre-computed angles. This enables future algorithm improvements without re-recording.

## Architecture

```
RecordingBuffer (quaternion samples)
         │
         ▼
┌─────────────────────────────────┐
│   GapValidator + GapFiller      │
│   - Detect/fill gaps            │
│   - Generate sparse flags       │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│   QuaternionCodec.pack()        │
│   - Flat arrays [w,x,y,z,...]   │
│   - Sparse flag indices         │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│   Chunker                       │
│   - 6000 samples per chunk      │
│   - ~384KB per chunk            │
└─────────────────────────────────┘
         │
         ├─────────────────────────┐
         ▼                         ▼
   recordings              raw_recordings
   (permanent)              (2-week TTL)
```

## Storage Format

### Quaternion Arrays
- Flat format: `[w0,x0,y0,z0, w1,x1,y1,z1, ...]`
- Empty array `[]` for inactive joints

### Sparse Flags
- `leftKneeInterpolated: [3, 15, 22]` - sample indices that were SLERP'd
- `leftKneeMissing: [6, 7, 45]` - sample indices that were held

### Chunking
- 6000 samples per chunk (1 minute @ 100Hz)
- Fields: `sessionId`, `chunkIndex`, `totalChunks`

## Gap Handling

| Gap Size | Action | Flag |
|----------|--------|------|
| < 2×interval (20ms @ 100Hz) | SLERP interpolate | `interpolated` |
| ≥ 2×interval | Hold last value | `missing` |

## UX Flow

1. User presses "Save" button
2. If online: upload immediately, show progress
3. If offline: toast error, queue in memory
4. On reconnection: auto-retry, toast success

## Tables

### recordings
Permanent storage with quaternion data and sparse flags.

### raw_recordings
Debug data with original timestamps. Auto-deleted after 2 weeks.
