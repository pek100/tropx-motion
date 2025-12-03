---
id: useDevices
tags: [ui, state-management, ble, hooks, refactor, critical]
related_files:
  - electron/renderer/src/hooks/useDevices.ts
  - electron/renderer/src/hooks/useBLEState.ts
  - electron/renderer/src/hooks/use-websocket.ts
  - electron/renderer/src/App.tsx
  - websocket-bridge/processors/BLEDomainProcessor.ts
doc: /docs/useDevices/decomposition.md
status: in-progress
last_sync: 2024-12-02
---

# useDevices Implementation Checklist

## Phase 1: Create useDevices Hook
> Extend useBLEState with missing functionality

- [ ] 1.1 Create `useDevices.ts` based on `useBLEState.ts`
- [ ] 1.2 Add WebSocket client creation/management
- [ ] 1.3 Add motion data handling (leftKneeData, rightKneeData)
- [ ] 1.4 Add locate mode (vibratingDeviceIds, startLocateMode, stopLocateMode)
- [ ] 1.5 Add sync progress tracking (syncProgress state, handlers)
- [ ] 1.6 Add burst scan actions (startBurstScan, stopBurstScan)
- [ ] 1.7 Export UI device mapper function
- [ ] 1.8 Verify all EVENT_TYPES are handled

## Phase 2: Backend Stream Check
> Remove "recording already active" limitation

- [ ] 2.1 Modify `BLEDomainProcessor.ts:265-266` - make idempotent (return success if already recording)
- [ ] 2.2 Test starting stream when already streaming

## Phase 3: App.tsx Migration
> Single source of truth refactor

### 3.1 Import Changes
- [ ] 3.1.1 Add `import { useDevices } from "@/hooks/useDevices"`
- [ ] 3.1.2 Remove `import { useWebSocket } from "@/hooks/use-websocket"`

### 3.2 Hook Usage
- [ ] 3.2.1 Replace useWebSocket() with useDevices()
- [ ] 3.2.2 Destructure all needed values from useDevices

### 3.3 State Cleanup (DELETE)
- [ ] 3.3.1 Delete local `devices` state (lines 49-57)
- [ ] 3.3.2 Delete `userDisconnectedDevices` state (line 75)
- [ ] 3.3.3 Delete merge useEffect (lines 305-470) - ~165 lines
- [ ] 3.3.4 Delete isSyncing useEffect (lines 732-751)

### 3.4 Derived State
- [ ] 3.4.1 Create `uiDevices` derived from useDevices with mapper
- [ ] 3.4.2 Update `sortedDevices` to use `uiDevices`

### 3.5 Handler Updates
- [ ] 3.5.1 Simplify `handleToggleConnection` - just call action
- [ ] 3.5.2 Simplify `handleConnectAll` - just call action
- [ ] 3.5.3 Simplify `handleDisconnectAll` - just call action
- [ ] 3.5.4 Simplify `handleRefresh` - use hook's burst scan
- [ ] 3.5.5 Simplify `handleSync` - use hook action
- [ ] 3.5.6 Update `handleLocate` - use hook actions
- [ ] 3.5.7 Simplify `handleToggleStreaming` - use hook actions

### 3.6 Remove Local State Mutations
- [ ] 3.6.1 Remove all `setDevices()` calls
- [ ] 3.6.2 Remove all `setUserDisconnectedDevices()` calls
- [ ] 3.6.3 Remove optimistic state updates (actions are fire-and-forget)

## Phase 4: Cleanup
- [ ] 4.1 Delete or deprecate `use-websocket.ts` (keep if needed elsewhere)
- [ ] 4.2 Update any other files importing use-websocket
- [ ] 4.3 Run TypeScript check
- [ ] 4.4 Test full flow: scan -> connect -> sync -> stream -> disconnect

## Phase 5: Verification
- [ ] 5.1 Test reconnection state displays correctly (main bug fix)
- [ ] 5.2 Test device discovery updates UI
- [ ] 5.3 Test streaming without "already running" error
- [ ] 5.4 Test all device card states render properly

---

## Execution Notes

### Key Principle
**Server owns truth. UI reflects. No local mutations.**

### UI Device Mapper
```typescript
function mapToUIDevice(device: BLEDevice): UIDevice {
  return {
    id: device.bleAddress,
    name: device.displayName || device.bleName,
    signalStrength: rssiToSignal(device.rssi),
    batteryPercentage: device.batteryLevel,
    connectionStatus: mapState(device.state),
    isReconnecting: device.state === DeviceState.RECONNECTING,
    reconnectAttempts: device.reconnectAttempts,
  };
}

function rssiToSignal(rssi: number | null): 1 | 2 | 3 | 4 {
  if (!rssi) return 1;
  if (rssi >= -50) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

function mapState(state: DeviceState): UIConnectionStatus {
  switch (state) {
    case DeviceState.CONNECTED:
    case DeviceState.SYNCED:
    case DeviceState.STREAMING:
      return 'connected';
    case DeviceState.CONNECTING:
      return 'connecting';
    case DeviceState.SYNCING:
      return 'synchronizing';
    case DeviceState.RECONNECTING:
      return 'reconnecting';
    case DeviceState.ERROR:
      return 'disabled';
    default:
      return 'disconnected';
  }
}
```

### Stream Check Modification
Change from error to idempotent:
```typescript
// Before (blocks)
if (service.isRecording()) {
  return this.createErrorResponse(message, 'RECORDING_ALREADY_ACTIVE');
}

// After (idempotent - return success)
if (service.isRecording()) {
  return {
    type: MESSAGE_TYPES.RECORD_START_RESPONSE,
    requestId: message.requestId,
    timestamp: Date.now(),
    success: true,
    message: 'Recording already active'
  } as RecordStartResponse;
}
```
