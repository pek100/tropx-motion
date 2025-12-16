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
  - electron/renderer/src/hooks/useRecordingSession.ts
  - electron/renderer/src/components/SaveModal.tsx
  - electron/renderer/src/components/ActionModal.tsx
  - electron/main/MainProcess.ts
  - electron/preload/preload.ts
checklist: /checklists/quaternion-storage.md
doc: /docs/quaternion-storage/README.md
status: complete
last_sync: 2024-12-15
---

# Convex Quaternion Storage - Checklist

## Phase 1: Schema & Foundation
- [x] 1.1 Create recordings table schema (quaternions, sparse flags, chunking)
- [x] 1.2 Create raw_recordings table schema (TTL, original timestamps)
- [ ] 1.3 Clear old recordings data (deferred - will happen on deploy)

## Phase 2: Data Processing
- [x] 2.1.1 GapValidator: calculate expected timestamps
- [x] 2.1.2 GapValidator: detect gaps between samples
- [x] 2.1.3 GapValidator: classify gap size (< 2×interval vs ≥ 2×interval)
- [x] 2.2.1 GapFiller: SLERP interpolation for small gaps
- [x] 2.2.2 GapFiller: hold-last value for large gaps
- [x] 2.3.1 QuaternionCodec: pack to flat array
- [x] 2.3.2 QuaternionCodec: detect active joints
- [x] 2.3.3 QuaternionCodec: build sparse flag index arrays
- [x] 2.4.1 Chunker: split into 6000-sample chunks
- [x] 2.4.2 Chunker: calculate chunkIndex/totalChunks

## Phase 3: Upload Flow
- [x] 3.1.1 Convex: createRecordingChunk mutation
- [x] 3.1.2 Convex: createRawRecordingChunk mutation
- [x] 3.1.3 Convex: input validation
- [x] 3.2.1 UploadService: process through pipeline
- [x] 3.2.2 UploadService: upload chunks sequentially
- [x] 3.2.3 UploadService: track progress
- [x] 3.3.1 OfflineHandler: detect connection state
- [x] 3.3.2 OfflineHandler: queue failed uploads
- [x] 3.3.3 OfflineHandler: retry on reconnect
- [x] 3.3.4 OfflineHandler: toast notifications

## Phase 4: Load/Decode Flow
- [x] 4.1.1 Convex: getRecordingSession query
- [x] 4.1.2 Convex: listRecordingSessions query
- [x] 4.2.1 Reassembler: fetch chunks by sessionId (mergeChunks)
- [x] 4.2.2 Reassembler: concatenate quaternion arrays (mergeChunks)
- [x] 4.2.3 Reassembler: merge flag arrays with offset (mergeChunks)
- [x] 4.3.1 Decoder: unpack flat array to quaternions (unpack)
- [x] 4.3.2 Decoder: convert to angles (toAngles)
- [x] 4.3.3 Decoder: apply flag metadata (AngleSample includes flags)

## Phase 5: UI Integration
- [x] 5.1 Save button handler integration
- [x] 5.2 Upload progress indicator
- [x] 5.3 Connection status awareness in UI

## Phase 6: Maintenance
- [x] 6.1 Cron job: delete expired raw_recordings (code exists in crons.ts)
- [ ] 6.2 One-time: clear old schema data (deferred - on deploy)
