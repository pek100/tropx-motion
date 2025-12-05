---
id: ble-refactor
tags: [ble, refactor, architecture, transport, critical]
related_files: [
  ble-bridge/NobleBluetoothService.ts,
  ble-bridge/NodeBleService.ts,
  ble-bridge/TropXDevice.ts,
  ble-bridge/BleServiceFactory.ts
]
checklist: /checklists/ble-refactor.md
status: planning
last_sync: 2025-12-05
---

# BLE Service Architecture Refactor

## Overview

Refactor BLE implementation from two separate services (Noble + node-ble) into a single `UnifiedBLEService` with platform-specific transports.

## Problem Statement

1. **Duplicate state management** - `DeviceStateManager` vs `UnifiedBLEStateStore`
2. **Leaky abstraction** - `NodeBleToNobleAdapter` tries to fake Noble behavior
3. **Different connection flows** - Not properly abstracted
4. **Code duplication** - Two services with similar logic

## Solution

Single `UnifiedBLEService` with:
- **ITransport** - Platform-specific BLE operations
- **IConnectionStrategy** - Parallel (Noble) vs Sequential (node-ble)
- **UnifiedBLEStateStore** - Single source of truth for all state

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BLEServiceAdapter                        │
│              (WebSocket, orchestration)                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                      IBleService                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  UnifiedBLEService                          │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │ ITransport  │  │IConnectionStrategy│  │ StateStore    │   │
│  └──────┬──────┘  └────────┬─────────┘  └───────────────┘   │
└─────────┼──────────────────┼────────────────────────────────┘
          │                  │
    ┌─────┴─────┐      ┌─────┴─────┐
    │           │      │           │
┌───▼───┐  ┌────▼────┐ ▼           ▼
│Noble  │  │NodeBle  │ Parallel  Sequential
│Trans. │  │Trans.   │ Strategy  Strategy
└───────┘  └─────────┘
```

## File Structure (After Refactor)

```
ble-bridge/
├── interfaces/
│   ├── ITransport.ts        <- ITransport, IPeripheral, IService, ICharacteristic
│   └── IConnectionStrategy.ts
├── transports/
│   ├── NobleTransport.ts
│   └── NodeBleTransport.ts
├── strategies/
│   ├── ParallelStrategy.ts
│   └── SequentialStrategy.ts
├── UnifiedBLEService.ts     <- Main service (replaces Noble/NodeBle services)
├── TropXDevice.ts           <- Refactored to use IPeripheral
├── PlatformConfig.ts        <- Platform detection and config
├── BleServiceFactory.ts     <- Updated to return UnifiedBLEService
├── BLEServiceAdapter.ts     <- Unchanged
└── ... (other unchanged files)

DELETED:
├── NobleBluetoothService.ts
├── NodeBleService.ts
├── NodeBleToNobleAdapter.ts
├── DeviceStateManager.ts
└── ConnectionQueue.ts       <- Logic moved to SequentialStrategy
```

## API Compatibility

| Component | Changes |
|-----------|---------|
| BLEServiceAdapter | None |
| IBleService | None |
| WebSocket messages | None |
| Renderer/UI | None |

## Status

- [x] Analysis complete
- [x] Decomposition complete
- [ ] Implementation
- [ ] Testing
- [ ] Cleanup
