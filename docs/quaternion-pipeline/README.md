---
id: quaternion-pipeline
tags: [motion, quaternion, websocket, data-pipeline]
related_files:
  - motionProcessing/uiProcessing/UIProcessor.ts
  - motionProcessing/jointProcessing/AngleCalculationService.ts
  - motionProcessing/MotionProcessingCoordinator.ts
  - motionProcessing/shared/QuaternionService.ts
  - electron/renderer/src/hooks/useDevices.ts
  - shared/QuaternionCodec.ts
  - electron/renderer/src/components/knee-area-chart.tsx
related_docs:
  - /docs/quaternion-euler-fix/README.md
status: complete
last_sync: 2025-01-21
---

# Quaternion Pipeline

Quaternion-only motion data pipeline. All angle extraction happens in frontend.

## Overview

The backend computes relative quaternions and streams them to the frontend. No angle calculation in backend - frontend decodes to any axis on demand.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BACKEND                                        │
│                                                                          │
│  Sensors → BatchSynchronizer → AngleCalculationService                   │
│                                      │                                   │
│                         computeRelativeQuat(thigh, shin)                 │
│                              relativeQuat = thigh⁻¹ × shin               │
│                                      │                                   │
│                     MotionProcessingCoordinator                          │
│                                      │                                   │
│                               UIProcessor                                │
│                                      │                                   │
│                         Float32Array[8] quaternions                      │
└──────────────────────────────────────┼──────────────────────────────────┘
                                       │ WebSocket
                                       ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                       │
│                                                                          │
│                              useDevices                                  │
│                    ┌─────────────┴─────────────┐                        │
│                    │                           │                         │
│           KneeData.quaternion        quaternionToAngle(q, 'y')          │
│           (raw quaternion)           → KneeData.current                  │
│                    │                                                     │
│                    ▼                                                     │
│              KneeAreaChart                                               │
│         quaternionToAngle(q, selectedAxis)                              │
│                    │                                                     │
│              Live angle display                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## WebSocket Format

```typescript
Float32Array[8]: [lqW, lqX, lqY, lqZ, rqW, rqX, rqY, rqZ]
```

## Angle Formula

Rotation matrix extraction (QuaternionService delegates to QuaternionCodec):

```typescript
// Matrix from quaternion (row-major)
m0 = 1 - 2(y² + z²)   m1 = 2(xy - wz)      m2 = 2(xz + wy)
m3 = 2(xy + wz)       m4 = 1 - 2(x² + z²)  m5 = 2(yz - wx)
m6 = 2(xz - wy)       m7 = 2(yz + wx)      m8 = 1 - 2(x² + y²)

// Decoupled axis extraction (prevents Y contaminating X/Z)
X: atan2(m7, m4)  // atan2(R21, R11) - denominator excludes y²
Y: atan2(m2, m0)  // atan2(R02, R00) - knee flexion
Z: atan2(m3, m4)  // atan2(R10, R11) - denominator excludes y²
```

See [quaternion-euler-fix](/docs/quaternion-euler-fix/README.md) for details on the decoupled extraction.

## Key Files

| File | Role |
|------|------|
| `AngleCalculationService.ts` | Computes relative quaternion only |
| `MotionProcessingCoordinator.ts` | Routes quaternions to UI/recording |
| `UIProcessor.ts` | Packs quaternions for WebSocket |
| `useDevices.ts` | Parses quaternions, decodes Y-axis for current |
| `QuaternionCodec.ts` | `quaternionToAngle(q, axis)` for any axis |
| `knee-area-chart.tsx` | Real-time axis selection |

## Usage

```typescript
import { quaternionToAngle } from 'shared/QuaternionCodec';

// Decode any axis from quaternion
const angle = quaternionToAngle(kneeData.quaternion, 'x'); // roll
const angle = quaternionToAngle(kneeData.quaternion, 'y'); // pitch (default)
const angle = quaternionToAngle(kneeData.quaternion, 'z'); // yaw
```
