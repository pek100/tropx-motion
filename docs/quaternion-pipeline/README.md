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
status: complete
last_sync: 2025-01-04
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

Rotation matrix extraction (same in backend QuaternionService and frontend QuaternionCodec):

```typescript
// Matrix from quaternion
matrix[0] = 1 - 2(y² + z²)   matrix[2] = 2(xz + wy)
matrix[4] = 1 - 2(x² + z²)   matrix[5] = 2(yz - wx)
matrix[1] = 2(xy - wz)       matrix[3] = 2(xy + wz)

// Axis extraction
X: atan2(matrix[5], matrix[4])
Y: atan2(matrix[2], matrix[0])  // knee flexion
Z: atan2(matrix[1], matrix[3])
```

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
