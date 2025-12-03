---
id: unified-ble-state
tags: [ble, state-management, websocket, react-hook, critical]
related_files:
  - ble-management/UnifiedBLEStateStore.ts
  - ble-management/PollingManager.ts
  - ble-management/ReconnectionManager.ts
  - ble-management/Watchdog.ts
  - ble-management/types.ts
  - ble-bridge/BLEServiceAdapter.ts
  - ble-bridge/NobleBluetoothService.ts
  - websocket-bridge/protocol/MessageTypes.ts
  - electron/renderer/src/hooks/useBLEState.ts
checklist: /checklists/unified-ble-state.md
doc: /docs/unified-ble-state/README.md
status: in-progress
last_sync: 2024-12-02
---

# Unified BLE State Management - Decomposition

## Problem Statement

Two parallel state managers (`DeviceStateStore` + `deviceStateManager`) cause:
- Race conditions and inconsistent UI
- No formal state machine (implicit transitions)
- Polling during streaming causes BLE interference
- Scattered reconnection logic
- Multiple event emission points

## Solution

Single `UnifiedBLEStateStore` with:
- Explicit state machine with validated transitions
- Integrated polling manager with global lock
- Reconnection manager with exponential backoff
- Watchdog for disconnect detection
- Single batched WebSocket broadcast
- React hook for UI consumption

---

## Decomposition Tree

