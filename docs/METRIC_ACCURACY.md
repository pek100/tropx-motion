# Metric Accuracy Assessment

This document provides a comprehensive assessment of all biomechanical metrics calculated by the TropX Motion system, categorizing them by reliability and usefulness.

## Overview

Our metrics fall into three categories:
1. **Accurate Metrics (19)** - Reliably calculated from angle data, useful for analysis and AI
2. **Meaningless for Multi-Rep (2)** - Technically correct but not meaningful for multi-rep sessions
3. **Require Accelerometer (7+)** - Cannot be calculated without accelerometer data (currently unavailable)

---

## ACCURATE METRICS (19 total)

These metrics are derived from angle data and are reliable for both single-rep and multi-rep sessions.

### Per-Leg Metrics (7) - Derived from angle data

| Metric | Unit | Direction | Description |
|--------|------|-----------|-------------|
| `overallMaxROM` | ° | higherBetter | Maximum range of motion achieved during session |
| `averageROM` | ° | higherBetter | Average range of motion across movement cycles |
| `peakFlexion` | ° | higherBetter | Maximum flexion angle achieved |
| `peakExtension` | ° | lowerBetter | Closest to full extension (0° = full extension) |
| `peakAngularVelocity` | °/s | higherBetter | Maximum movement speed |
| `explosivenessConcentric` | °/s² | higherBetter | Acceleration during concentric (upward) phase |
| `explosivenessLoading` | °/s² | higherBetter | Acceleration during eccentric (downward) phase |

### Bilateral Metrics (8) - Comparisons between legs

| Metric | Unit | Direction | Description |
|--------|------|-----------|-------------|
| `romAsymmetry` | % | lowerBetter | Difference in ROM between legs |
| `velocityAsymmetry` | % | lowerBetter | Difference in peak velocity between legs |
| `crossCorrelation` | (ratio) | higherBetter | Movement synchronization (1.0 = perfect sync) |
| `realAsymmetryAvg` | ° | lowerBetter | True asymmetry after phase correction |
| `netGlobalAsymmetry` | % | lowerBetter | Weighted composite asymmetry score |
| `phaseShift` | ° | lowerBetter | Phase offset between leg movements |
| `temporalLag` | ms | lowerBetter | Timing delay between leg movements |
| `maxFlexionTimingDiff` | ms | lowerBetter | Difference in timing of peak flexion |

### Smoothness Metrics (4) - Movement quality indicators

**Note:** Raw values are accurate and useful for trend tracking. However, the OPI thresholds for these metrics were calibrated for single-rep movements and may not apply directly to multi-rep sessions.

| Metric | Unit | Direction | Description |
|--------|------|-----------|-------------|
| `sparc` | (score) | higherBetter | Spectral Arc Length - smoothness measure (less negative = better) |
| `ldlj` | (score) | higherBetter | Log Dimensionless Jerk - smoothness measure (less negative = better) |
| `nVelocityPeaks` | count | lowerBetter | Number of velocity peaks (fewer = smoother) |
| `rmsJerk` | °/s³ | lowerBetter | Root mean square jerk (lower = smoother) |

### Derived Score (1)

| Metric | Unit | Direction | Description |
|--------|------|-----------|-------------|
| `opiScore` | /100 | higherBetter | Overall Performance Index - calculated from accurate metrics above |

---

## MEANINGLESS FOR MULTI-REP SESSIONS (2)

These metrics are technically calculated correctly, but their interpretation is meaningless for multi-rep sessions.

### Stability Metrics - REMOVE FROM DASHBOARD/AI

| Metric | Issue | Recommendation |
|--------|-------|----------------|
| `romCoV` | Measures variability ACROSS reps, not WITHIN movements. High variability across reps is expected in multi-rep sessions and doesn't indicate instability. | **Remove from dashboard and AI context** |
| `zeroVelocityPhaseMs` | Accumulates ALL pause times, grows linearly with more reps. A 10-rep session will show ~10x the pause time of a 1-rep session. | **Remove from dashboard and AI context** |

---

## REQUIRE ACCELEROMETER DATA (7+)

These metrics require accelerometer data which is not currently available from our IMU sensors (we only have gyroscope/quaternion data).

| Metric | Requires | Status |
|--------|----------|--------|
| `jumpHeight` | Linear acceleration | Not calculated |
| `flightTime` | Linear acceleration | Not calculated |
| `groundContactTime` | Linear acceleration | Not calculated |
| `rsi` (Reactive Strength Index) | Linear acceleration | Not calculated |
| `eRFD` (Explosive Rate of Force Development) | Linear acceleration | Not calculated |
| `shockAbsorption` | Linear acceleration | Not calculated |
| `gaitCycle` metrics | Linear acceleration + contact detection | Not calculated |
| `peakResultantAcceleration` | Linear acceleration | Not calculated |

---

## Vector Index Layout (32 dimensions)

For the Cross-Analysis Agent, we use a 32-dimensional vector with the following layout:

```
Dims 0-6:   Range metrics
  0: avgMaxROM (avg of both legs)
  1: avgPeakFlexion
  2: avgPeakExtension (inverted - closer to 0 is better)
  3: leftMaxROM (per-leg)
  4: rightMaxROM (per-leg)
  5-6: reserved

Dims 7-14:  Symmetry metrics (lower is better, inverted)
  7: romAsymmetry
  8: velocityAsymmetry
  9: crossCorrelation (NOT inverted - higher better)
  10: realAsymmetryAvg
  11: netGlobalAsymmetry
  12: phaseShift
  13: temporalLag
  14: maxFlexionTimingDiff

Dims 15-23: Power metrics
  15: peakAngularVelocity (avg)
  16: explosivenessConcentric (avg)
  17: explosivenessLoading (avg)
  18: leftPeakVelocity
  19: rightPeakVelocity
  20: leftExplosiveness
  21: rightExplosiveness
  22-23: reserved

Dims 24-31: Smoothness metrics (raw values, useful for trend tracking)
  24: sparc (less negative = better, normalized)
  25: ldlj (less negative = better, normalized)
  26: nVelocityPeaks (lower = better, inverted)
  27: rmsJerk (lower = better, inverted)
  28-31: reserved
```

---

## Implementation Notes

### Dashboard (`MetricsTable.tsx`)
- Display 19 accurate metrics + opiScore (20 rows total)
- Include smoothness metrics (sparc, ldlj, nVelocityPeaks, rmsJerk)
- **Remove:** romCoV, zeroVelocityPhaseMs

### AI Context (`v2/utils.ts`)
- Include smoothness metrics for trend tracking
- **Remove:** romCoV, zeroVelocityPhaseMs

### Metrics Registry (`horus/metrics.ts`)
- Add `meaningful: boolean` field to mark metrics
- `meaningful: false` for romCoV, zeroVelocityPhaseMs

### Dashboard Queries (`dashboard.ts`)
- Remove romCoV from flat metrics object
- Keep smoothness metrics (sparc, ldlj, nVelocityPeaks)

---

## References

- Flash & Hogan 1985 - Jerk minimization principle
- Sadeghi et al. Gait Posture 2000 - Asymmetry thresholds
- Balasubramanian et al. 2015 - SPARC smoothness metric
