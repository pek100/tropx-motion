# Remove userDisconnectedDevices - Manual Steps

Since backend handles device management via `removeDevice()`, the `userDisconnectedDevices` Set is no longer needed.

## Files to Edit

### File: `electron/renderer/src/App.tsx`

---

**Line 316:** Remove variable declaration
```typescript
// DELETE THIS LINE:
const wasUserDisconnected = userDisconnectedDevices.has(d.id);
```

**Line 326:** Update console.log
```typescript
// CHANGE FROM:
console.log(`🔍 Processing existing device ${d.name}: backend state=${d.state}, UI state=${existing.connectionStatus}, isReconnecting=${d.isReconnecting}, wasUserDisconnected=${wasUserDisconnected}`);

// TO:
console.log(`🔍 Processing existing device ${d.name}: backend state=${d.state}, UI state=${existing.connectionStatus}, isReconnecting=${d.isReconnecting}`);
```

**Lines 328-342:** Remove entire if block checking wasUserDisconnected
```typescript
// DELETE THESE LINES (15 lines total):
// If device was manually disconnected by user, it should have been removed from backend
// If it somehow reconnects, log a warning (shouldn't happen with removeDevice)
if (wasUserDisconnected && (d.state === 'connected' || d.state === 'streaming')) {
  console.warn(`⚠️ User-disconnected device ${d.name} reconnected unexpectedly - this should not happen`);
  // Device was removed from backend but is reconnecting somehow
  // Keep it disconnected in UI but don't fight the backend
  merged.set(d.id, {
    ...existing,
    signalStrength,
    connectionStatus: 'disconnected' as const,
    isReconnecting: false,
    reconnectAttempts: 0,
  });
  return;
}
```

**Line 376:** Update comment and condition
```typescript
// CHANGE FROM:
// If we're in a connecting transition (and NOT user-disconnected), keep it
if (!wasUserDisconnected && (existing.connectionStatus === 'connecting' || existing.connectionStatus === 'synchronizing')) {

// TO:
// If we're in a connecting transition, keep it
if (existing.connectionStatus === 'connecting' || existing.connectionStatus === 'synchronizing') {
```

**Lines 427-435:** Remove wasUserDisconnected check for new devices
```typescript
// DELETE THESE LINES:
// If this is a new device that's already connected, but user previously disconnected it,
// it shouldn't be reconnecting (since we used removeDevice)
if (wasUserDisconnected) {
  console.warn(`⚠️ User-disconnected device ${d.name} appeared as connected - this should not happen`);
  connectionStatus = 'disconnected';
} else {
  connectionStatus = 'connected';
}

// REPLACE WITH:
connectionStatus = 'connected';
```

**Line 456:** Remove comment about user-disconnected
```typescript
// CHANGE FROM:
// Second, keep any connected/connecting devices not in the scan
// (but NOT if they were user-disconnected)

// TO:
// Second, keep any connected/connecting devices not in the scan
```

**Line 470:** Remove from useEffect dependency
```typescript
// CHANGE FROM:
}, [wsDevices, userDisconnectedDevices, isStreaming])

// TO:
}, [wsDevices, isStreaming])
```

**Lines 545-547:** Remove from handleToggleConnection
```typescript
// DELETE THESE LINES:
// User manually disconnecting - use removeDevice to stop backend auto-reconnect
console.log(`🔴 User manually disconnected device: ${device.name} - removing from managed devices`)
setUserDisconnectedDevices((prev) => new Set(prev).add(device.id))
```

**Lines 585-591:** Remove from handleToggleConnection (connect path)
```typescript
// DELETE THESE LINES:
// User manually connecting - remove from userDisconnectedDevices set
console.log(`🟢 User manually connected device: ${device.name}`)
setUserDisconnectedDevices((prev) => {
  const next = new Set(prev)
  next.delete(device.id)
  return next
})
```

**Lines 612-614:** Remove from handleConnectAll
```typescript
// DELETE THESE LINES:
// User wants to connect all - clear the userDisconnectedDevices set
console.log(`🟢 User manually connecting all devices - clearing disconnect list`)
setUserDisconnectedDevices(new Set())
```

**Lines 632-636:** Remove from handleDisconnectAll
```typescript
// DELETE THESE LINES:
// User manually disconnecting all - add all device IDs to userDisconnectedDevices set
const allDeviceIds = sortedDevices.map(d => d.id)
console.log(`🔴 User manually disconnected all devices: ${allDeviceIds.length} devices - removing from managed devices`)
setUserDisconnectedDevices(new Set(allDeviceIds))
```

**Lines 1326-1332:** Remove from onRemove handler in DeviceCard
```typescript
// DELETE THESE LINES:
// Remove from userDisconnectedDevices set
setUserDisconnectedDevices((prev) => {
  const next = new Set(prev)
  next.delete(device.id)
  return next
})
```

---

## After Making Changes

1. Run build to verify no errors:
   ```bash
   npm run build:renderer
   ```

2. Test the application:
   - Refresh page
   - Verify device order persists
   - Verify screen preferences persist
   - Connect devices
   - Disconnect devices
   - Start streaming
   - Refresh during streaming (should see session recovery)

## Expected Behavior

**Before refresh:**
- Devices connected
- Streaming active
- Custom device order

**After refresh:**
- Device order restored ✓
- Screen preferences restored ✓
- Backend auto-reconnects devices ✓
- UI shows reconnection status ✓
- Session recovery prompt shown (if was streaming) ✓
