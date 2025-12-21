# Phase Alignment Algorithm

## Overview

Phase alignment synchronizes left and right knee angle signals before computing asymmetry metrics. Proper alignment is critical - misalignment causes false asymmetry readings.

## Algorithm: Velocity Overlap with Repeating Pattern Filter

### Step 1: Compute Velocities
```
velLeft = derivative(leftAngles)
velRight = derivative(rightAngles)
```

### Step 2: Filter for Repeating Patterns

**Problem**: Raw velocity signals contain transitions, pauses, and noise that pollute alignment.

**Solution**: Use acceleration histogram to identify repeating movement dynamics.

```typescript
// Compute acceleration (2nd derivative)
acceleration[i] = velocity[i+1] - velocity[i-1]  // central difference

// Bin accelerations into histogram
binned[i] = round(acceleration[i] / 50) * 50  // 50 deg/s² bins

// Find frequently-occurring bins (75th percentile)
threshold = frequencies[floor(len * 0.75)]

// Mask: true if this acceleration pattern repeats often
mask[i] = histogram[binned[i]] >= threshold
```

**Why acceleration over velocity?**

| Aspect | Velocity | Acceleration |
|--------|----------|--------------|
| Fatigue resistance | Low - speeds drop | High - dynamics same |
| ROM invariance | Low | High |
| Captures pattern | Speed values | Movement shape |

### Step 3: Find Optimal Lag

```typescript
for lag in [-maxSearch, maxSearch]:
  areaDiff = 0
  count = 0

  for i in range(velLen):
    j = i + lag
    // Only use points where BOTH signals have repeating pattern
    if maskLeft[i] && maskRight[j]:
      areaDiff += abs(velLeft[i] - velRight[j])
      count++

  if areaDiff/count < bestAreaDiff:
    bestLag = lag
```

### Step 4: Apply Alignment

Shift right signal by `bestLag` samples.

## Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `binSize` | 50 deg/s² | Acceleration magnitude scale |
| `percentile` | 75th | Stricter filtering, keeps top 25% frequent patterns |
| `maxSearchSamples` | 50 | ~500ms at 100Hz, covers typical phase offsets |

## Files

- `helpers.ts`: `findRepeatingVelocityMask()` - histogram-based pattern detection
- `classification.ts`: `calculateOptimalPhaseAlignment()` - main alignment algorithm

## History

- **v1.0**: Simple velocity overlap (all points weighted equally)
- **v1.1**: Added velocity histogram filtering (median threshold)
- **v1.2**: Changed to 75th percentile threshold
- **v1.3**: Switched from velocity to acceleration histogram - captures movement dynamics, more robust to fatigue/ROM variation
