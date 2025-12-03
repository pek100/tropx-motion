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

# Unified BLE State Management - Implementation Checklist

## Phase 1: Types & Core Foundation
> Dependencies: None
> Output: ble-management/types.ts (updated), ble-management/UnifiedBLEStateStore.ts

### 1.1 Types & Constants
- [ ] 1.1.1 Define `DeviceState` enum (DISCOVERED, CONNECTING, CONNECTED, SYNCING, SYNCED, STREAMING, RECONNECTING, DISCONNECTED, ERROR)
- [ ] 1.1.2 Define `GlobalState` enum (IDLE, SCANNING, SYNCING, STREAMING)
- [ ] 1.1.3 Define `TRANSITION_RULES` map (valid state transitions)
- [ ] 1.1.4 Define `UnifiedDeviceState` interface (complete device state shape)
- [ ] 1.1.5 Define `GlobalBLEState` interface (global state shape)
- [ ] 1.1.6 Define configuration constants (timeouts, intervals, max attempts)

### 1.2 State Machine Core
- [ ] 1.2.1 Implement `validateTransition(from: DeviceState, to: DeviceState): boolean`
- [ ] 1.2.2 Implement `transition(deviceId, newState, meta?)` with validation & events
- [ ] 1.2.3 Implement `getValidTransitions(state): DeviceState[]`
- [ ] 1.2.4 Implement `canTransition(deviceId, targetState): boolean`

### 1.3 Device State Management
- [ ] 1.3.1 Create `devices: Map<DeviceID, UnifiedDeviceState>` storage
- [ ] 1.3.2 Implement `registerDevice(bleAddress, bleName): DeviceID | null`
- [ ] 1.3.3 Implement `unregisterDevice(deviceId): void`
- [ ] 1.3.4 Implement `getDevice(deviceId): UnifiedDeviceState | null`
- [ ] 1.3.5 Implement `getDeviceByAddress(bleAddress): DeviceID | null`
- [ ] 1.3.6 Implement `getAllDevices(): UnifiedDeviceState[]`
- [ ] 1.3.7 Implement `getDevicesByState(state): UnifiedDeviceState[]`
- [ ] 1.3.8 Implement `updateDeviceFields(deviceId, partial): void`

### 1.4 Global State Management
- [ ] 1.4.1 Create `globalState: GlobalBLEState` storage
- [ ] 1.4.2 Implement `setGlobalState(state): void` with events
- [ ] 1.4.3 Implement `getGlobalState(): GlobalState`
- [ ] 1.4.4 Implement `isOperationBlocked(): boolean`

### 1.5 Streaming Hooks
- [ ] 1.5.1 Create `hooks: Map<DeviceID, StreamingHook>` storage
- [ ] 1.5.2 Implement `registerHook(deviceId, hook): void`
- [ ] 1.5.3 Implement `unregisterHook(deviceId): void`
- [ ] 1.5.4 Implement `dispatchMotionData(bleAddress, data): DeviceID | null`

---

## Phase 2: Managers (Polling, Reconnection, Watchdog)
> Dependencies: Phase 1
> Output: ble-management/PollingManager.ts, ReconnectionManager.ts, Watchdog.ts

### 2.1 Polling Manager
- [ ] 2.1.1 Define `PollingConfig` (intervals: battery=30s, rssi=10s, firmwareState=5s)
- [ ] 2.1.2 Create `pollingTimers: Map<string, NodeJS.Timeout>` storage
- [ ] 2.1.3 Implement `startPolling(): void`
- [ ] 2.1.4 Implement `stopPolling(): void`
- [ ] 2.1.5 Implement `blockPolling(reason): void` (clears all timers)
- [ ] 2.1.6 Implement `resumePolling(): void` (restarts for eligible devices)
- [ ] 2.1.7 Implement `shouldPollDevice(deviceId, pollType): boolean`
- [ ] 2.1.8 Implement `pollBattery(deviceId): Promise<number | null>`
- [ ] 2.1.9 Implement `pollRSSI(deviceId): Promise<number | null>`
- [ ] 2.1.10 Implement `pollFirmwareState(deviceId): Promise<number | null>`
- [ ] 2.1.11 Hook into global state changes (block on SYNCING/STREAMING)

### 2.2 Reconnection Manager
- [ ] 2.2.1 Define `ReconnectConfig` (baseDelay=2000, maxDelay=60000, maxAttempts=5, multiplier=2)
- [ ] 2.2.2 Create `attempts: Map<DeviceID, number>` storage
- [ ] 2.2.3 Create `reconnectTimers: Map<DeviceID, NodeJS.Timeout>` storage
- [ ] 2.2.4 Implement `calculateBackoffDelay(attempts): number`
- [ ] 2.2.5 Implement `scheduleReconnect(deviceId, reason): void`
- [ ] 2.2.6 Implement `attemptReconnect(deviceId): Promise<void>`
- [ ] 2.2.7 Implement `cancelReconnect(deviceId): void`
- [ ] 2.2.8 Implement `clearReconnectState(deviceId): void`
- [ ] 2.2.9 Implement `recoverStreamingIfActive(deviceId): Promise<boolean>`

