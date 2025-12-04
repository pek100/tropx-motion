---
id: unified-state-refactor
tags: [state-management, architecture, websocket, ble, refactor, critical]
related_files:
  - ble-management/types.ts
  - ble-management/UnifiedBLEStateStore.ts
  - ble-management/Watchdog.ts
  - electron/renderer/src/hooks/useDevices.ts
  - websocket-bridge/processors/BLEDomainProcessor.ts
  - ble-bridge/BLEServiceAdapter.ts
  - ble-bridge/DeviceLocateService.ts
checklist: /checklists/unified-state-refactor.md
doc: /docs/unified-state-refactor/README.md
status: in-progress
last_sync: 2025-12-03
---

# Unified State Refactor - Implementation Checklist

## Phase 1: Backend State Extensions
> Tree ref: 1.*

- [ ] **1.1** Add `syncProgress: number | null` to `UnifiedDeviceState` in `types.ts`
- [ ] **1.2** Add `isVibrating: boolean` to `UnifiedDeviceState` in `types.ts`
- [ ] **1.3** Update `StateUpdateDevice` interface to include new fields
- [ ] **1.4** Update `DEFAULT_DEVICE_STATE` with new field defaults
- [ ] **1.5** Update `serializeStateUpdate()` in `UnifiedBLEStateStore.ts`
- [ ] **1.6** Update `DeviceLocateService` to set `isVibrating` via store

**Verify:** Build passes after Phase 1

---

## Phase 2: Sync Progress Integration
> Tree ref: 3.*

- [ ] **2.1** In `BLEServiceAdapter.syncAllDevices()`: set `syncProgress` on device during sync
- [ ] **2.2** Update sync progress as samples are collected (0-100%)
- [ ] **2.3** Clear `syncProgress` (set to null) when sync completes or fails
- [ ] **2.4** Deprecate separate `SYNC_PROGRESS` event (add comment, keep for compatibility)

**Verify:** Sync shows progress via STATE_UPDATE

---

## Phase 3: Verify Health Monitoring Coverage
> Tree ref: 2.*

- [ ] **3.1** Verify `Watchdog` tracks `lastSeen` for streaming devices
- [ ] **3.2** Verify `Watchdog` triggers streaming recovery on data timeout
- [ ] **3.3** Confirm renderer health check is redundant (can be removed)

**Verify:** Streaming recovery works without renderer health check

---

## Phase 4: Renderer useDevices Refactor
> Tree ref: 4.*

### 4A: Remove Duplicate State
- [ ] **4.1** Remove `useState<Map>` for devices
- [ ] **4.2** Remove `useState` for globalState
- [ ] **4.3** Create `stateRef = useRef<{devices, globalState}>()` for received state
- [ ] **4.4** Add `forceUpdate` mechanism for re-renders on state change

### 4B: Remove Health Monitoring
- [ ] **4.5** Remove `healthCheckIntervalRef`
- [ ] **4.6** Remove `lastHealthReconnectRef`
- [ ] **4.7** Remove health check `useEffect` block (lines ~466-499)
- [ ] **4.8** Remove `lastMotionDataTimeRef` (no longer needed for health)

### 4C: Simplify Event Handlers
- [ ] **4.9** STATE_UPDATE handler: direct assignment to `stateRef.current`
- [ ] **4.10** Remove separate `syncProgress` state and SYNC_PROGRESS handler
- [ ] **4.11** Remove separate `vibratingDeviceIds` state and DEVICE_VIBRATING handler
- [ ] **4.12** Keep MOTION_DATA handler (local state for rendering)
- [ ] **4.13** Keep CLIENT_LIST_UPDATE handler

### 4D: Update Derived State
- [ ] **4.14** Derive `vibratingDeviceIds` from devices via useMemo
- [ ] **4.15** Derive `syncProgress` from devices via useMemo
- [ ] **4.16** Update all useMemo dependencies

**Verify:** UI renders correctly from STATE_UPDATE

---

## Phase 5: Type Synchronization
> Tree ref: 5.*

- [ ] **5.1** Ensure `BLEDevice` type in renderer matches `StateUpdateDevice`
- [ ] **5.2** Add `syncProgress` and `isVibrating` to renderer types
- [ ] **5.3** Update `convertRawToDevice()` mapper for new fields
- [ ] **5.4** Update `mapToUIDevice()` if needed

**Verify:** No TypeScript errors

---

## Phase 6: Cleanup & Validation
> Tree ref: 6.*

- [ ] **6.1** Remove unused imports from useDevices.ts
- [ ] **6.2** Run `npm run build:renderer` - no errors
- [ ] **6.3** Run `npx tsc --noEmit --project tsconfig.main.json` - no errors
- [ ] **6.4** Test: Device scanning
- [ ] **6.5** Test: Device connection
- [ ] **6.6** Test: Time sync (verify progress shows)
- [ ] **6.7** Test: Streaming start/stop
- [ ] **6.8** Test: Locate mode (verify vibrating indicators)
- [ ] **6.9** Test: Reconnection on disconnect
- [ ] **6.10** Test: Multiple windows (if applicable)

---

## Rollback Plan

If issues arise:
1. Revert renderer changes (git checkout useDevices.ts)
2. Backend changes are additive (new fields), safe to keep
3. Renderer can fall back to useState pattern

---

## Notes

- Motion data stays as high-frequency local stream (performance)
- STATE_UPDATE already debounced at 50ms
- Backend Watchdog already handles streaming recovery
- This refactor mostly removes code from renderer
