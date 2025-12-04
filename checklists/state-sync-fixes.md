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
doc: /docs/unified-state-refactor/state-sync-fixes.md
status: in-progress
last_sync: 2025-12-03
---

# State Sync Fixes Checklist

## Group A: Quick Fixes

- [ ] A1. Set GlobalState.SYNCING during sync
  - File: ble-bridge/BLEServiceAdapter.ts
  - Location: syncAllDevices() start/end

- [ ] A2. Keep syncProgress=100 until next sync
  - File: ble-bridge/BLEServiceAdapter.ts
  - Remove: setSyncProgress(null) after transition to SYNCED
  - Add: Clear all syncProgress at sync START instead

- [ ] A3. Force broadcast for isVibrating
  - File: ble-management/UnifiedBLEStateStore.ts
  - Change: setVibrating() to use forceBroadcast()

- [ ] A4. Display syncOffsetMs in tooltip
  - File: electron/renderer/src/components/device-card.tsx
  - Add: Tooltip on SignalIcon showing offset when synced

## Group B: Consolidation

- [ ] B1. Remove BLEServiceAdapter broadcast throttle
  - File: ble-bridge/BLEServiceAdapter.ts
  - Remove: broadcastDeviceStatus() throttle logic
  - Change: Use UnifiedBLEStateStore.forceBroadcast() for immediate

- [ ] B2. Remove duplicate GlobalState setters
  - Files: NobleBluetoothService.ts, NodeBleService.ts
  - Remove: All setGlobalState() calls (BLEServiceAdapter owns this)

## Group C: Enhancements

- [ ] C1. Add GlobalState.LOCATING
  - File: ble-management/types.ts
  - File: ble-bridge/BLEServiceAdapter.ts (set on locate start/stop)
  - File: electron/renderer/src/hooks/useDevices.ts (add isLocating derived)

- [ ] C2. Add GlobalState.CONNECTING
  - File: ble-management/types.ts
  - File: ble-bridge/BLEServiceAdapter.ts (set during batch connect)
  - File: electron/renderer/src/hooks/useDevices.ts (add isConnecting derived)

## Cleanup

- [ ] D1. Delete deprecated use-websocket.ts
  - File: electron/renderer/src/hooks/use-websocket.ts
  - Verify: No imports remain

## Validation

- [ ] V1. Type-check passes
- [ ] V2. Build succeeds
- [ ] V3. Trace sync flow
- [ ] V4. Trace locate flow
- [ ] V5. Trace streaming flow
