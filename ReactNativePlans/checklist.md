# React Native Migration Checklist

## Phase 1: Project Setup (2-3 days)

### 1.1 Initialize Project
- [ ] Create new React Native project: `npx react-native init TropXMotion --template react-native-template-typescript`
- [ ] Configure TypeScript with strict mode
- [ ] Set up ESLint + Prettier (match existing config)
- [ ] Initialize Git repository

### 1.2 Install Core Dependencies
- [ ] `react-native-ble-plx` - BLE library
- [ ] `@react-navigation/native` + stack/bottom-tabs
- [ ] `react-native-screens` + `react-native-safe-area-context`
- [ ] `@react-native-async-storage/async-storage`
- [ ] `react-native-svg` + `react-native-svg-transformer`
- [ ] `buffer` - Node.js Buffer polyfill
- [ ] `react-native-device-info` - Device detection
- [ ] `nativewind` (optional) - Tailwind for RN

### 1.3 iOS Configuration
- [ ] Update `Info.plist` with BLE permissions:
  ```xml
  <key>NSBluetoothAlwaysUsageDescription</key>
  <string>TropX Motion needs Bluetooth to connect to motion sensors</string>
  <key>UIBackgroundModes</key>
  <array>
    <string>bluetooth-central</string>
  </array>
  ```
- [ ] Run `pod install` in ios/
- [ ] Test build: `npx react-native run-ios`

### 1.4 Android Configuration
- [ ] Update `AndroidManifest.xml` with BLE permissions:
  ```xml
  <uses-permission android:name="android.permission.BLUETOOTH"/>
  <uses-permission android:name="android.permission.BLUETOOTH_ADMIN"/>
  <uses-permission android:name="android.permission.BLUETOOTH_SCAN"/>
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
  ```
- [ ] Set `minSdkVersion` to 21+
- [ ] Test build: `npx react-native run-android`

### 1.5 Copy Portable Types
- [ ] Copy `ble-bridge/BleBridgeTypes.ts` → `src/types/ble.ts`
- [ ] Copy `ble-bridge/BleBridgeConstants.ts` → `src/constants/ble.ts`
- [ ] Copy `motionProcessing/shared/types.ts` → `src/types/motion.ts`
- [ ] Copy `time-sync/types.ts` → `src/types/timeSync.ts`
- [ ] Verify TypeScript compilation

---

## Phase 2: BLE Layer (5-7 days)

### 2.1 Permissions Service
- [ ] Create `src/services/PermissionsService.ts`
- [ ] Implement Android permission requests (API 31+ vs older)
- [ ] Create `src/hooks/useBlePermissions.ts`
- [ ] Test permission flow on both platforms

### 2.2 BLE Transport
- [ ] Create `src/services/RNBleTransport.ts`
- [ ] Implement `initialize()` - BleManager setup
- [ ] Implement `startScan()` / `stopScan()`
- [ ] Implement device discovery callbacks
- [ ] Test scanning on real device

### 2.3 Binary Protocol Adaptation
- [ ] Adapt `QuaternionBinaryProtocol.ts` for base64
- [ ] Adapt `TropXCommands.ts` for base64
- [ ] Create `src/utils/base64.ts` helper functions
- [ ] Unit test binary parsing

### 2.4 TropX Device Service
- [ ] Create `src/services/RNTropXDevice.ts`
- [ ] Implement `connect()` / `disconnect()`
- [ ] Implement `discoverServices()`
- [ ] Implement command sending (SET_DATETIME, etc.)
- [ ] Implement `startStreaming()` with monitorCharacteristic
- [ ] Test single device connection

### 2.5 Multi-Device Support
- [ ] Create `src/services/BleManager.ts` (singleton)
- [ ] Implement connection queue (port `ConnectionQueue.ts`)
- [ ] Implement device state management (port `DeviceStateManager.ts`)
- [ ] Test 4 simultaneous devices

### 2.6 Time Sync Integration
- [ ] Port `time-sync/OffsetEstimator.ts`
- [ ] Port `time-sync/TimeSyncSession.ts`
- [ ] Port `time-sync/TimeSyncManager.ts`
- [ ] Adapt `TropXTimeSyncAdapter.ts` for RN BLE API
- [ ] Test time sync accuracy

---

## Phase 3: UI Migration (4-6 days)

### 3.1 Navigation Setup
- [ ] Create `src/navigation/RootNavigator.tsx`
- [ ] Create screen stubs:
  - `src/screens/HomeScreen.tsx`
  - `src/screens/DeviceDetailScreen.tsx`
  - `src/screens/SettingsScreen.tsx`
- [ ] Configure stack navigator with modals

