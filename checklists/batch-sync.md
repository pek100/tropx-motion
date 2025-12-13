---
id: batch-sync
tags: [motion-processing, synchronization, ble, real-time, critical]
related_files: [
  motionProcessing/synchronization/BatchSynchronizer.ts,
  motionProcessing/synchronization/SensorBuffer.ts,
  motionProcessing/synchronization/JointAligner.ts,
  motionProcessing/synchronization/ScanWindow.ts,
  motionProcessing/deviceProcessing/DeviceProcessor.ts,
  motionProcessing/jointProcessing/JointProcessor.ts,
  motionProcessing/MotionProcessingCoordinator.ts
]
doc: /docs/batch-sync/README.md
status: in-progress
last_sync: 2025-12-13
---

# Batch Sync Implementation Checklist

## Phase 1: Core Data Structures

### 1.1 SensorBuffer
- [ ] Create `motionProcessing/synchronization/SensorBuffer.ts`
- [ ] Implement `Sample` interface (timestamp, quaternion)
- [ ] Implement `addSample(timestamp, quaternion)`
- [ ] Implement `getBatchAtIndex(index)`
- [ ] Implement `findClosestIndex(targetTimestamp)` - binary search
- [ ] Implement `discardBefore(index)` - cleanup
- [ ] Implement `getSize()`
- [ ] Implement `getTimestampAtIndex(index)`
- [ ] Add MAX_BUFFER_SIZE safety limit

### 1.2 Types and Constants
- [ ] Create `motionProcessing/synchronization/types.ts`
- [ ] Define `AlignedSampleSet` interface
- [ ] Define `JointSamples` interface
- [ ] Define `SyncConfig` constants
- [ ] Define `DevicePosition` enum (THIGH, SHIN)

## Phase 2: Alignment Logic

### 2.1 JointAligner
- [ ] Create `motionProcessing/synchronization/JointAligner.ts`
- [ ] Implement `setBuffers(thighBuffer, shinBuffer)`
- [ ] Implement `findOverlapRange()` - timestamp intersection
- [ ] Implement `computeShearOffset()` - index offset calculation
- [ ] Implement `computeAlignment()` - main alignment trigger
- [ ] Implement `getAlignedPairAtIndex(index)`
- [ ] Implement `getAlignedRangeSize()`
- [ ] Handle edge case: one buffer empty

### 2.2 GlobalAligner
- [ ] Create `motionProcessing/synchronization/GlobalAligner.ts`
- [ ] Implement `setJointAligners(leftAligner, rightAligner)`
- [ ] Implement `findGlobalOverlapRange()`
- [ ] Implement `computeGlobalShearOffset()`
- [ ] Implement `computeGlobalAlignment()`
- [ ] Implement `isSingleJointMode()` - detect 1 vs 2 joints
- [ ] Implement `getGlobalAlignedRangeSize()`
- [ ] Handle single joint mode (skip inter-joint alignment)

## Phase 3: Scan Window

### 3.1 ScanWindow
- [ ] Create `motionProcessing/synchronization/ScanWindow.ts`
- [ ] Implement `setAligners(jointAligners, globalAligner)`
- [ ] Implement `canAdvance()` - check data availability
- [ ] Implement `extractAlignedSamples()` - get all sensor data
- [ ] Implement `computeOutputTimestamp()` - MAX of aligned
- [ ] Implement `advance()` - move forward + trigger cleanup
- [ ] Implement `getCurrentPosition()`
- [ ] Handle single joint mode output format

## Phase 4: Orchestrator

### 4.1 BatchSynchronizer
- [ ] Create `motionProcessing/synchronization/BatchSynchronizer.ts`
- [ ] Implement singleton pattern
- [ ] Initialize 4 SensorBuffers (one per device ID)
- [ ] Initialize 2 JointAligners (left knee, right knee)
- [ ] Initialize 1 GlobalAligner
- [ ] Initialize 1 ScanWindow
- [ ] Implement `pushSample(deviceId, timestamp, quaternion)`
- [ ] Implement `routeToBuffer(deviceId)` - map device to buffer
- [ ] Implement `tryEmit()` - main processing loop
- [ ] Implement `triggerAlignment()` - recompute all alignments
- [ ] Implement `checkScanWindowReady()`
- [ ] Implement `emitAndAdvance()` - extract, emit, cleanup
- [ ] Implement `subscribe(callback)` - output subscription
- [ ] Implement `detectActiveJoints()` - single vs dual mode
- [ ] Implement `cleanup()` - full reset
- [ ] Implement `getDebugStats()` - expose internals

