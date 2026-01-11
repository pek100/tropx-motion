---
id: overlap-shear-alignment
tags: [motion-processing, synchronization, shear-alignment, live-recording]
related_files: [motionProcessing/synchronization/JointAligner.ts, motionProcessing/synchronization/SensorBuffer.ts, motionProcessing/synchronization/BatchSynchronizer.ts]
checklist: /checklists/overlap-shear-alignment.md
doc: /docs/overlap-shear-alignment/README.md
status: in-progress
last_sync: 2025-01-11
---

# 50% Overlap Shear Alignment

## Overview

Improve shear alignment accuracy by only emitting samples that have full temporal context. Samples are held in a pending queue and only released once they're in the first 50% of the queue, ensuring they had both past and future neighbors during the matching process.

## Problem

Current `JointAligner.consumeOneMatch()` immediately matches and emits the oldest sample in the buffer. Edge samples lack future context, leading to suboptimal `findClosestIndex()` decisions.

## Solution

Add internal pending queue to `JointAligner`:
1. Match all available pairs from sensor buffers → push to pending queue
2. Calculate emit boundary: `floor(pending.length / 2)`
3. Only emit samples from first half (indices 0 to boundary-1)
4. Retain second half for next cycle
5. On reset/stop: clear queue, discard retained samples

## Key Files

| File | Change |
|------|--------|
| `motionProcessing/synchronization/JointAligner.ts` | Add pending queue, modify consumeOneMatch logic |
| `motionProcessing/synchronization/BatchSynchronizer.ts` | Verify compatibility (no changes expected) |

## Behavior

```
Tick 1: pending = [M1, M2, M3, M4, M5, M6]
        boundary = 3
        emit M1, pending = [M2, M3, M4, M5, M6]

Tick 2: (new match M7 arrives)
        pending = [M2, M3, M4, M5, M6, M7]
        boundary = 3
        emit M2, pending = [M3, M4, M5, M6, M7]

Tick N: pending = [Mx]
        boundary = 0
        nothing emittable, return null
        Mx waits for more matches
```

## Constraints

- Live recording path only
- No changes to BatchSynchronizer API
- On stop: clear all, no final flush
- Same logic for both left/right joints (encapsulated)
