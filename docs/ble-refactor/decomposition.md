---
id: ble-refactor
tags: [ble, refactor, architecture, transport, critical]
related_files: [
  ble-bridge/NobleBluetoothService.ts,
  ble-bridge/NodeBleService.ts,
  ble-bridge/TropXDevice.ts,
  ble-bridge/BleServiceFactory.ts,
  ble-bridge/ConnectionQueue.ts,
  ble-bridge/NodeBleToNobleAdapter.ts,
  ble-bridge/DeviceStateManager.ts,
  ble-management/UnifiedBLEStateStore.ts
]
checklist: /checklists/ble-refactor.md
doc: /docs/ble-refactor/README.md
status: planning
last_sync: 2025-12-05
---

# BLE Refactor Decomposition

## Feature: Unified BLE Service Architecture

```
UnifiedBLEService
├── Transport Layer (ITransport)
│   ├── Interface Definition ✓ atomic
│   │   └── ITransport, IPeripheral, IService, ICharacteristic
│   ├── NobleTransport ✓ atomic
│   │   └── Wraps @abandonware/noble
│   └── NodeBleTransport ✓ atomic
│       └── Wraps node-ble with GATT retry logic
│
├── Connection Strategy (IConnectionStrategy)
│   ├── Interface Definition ✓ atomic
│   ├── ParallelStrategy ✓ atomic
│   │   └── Promise.all for Noble
│   └── SequentialStrategy ✓ atomic
│       └── Queue-based for node-ble, uses UnifiedBLEStateStore
│
├── Unified Service (UnifiedBLEService)
│   ├── Initialization ✓ atomic
│   │   └── Create transport, strategy based on platform
│   ├── Scanning
│   │   ├── Start/Stop Scan ✓ atomic
│   │   └── Device Discovery Handler ✓ atomic
│   ├── Connection Management
│   │   ├── Connect Single Device ✓ atomic
│   │   ├── Connect Multiple Devices ✓ atomic
│   │   └── Disconnect Device ✓ atomic
│   ├── Streaming Management
│   │   ├── Start Global Streaming ✓ atomic
│   │   └── Stop Global Streaming ✓ atomic
│   └── Device Access
│       ├── Get Device Instance ✓ atomic
│       └── Get Battery/State ✓ atomic
│
├── TropXDevice Refactor
│   ├── Accept IPeripheral interface ✓ atomic
│   └── Remove Noble-specific code ✓ atomic
│
├── State Management Consolidation
│   ├── Update ConnectionQueue → UnifiedBLEStateStore ✓ atomic
│   └── Remove DeviceStateManager ✓ atomic
│
├── Platform Configuration
│   └── PlatformConfig with transport/strategy selection ✓ atomic
│
└── Cleanup
    ├── Delete NodeBleToNobleAdapter ✓ atomic
    ├── Delete DeviceStateManager ✓ atomic
    ├── Delete NobleBluetoothService ✓ atomic
    └── Delete NodeBleService ✓ atomic
```

## Atomic Units (Implementation Order)

### Phase 1: Interfaces
1. **ITransport Interface** - Transport abstraction with IPeripheral, IService, ICharacteristic
2. **IConnectionStrategy Interface** - Strategy pattern for connection policies

### Phase 2: Transport Implementations
3. **NobleTransport** - Noble wrapper implementing ITransport
4. **NodeBleTransport** - node-ble wrapper with GATT retry logic

### Phase 3: Strategy Implementations
5. **ParallelStrategy** - Promise.all connections
6. **SequentialStrategy** - Queue-based sequential connections

### Phase 4: Core Service
7. **UnifiedBLEService** - Main service using transport + strategy
8. **TropXDevice Refactor** - Use IPeripheral instead of any

### Phase 5: Integration
9. **PlatformConfig** - Platform detection and configuration
10. **BleServiceFactory Update** - Return UnifiedBLEService

### Phase 6: Cleanup
11. **Delete deprecated files** - NodeBleToNobleAdapter, DeviceStateManager, old services
12. **Update ConnectionQueue** - Use UnifiedBLEStateStore (or remove if embedded in strategy)

## Dependencies Graph

```
ITransport ──────────────────────────────────────┐
    │                                            │
    ├── NobleTransport                           │
    │                                            │
    └── NodeBleTransport                         │
                                                 │
IConnectionStrategy ─────────────────────────────┤
    │                                            │
    ├── ParallelStrategy                         │
    │                                            │
    └── SequentialStrategy ──┬── UnifiedBLEStateStore
                             │
                             │
UnifiedBLEService ───────────┴── TropXDevice ── IPeripheral
         │
         │
BleServiceFactory ── PlatformConfig
```
