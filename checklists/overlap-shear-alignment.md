---
id: overlap-shear-alignment
tags: [motion-processing, synchronization, shear-alignment, live-recording]
related_files: [motionProcessing/synchronization/JointAligner.ts, motionProcessing/synchronization/SensorBuffer.ts, motionProcessing/synchronization/BatchSynchronizer.ts]
checklist: /checklists/overlap-shear-alignment.md
doc: /docs/overlap-shear-alignment/README.md
status: in-progress
last_sync: 2025-01-11
---

# Checklist: 50% Overlap Shear Alignment

## JointAligner Modifications

- [x] 1. Add `pendingMatches: JointSamples[]` queue property
- [x] 2. Add `lastEmitted: JointSamples | null` for reuse when queue empty
- [x] 3. Create `matchAllAvailable()` private method - consumes all pairs from buffers into pending
- [x] 4. Create `getEmitBoundary()` private method - returns `floor(pending.length / 2)`
- [x] 5. Modify `consumeOneMatch()`:
  - [x] 5a. Call matchAllAvailable() to populate pending queue
  - [x] 5b. Calculate emit boundary
  - [x] 5c. If boundary > 0, shift from pending, update lastEmitted, return it
  - [x] 5d. If boundary = 0, return lastEmitted (or null if none)
- [x] 6. Modify `reset()` to clear pendingMatches and lastEmitted

## Integration Verification

- [x] 7. Review BatchSynchronizer.tick() - return value not used, compatible
- [x] 8. Check that prev/curr tracking still works - updated in matchAllAvailable()
- [x] 9. Verify getInterpolatedAt() still receives valid state - uses prev/curr from matching

## Testing

- [ ] 10. Manual test with live BLE data stream
- [ ] 11. Verify no regression in alignment quality
- [ ] 12. Confirm clean stop behavior (no stale emissions)
