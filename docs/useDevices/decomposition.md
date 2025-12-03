---
id: useDevices
tags: [ui, state-management, ble, hooks, refactor]
related_files:
  - electron/renderer/src/hooks/useDevices.ts
  - electron/renderer/src/hooks/useBLEState.ts
  - electron/renderer/src/hooks/use-websocket.ts
  - electron/renderer/src/App.tsx
  - websocket-bridge/processors/StreamingDomainProcessor.ts
checklist: /checklists/useDevices.md
status: in-progress
last_sync: 2024-12-02
---

# useDevices - Unified Device State Management

## Overview
Single React hook that provides all device state and actions. Server owns truth, UI reflects.

## Decomposition Tree

```
useDevices Hook Refactor
├── 1. useDevices Hook Creation
│   ├── 1.1 WebSocket Client Setup
│   │   ├── 1.1.1 Client initialization ✓ atomic
│   │   ├── 1.1.2 Connection state tracking ✓ atomic
│   │   └── 1.1.3 Reconnection handling ✓ atomic
│   │
│   ├── 1.2 Device State (from STATE_UPDATE 0x40)
│   │   ├── 1.2.1 STATE_UPDATE event handler ✓ atomic
│   │   ├── 1.2.2 Device Map state ✓ atomic
│   │   ├── 1.2.3 GlobalState tracking ✓ atomic
│   │   └── 1.2.4 Derived arrays (connected, streaming, etc.) ✓ atomic
│   │
│   ├── 1.3 Motion Data
│   │   ├── 1.3.1 MOTION_DATA event handler ✓ atomic
│   │   ├── 1.3.2 leftKneeData state ✓ atomic
│   │   └── 1.3.3 rightKneeData state ✓ atomic
│   │
│   ├── 1.4 Locate Mode
│   │   ├── 1.4.1 vibratingDeviceIds state ✓ atomic
│   │   ├── 1.4.2 DEVICE_VIBRATING event handler ✓ atomic
│   │   ├── 1.4.3 startLocateMode action ✓ atomic
│   │   └── 1.4.4 stopLocateMode action ✓ atomic
│   │
│   ├── 1.5 Sync Progress
│   │   ├── 1.5.1 syncProgress state ✓ atomic
│   │   ├── 1.5.2 SYNC_STARTED event handler ✓ atomic
│   │   ├── 1.5.3 SYNC_PROGRESS event handler ✓ atomic
│   │   └── 1.5.4 SYNC_COMPLETE event handler ✓ atomic
│   │
│   ├── 1.6 Device Actions
│   │   ├── 1.6.1 scanDevices ✓ atomic
│   │   ├── 1.6.2 startBurstScan ✓ atomic
│   │   ├── 1.6.3 stopBurstScan ✓ atomic
│   │   ├── 1.6.4 connectDevice ✓ atomic
│   │   ├── 1.6.5 connectAllDevices ✓ atomic
│   │   ├── 1.6.6 disconnectDevice ✓ atomic
│   │   ├── 1.6.7 removeDevice ✓ atomic
│   │   └── 1.6.8 syncAllDevices ✓ atomic
│   │
│   └── 1.7 Streaming Actions
│       ├── 1.7.1 startStreaming ✓ atomic
│       └── 1.7.2 stopStreaming ✓ atomic
│
├── 2. App.tsx Migration
│   ├── 2.1 Import Changes
│   │   ├── 2.1.1 Add useDevices import ✓ atomic
│   │   └── 2.1.2 Remove useWebSocket import ✓ atomic
│   │
│   ├── 2.2 State Cleanup
│   │   ├── 2.2.1 Remove local devices state ✓ atomic
│   │   ├── 2.2.2 Remove userDisconnectedDevices state ✓ atomic
│   │   ├── 2.2.3 Remove merge useEffect (lines 305-470) ✓ atomic
│   │   └── 2.2.4 Remove isSyncing useEffect (lines 732-751) ✓ atomic
│   │
│   ├── 2.3 Device Data Mapping
│   │   ├── 2.3.1 Create UI device type mapper ✓ atomic
│   │   └── 2.3.2 Derive sortedDevices from useDevices ✓ atomic
│   │
│   └── 2.4 Handler Updates
│       ├── 2.4.1 Update handleToggleConnection ✓ atomic
│       ├── 2.4.2 Update handleConnectAll ✓ atomic
│       ├── 2.4.3 Update handleDisconnectAll ✓ atomic
│       ├── 2.4.4 Update handleRefresh ✓ atomic
│       ├── 2.4.5 Update handleSync ✓ atomic
│       ├── 2.4.6 Update handleLocate ✓ atomic
│       └── 2.4.7 Update handleToggleStreaming ✓ atomic
│
└── 3. Backend Stream Check
    ├── 3.1 Find stream check location ✓ atomic
    └── 3.2 Remove/modify check ✓ atomic
```

## Atomic Units (Flat List)

