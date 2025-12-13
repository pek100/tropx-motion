---
id: batch-sync
tags: [motion-processing, synchronization, ble, real-time, critical]
related_files: [
  motionProcessing/synchronization/BatchSynchronizer.ts,
  motionProcessing/synchronization/SensorBuffer.ts,
  motionProcessing/synchronization/JointAligner.ts,
  motionProcessing/synchronization/ScanWindow.ts,
  motionProcessing/deviceProcessing/DeviceProcessor.ts,
  motionProcessing/jointProcessing/JointProcessor.ts
]
checklist: /checklists/batch-sync.md
doc: /docs/batch-sync/README.md
status: in-progress
last_sync: 2025-12-13
---

# BatchSynchronizer Decomposition

## Feature: Batch Synchronization System

Hierarchical temporal alignment of IMU sensor data using buffer shearing and scan window approach.

## Decomposition Tree

```
BatchSynchronizer
├── SensorBuffer (per-sensor sample storage)
│   ├── addSample(timestamp, quaternion) ✓ atomic
│   ├── getBatchAtIndex(index) ✓ atomic
│   ├── findClosestIndex(targetTimestamp) ✓ atomic
│   ├── discardBefore(index) ✓ atomic
│   ├── getSize() ✓ atomic
│   └── getTimestampAtIndex(index) ✓ atomic
│
├── JointAligner (intra-joint thigh↔shin alignment)
│   ├── setBuffers(thighBuffer, shinBuffer) ✓ atomic
│   ├── computeAlignment()
│   │   ├── findOverlapRange() ✓ atomic
│   │   └── computeShearOffset() ✓ atomic
│   ├── getAlignedPairAtIndex(index) ✓ atomic
│   └── getAlignedRangeSize() ✓ atomic
│
├── GlobalAligner (inter-joint left↔right alignment)
│   ├── setJointAligners(leftAligner, rightAligner) ✓ atomic
│   ├── computeGlobalAlignment()
│   │   ├── findGlobalOverlapRange() ✓ atomic
│   │   └── computeGlobalShearOffset() ✓ atomic
│   ├── isSingleJointMode() ✓ atomic
│   └── getGlobalAlignedRangeSize() ✓ atomic
│
├── ScanWindow (output extraction)
│   ├── canAdvance() ✓ atomic
│   ├── extractAlignedSamples() ✓ atomic
│   ├── computeOutputTimestamp() ✓ atomic
│   ├── advance() ✓ atomic
│   └── getCurrentPosition() ✓ atomic
│
├── BatchSynchronizer (orchestrator)
│   ├── pushSample(deviceId, timestamp, quaternion) ✓ atomic
│   ├── routeToBuffer(deviceId) ✓ atomic
│   ├── tryEmit()
│   │   ├── triggerAlignment() ✓ atomic
│   │   ├── checkScanWindowReady() ✓ atomic
│   │   └── emitAndAdvance() ✓ atomic
│   ├── subscribe(callback) ✓ atomic
│   ├── detectActiveJoints() ✓ atomic
│   ├── cleanup() ✓ atomic
│   └── getDebugStats() ✓ atomic
│
└── Integration
    ├── DeviceProcessor modifications
    │   ├── removeMatchingLogic() ✓ atomic
    │   └── routeToBatchSynchronizer() ✓ atomic
    ├── JointProcessor modifications
    │   └── updateInputSignature() ✓ atomic
    ├── Remove JointSynchronizer ✓ atomic
    └── Update MotionProcessingCoordinator
        ├── initializeBatchSynchronizer() ✓ atomic
        └── updateDataFlow() ✓ atomic
```

## Atomic Units (Flat List)

### SensorBuffer (6 atoms)
1. **addSample** - Add timestamped quaternion to buffer
2. **getBatchAtIndex** - Retrieve sample at specific index
3. **findClosestIndex** - Binary search for closest timestamp
4. **discardBefore** - Remove samples before index (cleanup)
5. **getSize** - Return current buffer size
6. **getTimestampAtIndex** - Get timestamp at index for alignment

### JointAligner (5 atoms)
7. **setBuffers** - Configure thigh/shin buffer references
8. **findOverlapRange** - Find timestamp range where both sensors have data
9. **computeShearOffset** - Calculate index offset for alignment
10. **getAlignedPairAtIndex** - Get thigh+shin quaternions at aligned index
11. **getAlignedRangeSize** - Number of aligned pairs available

### GlobalAligner (5 atoms)
12. **setJointAligners** - Configure left/right joint aligner references
13. **findGlobalOverlapRange** - Find range where all joints have data
14. **computeGlobalShearOffset** - Calculate joint-level offset
15. **isSingleJointMode** - Check if only one joint active
16. **getGlobalAlignedRangeSize** - Number of globally aligned samples

### ScanWindow (5 atoms)
17. **canAdvance** - Check if enough aligned data exists
18. **extractAlignedSamples** - Get all sensor data at current position
19. **computeOutputTimestamp** - MAX timestamp from aligned samples
20. **advance** - Move window forward, trigger cleanup
21. **getCurrentPosition** - Return current scan position

### BatchSynchronizer (8 atoms)
22. **pushSample** - Entry point for new sensor data
23. **routeToBuffer** - Map deviceId to correct SensorBuffer
24. **triggerAlignment** - Recompute all alignments
25. **checkScanWindowReady** - Verify window can produce output
26. **emitAndAdvance** - Extract, emit, cleanup
27. **subscribe** - Register output callback
28. **detectActiveJoints** - Determine single vs dual joint mode
29. **cleanup** - Reset all state
30. **getDebugStats** - Expose internal state for debugging

### Integration (5 atoms)
31. **removeMatchingLogic** - Strip flight controller code from DeviceProcessor
32. **routeToBatchSynchronizer** - Add BatchSynchronizer call in DeviceProcessor
33. **updateInputSignature** - Adjust JointProcessor to receive aligned data
34. **removeJointSynchronizer** - Delete obsolete synchronizer
35. **initializeBatchSynchronizer** - Add to coordinator initialization
36. **updateDataFlow** - Rewire coordinator subscriptions

## Total: 36 atomic units
