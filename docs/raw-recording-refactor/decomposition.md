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

# Raw Recording Refactor - Decomposition

## Key Requirements

1. **No backward compatibility** - Replace RecordingBuffer entirely
2. **No GapFiller** - Single AlignmentService for both CSV and Upload paths
3. **Raw timestamps** - Store device timestamps, interpolate only on export
4. **Constant interval grid** - Index-based loop (no floating-point accumulation)
5. **BatchSynchronizer unchanged** - Still used for live UI view

## Architecture Change

```
BEFORE:
Recording:
  BLE → BatchSynchronizer (align+grid) → RecordingBuffer (stores QuaternionSample[])
CSV Export:
  RecordingBuffer.getAllSamples() → InterpolationService
Upload:
  RecordingBuffer.getAllSamples() → GapFiller.resample() → chunkAndCompress()

AFTER:
Recording:
  BLE → DeviceProcessor → RecordingBuffer.pushRawSample(deviceId, ts, quat)
                       ↘ BatchSynchronizer (unchanged, for UI only)

Export/Save (BOTH CSV and Upload):
  RecordingBuffer.getRawSamples()
       ↓
  AlignmentService.process(rawSamples, targetHz)
       ↓
  1. Group by device (4 streams: 0x11, 0x12, 0x21, 0x22)
  2. Align thigh↔shin per joint, compute relative quat
  3. Align left↔right joints
  4. Interpolate to uniform grid (index-based, constant interval)
       ↓
  QuaternionSample[] { t, lq, rq }
       ↓
  CSV: InterpolationService.toAngleSamples() → generate file
  Upload: chunkAndCompress() → Convex
```

## $FUNNEL Decomposition

```
Raw Recording Refactor
│
├── [A] New Data Types (motionProcessing/recording/types.ts)
│   ├── [A1] RawDeviceSample interface ✓ atomic
│   ├── [A2] AlignedJointSample interface ✓ atomic
│   └── [A3] Reuse DEVICE_MAPPING from synchronization/types.ts
│
├── [B] Replace RecordingBuffer (motionProcessing/recording/RecordingBuffer.ts)
│   ├── [B1] Change buffer type to RawDeviceSample[] ✓ atomic
│   ├── [B2] Add pushRawSample(deviceId, ts, quat) ✓ atomic
│   ├── [B3] Add getRawSamples() ✓ atomic
│   ├── [B4] Remove old methods (pushSynchronizedPair, pushJointSample, tryAssembleSample)
│   └── [B5] Update crash recovery to use raw format
│
├── [C] Create AlignmentService (NEW: motionProcessing/recording/AlignmentService.ts)
│   ├── [C1] process() - main entry point ✓ atomic
│   ├── [C2] groupByDevice() ✓ atomic
│   ├── [C3] alignJoint(thigh[], shin[]) - returns AlignedJointSample[] ✓ atomic
│   ├── [C4] alignJoints(left[], right[]) - returns QuaternionSample[] ✓ atomic
│   └── [C5] interpolateToGrid(samples[], hz) - index-based loop ✓ atomic
│
├── [D] Update Export Paths
│   ├── [D1] CSVExporter: AlignmentService.process() → toAngleSamples() ✓ atomic
│   └── [D2] UploadService: Remove GapFiller, use AlignmentService.process() ✓ atomic
│
├── [E] Update Recording Entry Point
│   └── [E1] DeviceProcessor: add RecordingBuffer.pushRawSample() call ✓ atomic
│
└── [F] Verification
    ├── [F1] Unit tests for AlignmentService ✓ atomic
    └── [F2] Integration test: record → export → verify ✓ atomic
```

## Atomic Units Detail

### [A] New Data Types

```typescript
// A1: RawDeviceSample - raw per-device data stored during recording
export interface RawDeviceSample {
  deviceId: number;    // 0x11, 0x12, 0x21, 0x22
  timestamp: number;   // device timestamp (ms)
  quaternion: Quaternion;
}

// A2: AlignedJointSample - intermediate result after thigh↔shin alignment
export interface AlignedJointSample {
  timestamp: number;           // reference timestamp (from thigh sensor)
  relativeQuaternion: Quaternion;  // thigh⁻¹ × shin
}

// A3: Reuse existing DEVICE_MAPPING from synchronization/types.ts
// Already defines: 0x11=LEFT_SHIN, 0x12=LEFT_THIGH, 0x21=RIGHT_SHIN, 0x22=RIGHT_THIGH
```

### [B] RecordingBuffer Changes

