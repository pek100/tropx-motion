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

# Raw Recording Refactor - Checklist

## Key Requirements

- **No backward compatibility** - Replace entirely
- **No GapFiller** - Single AlignmentService for both CSV and Upload
- **Raw timestamps** - Store device timestamps, interpolate only on export
- **Constant interval grid** - Index-based loop

## Phase 1: Types

- [x] **[A1]** Add `RawDeviceSample` interface to `types.ts`
- [x] **[A2]** Add `AlignedJointSample` interface to `types.ts`

## Phase 2: AlignmentService (New File)

- [x] **[C1]** Create `AlignmentService.ts` with `process()` entry point
- [x] **[C2]** Implement `groupByDevice()`
- [x] **[C3]** Implement `alignJoint(thigh[], shin[])` - closest timestamp + relative quat
- [x] **[C4]** Implement `alignJoints(left[], right[])` - handle single-joint case
- [x] **[C5]** Implement `interpolateToGrid()` - index-based loop
- [x] **[F1]** Unit tests for AlignmentService

## Phase 3: RecordingBuffer Replacement

- [x] **[B1]** Replace `buffer: QuaternionSample[]` with `rawBuffer: RawDeviceSample[]`
- [x] **[B2]** Add `pushRawSample(deviceId, ts, quat)` method
- [x] **[B3]** Add `getRawSamples()` method (returns sorted copy)
- [x] **[B4]** Remove old methods (`pushSynchronizedPair`, `pushJointSample`, `tryAssembleSample`)
- [x] **[B5]** Update crash recovery to use raw format

## Phase 4: Wire Up

- [x] **[E1]** DeviceProcessor: add `RecordingBuffer.pushRawSample()` call
- [x] **[D1]** CSVExporter: use `AlignmentService.process()` instead of `InterpolationService.slerpToUniformRate()`
- [x] **[D2]** UploadService: remove GapFiller, use `AlignmentService.process()`

## Phase 5: Verification

- [x] **[F2]** Integration test: record → export → verify output format

---

## Progress Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2025-01-08 | Plan created | Done | |
| 2025-01-08 | Plan revised | Done | No backward compat, no GapFiller |
| 2025-01-08 | Phase 1-4 implemented | Done | Types, AlignmentService, RecordingBuffer, wiring |
| 2025-01-08 | TypeScript check | Passed | All modified files compile |
| 2025-01-08 | Unit tests | Passed | 9/9 AlignmentService tests |
| 2025-01-08 | Integration tests | Passed | 5/5 pipeline tests |
| 2025-01-08 | Refactor complete | Done | All tasks verified |