### 2.3 Watchdog (Heartbeat)
- [ ] 2.3.1 Define `WatchdogConfig` (interval=5000, timeout=15000)
- [ ] 2.3.2 Create `lastSeen: Map<DeviceID, number>` storage
- [ ] 2.3.3 Implement `startWatchdog(): void`
- [ ] 2.3.4 Implement `stopWatchdog(): void`
- [ ] 2.3.5 Implement `updateLastSeen(deviceId): void`
- [ ] 2.3.6 Implement `checkAllDevices(): void`
- [ ] 2.3.7 Implement `handleDeviceTimeout(deviceId): void` (triggers reconnect)

---

## Phase 3: Event & Broadcast System
> Dependencies: Phase 1, Phase 2
> Output: Updates to UnifiedBLEStateStore.ts, websocket-bridge/protocol/MessageTypes.ts

### 3.1 Event Emission
- [ ] 3.1.1 Setup EventEmitter in UnifiedBLEStateStore
- [ ] 3.1.2 Create `broadcastFunction` storage
- [ ] 3.1.3 Implement `setBroadcastFunction(fn): void`
- [ ] 3.1.4 Create `broadcastQueue: Set<DeviceID>` for batching
- [ ] 3.1.5 Implement `queueBroadcast(deviceId?): void`
- [ ] 3.1.6 Implement `flushBroadcast(): void` (debounced, 50ms)
- [ ] 3.1.7 Implement `serializeStateUpdate(): StateUpdateMessage`
- [ ] 3.1.8 Implement `emitLocalEvent(event, data): void`

### 3.2 WebSocket Protocol Updates
- [ ] 3.2.1 Add `STATE_UPDATE = 0x40` to MessageTypes
- [ ] 3.2.2 Define `StateUpdateMessage` interface
- [ ] 3.2.3 Update BLEDomainProcessor to use new broadcast
- [ ] 3.2.4 Add `GET_STATE` command handler (returns full state)

---

## Phase 4: useBLEState Hook
> Dependencies: Phase 3
> Output: electron/renderer/src/hooks/useBLEState.ts

### 4.1 Hook State
- [ ] 4.1.1 Define `devices: Map<DeviceID, DeviceState>` state
- [ ] 4.1.2 Define `globalState: GlobalState` state
- [ ] 4.1.3 Define `isConnected: boolean` state (WebSocket connection)
- [ ] 4.1.4 Define `lastUpdate: number` state

### 4.2 Subscription
- [ ] 4.2.1 Subscribe to `STATE_UPDATE` messages
- [ ] 4.2.2 Subscribe to `SYNC_PROGRESS` messages (for real-time sync UI)
- [ ] 4.2.3 Request initial state on WebSocket connect
- [ ] 4.2.4 Cleanup subscriptions on unmount

### 4.3 Actions
- [ ] 4.3.1 Implement `startScan(): Promise<void>`
- [ ] 4.3.2 Implement `stopScan(): Promise<void>`
- [ ] 4.3.3 Implement `connect(bleAddress): Promise<boolean>`
- [ ] 4.3.4 Implement `connectAll(addresses): Promise<boolean[]>`
- [ ] 4.3.5 Implement `disconnect(deviceId): Promise<boolean>`
- [ ] 4.3.6 Implement `disconnectAll(): Promise<void>`
- [ ] 4.3.7 Implement `remove(deviceId): Promise<boolean>`
- [ ] 4.3.8 Implement `syncAll(): Promise<SyncResult[]>`
- [ ] 4.3.9 Implement `startStreaming(): Promise<boolean>`
- [ ] 4.3.10 Implement `stopStreaming(): Promise<boolean>`
- [ ] 4.3.11 Implement `retryConnection(deviceId): Promise<boolean>`

### 4.4 Selectors
- [ ] 4.4.1 Implement `getDevice(deviceId): DeviceState | null`
- [ ] 4.4.2 Implement `getDeviceByAddress(address): DeviceState | null`
- [ ] 4.4.3 Implement `getLeftKneeDevices(): DeviceState[]`
- [ ] 4.4.4 Implement `getRightKneeDevices(): DeviceState[]`

### 4.5 Derived State (useMemo)
- [ ] 4.5.1 Compute `discoveredDevices` array
- [ ] 4.5.2 Compute `connectedDevices` array
- [ ] 4.5.3 Compute `streamingDevices` array
- [ ] 4.5.4 Compute `errorDevices` array
- [ ] 4.5.5 Compute `counts` object
- [ ] 4.5.6 Compute `isReadyToStream` boolean
- [ ] 4.5.7 Compute `isReadyToSync` boolean
- [ ] 4.5.8 Compute `isScanning` boolean
- [ ] 4.5.9 Compute `isStreaming` boolean
- [ ] 4.5.10 Compute `isSyncing` boolean

