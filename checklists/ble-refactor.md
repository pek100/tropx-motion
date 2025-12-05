---
id: ble-refactor
tags: [ble, refactor, architecture, transport, critical]
related_files: [
  ble-bridge/interfaces/ITransport.ts,
  ble-bridge/interfaces/IConnectionStrategy.ts,
  ble-bridge/transports/NobleTransport.ts,
  ble-bridge/transports/NodeBleTransport.ts,
  ble-bridge/strategies/ParallelStrategy.ts,
  ble-bridge/strategies/SequentialStrategy.ts,
  ble-bridge/UnifiedBLEService.ts,
  ble-bridge/TropXDevice.ts,
  ble-bridge/PlatformConfig.ts,
  ble-bridge/BleServiceFactory.ts
]
doc: /docs/ble-refactor/README.md
status: planning
last_sync: 2025-12-05
---

# BLE Refactor Checklist

## Phase 1: Interfaces
- [ ] 1.1 Create `ble-bridge/interfaces/ITransport.ts`
  - ITransport: initialize, cleanup, startScan, stopScan, getPeripheral
  - IPeripheral: id, name, state, connect, disconnect, discoverServices, onDisconnect
  - IService: uuid, discoverCharacteristics
  - ICharacteristic: uuid, properties, read, write, subscribe, unsubscribe, on('data')

- [ ] 1.2 Create `ble-bridge/interfaces/IConnectionStrategy.ts`
  - IConnectionStrategy: connect(peripherals[]) → Promise<results[]>

## Phase 2: Transport Implementations
- [ ] 2.1 Create `ble-bridge/transports/NobleTransport.ts`
  - Implements ITransport
  - Wraps @abandonware/noble
  - Event-based discovery
  - NoblePeripheral wrapper for IPeripheral

- [ ] 2.2 Create `ble-bridge/transports/NodeBleTransport.ts`
  - Implements ITransport
  - Wraps node-ble (chrvadala)
  - Polling-based discovery
  - NodeBlePeripheral with GATT retry logic (3 attempts, 200ms delay)
  - Zombie device cleanup on init

## Phase 3: Strategy Implementations
- [ ] 3.1 Create `ble-bridge/strategies/ParallelStrategy.ts`
  - Implements IConnectionStrategy
  - Uses Promise.all for parallel connections
  - For Noble on Windows/macOS

- [ ] 3.2 Create `ble-bridge/strategies/SequentialStrategy.ts`
  - Implements IConnectionStrategy
  - Queue-based sequential connections
  - Uses UnifiedBLEStateStore for state verification
  - 200ms inter-connection delay for BlueZ
  - For node-ble on Linux/Pi

## Phase 4: Core Service
- [ ] 4.1 Create `ble-bridge/UnifiedBLEService.ts`
  - Implements IBleService
  - Constructor takes ITransport + IConnectionStrategy
  - All state via UnifiedBLEStateStore
  - Methods: initialize, cleanup, startScanning, stopScanning,
    connectToDevice(s), disconnectDevice, startGlobalStreaming,
    stopGlobalStreaming, getDeviceInstance, getBatteryLevels, etc.

- [ ] 4.2 Refactor `ble-bridge/TropXDevice.ts`
  - Change constructor to accept IPeripheral (not any)
  - Update connect() to use IPeripheral.connect()
  - Update discoverServices() to use IPeripheral.discoverServices()
  - Remove Noble-specific assumptions
  - Keep all TropX protocol logic unchanged

## Phase 5: Integration
- [ ] 5.1 Create `ble-bridge/PlatformConfig.ts`
  - Platform detection (darwin, win32, linux)
  - Config: transport type, strategy type, timing values

- [ ] 5.2 Update `ble-bridge/BleServiceFactory.ts`
  - Import PlatformConfig
  - Create appropriate transport based on platform
  - Create appropriate strategy based on platform
  - Return new UnifiedBLEService(transport, strategy)

## Phase 6: Cleanup
- [ ] 6.1 Delete deprecated files
  - ble-bridge/NobleBluetoothService.ts
  - ble-bridge/NodeBleService.ts
  - ble-bridge/NodeBleToNobleAdapter.ts
  - ble-bridge/DeviceStateManager.ts
  - ble-bridge/ConnectionQueue.ts

- [ ] 6.2 Update exports in `ble-bridge/index.ts`

## Phase 7: Testing
- [ ] 7.1 Build project (`npm run build`)
- [ ] 7.2 Test on development machine (Noble)
- [ ] 7.3 Test on Raspberry Pi (node-ble)

## Notes

### Critical Implementation Details

**NodeBleTransport GATT handling:**
```typescript
// Device is connected at BLE level before getPeripheral returns
// But GATT server may not be ready immediately
async connect(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await delay(200); // BlueZ stabilization
      this.gattServer = await this.device.gatt();
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await delay(500); // Retry delay
    }
  }
}
```

**SequentialStrategy queue:**
```typescript
// Must wait for actual connected state before proceeding
async connect(peripherals: IPeripheral[]): Promise<Result[]> {
  const results = [];
  for (const p of peripherals) {
    const result = await this.connectSingle(p);
    results.push(result);
    if (result.success) {
      await delay(200); // Inter-connection gap
    }
  }
  return results;
}
```

**State updates:**
```typescript
// All state changes through UnifiedBLEStateStore
const deviceId = UnifiedBLEStateStore.getDeviceIdByAddress(bleAddress);
if (deviceId) {
  UnifiedBLEStateStore.transition(deviceId, DeviceState.CONNECTED);
}
```