### 1. useDevices Hook Creation
| ID | Unit | Parent | Description |
|----|------|--------|-------------|
| 1.1.1 | Client initialization | WebSocket Client Setup | Create/get WS client instance |
| 1.1.2 | Connection state tracking | WebSocket Client Setup | Track isConnected state |
| 1.1.3 | Reconnection handling | WebSocket Client Setup | Handle WS reconnection |
| 1.2.1 | STATE_UPDATE handler | Device State | Parse 0x40 messages, update devices |
| 1.2.2 | Device Map state | Device State | useState for devices Map |
| 1.2.3 | GlobalState tracking | Device State | Track global BLE state |
| 1.2.4 | Derived arrays | Device State | useMemo for filtered arrays |
| 1.3.1 | MOTION_DATA handler | Motion Data | Parse motion binary, update angles |
| 1.3.2 | leftKneeData state | Motion Data | Left knee angle data |
| 1.3.3 | rightKneeData state | Motion Data | Right knee angle data |
| 1.4.1 | vibratingDeviceIds state | Locate Mode | Track vibrating devices |
| 1.4.2 | DEVICE_VIBRATING handler | Locate Mode | Handle vibration events |
| 1.4.3 | startLocateMode action | Locate Mode | Start locate mode |
| 1.4.4 | stopLocateMode action | Locate Mode | Stop locate mode |
| 1.5.1 | syncProgress state | Sync Progress | Track per-device sync progress |
| 1.5.2 | SYNC_STARTED handler | Sync Progress | Handle sync start |
| 1.5.3 | SYNC_PROGRESS handler | Sync Progress | Handle sync updates |
| 1.5.4 | SYNC_COMPLETE handler | Sync Progress | Handle sync complete |
| 1.6.1 | scanDevices | Device Actions | Trigger device scan |
| 1.6.2 | startBurstScan | Device Actions | Start 10s burst scan |
| 1.6.3 | stopBurstScan | Device Actions | Stop burst scan |
| 1.6.4 | connectDevice | Device Actions | Connect single device |
| 1.6.5 | connectAllDevices | Device Actions | Connect all discovered |
| 1.6.6 | disconnectDevice | Device Actions | Disconnect single device |
| 1.6.7 | removeDevice | Device Actions | Remove device from registry |
| 1.6.8 | syncAllDevices | Device Actions | Sync all connected |
| 1.7.1 | startStreaming | Streaming Actions | Start motion streaming |
| 1.7.2 | stopStreaming | Streaming Actions | Stop motion streaming |

### 2. App.tsx Migration
| ID | Unit | Parent | Description |
|----|------|--------|-------------|
| 2.1.1 | Add useDevices import | Import Changes | Import new hook |
| 2.1.2 | Remove useWebSocket import | Import Changes | Remove old import |
| 2.2.1 | Remove local devices state | State Cleanup | Delete lines 49-57 |
| 2.2.2 | Remove userDisconnectedDevices | State Cleanup | Delete line 75 |
| 2.2.3 | Remove merge useEffect | State Cleanup | Delete lines 305-470 |
| 2.2.4 | Remove isSyncing useEffect | State Cleanup | Delete lines 732-751 |
| 2.3.1 | UI device type mapper | Device Data Mapping | Map BLEDevice to UI format |
| 2.3.2 | Derive sortedDevices | Device Data Mapping | useMemo with deviceOrder |
| 2.4.1 | handleToggleConnection | Handler Updates | Use hook actions |
| 2.4.2 | handleConnectAll | Handler Updates | Use hook actions |
| 2.4.3 | handleDisconnectAll | Handler Updates | Use hook actions |
| 2.4.4 | handleRefresh | Handler Updates | Use hook actions |
| 2.4.5 | handleSync | Handler Updates | Use hook actions |
| 2.4.6 | handleLocate | Handler Updates | Use hook actions |
| 2.4.7 | handleToggleStreaming | Handler Updates | Use hook actions |

### 3. Backend Stream Check
| ID | Unit | Parent | Description |
|----|------|--------|-------------|
| 3.1 | Find stream check | Backend Stream Check | Locate the validation |
| 3.2 | Remove/modify check | Backend Stream Check | Remove or make idempotent |

## Data Flow

```
Server (UnifiedBLEStateStore)
    │
    ▼ STATE_UPDATE (0x40)
    │
WebSocket Transport
    │
    ▼ DEVICE_STATUS event
    │
useDevices Hook
    │
    ├── devices: Map<deviceId, BLEDevice>
    ├── globalState: GlobalState
    ├── allDevices: BLEDevice[]
    └── ... derived state
    │
    ▼ UI Device Mapper
    │
App.tsx (read-only, no local state)
```

## Key Decisions
1. **No local device state in App.tsx** - only derived from hook
2. **Server owns truth** - UI never mutates state, only calls actions
3. **Actions are fire-and-forget** - state updates come via STATE_UPDATE
4. **Remove userDisconnectedDevices** - server handles this via removeDevice
