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

# Feature Decomposition: Unified State Refactor

## Goal
Move all device/BLE state ownership to backend. Renderer becomes pure sync layer.

## Tree Structure

```
Unified State Refactor
├── 1. Backend State Extensions
│   ├── 1.1 Add syncProgress to UnifiedDeviceState ✓ atomic
│   ├── 1.2 Add isVibrating to UnifiedDeviceState ✓ atomic
│   ├── 1.3 Update StateUpdateDevice type ✓ atomic
│   ├── 1.4 Update serializeStateUpdate() ✓ atomic
│   └── 1.5 Update DeviceLocateService to set isVibrating ✓ atomic
│
├── 2. Backend Health Monitoring
│   ├── 2.1 Add WebSocket health check to Watchdog
│   │   ├── 2.1.1 Add clientHealthTimeout config ✓ atomic
│   │   ├── 2.1.2 Track lastMotionDataTime per device ✓ atomic
│   │   └── 2.1.3 Trigger streaming recovery on timeout ✓ atomic
│   └── 2.2 Add health status to STATE_UPDATE ✓ atomic
│
├── 3. Sync Progress Integration
│   ├── 3.1 Update BLEServiceAdapter.syncAllDevices()
│   │   ├── 3.1.1 Set syncProgress on device during sync ✓ atomic
│   │   └── 3.1.2 Clear syncProgress when sync completes ✓ atomic
│   └── 3.2 Remove separate SYNC_PROGRESS event handling ✓ atomic
│
├── 4. Renderer useDevices Refactor
│   ├── 4.1 Remove duplicate state
│   │   ├── 4.1.1 Remove useState<Map> for devices ✓ atomic
│   │   ├── 4.1.2 Remove useState for globalState ✓ atomic
│   │   └── 4.1.3 Use useRef for received state ✓ atomic
│   ├── 4.2 Remove health monitoring
│   │   ├── 4.2.1 Remove healthCheckIntervalRef ✓ atomic
│   │   ├── 4.2.2 Remove lastHealthReconnectRef ✓ atomic
│   │   └── 4.2.3 Remove health check useEffect ✓ atomic
│   ├── 4.3 Simplify event handlers
│   │   ├── 4.3.1 STATE_UPDATE: direct state replacement ✓ atomic
│   │   ├── 4.3.2 Remove SYNC_PROGRESS handler ✓ atomic
│   │   ├── 4.3.3 Remove DEVICE_VIBRATING handler ✓ atomic
│   │   └── 4.3.4 Keep MOTION_DATA handler (local) ✓ atomic
│   └── 4.4 Update derived state
│       ├── 4.4.1 Derive vibratingDeviceIds from devices ✓ atomic
│       ├── 4.4.2 Derive syncProgress from devices ✓ atomic
│       └── 4.4.3 Remove separate syncProgress state ✓ atomic
│
├── 5. Type Synchronization
│   ├── 5.1 Create shared types file ✓ atomic
│   ├── 5.2 Update renderer BLEDevice type ✓ atomic
│   └── 5.3 Ensure type parity backend↔renderer ✓ atomic
│
└── 6. Cleanup & Validation
    ├── 6.1 Remove unused imports ✓ atomic
    ├── 6.2 Build validation ✓ atomic
    └── 6.3 Runtime testing ✓ atomic
```

## Atomic Units (Implementation Order)

### Phase 1: Backend Extensions
1. **1.1** Add `syncProgress: number | null` to UnifiedDeviceState
2. **1.2** Add `isVibrating: boolean` to UnifiedDeviceState
3. **1.3** Update StateUpdateDevice interface to include new fields
4. **1.4** Update `serializeStateUpdate()` to include syncProgress, isVibrating
5. **1.5** Update DeviceLocateService to set `isVibrating` flag on devices

### Phase 2: Sync Progress Integration
6. **3.1.1** In syncAllDevices(), set device.syncProgress during sync
7. **3.1.2** Clear syncProgress when sync completes or fails
8. **3.2** Mark SYNC_PROGRESS event as deprecated (don't remove yet)

### Phase 3: Health Monitoring Migration
9. **2.1.1** Add health monitoring config to BLE_CONFIG.watchdog
10. **2.1.2** Watchdog already tracks lastSeen - verify it works for streaming
11. **2.1.3** Watchdog already has streaming recovery - verify it covers health case
12. **2.2** Add optional `healthStatus` to STATE_UPDATE (future use)

### Phase 4: Renderer Refactor
13. **4.1.1** Remove `useState<Map>` for devices, use direct state from events
14. **4.1.2** Remove `useState` for globalState
15. **4.1.3** Use `useSyncExternalStore` or `useRef` + force update pattern
16. **4.2.1-3** Remove all health monitoring code from useDevices
17. **4.3.1** Simplify STATE_UPDATE handler to direct assignment
18. **4.3.2-3** Remove SYNC_PROGRESS and DEVICE_VIBRATING handlers
19. **4.4.1-3** Derive vibratingDeviceIds and syncProgress from device state

### Phase 5: Types & Cleanup
20. **5.1-3** Ensure type definitions match between backend and renderer
21. **6.1** Remove unused imports
22. **6.2** Build and verify no errors
23. **6.3** Test: scan, connect, sync, stream, locate, reconnect

## Dependencies

```
1.1 ─┬─► 1.3 ─► 1.4
1.2 ─┘

1.5 (independent, after 1.2)

3.1.1 ─► 3.1.2 ─► 3.2

2.1.1 ─► 2.1.2 ─► 2.1.3 ─► 2.2

4.1.* ─► 4.2.* ─► 4.3.* ─► 4.4.*

5.* (after all backend changes)
6.* (after all changes)
```

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing functionality | Incremental changes, test after each phase |
| Type mismatches | Update both sides atomically |
| Performance regression | Keep motion data as separate stream |
| STATE_UPDATE spam | Already debounced at 50ms |
