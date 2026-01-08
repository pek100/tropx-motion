---
id: time-sync-refactor
tags: [synchronization, interpolation, recording, refactor, critical]
related_files:
  - motionProcessing/synchronization/JointAligner.ts
  - motionProcessing/recording/GapValidator.ts
  - motionProcessing/recording/InterpolationService.ts
checklist: /checklists/time-sync-refactor.md
doc: /docs/time-sync-refactor/README.md
status: in-progress
last_sync: 2025-01-08
---

# Time Sync & Interpolation Refactor

## Overview

Fix floating-point bugs in grid generation and improve sample cleanup timing.

## Scope

**Current (3 fixes):**
- A1: GapValidator.generateTimeGrid() - index-based loop
- A2: InterpolationService.slerpToUniformRate() - index-based loop
- B1: JointAligner cleanup - use curr instead of prev

**Future (noted, not implemented):**
- Simplify BatchSynchronizer grid advancement
- Consider GapFiller redundancy
- Deprecate RecordingBuffer.pushJointSample()

## Problem

### Floating-Point Accumulation
```typescript
// BUG: Error accumulates each iteration
for (let t = startTime; t <= endTime; t += interval)

// FIX: Fresh calculation each iteration
for (let i = 0; i < count; i++) {
  const t = startTime + i * interval;
}
```

### Delayed Buffer Cleanup
```typescript
// BUG: Cleans to prev (delayed by one cycle)
if (thighConsumed && this.prevThigh) {
  this.discardSamplesBeforeTimestamp(buffer, this.prevThigh.timestamp);
}

// FIX: Cleans to curr (immediate)
if (thighConsumed && this.currThigh) {
  this.discardSamplesBeforeTimestamp(buffer, this.currThigh.timestamp);
}
```

## Files Changed

| File | Change |
|------|--------|
| `GapValidator.ts:153` | Index-based loop |
| `InterpolationService.ts:41` | Index-based loop |
| `JointAligner.ts:134-140` | curr instead of prev |

## Verification

```bash
npx tsx shared/compression/compression.test.ts
```

## Architecture Reference

See `decomposition.md` for data flow diagrams.
