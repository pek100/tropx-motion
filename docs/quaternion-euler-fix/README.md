---
id: quaternion-euler-fix
tags: [math, quaternion, euler, bugfix, motion-processing]
related_files:
  - shared/QuaternionCodec.ts
  - convex/lib/metrics/quaternionUtils.ts
  - motionProcessing/shared/QuaternionService.ts
  - scripts/validate-quaternion-euler.ts
checklist: /checklists/quaternion-euler-fix.md
status: complete
last_sync: 2025-01-21
---

# Quaternion to Euler Angle Conversion Fix

## Overview

Fixed cross-axis contamination in quaternion-to-Euler angle extraction where large Y-axis rotations (>90°) caused spurious ±180° readings on X and Z axes.

## Problem

The original Euler extraction used denominators that contained the y² term:

| Axis | Original Formula | Issue |
|------|------------------|-------|
| X (roll) | `atan2(yz+wx, 1-(xx+yy))` | Denominator contains `yy` |
| Y (pitch) | `atan2(xz+wy, 1-(yy+zz))` | Correct |
| Z (yaw) | `atan2(xy+wz, 1-(yy+zz))` | Denominator contains `yy` |

When Y rotation exceeded 90°, `yy > 1` caused the denominator `1-(xx+yy)` or `1-(yy+zz)` to go negative, flipping the atan2 result to ±180°.

**Example:** Pure Y rotation of 120° produced:
- Y = 120° ✓
- X = 180° ✗ (should be 0°)
- Z = 180° ✗ (should be 0°)

## Solution

Changed X and Z to use denominators that exclude y²:

| Axis | Fixed Formula | Denominator |
|------|---------------|-------------|
| X (roll) | `atan2(yz+wx, 1-(xx+zz))` | R11, excludes y² |
| Y (pitch) | `atan2(xz+wy, 1-(yy+zz))` | R00, unchanged |
| Z (yaw) | `atan2(xy+wz, 1-(xx+zz))` | R11, excludes y² |

**Result:** Pure Y rotation of 120° now produces:
- Y = 120° ✓
- X = 0° ✓
- Z = 0° ✓

## Trade-offs

The fix prioritizes Y-axis accuracy (primary measurement for knee flexion) at the cost of X-Z coupling at extreme angles:

| Scenario | Behavior |
|----------|----------|
| Pure Y rotation >90° | X and Z show 0° ✓ |
| Pure X rotation >90° | Z shows ±180° |
| Pure Z rotation >90° | X shows ±180° |

This is acceptable for knee biomechanics where:
- Y (flexion): 0° to ~150° — needs full range
- X (internal/external rotation): typically ±30°
- Z (varus/valgus): typically ±20°

## Files Modified

### 1. shared/QuaternionCodec.ts (Single Source of Truth)
**Lines 178-200** - `quaternionToAngle()` function
- Direct implementation of the fixed formulas
- Used by frontend (Electron renderer)

### 2. convex/lib/metrics/quaternionUtils.ts
**Lines 27-31** - `AXIS_EXTRACTION_MAP`
- Changed indices: X from `[7,8]` to `[7,4]`, Z from `[3,0]` to `[3,4]`
- Required separate copy due to Convex isolated runtime
- Used for server-side metrics computation and SVG preview generation

### 3. motionProcessing/shared/QuaternionService.ts
**Lines 198-204** - `toEulerAngle()` method
- Now delegates to `quaternionToAngle()` from QuaternionCodec
- Eliminates code duplication
- Used by motion processing pipeline (BLE bridge, recording)

## Validation

Test script: `scripts/validate-quaternion-euler.ts`

Run with:
```bash
npx tsx scripts/validate-quaternion-euler.ts
```

Tests pure rotations on all three axes from 0° to 180°.

Results:
- Y-axis: 12/12 tests pass (full range)
- X-axis: 7/12 tests pass (up to ±90°)
- Z-axis: 7/12 tests pass (up to ±90°)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Electron)                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           shared/QuaternionCodec.ts                 │    │
│  │           quaternionToAngle() ← SOURCE OF TRUTH     │    │
│  └─────────────────────────────────────────────────────┘    │
│                           ▲                                  │
│                           │ imports                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │    motionProcessing/shared/QuaternionService.ts     │    │
│  │    toEulerAngle() → delegates to QuaternionCodec    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 Backend (Convex - Isolated)                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │       convex/lib/metrics/quaternionUtils.ts         │    │
│  │       toEulerAngle() ← SEPARATE COPY (required)     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Mathematical Reference

Rotation matrix from quaternion q = (w, x, y, z):
```
R = | 1-2(y²+z²)   2(xy-wz)    2(xz+wy)  |
    | 2(xy+wz)     1-2(x²+z²)  2(yz-wx)  |
    | 2(xz-wy)     2(yz+wx)    1-2(x²+y²)|
```

Matrix indices (row-major):
```
m0 = R00 = 1-2(y²+z²)    m1 = R01    m2 = R02 = 2(xz+wy)
m3 = R10 = 2(xy+wz)      m4 = R11 = 1-2(x²+z²)    m5 = R12
m6 = R20                 m7 = R21 = 2(yz+wx)      m8 = R22
```

Decoupled extraction:
- X: `atan2(R21, R11)` = `atan2(m7, m4)`
- Y: `atan2(R02, R00)` = `atan2(m2, m0)`
- Z: `atan2(R10, R11)` = `atan2(m3, m4)`
