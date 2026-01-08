---
id: raw-recording-refactor
tags: [recording, alignment, export, refactor]
related_files:
  - motionProcessing/recording/RecordingBuffer.ts
  - motionProcessing/recording/AlignmentService.ts
  - motionProcessing/recording/CSVExporter.ts
  - motionProcessing/recording/InterpolationService.ts
  - motionProcessing/recording/types.ts
  - motionProcessing/synchronization/SensorBuffer.ts
  - motionProcessing/deviceProcessing/DeviceProcessor.ts
checklist: /checklists/raw-recording-refactor.md
doc: /docs/raw-recording-refactor/README.md
status: complete
last_sync: 2025-01-08
---

# Raw Recording Refactor

## Summary

Store raw per-device sensor data during recording. Process alignment only on export/save.

## Key Requirements

1. **No backward compatibility** - Replace RecordingBuffer entirely
2. **No GapFiller** - Single AlignmentService for both CSV and Upload paths
3. **Raw timestamps** - Store device timestamps, interpolate only on export
4. **Constant interval grid** - Index-based loop (no floating-point accumulation)
5. **BatchSynchronizer unchanged** - Still used for live UI view

## Why

- **Better alignment:** Export can look at ALL data (forward + backward)
- **Raw data preserved:** Can re-export with different parameters
- **Simpler recording:** Just store samples, no real-time assembly
- **No processing delay:** Pause/stop is instant
- **Single code path:** Both CSV and Upload use same AlignmentService

## Architecture

```
Recording:
  BLE → DeviceProcessor → RecordingBuffer.pushRawSample(deviceId, ts, quat)
                       ↘ BatchSynchronizer (for UI only, unchanged)

Export/Save (BOTH CSV and Upload):
  RecordingBuffer.getRawSamples()
       ↓
  AlignmentService.process(rawSamples, targetHz)
       ↓
  1. Group by device (4 streams: 0x11, 0x12, 0x21, 0x22)
  2. Align thigh↔shin per joint, compute relative quat (thigh⁻¹ × shin)
  3. Align left↔right joints by closest timestamp
  4. Interpolate to uniform grid (index-based, constant interval)
       ↓
  QuaternionSample[] { t, lq, rq }
       ↓
  CSV: toAngleSamples() → generate file
  Upload: chunkAndCompress() → Convex
```

## New Components

| Component | Purpose |
|-----------|---------|
| `RawDeviceSample` | Type: `{ deviceId, timestamp, quaternion }` |
| `AlignedJointSample` | Type: `{ timestamp, relativeQuaternion }` |
| `AlignmentService` | Post-process raw → aligned on export |
| `RecordingBuffer` | Simplified: just stores raw samples |

## Files Changed

| File | Change |
|------|--------|
| `types.ts` | Add `RawDeviceSample`, `AlignedJointSample` |
| `RecordingBuffer.ts` | Replace with raw storage, add `pushRawSample()`, `getRawSamples()` |
| `AlignmentService.ts` | NEW: alignment + interpolation logic |
| `CSVExporter.ts` | Use `AlignmentService.process()` |
| `UploadService.ts` | Remove GapFiller, use `AlignmentService.process()` |
| `DeviceProcessor.ts` | Add `RecordingBuffer.pushRawSample()` call |
