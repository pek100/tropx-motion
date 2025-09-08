# Breaking Changes - TropxMotion Refactoring

## Overview
This document outlines all breaking changes introduced during the comprehensive refactoring of WebSocket, Bluetooth, and Electron components in the TropxMotion application.

## Summary of Changes
- **Date**: [Current Date]
- **Scope**: WebSocket services, Bluetooth connectivity, Electron IPC, and type systems
- **Impact**: Major refactoring with improved performance and maintainability

---

## 1. Configuration System Changes

### BREAKING CHANGE: Centralized Configuration
- **File**: `electron/shared/config.ts` (NEW)
- **Impact**: All hardcoded constants moved to centralized configuration

#### Before:
```typescript
const WS_PORT = 8080;
const HEARTBEAT_INTERVAL = 30000;
// Scattered throughout codebase
```

#### After:
```typescript
import { CONFIG } from '../shared/config';
const port = CONFIG.WEBSOCKET.DEFAULT_PORT;
const interval = CONFIG.WEBSOCKET.HEARTBEAT_INTERVAL;
```

#### Migration Required:
- Replace all hardcoded constants with `CONFIG.*` imports
- Update imports to use `electron/shared/config`

---

## 2. WebSocket Service Architecture

### BREAKING CHANGE: Service Separation
- **Files**: 
  - `electron/main/services/WebSocketService.ts` (NEW)
  - `electron/main/services/DataBroadcastService.ts` (NEW)
  - `electron/main/services/MotionService.ts` (NEW, replaces ElectronMotionService)

#### Before:
```typescript
import { ElectronMotionService } from './services/ElectronMotionService';
```

#### After:
```typescript
import { MotionService } from './services/MotionService';
```

#### Migration Required:
- Replace `ElectronMotionService` with `MotionService`
- Update WebSocket message handling to use new service architecture

---

## 3. Type System Changes

### BREAKING CHANGE: Shared Type Definitions
- **File**: `electron/shared/types.ts` (NEW)
- **Impact**: All interfaces moved to shared types module

#### Before:
```typescript
import { WSMessageType } from './types/websocket';
interface WSMessage { /* local definition */ }
```

#### After:
```typescript
import { MESSAGE_TYPES, WSMessage } from '../shared/config';
import { WSMessage } from '../shared/types';
```

#### Migration Required:
- Update all type imports to use `electron/shared/types`
- Replace `WSMessageType` enum with `MESSAGE_TYPES` constants

---

## 4. Bluetooth Service Changes

### BREAKING CHANGE: Removed PowerShell Fallbacks
- **Files Removed**:
  - `electron/main/utils/BluetoothScan.ts`
  - `electron/main/utils/BluetoothFallback.ts`

#### Before:
```typescript
import { BluetoothScan } from './utils/BluetoothScan';
import { BluetoothFallback } from './utils/BluetoothFallback';
```

#### After:
```typescript
import { BluetoothService } from './services/BluetoothService';
// Web Bluetooth only - no fallbacks
```

#### Migration Required:
- Remove all references to PowerShell-based Bluetooth services
- Use only Web Bluetooth API through `BluetoothService`

### BREAKING CHANGE: Bluetooth Service API
- **File**: `electron/main/services/BluetoothService.ts` (NEW)

#### Before:
```typescript
// Multiple scattered Bluetooth handlers
webContents.on('select-bluetooth-device', ...);
// Direct PowerShell execution
```

#### After:
```typescript
const bluetoothService = new BluetoothService();
bluetoothService.initialize(webContents);
bluetoothService.selectDevice(deviceId);
```

#### Migration Required:
- Replace direct Bluetooth event handlers with service calls
- Update device selection logic to use service methods

---

## 5. IPC Handler Changes

### BREAKING CHANGE: Preload API Types
- **File**: `electron/preload/preload.ts`
- **Impact**: Stronger typing for IPC communications

#### Before:
```typescript
startRecording: (sessionData: any) => Promise<{ success: boolean; message: string; recordingId?: string }>;
```

#### After:
```typescript
startRecording: (sessionData: RecordingSession) => Promise<RecordingResponse>;
```

#### Migration Required:
- Update renderer code to use proper types
- Replace `any` types with specific interfaces

### BREAKING CHANGE: Removed IPC Handlers
- **Removed**:
  - `bluetooth:scanEnhanced` - No longer needed without PowerShell
  - Enhanced scan functionality removed

#### Migration Required:
- Remove calls to `bluetooth:scanEnhanced`
- Use standard `motion:scanDevices` instead

---

## 6. Main Process Architecture

### BREAKING CHANGE: Main Process Refactoring
- **Files**:
  - `electron/main/MainProcess.ts` (NEW)
  - `electron/main/main.ts` (SIMPLIFIED)

#### Before:
```typescript
class ElectronApp {
  private mainWindow: BrowserWindow | null = null;
  private motionService: ElectronMotionService;
  // Large class with mixed responsibilities
}
```

#### After:
```typescript
import { MainProcess } from './MainProcess';
new MainProcess();
```

#### Migration Required:
- No direct migration needed - internal refactoring
- External interfaces remain compatible

---

## 7. Message Type Constants

### BREAKING CHANGE: Message Type System
- **Impact**: Enum replaced with const object

#### Before:
```typescript
export enum WSMessageType {
    HEARTBEAT = 'heartbeat',
    // ...
}
```

#### After:
```typescript
export const MESSAGE_TYPES = {
    HEARTBEAT: 'heartbeat',
    // ...
} as const;
```

#### Migration Required:
- Replace `WSMessageType.HEARTBEAT` with `MESSAGE_TYPES.HEARTBEAT`
- Update imports to use new constants

---

## Migration Checklist

### For Existing Components:

1. **Update Imports**:
   ```typescript
   // Replace these imports:
   import { WSMessageType } from './types/websocket';
   
   // With these:
   import { MESSAGE_TYPES } from '../shared/config';
   import { WSMessage } from '../shared/types';
   ```

2. **Replace Configuration**:
   ```typescript
   // Replace hardcoded values:
   const port = 8080;
   
   // With configuration:
   import { CONFIG } from '../shared/config';
   const port = CONFIG.WEBSOCKET.DEFAULT_PORT;
   ```

3. **Update Service Usage**:
   ```typescript
   // Replace:
   new ElectronMotionService()
   
   // With:
   new MotionService()
   ```

4. **Remove PowerShell References**:
   - Remove all imports from `BluetoothScan` and `BluetoothFallback`
   - Remove calls to PowerShell-based methods

### For New Development:
- Always import from `electron/shared/config` and `electron/shared/types`
- Use the new service architecture
- Follow the established patterns in the refactored code

---

## Validation Steps Completed

✅ All service integrations tested
✅ Type compatibility verified
✅ IPC communication flow validated  
✅ WebSocket message protocol maintained
✅ Bluetooth device discovery working
✅ Motion processing pipeline intact
✅ Recording functionality preserved

---

## Notes

- **Backward Compatibility**: The `electron/main/types/websocket.ts` file maintains backward compatibility by re-exporting shared types
- **Performance Impact**: New architecture provides better performance through separation of concerns
- **Maintenance**: Code is now more maintainable with centralized configuration and clear service boundaries

## Support

For questions about these changes or migration assistance, refer to the service documentation in the respective service files.