---
id: motion-processing-cleanup
tags: [cleanup, refactor, motion-processing, dead-code]
related_files:
  - motionProcessing/MotionProcessingCoordinator.ts
  - motionProcessing/deviceProcessing/DeviceProcessor.ts
  - motionProcessing/uiProcessing/UIProcessor.ts
  - motionProcessing/jointProcessing/JointProcessor.ts
  - motionProcessing/shared/constants.ts
status: complete
last_sync: 2024-12-09
---

# Motion Processing Cleanup

## Goal
Remove dead/unused code from motionProcessing while preserving angle→UI data flow.

## Phase 1: Delete Dead Files (14 files)

### dataProcessing/ (delete entire folder)
- [ ] Delete `AsyncDataParser.ts`
- [ ] Delete `ServerService.ts`
- [ ] Delete `ChunkingService.ts`

### deviceProcessing/ (delete 3 files)
- [ ] Delete `InterpolationService.ts`
- [ ] Delete `AsyncInterpolationService.ts`
- [ ] Delete `DataSyncService.ts`

### shared/ (delete 5 files)
- [ ] Delete `ApiClient.ts`
- [ ] Delete `cache.ts`
- [ ] Delete `CircularBuffer.ts`
- [ ] Delete `AsyncPerformanceMonitor.ts`
- [ ] Delete `JointStatisticsManager.ts`

### uiProcessing/ (delete 1 file)
- [ ] Delete `StateManager.ts`

### Root motionProcessing/ (delete 1 file)
- [ ] Delete `MotionProcessingConsumer.ts`

### electron/renderer/ (delete 2 dead entry files)
- [ ] Delete `ElectronMotionApp.tsx`
- [ ] Delete `main.tsx` (root level, not src/)

## Phase 2: Simplify Core Files

### MotionProcessingCoordinator.ts
- [ ] Remove imports: AsyncDataParser, ServerService, ChunkingService
- [ ] Remove fields: dataParser, serverService, chunkingService, lastCompleteRecording
- [ ] Simplify startRecording(): keep isRecording toggle, remove dataParser calls
- [ ] Simplify stopRecording(): keep isRecording toggle, remove dataParser/upload calls
- [ ] Remove methods: uploadRecordingToDatabase, getLastCompleteRecording, getQueueSize, getAsyncParserStats, processServerData, getOptimalChunkSize
- [ ] Remove dataParser.accumulateAngleData() from subscriber callback
- [ ] Remove initializeServices() dataParser/serverService/chunkingService init

### DeviceProcessor.ts
- [ ] Remove import: DataSyncService
- [ ] Remove field: dataSyncService
- [ ] Remove constructor: dataSyncService init
- [ ] Simplify startNewRecording(): empty body or remove
- [ ] Simplify isSyncReady(): return true
- [ ] Remove cleanup(): dataSyncService.reset()

### UIProcessor.ts
- [ ] Remove fields: lastBroadcastTime, MIN_BROADCAST_INTERVAL, pendingBroadcast
- [ ] Remove throttle logic from broadcastJointAngleData()

### JointProcessor.ts
- [ ] Remove import: JointStatisticsManager
- [ ] Remove field: statisticsManager
- [ ] Remove constructor: statisticsManager init
- [ ] Remove: statisticsManager.updateStats() calls
- [ ] Simplify getStats(): return null or remove
- [ ] Simplify resetStats(): remove statisticsManager calls

### constants.ts
- [ ] Remove enum: CHUNKING
- [ ] Remove enum: CACHE
- [ ] Remove enum: SERVER
- [ ] Remove enum: SYNC
- [ ] Remove enum: INTERPOLATION
- [ ] Remove enum: STATISTICS
- [ ] Remove: UI.THROTTLE_INTERVAL_MS

## Phase 3: Cleanup Tests & Docs

- [ ] Delete `motionProcessing/tests/AsyncParserValidation.ts` (tests deleted code)
- [ ] Check for any remaining imports of deleted files

## Phase 4: Verify

- [ ] Build passes: `npm run build`
- [ ] App starts without errors
- [ ] BLE devices can connect
- [ ] Angle data flows to UI (start streaming, see chart update)
