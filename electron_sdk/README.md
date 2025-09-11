# Electron BLE SDK

This SDK provides a unified interface for Bluetooth Low Energy (BLE) operations in the TropxMotion Electron application.

## Architecture

The Electron BLE SDK sits between the UI layer and the underlying systems, providing:

- **Unified API**: Single interface for all BLE operations  
- **State Management**: Centralized device state across all systems
- **Error Handling**: Consistent error propagation and recovery
- **Platform Abstraction**: Clean separation between Electron-specific and Web Bluetooth logic

## Components

### Core Classes

- **ElectronBLEManager**: Main facade providing unified BLE operations
- **ElectronDeviceRegistry**: Centralized device state management  
- **ElectronIPCHandler**: Abstraction over Electron IPC communication

### Integration

The SDK coordinates between:
- **MuseManager**: Pure Web Bluetooth GATT operations
- **Electron Main Process**: Native device discovery and IPC  
- **React UI**: State synchronization and user interactions
- **WebSocket**: Real-time communication and data streaming

## Migration Status

This SDK is being built incrementally to replace scattered BLE logic:

- [x] Phase 1: Foundation structure and types
- [ ] Phase 2: ElectronDeviceRegistry implementation
- [ ] Phase 3: ElectronIPCHandler implementation  
- [ ] Phase 4: ElectronBLEManager facade
- [ ] Phase 5: UI migration (scan → connect → record)
- [ ] Phase 6: Cleanup of old systems

## Usage

```typescript
import { ElectronBLEManager } from './electron_sdk';

// Initialize the manager
const bleManager = new ElectronBLEManager();

// Scan for devices
const scanResult = await bleManager.scanDevices();

// Connect to a device
const connectResult = await bleManager.connectDevice(deviceId, deviceName);

// Start recording
const recordResult = await bleManager.startRecording({
  sessionId: 'session_123',
  exerciseId: 'exercise_456', 
  setNumber: 1
});
```

## Safety

Each phase of the migration includes:
- **Feature flags** for safe rollout
- **Parallel systems** to prevent breaking changes  
- **Git commit points** for easy rollback
- **Build verification** after every change