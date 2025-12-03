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

# Unified BLE State Management

## Overview

Refactoring the TropxMotion BLE layer to use a single source of truth for all device state, with explicit state machine transitions, robust reconnection handling, and a clean React hook for UI consumption.

## Problem

The current implementation has:
- **Two parallel state managers** (`DeviceStateStore` + `deviceStateManager`)
- **Implicit state transitions** (no validation, easy to get out of sync)
- **Polling during streaming** (causes BLE interference)
- **Scattered reconnection logic** (timers in one place, state in another)
- **Multiple event emissions** (UI can receive partial/inconsistent updates)

## Solution Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MAIN PROCESS                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              UnifiedBLEStateStore                         │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐ │   │
│  │  │ State       │ │ Polling     │ │ Reconnection        │ │   │
│  │  │ Machine     │ │ Manager     │ │ Manager             │ │   │
│  │  │             │ │             │ │                     │ │   │
│  │  │ • validate  │ │ • block on  │ │ • exponential       │ │   │
│  │  │ • transition│ │   streaming │ │   backoff           │ │   │
│  │  │ • emit      │ │ • resume on │ │ • max attempts      │ │   │
│  │  │             │ │   idle      │ │ • auto-recover      │ │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────┘ │   │
│  │  ┌─────────────┐ ┌─────────────────────────────────────┐ │   │
│  │  │ Watchdog    │ │ Event & Broadcast                   │ │   │
│  │  │             │ │                                     │ │   │
│  │  │ • heartbeat │ │ • local EventEmitter                │ │   │
│  │  │ • timeout   │ │ • batched WebSocket broadcast       │ │   │
│  │  │   detection │ │ • 50ms debounce                     │ │   │
│  │  └─────────────┘ └─────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              │ WebSocket (STATE_UPDATE 0x40)     │
│                              ▼                                   │
├─────────────────────────────────────────────────────────────────┤
│                       RENDERER PROCESS                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    useBLEState() Hook                     │   │
│  │                                                           │   │
│  │  State (mirrors server):                                  │   │
│  │  • devices: Map<DeviceID, DeviceState>                    │   │
│  │  • globalState: GlobalState                               │   │
│  │                                                           │   │
│  │  Actions (send commands):                                 │   │
│  │  • connect(), disconnect(), startStreaming(), etc.        │   │
│  │                                                           │   │
│  │  Derived (computed):                                      │   │
│  │  • connectedDevices, counts, isReadyToStream, etc.        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    React Components                       │   │
│  │  const { devices, connect, isStreaming } = useBLEState(); │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## State Machine

### Device States

```
DISCOVERED ──▶ CONNECTING ──▶ CONNECTED ──▶ SYNCING ──▶ SYNCED ──▶ STREAMING
     │              │              │            │           │           │
     │              │              │            │           │           │
     ▼              ▼              ▼            ▼           ▼           ▼
DISCONNECTED ◀── ERROR ◀─────────────────────────────────────────────────
                   ▲
                   │
            RECONNECTING (with exponential backoff)
```

### Global States

| State | Polling | Description |
|-------|---------|-------------|
| IDLE | ✅ Allowed | Normal operation |
| SCANNING | ⏸ Paused | Discovery in progress |
| SYNCING | 🚫 Blocked | Time sync in progress |
| STREAMING | 🚫 Blocked | Motion data streaming |

### Transition Rules

```typescript
const TRANSITIONS: Record<DeviceState, DeviceState[]> = {
  DISCOVERED:    ['CONNECTING', 'DISCONNECTED'],
  CONNECTING:    ['CONNECTED', 'RECONNECTING', 'ERROR', 'DISCONNECTED'],
  CONNECTED:     ['SYNCING', 'STREAMING', 'RECONNECTING', 'DISCONNECTED'],
  SYNCING:       ['SYNCED', 'CONNECTED', 'ERROR', 'RECONNECTING'],
  SYNCED:        ['STREAMING', 'SYNCING', 'CONNECTED', 'RECONNECTING', 'DISCONNECTED'],
  STREAMING:     ['SYNCED', 'CONNECTED', 'RECONNECTING', 'ERROR', 'DISCONNECTED'],
  RECONNECTING:  ['CONNECTING', 'DISCONNECTED', 'ERROR'],
  DISCONNECTED:  ['DISCOVERED', 'CONNECTING'],
  ERROR:         ['DISCONNECTED', 'CONNECTING'],
};
```

## Key Components

### 1. UnifiedBLEStateStore

Single source of truth for all BLE state. Singleton pattern.

```typescript
// Usage
const store = UnifiedBLEStateStore.getInstance();

// Register device
const deviceId = store.registerDevice(bleAddress, bleName);

// Transition state (validated)
store.transition(deviceId, DeviceState.CONNECTED);

// Get state
const device = store.getDevice(deviceId);
const all = store.getAllDevices();
```