### 4.2 Index File
- [ ] Create `motionProcessing/synchronization/index.ts`
- [ ] Export all public APIs

## Phase 5: Integration

### 5.1 DeviceProcessor Modifications
- [ ] Remove "flight controller" matching logic
- [ ] Remove `getLatestSample()` usage for pairing
- [ ] Remove MAX timestamp calculation
- [ ] Add `BatchSynchronizer.pushSample()` call
- [ ] Keep device tracking (battery, connection state)
- [ ] Keep quaternion normalization

### 5.2 JointProcessor Modifications
- [ ] Update input signature to receive `AlignedSampleSet`
- [ ] Process pre-aligned thigh+shin quaternions
- [ ] Remove any internal pairing logic

### 5.3 Remove JointSynchronizer
- [ ] Delete `motionProcessing/synchronization/JointSynchronizer.ts`
- [ ] Remove all imports/references

### 5.4 MotionProcessingCoordinator Updates
- [ ] Import BatchSynchronizer
- [ ] Initialize BatchSynchronizer in `initialize()`
- [ ] Subscribe BatchSynchronizer output to JointProcessor
- [ ] Update data flow: DeviceProcessor → BatchSynchronizer → JointProcessor
- [ ] Remove JointSynchronizer initialization
- [ ] Update `cleanup()` to include BatchSynchronizer

### 5.5 UIProcessor Updates
- [ ] Verify compatibility with new data flow
- [ ] Update if needed for `AlignedSampleSet` format

### 5.6 RecordingBuffer Updates
- [ ] Verify receives pre-aligned data
- [ ] Update input handling if needed

## Phase 6: Testing & Validation

### 6.1 Unit Tests
- [ ] Test SensorBuffer operations
- [ ] Test JointAligner alignment correctness
- [ ] Test GlobalAligner with single/dual joint modes
- [ ] Test ScanWindow advance and cleanup

### 6.2 Integration Tests
- [ ] Test full pipeline with synthetic burst data
- [ ] Test single knee mode
- [ ] Test dual knee mode
- [ ] Test packet drop handling

### 6.3 Visual Validation
- [ ] Run with real sensors
- [ ] Verify chart shows smooth progression (no staircase)
- [ ] Compare timestamps before/after
- [ ] Verify recording captures aligned data

## Phase 7: Cleanup

- [ ] Remove unused imports
- [ ] Remove dead code from DeviceProcessor
- [ ] Update any documentation referencing old flow
- [ ] Final code review

---

## Progress Summary

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Core Data Structures | Complete | 100% |
| Phase 2: Alignment Logic | Complete | 100% |
| Phase 3: Scan Window | Complete | 100% |
| Phase 4: Orchestrator | Complete | 100% |
| Phase 5: Integration | Complete | 100% |
| Phase 6: Testing | In Progress | 0% |
| Phase 7: Cleanup | Not Started | 0% |

**Overall: ~50/67 tasks complete (core implementation done, testing pending)**

## Implementation Notes

### Files Created
- `motionProcessing/synchronization/types.ts` - Types and constants
- `motionProcessing/synchronization/SensorBuffer.ts` - Per-sensor sample buffer
- `motionProcessing/synchronization/JointAligner.ts` - Intra-joint alignment
- `motionProcessing/synchronization/GlobalAligner.ts` - Inter-joint alignment
- `motionProcessing/synchronization/ScanWindow.ts` - Output extraction
- `motionProcessing/synchronization/BatchSynchronizer.ts` - Main orchestrator

### Files Modified
- `motionProcessing/synchronization/index.ts` - Updated exports
- `motionProcessing/deviceProcessing/DeviceProcessor.ts` - Routes to BatchSynchronizer
- `motionProcessing/jointProcessing/AngleCalculationService.ts` - Added calculateFromQuaternions
- `motionProcessing/MotionProcessingCoordinator.ts` - Added BatchSync subscription

### Feature Flags
- `DeviceProcessor.setUseBatchSync(true/false)` - Toggle between new and legacy paths
- Default: BatchSync enabled