### 3.2 UI Profiles (Port)
- [ ] Copy `lib/ui-profiles/types.ts` → `src/lib/ui-profiles/`
- [ ] Adapt `profiles.ts` - add 'mobile', adjust tokens
- [ ] Adapt `matchers.ts` - Platform.OS detection
- [ ] Adapt `persistence.ts` - AsyncStorage
- [ ] Adapt `UIProfileContext.tsx` - async loading
- [ ] Test profile switching

### 3.3 Core Components
- [ ] Migrate `device-card.tsx`:
  - Replace div → View
  - Replace button → TouchableOpacity
  - Convert Tailwind → StyleSheet/NativeWind
- [ ] Migrate `chart-svg.tsx` → react-native-svg
- [ ] Migrate `knee-area-chart.tsx` → react-native-svg
- [ ] Migrate leg visualization SVGs

### 3.4 UI Library Components
- [ ] Create `src/components/ui/Button.tsx`
- [ ] Create `src/components/ui/Card.tsx`
- [ ] Create `src/components/ui/Progress.tsx`
- [ ] Create `src/components/ui/Switch.tsx`
- [ ] Create `src/components/ui/Modal.tsx`
- [ ] (Or use component library: react-native-paper, NativeBase)

### 3.5 Home Screen
- [ ] Port device grid layout
- [ ] Implement device connection controls
- [ ] Implement real-time data display
- [ ] Test with mock data

### 3.6 Profile Selector
- [ ] Migrate `ProfileSelector.tsx` to RN Modal
- [ ] Implement radio button list
- [ ] Connect to UIProfileContext
- [ ] Add settings menu entry

---

## Phase 4: Motion Processing (2-3 days)

### 4.1 Port Core Processing
- [ ] Copy `motionProcessing/shared/` → `src/processing/shared/`
- [ ] Copy `motionProcessing/deviceProcessing/` → `src/processing/device/`
- [ ] Copy `motionProcessing/jointProcessing/` → `src/processing/joint/`
- [ ] Adapt Logger for RN console

### 4.2 Integration
- [ ] Create `src/hooks/useMotionProcessing.ts`
- [ ] Connect BLE data stream to processor
- [ ] Connect processor output to UI
- [ ] Test end-to-end data flow

### 4.3 Performance Optimization
- [ ] Implement data batching (100Hz → 60fps UI)
- [ ] Profile memory usage
- [ ] Test sustained streaming (30+ minutes)

---

## Phase 5: Testing & Polish (2-4 days)

### 5.1 Functional Testing
- [ ] Test: Scan and discover devices
- [ ] Test: Connect to single device
- [ ] Test: Connect to 4 devices simultaneously
- [ ] Test: Stream data at 100Hz
- [ ] Test: Time synchronization accuracy
- [ ] Test: Disconnect and reconnect
- [ ] Test: App backgrounding (iOS)
- [ ] Test: App kill and restart

### 5.2 Performance Testing
- [ ] Measure data latency (target < 10ms)
- [ ] Measure UI frame rate (target 30+ FPS)
- [ ] Measure battery drain (target < 20%/hour)
- [ ] Measure memory usage (no leaks over 1 hour)

### 5.3 Platform-Specific Testing
- [ ] iOS: Test on iPhone 12+ (iOS 15+)
- [ ] iOS: Test on iPad
- [ ] Android: Test on mid-range device (Pixel 4a level)
- [ ] Android: Test on older device (Android 10)

### 5.4 Polish
- [ ] Add loading states for async operations
- [ ] Add error boundaries
- [ ] Add offline indicators
- [ ] Add haptic feedback on connections
- [ ] Add app icon and splash screen

### 5.5 Documentation
- [ ] Update README with RN build instructions
- [ ] Document environment setup
- [ ] Document device pairing procedure
- [ ] Create troubleshooting guide

---

## Post-Migration

### Cleanup
- [ ] Archive Electron-specific files (don't delete yet)
- [ ] Update CI/CD for mobile builds
- [ ] Set up TestFlight (iOS) / Internal Testing (Android)

### Future Considerations
- [ ] Recording to local storage
- [ ] Cloud sync integration
- [ ] Push notifications for device status
- [ ] Apple Watch / Wear OS companion

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| BLE reliability issues | Extensive real-device testing; fallback to sequential connections |
| 100Hz performance | Data batching; consider native module for parsing |
| iOS background mode | Request background BLE permission; document limitations |
| Android fragmentation | Test on 3+ Android versions; min SDK 21 |

---

## Dependencies Summary

```json
{
  "dependencies": {
    "react-native-ble-plx": "^3.1.0",
    "@react-navigation/native": "^6.x",
    "@react-navigation/native-stack": "^6.x",
    "@react-native-async-storage/async-storage": "^1.x",
    "react-native-svg": "^14.x",
    "react-native-safe-area-context": "^4.x",
    "react-native-screens": "^3.x",
    "react-native-device-info": "^10.x",
    "buffer": "^6.x"
  },
  "devDependencies": {
    "react-native-svg-transformer": "^1.x"
  }
}
```
