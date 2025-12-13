---
id: batch-sync
tags: [motion-processing, synchronization, ble, real-time, critical]
related_files: [
  motionProcessing/synchronization/BatchSynchronizer.ts,
  motionProcessing/synchronization/SensorBuffer.ts,
  motionProcessing/synchronization/JointAligner.ts,
  motionProcessing/synchronization/ScanWindow.ts
]
checklist: /checklists/batch-sync.md
doc: /docs/batch-sync/README.md
status: in-progress
last_sync: 2025-12-13
---

# Batch Synchronization System

## Overview

Hierarchical temporal alignment system for multi-sensor IMU data. Replaces the "flight controller" MAX timestamp approach with buffer shearing and scan window output.

## Problem Statement

Current issues with MAX timestamp approach:
1. BLE packets arrive in 25Hz bursts (4 samples each at 100Hz)
2. MAX timestamp causes multiple samples to collapse to same timestamp
3. Results in "staircase" / "square wave" pattern in charts
4. Samples paired for joint angle may not be from same physical moment

## Solution: Hierarchical Batch Alignment

### Stage 1: Per-Sensor Buffering
Each sensor has its own buffer that grows based on observed burst batch count.

### Stage 2: Intra-Joint Alignment (Shearing)
Within each joint, align thigh and shin sensor buffers by finding closest timestamps.

### Stage 3: Inter-Joint Alignment (Shearing)
Align left knee and right knee outputs to find common overlap region.

### Stage 4: Scan Window Output
Extract first common aligned batch from all sensors, emit with MAX timestamp (now valid because samples are truly aligned).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      BatchSynchronizer                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Left Knee (JointAligner)                                │   │
│  │  ┌──────────────┐    ┌──────────────┐                   │   │
│  │  │ SensorBuffer │    │ SensorBuffer │                   │   │
│  │  │ (Thigh 0x11) │◄──►│ (Shin 0x12)  │                   │   │
│  │  └──────────────┘    └──────────────┘                   │   │
│  │         └──────── SHEAR ────────┘                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│                    ┌─────────────────┐                         │
│                    │  GlobalAligner  │                         │
│                    │  (Joint Shear)  │                         │
│                    └─────────────────┘                         │
│                              ▲                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Right Knee (JointAligner)                               │   │
│  │  ┌──────────────┐    ┌──────────────┐                   │   │
│  │  │ SensorBuffer │    │ SensorBuffer │                   │   │
│  │  │ (Thigh 0x21) │◄──►│ (Shin 0x22)  │                   │   │
│  │  └──────────────┘    └──────────────┘                   │   │
│  │         └──────── SHEAR ────────┘                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│                    ┌─────────────────┐                         │
│                    │   ScanWindow    │──────► OUTPUT            │
│                    │   (Extract)     │   (aligned samples +     │
│                    └─────────────────┘    MAX timestamp)        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
BLE Packet
    │
    ▼
DeviceProcessor (normalize, validate)
    │
    ▼
BatchSynchronizer.pushSample(deviceId, timestamp, quaternion)
    │
    ├──► SensorBuffer[deviceId].addSample()
    │
    ▼
tryEmit()
    │
    ├──► JointAligner.computeAlignment() (per joint)
    ├──► GlobalAligner.computeGlobalAlignment()
    ├──► ScanWindow.canAdvance()?
    │         │
    │         ▼ YES
    │    extractAlignedSamples()
    │    computeOutputTimestamp() ← MAX of aligned
    │    emit(AlignedSampleSet)
    │    advance() ← cleanup behind scan line
    │
    ▼
JointProcessor.processAlignedSamples()
    │
    ▼
UIProcessor.broadcast()
```

## Key Algorithms

### Closest Timestamp Matching
```typescript
// Binary search for closest timestamp in buffer
findClosestIndex(targetTs: number): number {
  let left = 0, right = this.size - 1;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (this.timestamps[mid] < targetTs) left = mid + 1;
    else right = mid;
  }
  // Check neighbors for actual closest
  if (left > 0) {
    const diffLeft = Math.abs(this.timestamps[left - 1] - targetTs);
    const diffRight = Math.abs(this.timestamps[left] - targetTs);
    if (diffLeft < diffRight) return left - 1;
  }
  return left;
}
```

### Shear Offset Computation
```typescript
// Find how much to offset buffer B to align with buffer A
computeShearOffset(bufferA: SensorBuffer, bufferB: SensorBuffer): number {
  // Use first sample of A as reference
  const refTimestamp = bufferA.getTimestampAtIndex(0);
  const closestInB = bufferB.findClosestIndex(refTimestamp);
  return closestInB; // B[closestInB] aligns with A[0]
}
```

### Scan Window Advance
```typescript
advance(): void {
  this.position++;
  // Cleanup: discard samples behind scan line
  for (const buffer of this.allBuffers) {
    buffer.discardBefore(this.getBufferIndex(buffer));
  }
}
```

## Configuration

| Constant | Value | Description |
|----------|-------|-------------|
| MAX_BUFFER_SIZE | 100 | Safety limit per sensor |
| ALIGNMENT_TRIGGER_INTERVAL | 1 | Realign every N samples |

## Single Joint Mode

When only one knee is connected (2 sensors):
- Skip GlobalAligner / inter-joint alignment
- ScanWindow operates on single JointAligner output
- Detected automatically via `detectActiveJoints()`

## Output Format

```typescript
interface AlignedSampleSet {
  timestamp: number;              // MAX of all aligned samples
  leftKnee?: {
    thigh: Quaternion;
    shin: Quaternion;
  };
  rightKnee?: {
    thigh: Quaternion;
    shin: Quaternion;
  };
}
```

## Files

| File | Purpose |
|------|---------|
| `SensorBuffer.ts` | Per-sensor circular buffer with timestamp indexing |
| `JointAligner.ts` | Intra-joint thigh↔shin alignment |
| `GlobalAligner.ts` | Inter-joint left↔right alignment |
| `ScanWindow.ts` | Output extraction and buffer cleanup |
| `BatchSynchronizer.ts` | Orchestrator, public API |

## Testing Strategy

1. Unit tests for each atomic component
2. Integration test with synthetic BLE burst patterns
3. Comparison test: old vs new approach with same input
4. Visual validation: chart should show smooth progression