```
Unified BLE State Management
├── 1. Core Types & Constants
│   ├── 1.1 DeviceState enum ✓ atomic
│   ├── 1.2 GlobalState enum ✓ atomic
│   ├── 1.3 TransitionRules map ✓ atomic
│   ├── 1.4 UnifiedDeviceState interface ✓ atomic
│   ├── 1.5 GlobalBLEState interface ✓ atomic
│   └── 1.6 Configuration constants ✓ atomic
│
├── 2. State Machine
│   ├── 2.1 validateTransition(from, to) ✓ atomic
│   ├── 2.2 transition(deviceId, newState, meta?) ✓ atomic
│   ├── 2.3 getValidTransitions(state) ✓ atomic
│   └── 2.4 canTransition(deviceId, targetState) ✓ atomic
│
├── 3. Device State Management
│   ├── 3.1 devices Map storage ✓ atomic
│   ├── 3.2 registerDevice(bleAddress, bleName) ✓ atomic
│   ├── 3.3 unregisterDevice(deviceId) ✓ atomic
│   ├── 3.4 getDevice(deviceId) ✓ atomic
│   ├── 3.5 getDeviceByAddress(bleAddress) ✓ atomic
│   ├── 3.6 getAllDevices() ✓ atomic
│   ├── 3.7 getDevicesByState(state) ✓ atomic
│   └── 3.8 updateDeviceFields(deviceId, partial) ✓ atomic
│
├── 4. Global State Management
│   ├── 4.1 globalState storage ✓ atomic
│   ├── 4.2 setGlobalState(state) ✓ atomic
│   ├── 4.3 getGlobalState() ✓ atomic
│   └── 4.4 isOperationBlocked() ✓ atomic
│
├── 5. Streaming Hooks
│   ├── 5.1 hooks Map storage ✓ atomic
│   ├── 5.2 registerHook(deviceId, hook) ✓ atomic
│   ├── 5.3 unregisterHook(deviceId) ✓ atomic
│   └── 5.4 dispatchMotionData(bleAddress, data) ✓ atomic
│
├── 6. Polling Manager
│   ├── 6.1 PollingConfig constants ✓ atomic
│   ├── 6.2 pollingTimers Map storage ✓ atomic
│   ├── 6.3 startPolling() ✓ atomic
│   ├── 6.4 stopPolling() ✓ atomic
│   ├── 6.5 blockPolling(reason) ✓ atomic
│   ├── 6.6 resumePolling() ✓ atomic
│   ├── 6.7 shouldPollDevice(deviceId, pollType) ✓ atomic
│   ├── 6.8 pollBattery(deviceId) ✓ atomic
│   ├── 6.9 pollRSSI(deviceId) ✓ atomic
│   └── 6.10 pollFirmwareState(deviceId) ✓ atomic
│
├── 7. Reconnection Manager
│   ├── 7.1 ReconnectConfig constants ✓ atomic
│   ├── 7.2 attempts Map storage ✓ atomic
│   ├── 7.3 reconnectTimers Map storage ✓ atomic
│   ├── 7.4 calculateBackoffDelay(attempts) ✓ atomic
│   ├── 7.5 scheduleReconnect(deviceId, reason) ✓ atomic
│   ├── 7.6 attemptReconnect(deviceId) ✓ atomic
│   ├── 7.7 cancelReconnect(deviceId) ✓ atomic
│   ├── 7.8 clearReconnectState(deviceId) ✓ atomic
│   └── 7.9 recoverStreamingIfActive(deviceId) ✓ atomic
│
├── 8. Watchdog (Heartbeat)
│   ├── 8.1 WatchdogConfig constants ✓ atomic
│   ├── 8.2 lastSeen Map storage ✓ atomic
│   ├── 8.3 startWatchdog() ✓ atomic
│   ├── 8.4 stopWatchdog() ✓ atomic
│   ├── 8.5 updateLastSeen(deviceId) ✓ atomic
│   ├── 8.6 checkAllDevices() ✓ atomic
│   └── 8.7 handleDeviceTimeout(deviceId) ✓ atomic
│
├── 9. Event & Broadcast System
│   ├── 9.1 EventEmitter setup ✓ atomic
│   ├── 9.2 broadcastFunction storage ✓ atomic
│   ├── 9.3 setBroadcastFunction(fn) ✓ atomic
│   ├── 9.4 broadcastQueue Set storage ✓ atomic
│   ├── 9.5 queueBroadcast(deviceId) ✓ atomic
│   ├── 9.6 flushBroadcast() ✓ atomic
│   ├── 9.7 serializeStateUpdate() ✓ atomic
│   └── 9.8 emitLocalEvent(event, data) ✓ atomic
│
├── 10. WebSocket Protocol Updates
│   ├── 10.1 STATE_UPDATE message type (0x40) ✓ atomic
│   ├── 10.2 Update MessageTypes.ts ✓ atomic
│   ├── 10.3 Update BLEDomainProcessor ✓ atomic
│   └── 10.4 Remove deprecated message handlers ✓ atomic
│
├── 11. useBLEState Hook
│   ├── 11.1 Hook State
│   │   ├── 11.1.1 devices state ✓ atomic
│   │   ├── 11.1.2 globalState state ✓ atomic
│   │   ├── 11.1.3 isConnected state ✓ atomic
│   │   └── 11.1.4 lastUpdate state ✓ atomic
│   │
│   ├── 11.2 Subscription
│   │   ├── 11.2.1 Subscribe to STATE_UPDATE ✓ atomic
│   │   ├── 11.2.2 Subscribe to SYNC_PROGRESS ✓ atomic
│   │   ├── 11.2.3 Request initial state on connect ✓ atomic
│   │   └── 11.2.4 Cleanup on unmount ✓ atomic
│   │
│   ├── 11.3 Actions
│   │   ├── 11.3.1 startScan() ✓ atomic
│   │   ├── 11.3.2 stopScan() ✓ atomic
│   │   ├── 11.3.3 connect(bleAddress) ✓ atomic
│   │   ├── 11.3.4 connectAll(addresses) ✓ atomic
│   │   ├── 11.3.5 disconnect(deviceId) ✓ atomic
│   │   ├── 11.3.6 disconnectAll() ✓ atomic
│   │   ├── 11.3.7 remove(deviceId) ✓ atomic
│   │   ├── 11.3.8 syncAll() ✓ atomic
│   │   ├── 11.3.9 startStreaming() ✓ atomic
│   │   ├── 11.3.10 stopStreaming() ✓ atomic
│   │   └── 11.3.11 retryConnection(deviceId) ✓ atomic
│   │
│   ├── 11.4 Selectors
│   │   ├── 11.4.1 getDevice(deviceId) ✓ atomic
│   │   ├── 11.4.2 getDeviceByAddress(address) ✓ atomic
│   │   ├── 11.4.3 getLeftKneeDevices() ✓ atomic
│   │   └── 11.4.4 getRightKneeDevices() ✓ atomic
│   │
│   └── 11.5 Derived State (useMemo)
│       ├── 11.5.1 discoveredDevices ✓ atomic
│       ├── 11.5.2 connectedDevices ✓ atomic
│       ├── 11.5.3 streamingDevices ✓ atomic
│       ├── 11.5.4 errorDevices ✓ atomic
│       ├── 11.5.5 counts object ✓ atomic
│       ├── 11.5.6 isReadyToStream ✓ atomic
│       ├── 11.5.7 isReadyToSync ✓ atomic
│       ├── 11.5.8 isScanning ✓ atomic
│       ├── 11.5.9 isStreaming ✓ atomic
│       └── 11.5.10 isSyncing ✓ atomic
│
├── 12. Migration - BLE Layer
│   ├── 12.1 Update BLEServiceAdapter imports ✓ atomic
│   ├── 12.2 Replace deviceStateManager calls in BLEServiceAdapter ✓ atomic
│   ├── 12.3 Update NobleBluetoothService imports ✓ atomic
│   ├── 12.4 Replace deviceStateManager calls in NobleBluetoothService ✓ atomic
│   ├── 12.5 Update disconnect handlers ✓ atomic
│   ├── 12.6 Integrate watchdog callbacks ✓ atomic
│   └── 12.7 Update NodeBleService ✓ atomic
│
├── 13. Migration - WebSocket Layer
│   ├── 13.1 Update UnifiedMessageRouter ✓ atomic
│   ├── 13.2 Update BLEDomainProcessor commands ✓ atomic
│   ├── 13.3 Add GET_STATE command handler ✓ atomic
│   └── 13.4 Update broadcast calls ✓ atomic
│
├── 14. Migration - UI Layer
│   ├── 14.1 Create useBLEState.ts ✓ atomic
│   ├── 14.2 Update App.tsx to use useBLEState ✓ atomic
│   ├── 14.3 Update device-card.tsx ✓ atomic
│   ├── 14.4 Update any other BLE-consuming components ✓ atomic
│   └── 14.5 Remove useSensorMap.ts ✓ atomic
│
├── 15. Cleanup
│   ├── 15.1 Delete DeviceStateManager.ts ✓ atomic
│   ├── 15.2 Delete old DeviceStateStore.ts (if separate) ✓ atomic
│   ├── 15.3 Update ble-management/index.ts exports ✓ atomic
│   ├── 15.4 Update ble-bridge/index.ts exports ✓ atomic
│   └── 15.5 Remove deprecated message type handlers ✓ atomic
│
└── 16. Validation
    ├── 16.1 TypeScript compilation ✓ atomic
    ├── 16.2 Test state transitions ✓ atomic
    ├── 16.3 Test reconnection flow ✓ atomic
    ├── 16.4 Test polling block during streaming ✓ atomic
    └── 16.5 Test UI sync ✓ atomic
```

