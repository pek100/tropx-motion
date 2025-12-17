---
id: opi
tags: [metrics, convex, signal-processing, biomechanics, scoring]
related_files: [
  convex/schema.ts,
  convex/recordingMetrics.ts,
  convex/lib/metrics/opi.ts,
  convex/lib/metrics/types.ts
]
checklist: /checklists/opi.md
status: complete
last_sync: 2025-01-17
---

# Overall Performance Index (OPI) v1.2.2

## Overview

Composite scoring system that aggregates 14 biomechanical metrics into a single 0-100 score with grade (A-F), uncertainty quantification, and actionable insights.

**Spec Reference:** `/docs/recording-metrics-calculations/opi-v1.2.2-audited.md`

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPI COMPUTATION                              │
├─────────────────────────────────────────────────────────────────┤
│  Input: FullAnalysisResult (42 biomechanical metrics)           │
│           ↓                                                     │
│  1. Extract relevant metrics → Map<string, number>              │
│           ↓                                                     │
│  2. For each domain (symmetry, power, control, stability):      │
│     a. Normalize metrics (0-100)                                │
│     b. Apply ICC-weighted scoring                               │
│     c. Calculate domain score & SEM                             │
│           ↓                                                     │
│  3. Combine domain scores with activity profile weights         │
│           ↓                                                     │
│  4. Calculate uncertainty (SEM, MDC95, CI)                      │
│           ↓                                                     │
│  5. Generate insights (strengths, weaknesses, clinical flags)   │
│           ↓                                                     │
│  Output: OPIResult stored in recordingMetrics.opiResult         │
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
convex/lib/metrics/
├── opi.ts             # OPI calculation logic
│   ├── METRIC_CONFIGS    # 14 metric configurations
│   ├── DOMAIN_WEIGHTS    # Weights by activity profile
│   ├── extractMetricsForOPI()
│   ├── normalizeMetric()
│   ├── calculateDomainScore()
│   └── calculateOPI()     # Main entry point
└── types.ts           # OPI type definitions

convex/
├── schema.ts          # OPI validators, activityProfile field
└── recordingMetrics.ts # Stores OPI result
```

## Domains & Metrics

| Domain | Metrics | Weight (general) |
|--------|---------|------------------|
| Symmetry | rom_asymmetry, velocity_asymmetry, cross_correlation, real_asymmetry_avg | 25% |
| Power | RSI, jump_height_cm, peak_angular_velocity, explosiveness_concentric | 25% |
| Control | SPARC, LDLJ, n_velocity_peaks, rms_jerk | 25% |
| Stability | rom_cov, ground_contact_time | 25% |

## Activity Profiles

Weights adjust based on user-selected profile:

| Profile | Symmetry | Power | Control | Stability |
|---------|----------|-------|---------|-----------|
| power | 15% | 40% | 25% | 20% |
| endurance | 30% | 10% | 25% | 35% |
| rehabilitation | 35% | 10% | 30% | 25% |
| general | 25% | 25% | 25% | 25% |

## Output Structure

```typescript
interface OPIResult {
  overallScore: number;        // 0-100
  grade: "A" | "B" | "C" | "D" | "F";
  confidenceInterval: { lower: number; upper: number };
  sem: number;                 // Standard error of measurement
  mdc95: number;               // Minimal detectable change
  domainScores: DomainScore[]; // Per-domain breakdown
  strengths: string[];         // Metrics >= 80
  weaknesses: string[];        // Metrics < 50
  clinicalFlags: string[];     // Threshold violations
  movementType: "bilateral" | "unilateral";
  activityProfile: ActivityProfile;
  dataCompleteness: number;    // % of metrics available
  methodologyCitations: string[];
}
```

## Clinical Flags

Automatically generated when:
- Asymmetry > 15% (Sadeghi 2000)
- SPARC < -3.0 (Beck 2018)
- RSI < 1.0 (Flanagan 2008)

## Grading Scale

| Grade | Score Range |
|-------|-------------|
| A | >= 90 |
| B | 80-89 |
| C | 70-79 |
| D | 60-69 |
| F | < 60 |

## Integration

OPI is computed automatically after all biomechanical metrics in `compute.ts`:

```typescript
const result = computeAllMetrics(chunks, sessionId, activityProfile);
// result.metrics.opiResult contains the OPI
```

Activity profile is set by user in save modal, stored in `recordings.activityProfile`.

## Reliability Sources

All thresholds and ICC values are literature-cited. See `opi-v1.2.2-audited.md` for full reference list.
