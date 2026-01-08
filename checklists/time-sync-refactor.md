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

# Time Sync & Interpolation Refactor - Checklist

## Phase 1: Bug Fixes (Low Risk)

### [A] Fix Floating-Point Accumulation

- [x] **[A1]** GapValidator.generateTimeGrid() - line 153
  - Change: `for (let t = startTime; t <= endTime; t += interval)`
  - To: index-based loop with `startTime + i * interval`
  - Use `> endTime` not `>= endTime` for boundary
  - File: `motionProcessing/recording/GapValidator.ts`
  - Affects: Cloud upload via UploadService → GapFiller.resample()

- [x] **[A2]** InterpolationService.slerpToUniformRate() - line 41
  - Change: `for (let t = startTime; t <= endTime; t += intervalMs)`
  - To: index-based loop with `startTime + i * intervalMs`
  - Use `> endTime` not `>= endTime` for boundary
  - File: `motionProcessing/recording/InterpolationService.ts`
  - Affects: CSV export

### [B] Fix Sample Cleanup

- [x] **[B1]** JointAligner cleanup - lines 134-140
  - Current: uses `prevThigh/prevShin` (delayed by one cycle)
  - Change to: `currThigh/currShin` (immediate cleanup)
  - Each buffer cleans to its own last-used timestamp
  - File: `motionProcessing/synchronization/JointAligner.ts`

## Phase 2: Verification

- [x] **[V1]** Run compression tests
  - Command: `npx tsx shared/compression/compression.test.ts`
  - All 6 tests passed

- [ ] **[V2]** Verify CSV output unchanged
  - Record short session (10s)
  - Export CSV before and after changes
  - Compare output format (headers, columns)
  - Timestamps should be more consistent

- [ ] **[V3]** Verify buffer behavior
  - Monitor buffer sizes during long recording
  - Should not grow unbounded
  - Add debug logging if needed

## Future Improvements (Not in this refactor)

These are noted for future consideration but NOT part of current scope:

- [ ] Simplify BatchSynchronizer grid advancement (constant interval)
- [ ] Consider removing GapFiller redundancy (BatchSynchronizer already interpolates)
- [ ] Remove deprecated pushJointSample() from RecordingBuffer
- [ ] Unify InterpolationService and GapFiller (similar logic, different paths)

---

## Progress Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2025-01-08 | Plan created | Done | |
| 2025-01-08 | A1 - GapValidator fix | Done | Index-based loop |
| 2025-01-08 | A2 - InterpolationService fix | Done | Index-based loop |
| 2025-01-08 | B1 - JointAligner cleanup | Done | curr instead of prev |
| 2025-01-08 | V1 - Compression tests | Done | 6/6 passed |
| | V2 - CSV verification | Pending | Manual test needed |
| | V3 - Buffer behavior | Pending | Manual test needed |