---

## Atomic Units Summary

Total: 89 atomic units across 16 components

| Component | Count | Complexity |
|-----------|-------|------------|
| 1. Types & Constants | 6 | Low |
| 2. State Machine | 4 | Medium |
| 3. Device State | 8 | Medium |
| 4. Global State | 4 | Low |
| 5. Streaming Hooks | 4 | Low |
| 6. Polling Manager | 10 | Medium |
| 7. Reconnection Manager | 9 | High |
| 8. Watchdog | 7 | Medium |
| 9. Event & Broadcast | 8 | Medium |
| 10. WebSocket Protocol | 4 | Low |
| 11. useBLEState Hook | 25 | High |
| 12. Migration - BLE | 7 | Medium |
| 13. Migration - WebSocket | 4 | Low |
| 14. Migration - UI | 5 | Medium |
| 15. Cleanup | 5 | Low |
| 16. Validation | 5 | Medium |

---

## Dependencies Graph

```
Types (1) ──────────────────────────────────────────────────────────┐
    │                                                               │
    ▼                                                               │
State Machine (2) ◄──── Device State (3) ◄──── Global State (4)     │
    │                        │                      │               │
    │                        ▼                      │               │
    │              Streaming Hooks (5)              │               │
    │                        │                      │               │
    ▼                        ▼                      ▼               │
Polling Manager (6) ◄─── Reconnection (7) ◄─── Watchdog (8)         │
    │                        │                      │               │
    └────────────────────────┼──────────────────────┘               │
                             │                                      │
                             ▼                                      │
                    Event & Broadcast (9)                           │
                             │                                      │
                             ▼                                      │
                    WebSocket Protocol (10) ◄───────────────────────┘
                             │
                             ▼
                    useBLEState Hook (11)
                             │
                             ▼
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        Migration      Migration      Migration
        BLE (12)       WS (13)        UI (14)
              │              │              │
              └──────────────┼──────────────┘
                             ▼
                        Cleanup (15)
                             │
                             ▼
                      Validation (16)
```

## Implementation Order

1. **Phase 1**: Types & Core (1, 2, 3, 4, 5) - Foundation
2. **Phase 2**: Managers (6, 7, 8) - Behavior
3. **Phase 3**: Communication (9, 10) - Broadcast
4. **Phase 4**: UI (11) - Hook
5. **Phase 5**: Migration (12, 13, 14) - Integration
6. **Phase 6**: Cleanup & Validation (15, 16) - Finalize