```typescript
// B1-B5: Replace entire buffer system
class RecordingBufferClass {
  private rawBuffer: RawDeviceSample[] = [];  // B1: New buffer type
  private isRecording = false;
  private startTime: number | null = null;
  private targetHz = 100;
  private tempFilePath: string;

  // B2: Push raw sample from DeviceProcessor
  pushRawSample(deviceId: number, timestamp: number, quaternion: Quaternion): void {
    if (!this.isRecording) return;
    this.rawBuffer.push({ deviceId, timestamp, quaternion });
    this.checkFlush();
  }

  // B3: Get raw samples for export
  getRawSamples(): RawDeviceSample[] {
    // Sort by timestamp to handle BLE out-of-order arrival
    return [...this.rawBuffer].sort((a, b) => a.timestamp - b.timestamp);
  }

  // B4: Remove old methods entirely (no backward compat)
  // DELETED: pushSynchronizedPair(), pushJointSample(), tryAssembleSample()
  // DELETED: pendingLeft, pendingRight, leftJointSeen, rightJointSeen

  // B5: Update crash recovery format
  private flushToDisk(): void {
    const data = { startTime: this.startTime, targetHz: this.targetHz, rawSamples: this.rawBuffer };
    fs.writeFileSync(this.tempFilePath, JSON.stringify(data), 'utf-8');
  }
}
```

### [C] AlignmentService (NEW)

```typescript
// C1-C5: Post-processing on export - single service for both CSV and Upload
import { QuaternionService } from '../shared/QuaternionService';
import { DEVICE_MAPPING } from '../synchronization/types';

export class AlignmentService {

  // C1: Main entry point - called by both CSVExporter and UploadService
  static process(raw: RawDeviceSample[], targetHz: number): QuaternionSample[] {
    if (raw.length === 0) return [];

    // C2: Group by device
    const grouped = this.groupByDevice(raw);

    // C3: Align sensors within each joint, compute relative quaternions
    const leftAligned = this.alignJoint(
      grouped.get(0x12) || [],  // LEFT_THIGH
      grouped.get(0x11) || []   // LEFT_SHIN
    );
    const rightAligned = this.alignJoint(
      grouped.get(0x22) || [],  // RIGHT_THIGH
      grouped.get(0x21) || []   // RIGHT_SHIN
    );

    // C4: Align left and right joints
    const combined = this.alignJoints(leftAligned, rightAligned);

    // C5: Interpolate to uniform grid
    return this.interpolateToGrid(combined, targetHz);
  }

  // C2: Group raw samples by device ID, sort each by timestamp
  private static groupByDevice(raw: RawDeviceSample[]): Map<number, RawDeviceSample[]> {
    const grouped = new Map<number, RawDeviceSample[]>();
    for (const sample of raw) {
      if (!grouped.has(sample.deviceId)) {
        grouped.set(sample.deviceId, []);
      }
      grouped.get(sample.deviceId)!.push(sample);
    }
    // Sort each group by timestamp
    grouped.forEach(samples => samples.sort((a, b) => a.timestamp - b.timestamp));
    return grouped;
  }

  // C3: Align thigh and shin sensors, compute relative quaternion
  private static alignJoint(
    thigh: RawDeviceSample[],
    shin: RawDeviceSample[]
  ): AlignedJointSample[] {
    // Need BOTH sensors to compute relative quaternion
    if (thigh.length === 0 || shin.length === 0) return [];

    const result: AlignedJointSample[] = [];
    let shinIdx = 0;

    for (const thighSample of thigh) {
      // Find closest shin sample (advancing pointer)
      while (shinIdx < shin.length - 1 &&
             Math.abs(shin[shinIdx + 1].timestamp - thighSample.timestamp) <
             Math.abs(shin[shinIdx].timestamp - thighSample.timestamp)) {
        shinIdx++;
      }

      const shinSample = shin[shinIdx];
      // Compute relative: thigh⁻¹ × shin
      const relativeQuat = QuaternionService.multiply(
        QuaternionService.inverse(thighSample.quaternion),
        shinSample.quaternion
      );

      result.push({
        timestamp: thighSample.timestamp,  // Use thigh timestamp as reference
        relativeQuaternion: relativeQuat
      });
    }

    return result;
  }

  // C4: Align left and right joints by closest timestamp
  private static alignJoints(
    left: AlignedJointSample[],
    right: AlignedJointSample[]
  ): QuaternionSample[] {
    // Handle single-joint cases
    if (left.length === 0 && right.length === 0) return [];

    if (right.length === 0) {
      // Only left joint active
      return left.map(s => ({ t: s.timestamp, lq: s.relativeQuaternion, rq: null }));
    }

    if (left.length === 0) {
      // Only right joint active
      return right.map(s => ({ t: s.timestamp, lq: null, rq: s.relativeQuaternion }));
    }

    // Both joints - align by closest timestamp
    const result: QuaternionSample[] = [];
    let rightIdx = 0;

    for (const leftSample of left) {
      // Find closest right sample (advancing pointer)
      while (rightIdx < right.length - 1 &&
             Math.abs(right[rightIdx + 1].timestamp - leftSample.timestamp) <
             Math.abs(right[rightIdx].timestamp - leftSample.timestamp)) {
        rightIdx++;
      }

      result.push({
        t: leftSample.timestamp,
        lq: leftSample.relativeQuaternion,
        rq: right[rightIdx].relativeQuaternion
      });
    }

    return result;
  }

  // C5: Interpolate to uniform grid (index-based loop, constant interval)
  private static interpolateToGrid(
    samples: QuaternionSample[],
    targetHz: number
  ): QuaternionSample[] {
    if (samples.length === 0) return [];

    const intervalMs = 1000 / targetHz;
    const startTime = samples[0].t;
    const endTime = samples[samples.length - 1].t;

    // Index-based loop (no floating-point accumulation - previous requirement)
    const sampleCount = Math.ceil((endTime - startTime) / intervalMs) + 1;
    const result: QuaternionSample[] = [];

    let sampleIdx = 0;

    for (let i = 0; i < sampleCount; i++) {
      const t = startTime + i * intervalMs;
      if (t > endTime) break;  // Use > not >= (previous requirement)

      // Find bracketing samples
      while (sampleIdx < samples.length - 1 && samples[sampleIdx + 1].t <= t) {
        sampleIdx++;
      }

      const curr = samples[sampleIdx];
      const next = samples[sampleIdx + 1] || curr;

      if (curr === next || curr.t === next.t) {
        result.push({ t, lq: curr.lq, rq: curr.rq });
      } else {
        // SLERP between curr and next
        const alpha = (t - curr.t) / (next.t - curr.t);
        result.push({
          t,
          lq: curr.lq && next.lq
            ? QuaternionService.slerp(curr.lq, next.lq, alpha)
            : curr.lq || next.lq,
          rq: curr.rq && next.rq
            ? QuaternionService.slerp(curr.rq, next.rq, alpha)
            : curr.rq || next.rq
        });
      }
    }

    return result;
  }
}
```

