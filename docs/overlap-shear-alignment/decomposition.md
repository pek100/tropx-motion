---
id: overlap-shear-alignment
tags: [motion-processing, synchronization, shear-alignment, live-recording]
related_files: [motionProcessing/synchronization/JointAligner.ts, motionProcessing/synchronization/SensorBuffer.ts, motionProcessing/synchronization/BatchSynchronizer.ts]
checklist: /checklists/overlap-shear-alignment.md
doc: /docs/overlap-shear-alignment/README.md
status: in-progress
last_sync: 2025-01-11
---

# Decomposition: 50% Overlap Shear Alignment

```
Feature: 50% Overlap Shear Alignment

50% Overlap Shear Alignment
├── JointAligner Modifications
│   ├── Add pendingMatches queue ✓ atomic
│   ├── Modify consumeOneMatch to populate queue ✓ atomic
│   ├── Calculate emit boundary (n/2) ✓ atomic
│   ├── Emit from queue when past boundary ✓ atomic
│   ├── Return null when nothing emittable ✓ atomic
│   └── Clear pendingMatches on reset ✓ atomic
├── State Management
│   ├── Track last emitted sample for reuse ✓ atomic
│   └── Handle empty queue gracefully ✓ atomic
└── Integration
    ├── Verify BatchSynchronizer tick behavior ✓ atomic
    └── Validate with live data stream ✓ atomic

Atomic Units:
1. Add pendingMatches queue - (JointAligner) - stores matched pairs awaiting emission
2. Modify consumeOneMatch to populate queue - (JointAligner) - match all available, push to queue
3. Calculate emit boundary (n/2) - (JointAligner) - floor(pendingMatches.length / 2)
4. Emit from queue when past boundary - (JointAligner) - shift from front if index < boundary
5. Return null when nothing emittable - (JointAligner) - boundary is 0 or queue empty
6. Clear pendingMatches on reset - (JointAligner) - clean slate for next recording
7. Track last emitted sample for reuse - (State) - BatchSynchronizer may need last known state
8. Handle empty queue gracefully - (State) - no crash, no stale data
9. Verify BatchSynchronizer tick behavior - (Integration) - ensure tick loop handles null returns
10. Validate with live data stream - (Integration) - end-to-end test with BLE devices
```