---

## Phase 5: Migration
> Dependencies: Phase 4
> Output: Updated BLE layer, WebSocket layer, UI layer

### 5.1 BLE Layer Migration
- [ ] 5.1.1 Update BLEServiceAdapter imports (UnifiedBLEStateStore)
- [ ] 5.1.2 Replace all `deviceStateManager` calls in BLEServiceAdapter
- [ ] 5.1.3 Update NobleBluetoothService imports
- [ ] 5.1.4 Replace all `deviceStateManager` calls in NobleBluetoothService
- [ ] 5.1.5 Update disconnect event handlers to use store.transition()
- [ ] 5.1.6 Integrate watchdog.updateLastSeen() on data receive
- [ ] 5.1.7 Update NodeBleService if applicable

### 5.2 WebSocket Layer Migration
- [ ] 5.2.1 Update UnifiedMessageRouter for GET_STATE command
- [ ] 5.2.2 Update BLEDomainProcessor command handlers
- [ ] 5.2.3 Add GET_STATE command handler
- [ ] 5.2.4 Update all broadcast calls to use store.queueBroadcast()

### 5.3 UI Layer Migration
- [ ] 5.3.1 Create useBLEState.ts hook file
- [ ] 5.3.2 Update App.tsx to use useBLEState instead of useSensorMap
- [ ] 5.3.3 Update device-card.tsx to use new state shape
- [ ] 5.3.4 Update any other components consuming BLE state
- [ ] 5.3.5 Delete useSensorMap.ts

---

## Phase 6: Cleanup & Validation
> Dependencies: Phase 5
> Output: Clean codebase, passing tests

### 6.1 Cleanup
- [ ] 6.1.1 Delete ble-bridge/DeviceStateManager.ts
- [ ] 6.1.2 Update ble-management/index.ts exports
- [ ] 6.1.3 Update ble-bridge/index.ts exports
- [ ] 6.1.4 Remove deprecated message type constants (0x31, 0x32, 0x33, 0x35)
- [ ] 6.1.5 Remove deprecated message handlers

### 6.2 Validation
- [ ] 6.2.1 TypeScript compilation passes
- [ ] 6.2.2 Test: State transitions work correctly
- [ ] 6.2.3 Test: Reconnection with backoff works
- [ ] 6.2.4 Test: Polling stops during streaming
- [ ] 6.2.5 Test: UI receives and displays state updates
- [ ] 6.2.6 Test: Error state shows "Retry" button
- [ ] 6.2.7 Test: Watchdog detects disconnected devices

---

## Progress Summary

| Phase | Tasks | Completed | Status |
|-------|-------|-----------|--------|
| 1. Types & Core | 22 | 0 | ⬜ Not Started |
| 2. Managers | 21 | 0 | ⬜ Not Started |
| 3. Event & Broadcast | 12 | 0 | ⬜ Not Started |
| 4. useBLEState Hook | 25 | 0 | ⬜ Not Started |
| 5. Migration | 16 | 0 | ⬜ Not Started |
| 6. Cleanup & Validation | 12 | 0 | ⬜ Not Started |
| **Total** | **108** | **0** | **0%** |

---

## Notes

### Design Decisions
1. Single `STATE_UPDATE` message replaces 4 separate message types
2. Polling blocked globally during SYNCING or STREAMING
3. Watchdog interval separate from polling (always runs for disconnect detection)
4. Hook never modifies state directly - only sends commands
5. Error state persists with "Retry" button (user-driven recovery)

### Risk Areas
1. Noble disconnect events may not always fire → Watchdog mitigates
2. State transition validation may break existing flows → Need thorough testing
3. Hook subscription timing on reconnect → Request initial state on connect

### Files to Create
- `ble-management/UnifiedBLEStateStore.ts`
- `ble-management/PollingManager.ts`
- `ble-management/ReconnectionManager.ts`
- `ble-management/Watchdog.ts`
- `electron/renderer/src/hooks/useBLEState.ts`

### Files to Delete
- `ble-bridge/DeviceStateManager.ts`
- `electron/renderer/src/hooks/useSensorMap.ts`

### Files to Modify
- `ble-management/types.ts`
- `ble-management/index.ts`
- `ble-bridge/BLEServiceAdapter.ts`
- `ble-bridge/NobleBluetoothService.ts`
- `ble-bridge/index.ts`
- `websocket-bridge/protocol/MessageTypes.ts`
- `websocket-bridge/processors/BLEDomainProcessor.ts`
- `electron/renderer/src/App.tsx`
- `electron/renderer/src/components/device-card.tsx`
