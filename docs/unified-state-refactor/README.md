---
id: unified-state-refactor
tags: [state-management, architecture, websocket, ble, refactor, critical]
related_files:
  - ble-management/types.ts
  - ble-management/UnifiedBLEStateStore.ts
  - ble-management/Watchdog.ts
  - electron/renderer/src/hooks/useDevices.ts
  - websocket-bridge/processors/BLEDomainProcessor.ts
checklist: /checklists/unified-state-refactor.md
doc: /docs/unified-state-refactor/README.md
status: in-progress
last_sync: 2025-12-03
---

# Unified State Refactor

## Overview

Refactor TropxMotion to use **backend-owned state** with the renderer as a **pure sync layer**.

## Problem

Current architecture has split-brain state management:
- Backend: `UnifiedBLEStateStore` (source of truth)
- Renderer: `useDevices` with duplicate `useState`, local timers, health monitoring

This causes:
- State drift between backend and renderer
- Cooldown conflicts (renderer blocks reconnection)
- Retry count resets (state change handlers interfere)
- Complex debugging (state in two places)

## Solution

```
┌─────────────────────────────────────────────────────┐
│  Backend (Main Process)                             │
│  ┌─────────────────────────────────────────────┐    │
│  │  UnifiedBLEStateStore                       │    │
│  │  - All device state (+ syncProgress)        │    │
│  │  - Global state                             │    │
│  │  - Reconnection tracking                    │    │
│  │  - isVibrating (locate mode)                │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │  Watchdog                                   │    │
│  │  - Health monitoring (moved from renderer)  │    │
│  │  - Streaming recovery                       │    │
│  └─────────────────────────────────────────────┘    │
│                      │                              │
│                      ▼ STATE_UPDATE                 │
└─────────────────────────────────────────────────────┘
                       │
                       │ WebSocket
                       ▼
┌─────────────────────────────────────────────────────┐
│  Renderer                                           │
│  ┌─────────────────────────────────────────────┐    │
│  │  useDevices (simplified)                    │    │
│  │  - NO useState for devices                  │    │
│  │  - NO local health timers                   │    │
│  │  - Direct state from STATE_UPDATE           │    │
│  │  - Commands via WebSocket                   │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │  Local State (kept)                         │    │
│  │  - Motion data (high-frequency stream)      │    │
│  │  - UI-only state (modals, selections)       │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

## State Ownership

| State | Owner | Reasoning |
|-------|-------|-----------|
| Device state | Backend | Source of truth |
| Global state | Backend | Source of truth |
| syncProgress | Backend | Part of device lifecycle |
| isVibrating | Backend | Part of device state |
| Reconnection | Backend | Backend manages BLE |
| Health monitoring | Backend | Eliminates sync issues |
| Motion data | Renderer | High-frequency, latency-sensitive |
| UI state | Renderer | Modal, selection, animation |

## Key Files

| File | Changes |
|------|---------|
| `ble-management/types.ts` | Add syncProgress, isVibrating fields |
| `ble-management/UnifiedBLEStateStore.ts` | Update serialization |
| `ble-bridge/BLEServiceAdapter.ts` | Set syncProgress during sync |
| `ble-bridge/DeviceLocateService.ts` | Set isVibrating on devices |
| `electron/renderer/src/hooks/useDevices.ts` | Major refactor |

## Implementation Phases

1. **Backend Extensions** - Add new fields to state
2. **Sync Progress Integration** - Move to device state
3. **Health Monitoring Migration** - Already in Watchdog, verify coverage
4. **Renderer Refactor** - Simplify useDevices
5. **Cleanup & Validation** - Build, test

## Success Criteria

- [ ] No useState for devices in renderer
- [ ] No health check timers in renderer
- [ ] STATE_UPDATE includes syncProgress, isVibrating
- [ ] All existing functionality works: scan, connect, sync, stream, locate, reconnect
- [ ] No console errors or type mismatches
