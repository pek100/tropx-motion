---
id: ble-state-refactor
tags: [ble, state-management, refactor, critical]
related_files:
  - ble-bridge/UnifiedBLEService.ts
  - ble-bridge/TropXDevice.ts
  - ble-bridge/strategies/SequentialStrategy.ts
  - ble-bridge/strategies/ParallelStrategy.ts
  - ble-bridge/transports/NobleTransport.ts
  - ble-bridge/interfaces/IConnectionStrategy.ts
  - ble-bridge/PlatformConfig.ts
  - ble-bridge/BleServiceFactory.ts
  - ble-bridge/BleBridgeConstants.ts
  - ble-management/UnifiedBLEStateStore.ts
status: complete
last_sync: 2025-01-05
---

# BLE State Management Refactor

## Goal
Make UnifiedBLEStateStore the single source of truth for BLE connection state. Remove timeout-based state decisions and use event-driven architecture.

## Checklist

### Phase 1: Simplify Strategies (remove timeout-based verification)
- [x] 1.1 `SequentialStrategy.ts` - Remove `verifyConnectedState()` timeout polling, trust `peripheral.connect()` result
- [x] 1.2 `ParallelStrategy.ts` - Same changes as Sequential
- [x] 1.3 `IConnectionStrategy.ts` - Remove `stateVerificationTimeoutMs` and `connectionTimeoutMs` from config

### Phase 2: Event-Driven State Updates
- [x] 2.1 `TropXDevice.ts` - Verify disconnect handler updates state store (already implemented)
- [x] 2.2 `UnifiedBLEService.ts` - Add reactive state change listener (`subscribeToStateChanges()`)
- [x] 2.3 `UnifiedBLEService.ts` - Add `ensureDeviceInMap()` for reactive sync

### Phase 3: Reactive Device Map Population
- [x] 3.1 `UnifiedBLEService.ts` - On CONNECTED state → ensure device in `this.devices` via listener
- [x] 3.2 `UnifiedBLEService.ts` - On DISCONNECTED/ERROR state → cleanup `this.devices` via listener
- [x] 3.3 `UnifiedBLEService.ts` - Add "ghost connected" recovery in `connectSingleDeviceWithRetry()`

### Phase 4: Cleanup & Testing
- [x] 4.1 Remove unused timeout constants from `IConnectionStrategy.ts`, `PlatformConfig.ts`, `BleServiceFactory.ts`
- [x] 4.2 Update `BleBridgeConstants.ts` - removed unused CONNECTION_TIMEOUT
- [x] 4.3 Fix `X → X` state transitions: Make same-state transitions a no-op in `UnifiedBLEStateStore.transition()`
- [x] 4.4 Fix listener leak in `TropXDevice.ensureCharacteristics()` - proper cleanup on timeout
- [x] 4.5 Add concurrency guard for characteristic discovery in `TropXDevice.ts`
- [x] 4.6 Add concurrency guard for sync operations in `BLEServiceAdapter.syncAllDevices()`
- [x] 4.7 Fix variable shadowing in `TropXDevice.performCharacteristicDiscovery()`
- [x] 4.8 Fix race condition in reactive state listener (check current state after async ensureDeviceInMap)
- [x] 4.9 Fix duplicate TropXDevice instances: cleanup existing instance before creating new in `setupConnectedDevice()`
- [x] 4.10 Add `disposed` flag to TropXDevice - allows pending async ops to abort when instance is superseded
- [ ] 4.11 Manual test: slow-connecting device scenario (user to verify)
- [ ] 4.12 Manual test: normal connection flow (user to verify)

## Summary of Changes

### Architecture
- **UnifiedBLEStateStore** is now the single source of truth for device connection state
- **this.devices Map** is now a reactive cache that syncs with state store
- Removed timeout-based state verification - BLE libraries handle their own timeouts
  - Noble: 30s internal timeout
  - node-ble/BlueZ: ~20s system timeout

### Key Changes
1. **Strategies simplified**: Just trust `peripheral.connect()` result, removed polling loops
2. **Reactive state listener**: `subscribeToStateChanges()` now syncs `this.devices` with state store
3. **Ghost connected recovery**: If strategy reports failure but peripheral is actually connected, recover it
4. **Cleanup on state change**: `this.devices` cleaned up when state transitions to DISCONNECTED/ERROR
5. **Same-state transitions**: `X → X` transitions are now no-ops instead of throwing InvalidTransitionError
6. **Listener leak fix**: Characteristic discovery properly removes listeners on timeout (prevents MaxListenersExceededWarning)
7. **Concurrent discovery guard**: Per-TropXDevice lock prevents multiple parallel characteristic discovery attempts
8. **Concurrent sync guard**: BLEServiceAdapter prevents multiple sync operations from running simultaneously
9. **Race condition fix**: Reactive state listener verifies current state after async operations to prevent stale device entries
10. **Duplicate TropXDevice fix**: `setupConnectedDevice()` cleans up existing instance before creating new one (prevents parallel discovery)
11. **Disposed flag pattern**: TropXDevice has `disposed` flag set on disconnect - pending async ops check via `checkDisposed()` helper and abort gracefully
12. **Helper methods**: `assertNotDisposed()` throws for critical operations, `checkDisposed()` returns boolean for silent early returns
13. **ensureDeviceInMap lock**: Per-device promise lock prevents concurrent calls from creating duplicate TropXDevice instances
14. **Listener cleanup on disconnect**: Data characteristic listeners explicitly removed in `disconnect()` to prevent stale callbacks
15. **Static discovery lock**: TropXDevice.discoveryLocks is now static (per device address) - prevents parallel characteristic discovery across ALL instances for same physical device
16. **Setup-in-progress guard**: UnifiedBLEService tracks devices being set up via `setupInProgressDevices` Set - prevents `ensureDeviceInMap` from creating duplicate instances during the race window between TropXDevice creation and map insertion
17. **setupConnectedDevice lock**: Per-device promise lock (`setupConnectedDeviceLocks`) prevents concurrent setup calls from creating multiple TropXDevice instances when retries pile up
18. **Discovery lock cleanup on disconnect**: TropXDevice.disconnect() now clears the static discovery lock, preventing disposed instances from holding the lock forever