### [D] Export Path Updates

```typescript
// D1: CSVExporter - use AlignmentService instead of InterpolationService.slerpToUniformRate()
static export(options: ExportOptions = {}): ExportResult {
  const { targetHz, includeMetadata = true, outputPath } = options;

  const rawSamples = RecordingBuffer.getRawSamples();
  const metadata = RecordingBuffer.getMetadata();
  const hz = targetHz || metadata?.targetHz || 100;

  // Use AlignmentService for alignment + interpolation
  const alignedSamples = AlignmentService.process(rawSamples, hz);

  // Convert to angle samples for CSV (reuse existing logic)
  const angleSamples = InterpolationService.toAngleSamples(alignedSamples);

  // Continue with existing CSV generation...
  const csvContent = CSVExporter.generateCSVContent(angleSamples, metadata, true, hz, includeMetadata);
  // ... write file
}

// D2: UploadService - REMOVE GapFiller, use AlignmentService directly
async upload(rawSamples: RawDeviceSample[], options, onProgress): Promise<UploadResult> {
  const targetHz = options.targetHz ?? 100;

  // Use AlignmentService instead of GapFiller.resample()
  // (No more: const resampleResult = resample(rawSamples, { targetHz });)
  const alignedSamples = AlignmentService.process(rawSamples, targetHz);

  // Continue with existing chunkAndCompress...
  const compressed = chunkAndCompress(alignedSamples, sessionId);
  // ... upload chunks
}
```

### [E] Recording Entry Point

```typescript
// E1: DeviceProcessor calls RecordingBuffer directly
processData(deviceId: DeviceID | string, imuData: IMUData): void {
  // ... existing normalization code ...

  const deviceSample: DeviceData = {
    deviceId: deviceIdStr,
    quaternion: QuaternionService.normalize(imuData.quaternion ?? QuaternionService.createIdentity()),
    timestamp: imuData.timestamp,
    // ...
  };

  // Route to BatchSynchronizer for live UI (unchanged)
  if (this.useBatchSync && resolvedDeviceId) {
    BatchSynchronizer.getInstance().pushSample(
      resolvedDeviceId,
      deviceSample.timestamp,
      deviceSample.quaternion
    );
  }

  // NEW: Also store raw sample in RecordingBuffer
  if (resolvedDeviceId) {
    RecordingBuffer.pushRawSample(
      resolvedDeviceId,  // deviceId as number (0x11, 0x12, 0x21, 0x22)
      deviceSample.timestamp,
      deviceSample.quaternion
    );
  }
}
```

## Implementation Order

1. **[A]** Add types to `motionProcessing/recording/types.ts`
2. **[C]** Create `AlignmentService.ts` (new file, standalone)
3. **[F1]** Unit tests for AlignmentService
4. **[B]** Replace RecordingBuffer entirely
5. **[E]** Update DeviceProcessor entry point
6. **[D]** Update export paths (CSVExporter, UploadService)
7. **[F2]** Integration test

## Edge Cases

| Case | Handling |
|------|----------|
| Single joint (only left OR right) | alignJoints() returns samples with null for missing joint |
| Missing sensor (only thigh OR shin) | alignJoint() returns [] - can't compute relative quat |
| Out-of-order BLE packets | groupByDevice() + getRawSamples() both sort by timestamp |
| Gaps in data | SLERP interpolates across gaps |
| Different sensor rates | Closest-timestamp alignment normalizes |

## Success Criteria

1. Raw samples stored per-device with original timestamps
2. Export produces identical output format (QuaternionSample[] → CSV/Upload)
3. UI live view still works (BatchSynchronizer unchanged)
4. No GapFiller dependency - single AlignmentService for both paths
5. Better alignment quality (can look at entire recording)
