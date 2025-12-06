# File-by-File Migration Mapping

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Direct port (copy with minimal changes) |
| 🔄 | Refactor required |
| ⚠️ | Significant rewrite needed |
| ❌ | Not needed / Delete |
| 📦 | New file required |

---

## 1. BLE Bridge (`ble-bridge/`) - 24 files

**Status: ⚠️ Complete Rewrite**

The entire BLE layer must be rewritten. Noble (Node.js) APIs are incompatible with react-native-ble-plx. However, the interface abstractions can guide the new implementation.

| File | Status | Notes |
|------|--------|-------|
| `BleBridgeTypes.ts` | ✅ | Types are portable (Quaternion, MotionData, DeviceConnectionState) |
| `BleBridgeConstants.ts` | ✅ | UUID constants remain the same |
| `BleLogger.ts` | 🔄 | Replace console with RN logging |
| `interfaces/ITransport.ts` | 🔄 | Remove EventEmitter extends, use callbacks |
| `interfaces/IConnectionStrategy.ts` | ✅ | Interface only |
| `TropXDevice.ts` | ⚠️ | **Major rewrite** - Core device handler |
| `TropXCommands.ts` | 🔄 | Buffer → Base64 encoding |
| `QuaternionBinaryProtocol.ts` | 🔄 | Buffer → Uint8Array |
| `UnifiedBLEService.ts` | ⚠️ | Rewrite with react-native-ble-plx |
| `NobleBluetoothService.ts` | ❌ | Noble-specific, delete |
| `NodeBleService.ts` | ❌ | Node.js-specific, delete |
| `NodeBleToNobleAdapter.ts` | ❌ | Adapter not needed |
| `BLEServiceAdapter.ts` | ⚠️ | Rewrite for RN |
| `BleServiceFactory.ts` | 🔄 | Simplify for single platform |
| `PlatformConfig.ts` | 🔄 | RN platform detection |
| `ConnectionQueue.ts` | ✅ | Pure TypeScript logic |
| `DeviceStateManager.ts` | ✅ | State machine, portable |
| `DeviceLocateService.ts` | 🔄 | Sound API differs in RN |
| `TimeSyncEstimator.ts` | ✅ | Math-only, portable |
| `transports/NobleTransport.ts` | ❌ | Delete |
| `transports/NodeBleTransport.ts` | ❌ | Delete |
| `strategies/SequentialStrategy.ts` | ✅ | Strategy logic portable |
| `strategies/ParallelStrategy.ts` | ✅ | Strategy logic portable |
| `index.ts` | 🔄 | Update exports |

### New Files Required

| File | Purpose |
|------|---------|
| 📦 `RNBleService.ts` | react-native-ble-plx wrapper |
| 📦 `RNBleTransport.ts` | ITransport implementation |
| 📦 `PermissionsManager.ts` | Android/iOS BLE permissions |

---

## 2. Motion Processing (`motionProcessing/`) - 27 files

**Status: ✅ Mostly Portable**

Pure TypeScript math and data processing. Minor adjustments for performance.

