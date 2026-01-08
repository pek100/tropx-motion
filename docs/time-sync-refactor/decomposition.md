---
id: time-sync-refactor
tags: [synchronization, interpolation, recording, refactor, critical]
related_files:
  - motionProcessing/synchronization/BatchSynchronizer.ts
  - motionProcessing/synchronization/JointAligner.ts
  - motionProcessing/synchronization/SensorBuffer.ts
  - motionProcessing/recording/RecordingBuffer.ts
  - motionProcessing/recording/GapValidator.ts
  - motionProcessing/recording/GapFiller.ts
  - motionProcessing/recording/InterpolationService.ts
checklist: /checklists/time-sync-refactor.md
doc: /docs/time-sync-refactor/README.md
status: in-progress
last_sync: 2025-01-08
---

# Time Sync & Interpolation Refactor - Decomposition

## Current Architecture

```
BLE → DeviceProcessor → SensorBuffer → JointAligner → BatchSynchronizer
                                                            ↓
                                              (grid interpolation - real-time)
                                                            ↓
                                              MotionProcessingCoordinator
                                                            ↓
                                                     RecordingBuffer
                                                            ↓
                              ┌──────────────────────────────┴──────────────────────────────┐
                              ↓                                                              ↓
                    CSV Export Path                                               Cloud Upload Path
                              ↓                                                              ↓
              InterpolationService.slerpToUniformRate()                      GapFiller.resample()
                    (has floating-point bug)                                 (uses generateTimeGrid - same bug)
                              ↓                                                              ↓
                        CSVExporter                                               UploadService
```

## Issues (Current Scope)

1. **Floating-point accumulation** in both export paths
2. **Sample cleanup delayed** by one cycle (uses prev instead of curr)

## Future Considerations (NOT current scope)

- BatchSynchronizer already produces grid-aligned samples
- Export-time interpolation may be partially redundant
- But UploadService needs GapFiller for gap statistics

---

## $FUNNEL Decomposition Tree

```
Time Sync Refactor
│
├── [A] Fix Floating-Point Accumulation ← CURRENT SCOPE
│   ├── [A1] GapValidator.generateTimeGrid() ✓ atomic
│   └── [A2] InterpolationService.slerpToUniformRate() ✓ atomic
│
├── [B] Fix Sample Cleanup ← CURRENT SCOPE
│   └── [B1] JointAligner: use currThigh/currShin instead of prev ✓ atomic
│
├── [C] Remove Redundant Grid Interpolation ← FUTURE (needs analysis)
│   ├── [C1] Verify BatchSynchronizer output is sufficient
│   ├── [C2] Simplify RecordingBuffer (deprecate pushJointSample)
│   └── [C3] Simplify Export Pipeline
│
├── [D] Ensure Constant Grid Interval ← FUTURE
│   └── [D1] BatchSynchronizer: simpler grid advancement
│
└── [E] Verification ← CURRENT SCOPE
    └── [E1] Run tests and verify output unchanged ✓ atomic
```

---

## Current Scope - Atomic Units

| ID | Task | File | Line |
|----|------|------|------|
| A1 | Fix generateTimeGrid() loop | `motionProcessing/recording/GapValidator.ts` | 153 |
| A2 | Fix slerpToUniformRate() loop | `motionProcessing/recording/InterpolationService.ts` | 41 |
| B1 | Use currThigh/currShin for cleanup | `motionProcessing/synchronization/JointAligner.ts` | 134-140 |
| E1 | Run tests, verify output | - | - |

---

## Success Criteria

1. **Floating-point fix:** Grid timestamps are `startTime + i * interval` (no accumulation)
2. **Buffer cleanup:** Immediate (uses curr, not prev)
3. **Output unchanged:** CSV/upload format identical
4. **Tests pass:** Compression tests still work
