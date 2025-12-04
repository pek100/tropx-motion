---
id: state-sync-fixes
tags: [ble, state-management, ui, backend, sync, locate, streaming, critical]
related_files:
  - ble-bridge/BLEServiceAdapter.ts
  - ble-bridge/DeviceLocateService.ts
  - ble-bridge/NobleBluetoothService.ts
  - ble-bridge/NodeBleService.ts
  - ble-management/UnifiedBLEStateStore.ts
  - ble-management/types.ts
  - electron/renderer/src/components/device-card.tsx
  - electron/renderer/src/hooks/useDevices.ts
  - electron/renderer/src/hooks/use-websocket.ts (DELETE)
checklist: /checklists/state-sync-fixes.md
status: in-progress
last_sync: 2025-12-03
---

# State Sync Fixes

## Overview

Fixing 12 issues across backend/renderer state synchronization.

## Issues Being Fixed

### Group A: Quick Fixes (P0/P1)
1. **GlobalState.SYNCING never set** - Add to syncAllDevices()
2. **syncProgress cleared before broadcast** - Keep at 100, clear on next sync start
3. **Force broadcast for isVibrating** - Bypass debounce
4. **Display syncOffsetMs** - Add tooltip to SignalIcon

### Group B: Consolidation (P1)
5. **Dual broadcast paths** - Remove BLEServiceAdapter throttle, use store only
6. **Duplicate GlobalState setters** - Only BLEServiceAdapter sets global state

### Group C: Enhancements (P3)
7. **Add GlobalState.LOCATING** - For blocking conflicting operations
8. **Add GlobalState.CONNECTING** - For UI feedback during batch connect

### Cleanup
9. **Remove deprecated use-websocket.ts** - Dead code removal

## Architecture After Fix

```
UnifiedBLEStateStore (SINGLE broadcast path)
├── setGlobalState() ──► queueBroadcast() ──► 50ms debounce ──► broadcast
├── transition()     ──► queueBroadcast()
├── setSyncProgress()──► queueBroadcast()
├── setVibrating()   ──► forceBroadcast() ◄── CHANGED: immediate for UI
└── updateDeviceFields() ──► queueBroadcast()

GlobalState enum:
├── IDLE
├── SCANNING
├── CONNECTING  ◄── NEW
├── SYNCING
├── LOCATING    ◄── NEW
└── STREAMING
```

## Validation

After implementation:
1. Type-check: `npx tsc --noEmit`
2. Build: `npm run build`
3. Flow trace: Manual verification of each state transition
