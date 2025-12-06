# Architecture Changes: Electron to React Native

## Overview

This document outlines the fundamental architectural differences between the Electron and React Native versions of TropX Motion, and how each subsystem needs to adapt.

---

## 1. Process Model

### Electron Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Main Process                             │
│  (Node.js - full system access)                                  │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ BLE Bridge  │  │   Time Sync │  │   Motion    │              │
│  │  (Noble)    │  │   Manager   │  │  Processing │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          │                                       │
│              ┌───────────▼───────────┐                          │
│              │   WebSocket Bridge    │                          │
│              │     (Port 8765)       │                          │
│              └───────────┬───────────┘                          │
└──────────────────────────┼──────────────────────────────────────┘
                           │ WebSocket
┌──────────────────────────┼──────────────────────────────────────┐
│                          ▼                                       │
│              ┌───────────────────────┐                          │
│              │   TropX WS Client     │                          │
│              └───────────┬───────────┘                          │
│                          │                                       │
│  ┌─────────────┐  ┌──────▼──────┐  ┌─────────────┐              │
│  │  UI Profile │  │   Hooks     │  │ Components  │              │
│  │   Context   │  │             │  │             │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│                    Renderer Process                              │
│                 (Chromium - sandboxed)                           │
└──────────────────────────────────────────────────────────────────┘
```

### React Native Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     React Native Application                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    JavaScript Thread                         │ │
│  │                                                              │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │ │
│  │  │  UI Profile │  │   Hooks     │  │ Components  │         │ │
│  │  │   Context   │  │             │  │             │         │ │
│  │  └─────────────┘  └──────┬──────┘  └─────────────┘         │ │
│  │                          │                                   │ │
│  │  ┌─────────────┐  ┌──────▼──────┐  ┌─────────────┐         │ │
│  │  │ BLE Service │  │   Motion    │  │  Time Sync  │         │ │
│  │  │  (JS API)   │  │  Processing │  │   Manager   │         │ │
│  │  └──────┬──────┘  └─────────────┘  └─────────────┘         │ │
│  │         │                                                    │ │
│  └─────────┼────────────────────────────────────────────────────┘ │
│            │ Native Bridge (async)                               │
│  ┌─────────▼─────────────────────────────────────────────────┐  │
│  │                      Native Modules                         │  │
│  │                                                             │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐          │  │
│  │  │ react-native-ble-plx│  │  Platform APIs      │          │  │
│  │  │ (CoreBluetooth/     │  │  (Permissions,      │          │  │
│  │  │  Android BLE)       │  │   Storage, etc.)    │          │  │
│  │  └─────────────────────┘  └─────────────────────┘          │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### Key Differences

| Aspect | Electron | React Native |
|--------|----------|--------------|
| BLE Access | Main process only | JS thread via native bridge |
| IPC | WebSocket | Not needed (direct) |
| Threading | Multi-process | Single JS + Native workers |
| UI Rendering | Chromium | Native views |

---

## 2. Communication Patterns

### Electron: WebSocket Bridge

The renderer process cannot access BLE, so all communication goes through WebSocket:

```typescript
// Renderer: Request scan
wsClient.send({ type: 'ble:startScan' });

// Main process: Handle request
wsBridge.on('ble:startScan', async () => {
  await bleService.startScan();
});

// Main process: Send updates
bleService.on('deviceFound', (device) => {
  wsBridge.broadcast({ type: 'ble:deviceFound', device });
});

// Renderer: Receive updates
wsClient.on('ble:deviceFound', (device) => {
  addDevice(device);
});
```

### React Native: Direct Calls

No bridge needed - BLE is accessible directly:

```typescript
// Direct call to BLE service
const bleService = useBleService();

const handleScan = async () => {
  await bleService.startScan((device) => {
    addDevice(device);
  });
};
```

### Impact

- **Delete**: All of `websocket-bridge/` (18 files)
- **Delete**: All of `tropx-ws-client/` (13 files)
- **Simplify**: Hook implementations (no WebSocket subscriptions)

---

## 3. Styling System

### Electron: Tailwind CSS

```tsx
// Current: Tailwind classes
<div className="flex items-center gap-4 p-4 bg-white rounded-lg shadow-md">
  <button className="px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600">
    Connect
  </button>
</div>
```

### React Native: StyleSheet

```tsx
// Target: StyleSheet
<View style={styles.container}>
  <TouchableOpacity style={styles.button} onPress={onConnect}>
    <Text style={styles.buttonText}>Connect</Text>
  </TouchableOpacity>
</View>

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#3b82f6',
    borderRadius: 4,
  },
  buttonText: {
    color: '#fff',
  },
});
```

### Alternative: NativeWind

Use Tailwind-like syntax with NativeWind:

```tsx
// With NativeWind (Tailwind for RN)
<View className="flex-row items-center gap-4 p-4 bg-white rounded-lg shadow-md">
  <TouchableOpacity className="px-4 py-2 bg-blue-500 rounded">
    <Text className="text-white">Connect</Text>
  </TouchableOpacity>
</View>
```

### Recommendation

Use **NativeWind** to minimize styling changes. The UI profile tokens can remain as-is.

---

## 4. Navigation

### Electron: Single Page + Modals

Current app is single-page with modal overlays:

```tsx
// App.tsx
function App() {
  const [showProfileSelector, setShowProfileSelector] = useState(false);

  return (
    <div>
      <MainContent />
      {showProfileSelector && <ProfileSelector onClose={() => setShowProfileSelector(false)} />}
    </div>
  );
}
```

### React Native: React Navigation

Multi-screen with stack/tab navigation:

```tsx
// App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

