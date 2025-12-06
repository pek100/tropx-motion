# BLE Layer Rewrite Guide

## Overview

The BLE layer is the most significant rewrite in the React Native migration. The current implementation uses Noble (Node.js) which is incompatible with React Native. The replacement library is `react-native-ble-plx`.

## Library Comparison

| Feature | Noble | react-native-ble-plx |
|---------|-------|---------------------|
| Platform | Node.js | iOS/Android |
| API Style | Event-based | Promise + Subscription |
| Buffer Handling | Node.js Buffer | Base64 strings |
| Scanning | startScanning() | startDeviceScan() |
| Connection | peripheral.connect() | device.connect() |
| Services | discoverAllServicesAndCharacteristics() | discoverAllServicesAndCharacteristics() |
| Notifications | subscribe() | monitorCharacteristic() |

## API Mapping

### Initialization

**Noble (Current)**
```typescript
import noble from '@abandonware/noble';

noble.on('stateChange', (state) => {
  if (state === 'poweredOn') {
    noble.startScanning([SERVICE_UUID], false);
  }
});
```

**react-native-ble-plx (Target)**
```typescript
import { BleManager } from 'react-native-ble-plx';

const manager = new BleManager();

manager.onStateChange((state) => {
  if (state === 'PoweredOn') {
    manager.startDeviceScan([SERVICE_UUID], null, onDeviceDiscovered);
  }
}, true);
```

### Scanning

**Noble (Current)**
```typescript
noble.startScanning([SERVICE_UUID], false);

noble.on('discover', (peripheral) => {
  console.log('Found:', peripheral.advertisement.localName);
});

noble.stopScanning();
```

**react-native-ble-plx (Target)**
```typescript
manager.startDeviceScan(
  [SERVICE_UUID],
  { allowDuplicates: false },
  (error, device) => {
    if (device) {
      console.log('Found:', device.name);
    }
  }
);

manager.stopDeviceScan();
```

### Connection

**Noble (Current)**
```typescript
await peripheral.connectAsync();
await peripheral.discoverAllServicesAndCharacteristicsAsync();

const services = peripheral.services;
const characteristic = services[0].characteristics[0];
```

**react-native-ble-plx (Target)**
```typescript
const connectedDevice = await device.connect();
await connectedDevice.discoverAllServicesAndCharacteristics();

const services = await connectedDevice.services();
const characteristics = await connectedDevice.characteristicsForService(SERVICE_UUID);
```

### Reading Characteristics

**Noble (Current)**
```typescript
const data = await characteristic.readAsync();
const value = data.readUInt8(0);
```

**react-native-ble-plx (Target)**
```typescript
const characteristic = await device.readCharacteristicForService(
  SERVICE_UUID,
  CHARACTERISTIC_UUID
);
const data = Buffer.from(characteristic.value, 'base64');
const value = data.readUInt8(0);
```

### Writing Characteristics

**Noble (Current)**
```typescript
const buffer = Buffer.from([0x01, 0x02, 0x03]);
await characteristic.writeAsync(buffer, false);
```

**react-native-ble-plx (Target)**
```typescript
const base64Data = Buffer.from([0x01, 0x02, 0x03]).toString('base64');
await device.writeCharacteristicWithResponseForService(
  SERVICE_UUID,
  CHARACTERISTIC_UUID,
  base64Data
);
```

### Notifications (Streaming)

**Noble (Current)**
```typescript
await characteristic.subscribeAsync();

characteristic.on('data', (data: Buffer) => {
  const quaternion = parseQuaternion(data);
  onData(quaternion);
});
```

**react-native-ble-plx (Target)**
```typescript
const subscription = device.monitorCharacteristicForService(
  SERVICE_UUID,
  DATA_CHARACTERISTIC_UUID,
  (error, characteristic) => {
    if (characteristic?.value) {
      const data = Buffer.from(characteristic.value, 'base64');
      const quaternion = parseQuaternion(data);
      onData(quaternion);
    }
  }
);

// Later: subscription.remove();
```

## Interface Adaptation

### Current ITransport Interface

```typescript
// ble-bridge/interfaces/ITransport.ts
export interface ITransport extends EventEmitter {
  readonly isInitialized: boolean;
  readonly isScanning: boolean;

  initialize(): Promise<boolean>;
  cleanup(): Promise<void>;
  startScan(): Promise<void>;
  stopScan(): Promise<void>;
  getDiscoveredDevices(): DiscoveredDevice[];
  getPeripheral(deviceId: string): IPeripheral | null;
  forgetPeripheral(deviceId: string): void | Promise<void>;
}
```

