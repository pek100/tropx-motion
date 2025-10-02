# Registry Management Module

**Deterministic device identification and registration system for motion capture sensors.**

## Overview

This module implements industry best practices for IoT device registry management, based on:
- Azure IoT Hub (separation of provisioning from runtime operations)
- Bosch IoT Suite (hierarchical namespace patterns)
- BLE cross-platform identifier strategies

## Key Features

✅ **Deterministic Device IDs** - Same device always gets same ID based on name patterns
✅ **Semantic Encoding** - IDs encode joint + position (0x11 = left knee bottom)
✅ **Connection-Time Mapping** - No pattern matching during data processing (100Hz)
✅ **Manual Overrides** - Configure exceptions via file system
✅ **Persistent** - Mappings survive reconnects and app restarts (saved to userData directory)
✅ **Event-Based** - UI updates via onChange handlers

## Architecture

### Device ID Scheme

Single-byte IDs with semantic encoding:

```
0x11 = 0001 0001 = Left knee, bottom sensor (thigh)
0x12 = 0001 0010 = Left knee, top sensor (shin)
0x21 = 0010 0001 = Right knee, bottom sensor (thigh)
0x22 = 0010 0010 = Right knee, top sensor (shin)

Upper nibble (bits 4-7): Joint ID (1=left, 2=right)
Lower nibble (bits 0-3): Position ID (1=bottom, 2=top)
```

### Pattern Matching Rules

Devices are identified by substring matching (case-insensitive):

| Pattern | Device ID | Joint | Position | Description |
|---------|-----------|-------|----------|-------------|
| `ln_bottom` | 0x11 | left-knee | bottom | Left knee thigh sensor |
| `ln_top` | 0x12 | left-knee | top | Left knee shin sensor |
| `rn_bottom` | 0x21 | right-knee | bottom | Right knee thigh sensor |
| `rn_top` | 0x22 | right-knee | top | Right knee shin sensor |

**Legacy devices** (exact name match):
- `muse_v3` → 0x11 (left knee bottom)
- `muse_v3_2` → 0x12 (left knee top)
- `muse_v3_01` → 0x21 (right knee bottom)
- `muse_v3_02` → 0x22 (right knee top)

## Usage

### Basic Registration (Connection Handler)

```typescript
import { deviceRegistry } from './registry-management';

// When device connects
async function onDeviceConnected(bleAddress: string, deviceName: string) {
  const device = deviceRegistry.registerDevice(bleAddress, deviceName);

  if (!device) {
    console.error(`Unknown device: ${deviceName}`);
    return;
  }

  console.log(`Registered: ${deviceName} → ID 0x${device.deviceID.toString(16)}`);
  console.log(`Joint: ${device.joint}, Position: ${device.position}`);
}

// When device disconnects
function onDeviceDisconnected(bleAddress: string) {
  deviceRegistry.unregisterDevice(bleAddress);
}
```

### Runtime Lookups (Data Processing)

```typescript
// Fast O(1) lookup by BLE address
const device = deviceRegistry.getDeviceByAddress(bleAddress);
if (device) {
  processData(device.deviceID, imuData);
}

// Lookup by device name
const device = deviceRegistry.getDeviceByName('tropx_ln_bottom');

// Get all devices for a joint
const leftKneeDevices = deviceRegistry.getDevicesByJoint('left-knee');

// Update last seen (called from data processing)
deviceRegistry.updateLastSeen(bleAddress);
```

### Manual Overrides

```typescript
import { deviceRegistry, DeviceID } from './registry-management';

// Set manual override for unknown device
deviceRegistry.setManualOverride(
  'custom_device_123',
  DeviceID.LEFT_KNEE_BOTTOM,
  'left-knee',
  'bottom'
);

// Remove override
deviceRegistry.removeManualOverride('custom_device_123');
```

### UI Integration

```typescript
// Subscribe to registry changes
const unsubscribe = deviceRegistry.onChange((devices) => {
  console.log(`Registry updated: ${devices.length} devices`);
  updateDeviceList(devices);
});

// Cleanup
unsubscribe();
```

## Files

- **DeviceMappingConfig.ts** - Configuration and device ID definitions
- **DeviceIdentifier.ts** - Pattern matching and identification logic
- **DeviceRegistry.ts** - Central registry with persistence
- **index.ts** - Public API exports

## Configuration

Edit `DeviceMappingConfig.ts` to add new patterns:

```typescript
export const DEVICE_MAPPING_CONFIG = {
  rules: [
    {
      pattern: 'my_custom_sensor',
      deviceID: DeviceID.LEFT_KNEE_BOTTOM,
      joint: 'left-knee',
      position: 'bottom',
      description: 'Custom sensor description'
    },
    // ... more rules
  ]
};
```

## Benefits

### Before (Old System)
- ❌ Pattern matching at 100Hz during processData()
- ❌ Mappings could get "lost" or overridden
- ❌ Regex patterns fragile and hard to debug
- ❌ No persistence across reconnects

### After (Registry System)
- ✅ Pattern matching once at connection time
- ✅ Mappings are deterministic and persistent
- ✅ Simple substring matching (fast and reliable)
- ✅ Survives reconnects with file system persistence (Electron userData directory)

## Performance Impact

- **Eliminated**: 100Hz pattern matching (was called every frame!)
- **Added**: O(1) registry lookups during data processing
- **Result**: Negligible overhead, much more reliable

## Testing

```typescript
// List configured patterns for debugging
import { listConfiguredPatterns } from './registry-management';
console.log(listConfiguredPatterns());

// Validate device ID
import { isValidDeviceID } from './registry-management';
console.log(isValidDeviceID(0x11)); // true
console.log(isValidDeviceID(0xFF)); // false

// Extract info from device ID
import { getJointID, getPositionID, isLeftKnee } from './registry-management';
const deviceID = 0x11;
console.log(getJointID(deviceID)); // 1
console.log(getPositionID(deviceID)); // 1
console.log(isLeftKnee(deviceID)); // true
```

## Future Enhancements

- [ ] UI panel for manual device assignment
- [ ] Export/import configuration
- [ ] Device nickname support
- [ ] Connection quality tracking
- [ ] Device firmware version tracking