const Stack = createNativeStackNavigator();

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen
          name="ProfileSelector"
          component={ProfileSelectorScreen}
          options={{ presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### Screen Structure

```
screens/
├── HomeScreen.tsx          # Main device dashboard
├── DeviceDetailScreen.tsx  # Single device view
├── SettingsScreen.tsx      # App settings
├── ProfileSelectorScreen.tsx # UI profile picker
└── RecordingScreen.tsx     # Recording session
```

---

## 5. Platform Detection

### Electron: PlatformDetector

Reads `/proc/device-tree/model` for Raspberry Pi detection:

```typescript
// shared/PlatformDetector.ts
if (fs.existsSync('/proc/device-tree/model')) {
  const model = fs.readFileSync('/proc/device-tree/model');
  if (model.includes('Raspberry Pi')) {
    isRaspberryPi = true;
  }
}
```

### React Native: Platform API

Much simpler - just iOS or Android:

```typescript
// lib/ui-profiles/matchers.ts (adapted)
import { Platform, Dimensions } from 'react-native';
import DeviceInfo from 'react-native-device-info';

export async function buildDetectionContext(): Promise<DetectionContext> {
  const { width, height } = Dimensions.get('window');

  return {
    platform: Platform.OS,               // 'ios' | 'android'
    isTablet: DeviceInfo.isTablet(),
    windowWidth: width,
    windowHeight: height,
    isRaspberryPi: false,                // Never on mobile
  };
}
```

### UI Profile Updates

```typescript
// profiles.ts - Add mobile profile, remove kiosk
export const PROFILES: Record<ProfileId, UIProfile> = {
  mobile: {
    id: 'mobile',
    label: 'Mobile',
    layout: { mode: 'split', showHeader: true, showBorders: false, fullscreen: false },
    spacing: { /* mobile-optimized */ },
    sizing: { touchTarget: '48px', /* ... */ },
    features: { textLabels: true, dynamicIsland: false, animations: true, tooltips: false },
  },
  tablet: { /* existing */ },
  desktop: { /* existing - for potential future desktop RN */ },
};

// matchers.ts - Simplified for mobile
export const PROFILE_MATCHERS: ProfileMatcher[] = [
  { profile: 'tablet', conditions: { isTablet: true }, priority: 100 },
  // Default to 'mobile' for phones
];
```

---

## 6. Storage

### Electron: localStorage

```typescript
// persistence.ts
localStorage.setItem('tropx_ui_profile_override', JSON.stringify(profileId));
const stored = localStorage.getItem('tropx_ui_profile_override');
```

### React Native: AsyncStorage

```typescript
// persistence.ts (adapted)
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function setStoredOverride(profileId: ProfileId | null): Promise<void> {
  if (profileId === null) {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profileId));
  }
}

export async function getStoredOverride(): Promise<ProfileId | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  // ... validation
}
```

### Impact

All persistence functions become `async`. Context initialization needs to handle loading state:

```typescript
// UIProfileContext.tsx (adapted)
const [isLoading, setIsLoading] = useState(true);

useEffect(() => {
  const init = async () => {
    const storedOverride = await getStoredOverride();
    setOverrideState(storedOverride);
    setIsLoading(false);
  };
  init();
}, []);

if (isLoading) {
  return <LoadingScreen />;
}
```

---

## 7. SVG Handling

### Electron: Native SVG

```tsx
// chart-svg.tsx
<svg xmlns="http://www.w3.org/2000/svg" width="423" height="287" fill="none">
  <path d="M20 42c15 16..." />
</svg>
```

### React Native: react-native-svg

```tsx
// chart-svg.tsx (adapted)
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

<Svg width={423} height={287} viewBox="0 0 423 287">
  <Path d="M20 42c15 16..." fill="url(#a)" />
  <Defs>
    <LinearGradient id="a" x1="124" y1="74.2" x2="228.6" y2="203">
      <Stop stopColor="#FF4D4D" stopOpacity={0.8} />
      <Stop offset={1} stopColor="#FF4D4D" stopOpacity={0.1} />
    </LinearGradient>
  </Defs>
</Svg>
```

### Conversion Tool

Use `react-native-svg-transformer` to import `.svg` files directly.

---

## 8. Event Handling

### Electron: DOM Events

```typescript
// Current: Keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'R') {
      setShowProfileSelector(true);
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);
```

### React Native: No Keyboard Shortcuts

Mobile apps don't have keyboard shortcuts. Replace with:

1. **Menu button** in header
2. **Long press** gestures
3. **Shake to open** (dev menu pattern)

```typescript
// Settings accessible via header button
<Stack.Screen
  name="Home"
  component={HomeScreen}
  options={{
    headerRight: () => (
      <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
        <Icon name="settings" />
      </TouchableOpacity>
    ),
  }}
/>
```

---

## 9. Development Workflow

| Aspect | Electron | React Native |
|--------|----------|--------------|
| Dev server | Vite (hot reload) | Metro (hot reload) |
| Debugging | Chrome DevTools | Flipper / Chrome |
| Building | electron-builder | Xcode / Android Studio |
| Testing devices | USB + Noble | Real device required |

### BLE Development Note

Both platforms require **real physical devices** for BLE testing. Simulators/emulators do not support BLE.

---

## Summary of Architectural Changes

1. **Eliminate IPC layer**: WebSocket bridge not needed
2. **Direct BLE access**: Simpler data flow
3. **StyleSheet/NativeWind**: CSS-in-JS adaptation
4. **React Navigation**: Multi-screen architecture
5. **AsyncStorage**: Async persistence everywhere
6. **react-native-svg**: SVG component conversion
7. **No keyboard shortcuts**: Touch/menu-based UI
8. **Simpler platform detection**: iOS vs Android only
