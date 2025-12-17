---
id: biomechanical-metrics
tags: [metrics, convex, signal-processing, biomechanics]
related_files: [
  convex/schema.ts,
  convex/recordings.ts,
  convex/recordingMetrics.ts,
  convex/lib/metrics/*
]
checklist: /checklists/biomechanical-metrics.md
status: complete
last_sync: 2025-01-17
---

# Biomechanical Metrics

## Overview

Implementation of 42 biomechanical metrics for IMU-based knee movement analysis, computed automatically when a recording session completes.

**Spec Reference:** `/docs/recording-metrics-calculations/biomechanical-metrics-spec-v1.2.md`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    METRICS COMPUTATION                          │
├─────────────────────────────────────────────────────────────────┤
│  Trigger: Last chunk saved in createChunk()                     │
│           ↓                                                     │
│  1. Schedule internal action (async)                            │
│           ↓                                                     │
│  2. Fetch all chunks for sessionId                              │
│           ↓                                                     │
│  3. Convert quaternions → knee angles                           │
│           ↓                                                     │
│  4. Run analysis pipeline:                                      │
│     a. Movement Classification (bilateral/unilateral)           │
│     b. Phase Correction (if needed)                             │
│     c. Advanced Asymmetry Analysis                              │
│     d. All Standard Metrics (#1-37)                             │
│           ↓                                                     │
│  5. Store results in recordingMetrics table                     │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
convex/lib/metrics/
├── types.ts           # All TypeScript interfaces
├── helpers.ts         # Signal processing utilities
├── quaternionUtils.ts # Quaternion → angle conversion
├── computedParams.ts  # Per-leg metrics (#1-11)
├── bilateral.ts       # Bilateral/unilateral analysis (#12-19)
├── classification.ts  # Movement type & advanced asymmetry (#38-41)
├── smoothness.ts      # Smoothness & temporal (#29-34)
├── groundContact.ts   # Ground contact, force, gait (#20-28, 35-37)
└── compute.ts         # Main orchestrator

convex/
├── recordingMetrics.ts  # Convex mutations/queries/actions
└── schema.ts            # recordingMetrics table definition
```

## Metric Categories

| Category | Count | File |
|----------|-------|------|
| Computed Parameters (per-leg) | 11 | computedParams.ts |
| Bilateral Analysis | 5 | bilateral.ts |
| Unilateral Analysis | 3 | bilateral.ts |
| Ground Contact & Flight | 4 | groundContact.ts |
| Force/Power | 3 | groundContact.ts |
| Stiffness | 2 | groundContact.ts |
| Smoothness | 3 | smoothness.ts |
| Temporal Coordination | 3 | smoothness.ts |
| Gait Cycle | 3 | groundContact.ts |
| Movement Classification | 2 | classification.ts |
| Advanced Asymmetry | 3 | classification.ts |
| **Total** | **42** | |

## Data Flow

1. **Input:** Quaternion arrays from recording chunks (`leftKneeQ`, `rightKneeQ`)
2. **Conversion:** Relative quaternion → knee angle (degrees) via `toEulerAngle(q, 'y')`
3. **Processing:** Signal processing (filtering, derivatives, peak detection)
4. **Output:** `FullAnalysisResult` stored in `recordingMetrics` table

## Important Notes

### Angular Acceleration Metrics
Metrics in categories Ground Contact, Force/Power, Stiffness, and Gait (#20-28, #35-37) derive acceleration from angle data (second derivative), NOT from raw gyroscope/accelerometer data. These are marked:
```typescript
// TODO: review needed - uses angular acceleration, not raw gyro
```

### Re-computation
Metrics can be re-computed via `recomputeMetrics(sessionId)` mutation, useful when algorithms improve.

## Status Tracking

```typescript
METRIC_STATUS = {
  PENDING: "pending",     // Created, waiting to compute
  COMPUTING: "computing", // In progress
  COMPLETE: "complete",   // Successfully computed
  FAILED: "failed",       // Error occurred (see error field)
}
```