### Adapted RN Transport

```typescript
// New: services/RNBleTransport.ts
export interface RNTransportCallbacks {
  onDeviceDiscovered: (device: DiscoveredDevice) => void;
  onScanStarted: () => void;
  onScanStopped: () => void;
  onError: (error: Error) => void;
}

export class RNBleTransport {
  private manager: BleManager;
  private discoveredDevices: Map<string, Device> = new Map();
  private callbacks: RNTransportCallbacks;

  constructor(callbacks: RNTransportCallbacks) {
    this.manager = new BleManager();
    this.callbacks = callbacks;
  }

  async initialize(): Promise<boolean> {
    return new Promise((resolve) => {
      this.manager.onStateChange((state) => {
        resolve(state === 'PoweredOn');
      }, true);
    });
  }

  async cleanup(): Promise<void> {
    this.manager.destroy();
  }

  async startScan(): Promise<void> {
    this.callbacks.onScanStarted();
    this.manager.startDeviceScan(
      [TROPX_SERVICE_UUID],
      null,
      (error, device) => {
        if (error) {
          this.callbacks.onError(error);
          return;
        }
        if (device && device.name?.startsWith('TropX')) {
          this.discoveredDevices.set(device.id, device);
          this.callbacks.onDeviceDiscovered({
            id: device.id,
            name: device.name,
            address: device.id,
            rssi: device.rssi ?? -100,
          });
        }
      }
    );
  }

  async stopScan(): Promise<void> {
    this.manager.stopDeviceScan();
    this.callbacks.onScanStopped();
  }

  getDevice(deviceId: string): Device | null {
    return this.discoveredDevices.get(deviceId) ?? null;
  }
}
```

## Binary Protocol Changes

### Buffer Handling

The `QuaternionBinaryProtocol.ts` uses Node.js Buffer extensively. In React Native, data arrives as base64 strings.

**Current Implementation**
```typescript
export function parseQuaternionPacket(buffer: Buffer): MotionData {
  const timestamp = buffer.readUInt32LE(0);
  const w = buffer.readFloatLE(4);
  const x = buffer.readFloatLE(8);
  const y = buffer.readFloatLE(12);
  const z = buffer.readFloatLE(16);
  return { timestamp, quaternion: { w, x, y, z } };
}
```

**Adapted Implementation**
```typescript
import { Buffer } from 'buffer'; // Install: npm install buffer

export function parseQuaternionPacket(base64Data: string): MotionData {
  const buffer = Buffer.from(base64Data, 'base64');
  const timestamp = buffer.readUInt32LE(0);
  const w = buffer.readFloatLE(4);
  const x = buffer.readFloatLE(8);
  const y = buffer.readFloatLE(12);
  const z = buffer.readFloatLE(16);
  return { timestamp, quaternion: { w, x, y, z } };
}
```

### Command Encoding

**Current (TropXCommands.ts)**
```typescript
export function createSetDateTimeCommand(unixSeconds: number): Buffer {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(CMD_SET_DATETIME, 0);
  buffer.writeUInt32LE(unixSeconds, 1);
  return buffer;
}
```

**Adapted**
```typescript
export function createSetDateTimeCommand(unixSeconds: number): string {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(CMD_SET_DATETIME, 0);
  buffer.writeUInt32LE(unixSeconds, 1);
  return buffer.toString('base64');
}
```

## TropXDevice Rewrite

The `TropXDevice.ts` (1400+ lines) is the core device handler. Key changes:

### State Machine

The `DeviceStateManager.ts` is portable. The device wrapper needs changes:

```typescript
// New: services/RNTropXDevice.ts
export class RNTropXDevice implements TimeSyncDevice {
  private device: Device;
  private dataSubscription: Subscription | null = null;
  private stateManager: DeviceStateManager;

  constructor(device: Device) {
    this.device = device;
    this.stateManager = new DeviceStateManager(device.id);
  }

  async connect(): Promise<void> {
    await this.device.connect();
    await this.device.discoverAllServicesAndCharacteristics();
    this.stateManager.transition('connected');
  }

  async startStreaming(onData: (data: MotionData) => void): Promise<void> {
    this.dataSubscription = this.device.monitorCharacteristicForService(
      TROPX_SERVICE_UUID,
      DATA_CHAR_UUID,
      (error, char) => {
        if (char?.value) {
          const motionData = parseQuaternionPacket(char.value);
          onData(motionData);
        }
      }
    );
    this.stateManager.transition('streaming');
  }

  async stopStreaming(): Promise<void> {
    this.dataSubscription?.remove();
    this.dataSubscription = null;
    this.stateManager.transition('connected');
  }

  async disconnect(): Promise<void> {
    await this.device.cancelConnection();
    this.stateManager.transition('disconnected');
  }

  // TimeSyncDevice interface implementation
  async getDeviceTimestamp(): Promise<number> {
    const char = await this.device.readCharacteristicForService(
      TROPX_SERVICE_UUID,
      TIMESTAMP_CHAR_UUID
    );
    const buffer = Buffer.from(char.value!, 'base64');
    return buffer.readUInt32LE(0);
  }

  async setClockOffset(offsetMs: number): Promise<void> {
    const command = createSetClockOffsetCommand(offsetMs);
    await this.device.writeCharacteristicWithResponseForService(
      TROPX_SERVICE_UUID,
      COMMAND_CHAR_UUID,
      command
    );
  }
}
```

## Permissions Handling

React Native requires explicit BLE permissions on both platforms.

```typescript
// New: services/PermissionsService.ts
import { Platform, PermissionsAndroid } from 'react-native';

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // iOS permissions handled in Info.plist
    return true;
  }

  if (Platform.OS === 'android') {
    const apiLevel = Platform.Version;

    if (apiLevel >= 31) {
      // Android 12+
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      // Android 11 and below
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  }

  return false;
}
```

## Performance Considerations

### 100Hz Streaming

The TropX devices stream quaternion data at 100Hz. Key optimizations:

1. **Avoid GC pressure**: Reuse Buffer objects where possible
2. **Batch state updates**: Don't update React state on every packet
3. **Use InteractionManager**: Defer non-critical updates
4. **Consider worklets**: react-native-reanimated for smooth animations

```typescript
// Batched updates (every 16ms = ~60fps UI updates)
const batchedDataRef = useRef<MotionData[]>([]);
const lastUpdateRef = useRef(0);

const onData = useCallback((data: MotionData) => {
  batchedDataRef.current.push(data);

  const now = Date.now();
  if (now - lastUpdateRef.current >= 16) {
    // Process batch
    const batch = batchedDataRef.current;
    batchedDataRef.current = [];
    lastUpdateRef.current = now;

    // Update UI with latest only
    setLatestData(batch[batch.length - 1]);

    // Send all to motion processing
    batch.forEach(d => motionProcessor.process(d));
  }
}, []);
```

### Background Mode (iOS)

iOS restricts BLE in background. Add to `Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>bluetooth-central</string>
</array>
<key>NSBluetoothAlwaysUsageDescription</key>
<string>TropX Motion needs Bluetooth to connect to motion sensors</string>
```

## Testing Strategy

1. **Unit tests**: Mock `BleManager` for logic testing
2. **Integration tests**: Real device testing required
3. **Performance tests**: Measure data rate, latency, battery impact

```typescript
// Mock for testing
jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    onStateChange: jest.fn((callback) => {
      callback('PoweredOn');
      return { remove: jest.fn() };
    }),
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
  })),
}));
```

## Migration Checklist

- [ ] Install dependencies: `react-native-ble-plx`, `buffer`
- [ ] Configure iOS permissions (Info.plist)
- [ ] Configure Android permissions (AndroidManifest.xml)
- [ ] Create `RNBleTransport` implementing transport interface
- [ ] Create `RNTropXDevice` with connection/streaming logic
- [ ] Adapt `QuaternionBinaryProtocol` for base64
- [ ] Adapt `TropXCommands` for base64
- [ ] Create `PermissionsService` with platform-specific logic
- [ ] Create `useBlePermissions` hook
- [ ] Update `useBLEState` hook for new API
- [ ] Test single device connection
- [ ] Test multi-device connection (4 devices)
- [ ] Test streaming performance (100Hz)
- [ ] Test time synchronization
- [ ] Test background mode (iOS)
- [ ] Battery impact testing