### 2. PollingManager

Manages periodic polling with automatic blocking during critical operations.

```typescript
// Automatically blocked when global state is SYNCING or STREAMING
pollingManager.onGlobalStateChange(GlobalState.STREAMING);
// → All polling stops

pollingManager.onGlobalStateChange(GlobalState.IDLE);
// → Polling resumes for eligible devices
```

### 3. ReconnectionManager

Handles reconnection with exponential backoff.

```typescript
// On disconnect
reconnectionManager.scheduleReconnect(deviceId, 'connection_lost');
// → Attempt 1 in 2s
// → Attempt 2 in 4s
// → Attempt 3 in 8s
// → Attempt 4 in 16s
// → Attempt 5 in 32s
// → ERROR state (max attempts reached)
```

### 4. Watchdog

Backup disconnect detection via heartbeat.

```typescript
// Updated on every motion data packet
watchdog.updateLastSeen(deviceId);

// Checked every 5 seconds
// If lastSeen > 15 seconds ago → trigger reconnect
```

### 5. useBLEState Hook

React hook for UI consumption.

```typescript
function MyComponent() {
  const {
    // State
    devices,
    globalState,
    connectedDevices,
    isStreaming,
    counts,

    // Actions
    connect,
    startStreaming,
    stopStreaming,

    // Selectors
    getDevice,
  } = useBLEState();

  return (
    <div>
      <p>Connected: {counts.connected}</p>
      <button onClick={startStreaming} disabled={!isReadyToStream}>
        Start
      </button>
    </div>
  );
}
```

## WebSocket Protocol

### STATE_UPDATE (0x40)

Replaces: DEVICE_STATUS (0x31), BATTERY_UPDATE (0x32), SYNC_STARTED (0x33), SYNC_COMPLETE (0x35)

```typescript
interface StateUpdateMessage {
  type: 0x40;
  timestamp: number;
  globalState: GlobalState;
  devices: Array<{
    deviceId: DeviceID;
    bleAddress: string;
    bleName: string;
    status: DeviceState;
    batteryLevel: number | null;
    rssi: number | null;
    syncState: 'not_synced' | 'syncing' | 'synced' | 'failed';
    clockOffset: number;
    reconnectAttempts: number;
    lastError: { type: string; message: string } | null;
  }>;
}
```

### Retained Messages

- **SYNC_PROGRESS (0x34)**: Real-time sync feedback (device timestamps)
- **DEVICE_VIBRATING (0x36)**: Locate mode

## Configuration

```typescript
const CONFIG = {
  // Polling
  polling: {
    battery: { interval: 30000, allowedStates: ['CONNECTED', 'SYNCED'] },
    rssi: { interval: 10000, allowedStates: ['CONNECTED', 'SYNCED'] },
    firmwareState: { interval: 5000, allowedStates: ['CONNECTED', 'SYNCED'] },
  },

  // Reconnection
  reconnect: {
    baseDelay: 2000,
    maxDelay: 60000,
    maxAttempts: 5,
    multiplier: 2,
  },

  // Watchdog
  watchdog: {
    checkInterval: 5000,
    timeout: 15000,
  },

  // Broadcast
  broadcast: {
    debounceMs: 50,
  },
};
```

## Error Handling

### Error State Behavior
- Device stays visible in UI with ERROR status
- "Retry" button allows user to manually trigger reconnection
- Error details (type, message) displayed to user

### Recovery Paths
1. **User clicks Retry** → Transition to CONNECTING
2. **Device rediscovered** → Transition to DISCOVERED
3. **Manual remove** → Transition to DISCONNECTED, then removed

## Files

### Created
- `ble-management/UnifiedBLEStateStore.ts`
- `ble-management/PollingManager.ts`
- `ble-management/ReconnectionManager.ts`
- `ble-management/Watchdog.ts`
- `electron/renderer/src/hooks/useBLEState.ts`

### Modified
- `ble-management/types.ts`
- `ble-management/index.ts`
- `ble-bridge/BLEServiceAdapter.ts`
- `ble-bridge/NobleBluetoothService.ts`
- `websocket-bridge/protocol/MessageTypes.ts`
- `websocket-bridge/processors/BLEDomainProcessor.ts`

### Deleted
- `ble-bridge/DeviceStateManager.ts`
- `electron/renderer/src/hooks/useSensorMap.ts`

## Testing Checklist

- [ ] State transitions validate correctly
- [ ] Invalid transitions throw errors
- [ ] Polling stops during streaming
- [ ] Polling resumes after streaming stops
- [ ] Reconnection uses exponential backoff
- [ ] Max reconnect attempts triggers ERROR state
- [ ] Watchdog detects unresponsive devices
- [ ] UI updates on state changes
- [ ] Error state shows Retry button
- [ ] Retry triggers new connection attempt