| File | Status | Notes |
|------|--------|-------|
| `MotionProcessingConsumer.ts` | ✅ | Direct port |
| `MotionProcessingCoordinator.ts` | ✅ | Direct port |
| **dataProcessing/** | | |
| `AsyncDataParser.ts` | ✅ | Direct port |
| `ChunkingService.ts` | ✅ | Direct port |
| `ServerService.ts` | 🔄 | Fetch API compatible |
| **deviceProcessing/** | | |
| `AsyncInterpolationService.ts` | ✅ | Direct port |
| `DataSyncService.ts` | ✅ | Direct port |
| `InterpolationService.ts` | ✅ | Direct port |
| `DeviceProcessor.ts` | ✅ | Direct port |
| **jointProcessing/** | | |
| `JointProcessor.ts` | ✅ | Direct port |
| `AngleCalculationService.ts` | ✅ | Quaternion math, portable |
| **uiProcessing/** | | |
| `StateManager.ts` | ✅ | Direct port |
| `UIProcessor.ts` | ✅ | Direct port |
| **shared/** | | |
| `types.ts` | ✅ | Direct port |
| `constants.ts` | ✅ | Direct port |
| `config.ts` | ✅ | Direct port |
| `utils.ts` | ✅ | Direct port |
| `cache.ts` | ✅ | Direct port |
| `CircularBuffer.ts` | ✅ | Direct port |
| `Logger.ts` | 🔄 | RN console logging |
| `PerformanceLogger.ts` | 🔄 | RN performance API |
| `AsyncPerformanceMonitor.ts` | 🔄 | RN performance API |
| `QuaternionService.ts` | ✅ | Pure math |
| `JointStatisticsManager.ts` | ✅ | Direct port |
| `ApiClient.ts` | 🔄 | Fetch works, check CORS |
| **hooks/** | | |
| `useMotionProcessing.ts` | ✅ | React hook, portable |
| **tests/** | | |
| `AsyncParserValidation.ts` | ✅ | Test file, portable |

---

## 3. Time Sync (`time-sync/`) - 7 files

**Status: ✅ Fully Portable**

Pure TypeScript logic with no platform dependencies.

| File | Status | Notes |
|------|--------|-------|
| `types.ts` | ✅ | Direct port |
| `constants.ts` | ✅ | Direct port |
| `index.ts` | ✅ | Direct port |
| `OffsetEstimator.ts` | ✅ | Math-only |
| `TimeSyncManager.ts` | ✅ | Direct port |
| `TimeSyncSession.ts` | ✅ | Direct port |
| `adapters/TropXTimeSyncAdapter.ts` | 🔄 | Adjust for new BLE API |

---

## 4. WebSocket Bridge (`websocket-bridge/`) - 18 files

**Status: ❌ Not Needed**

The WebSocket bridge exists because Electron's renderer process cannot access BLE directly. In React Native, BLE is accessed directly from JavaScript.

| File | Status | Notes |
|------|--------|-------|
| All files | ❌ | Architecture not needed in RN |

---

## 5. Renderer Components (`electron/renderer/src/components/`) - 64 files

**Status: 🔄 Refactor Styling**

React components are mostly portable. Main changes:
- CSS → StyleSheet
- className → style prop
- Web-specific elements → RN equivalents

### Core Components

| File | Status | Notes |
|------|--------|-------|
| `App.tsx` | 🔄 | Layout changes, SafeAreaView |
| `device-card.tsx` | 🔄 | TouchableOpacity, StyleSheet |
| `chart-svg.tsx` | 🔄 | react-native-svg |
| `knee-area-chart.tsx` | 🔄 | react-native-svg |
| `leg-above-left-knee.tsx` | 🔄 | react-native-svg |
| `leg-above-right-knee.tsx` | 🔄 | react-native-svg |
| `leg-below-left-knee.tsx` | 🔄 | react-native-svg |
| `leg-below-right-knee.tsx` | 🔄 | react-native-svg |
| `platform-indicator.tsx` | 🔄 | Platform.OS detection |
| `theme-provider.tsx` | 🔄 | RN theming approach |
| `ProfileSelector.tsx` | 🔄 | Modal → RN Modal |

### UI Components (`components/ui/`)

Most shadcn/ui components need replacement with RN equivalents:

| Component | RN Equivalent |
|-----------|---------------|
| `button.tsx` | TouchableOpacity + StyleSheet |
| `card.tsx` | View + StyleSheet |
| `dialog.tsx` | Modal |
| `sheet.tsx` | react-native-bottom-sheet |
| `tabs.tsx` | react-native-tab-view |
| `toast.tsx` | react-native-toast-message |
| `progress.tsx` | Custom or react-native-progress |
| `switch.tsx` | Switch (RN core) |
| `slider.tsx` | @react-native-community/slider |
| `input.tsx` | TextInput |
| Others... | Custom implementations |

### DynamicIsland Components

| File | Status | Notes |
|------|--------|-------|
| `DynamicIsland/DynamicIsland.tsx` | 🔄 | Animated API changes |
| `DynamicIsland/ClientLauncher.tsx` | 🔄 | StyleSheet |
| `DynamicIsland/ClientRegistry.tsx` | 🔄 | StyleSheet |
| `DynamicIsland/index.ts` | ✅ | Direct port |

---

## 6. Renderer Hooks (`electron/renderer/src/hooks/`) - 5 files

**Status: 🔄 Refactor**

| File | Status | Notes |
|------|--------|-------|
| `useBLEState.ts` | ⚠️ | Major rewrite for new BLE API |
| `useDevices.ts` | ⚠️ | Depends on BLE changes |
| `useSensorMap.ts` | 🔄 | Minor adjustments |
| `use-mobile.ts` | ❌ | RN is always mobile |
| `use-toast.ts` | 🔄 | RN toast library |

---

## 7. UI Profiles (`electron/renderer/src/lib/ui-profiles/`) - 6 files

**Status: ✅ Direct Port**

The UI profile system we just built is highly portable.

| File | Status | Notes |
|------|--------|-------|
| `types.ts` | ✅ | Direct port |
| `profiles.ts` | 🔄 | Add 'mobile' profile, remove 'kiosk' |
| `matchers.ts` | 🔄 | Platform.OS detection |
| `persistence.ts` | 🔄 | AsyncStorage instead of localStorage |
| `UIProfileContext.tsx` | ✅ | Direct port |
| `index.ts` | ✅ | Direct port |

---

## 8. TropX WS Client (`electron/renderer/src/lib/tropx-ws-client/`) - 13 files

**Status: ❌ Not Needed**

This client communicates with the WebSocket bridge, which doesn't exist in RN.

| File | Status | Notes |
|------|--------|-------|
| All files | ❌ | Direct BLE access in RN |

---

## 9. Shared Utilities (`shared/`) - 2 files

| File | Status | Notes |
|------|--------|-------|
| `PlatformDetector.ts` | ⚠️ | Rewrite with Platform.OS, DeviceInfo |
| `SerialPortDetector.ts` | ❌ | Not applicable to mobile |

---

## 10. New Files Required

### RN-Specific Infrastructure

| File | Purpose |
|------|---------|
| 📦 `App.tsx` | RN entry point |
| 📦 `navigation/` | React Navigation setup |
| 📦 `screens/` | Screen components |
| 📦 `services/BleManager.ts` | BLE singleton |
| 📦 `services/PermissionsService.ts` | Permission handling |
| 📦 `hooks/useBlePermissions.ts` | Permission hook |
| 📦 `utils/base64.ts` | Binary encoding utilities |

---

## Summary Statistics

| Category | Direct Port | Refactor | Rewrite | Delete | Total |
|----------|-------------|----------|---------|--------|-------|
| ble-bridge | 9 | 6 | 4 | 5 | 24 |
| motionProcessing | 22 | 5 | 0 | 0 | 27 |
| time-sync | 6 | 1 | 0 | 0 | 7 |
| websocket-bridge | 0 | 0 | 0 | 18 | 18 |
| components | 4 | 60 | 0 | 0 | 64 |
| hooks | 0 | 2 | 2 | 1 | 5 |
| ui-profiles | 4 | 2 | 0 | 0 | 6 |
| tropx-ws-client | 0 | 0 | 0 | 13 | 13 |
| shared | 0 | 0 | 1 | 1 | 2 |
| **Total** | **45 (27%)** | **76 (46%)** | **7 (4%)** | **38 (23%)** | **166** |

Plus 7+ new files required for RN infrastructure.
