# BLE Interaction Flow Map - TropxMotion App

This document maps out the complete Bluetooth Low Energy (BLE) interaction flow in the TropxMotion application, tracking every operation, function call, and state change for each user action.

## Architecture Overview

The application uses a hybrid approach combining:
- **Electron Main Process**: Device discovery and WebSocket management
- **Web Bluetooth API**: Device pairing and GATT operations  
- **MuseManager (SDK)**: Device connection management and data streaming
- **React Renderer**: UI state management and user interactions

## Flow Maps

### 1. SCAN BUTTON CLICK FLOW

**UI Component**: `DeviceManagementPane` → Line 513 → `onScan={handleScan}`

#### Step-by-Step Flow:

**1.1 Initial UI Handler** (`ElectronMotionApp.tsx:1305`)
```typescript
const handleScan = async () => {
  // Prevent multiple simultaneous scans
  if (state.isScanning) return;
  
  // Enforce cooldown period (3000ms)
  const now = Date.now();
  if (now - lastScanTimeRef.current < SCAN_COOLDOWN) return;
  
  // Set scanning state
  dispatch({ type: "SET_SCANNING", payload: true });
}
```

**1.2 Web Bluetooth Request** (`ElectronMotionApp.tsx:1331`)
```typescript
// Race between Bluetooth scan and timeout (5000ms)
await Promise.race([
  navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
  }),
  timeoutPromise,
]);
```

**1.3 Electron Main Process Device Selection** (`BluetoothService.ts:145`)
```typescript
webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
  event.preventDefault();
  const validDevices = this.filterValidDevices(deviceList);
  this.deviceCallback = callback;
  
  // Convert to DeviceInfo format and store
  devices.forEach(device => {
    this.discoveredDevices.set(device.id, device);
  });
});
```

**1.4 WebSocket Message Processing** (`ElectronMotionApp.tsx:1236`)
```typescript
case "device_scan_result": {
  const devices = data.devices || [];
  
  // Add new devices to MuseManager registry
  const newDevices = devices.filter(device => !state.allDevices.has(device.id));
  if (newDevices.length > 0) {
    museManager.addScannedDevices(newDevices.map(device => ({
      deviceId: device.id,
      deviceName: device.name,
    })));
  }
  
  // Update state for each device
  devices.forEach((device: DeviceInfo) => {
    const deviceState: DeviceStateMachine = {
      id: device.id,
      name: device.name,
      state: "discovered",
      batteryLevel: device.batteryLevel || null,
      lastSeen: new Date(),
    };
    dispatch({ type: "SET_DEVICE_STATE", payload: { deviceId: device.id, device: deviceState } });
  });
  
  dispatch({ type: "SET_SCANNING", payload: false });
}
```

**1.5 MuseManager Registry Update** (`MuseManager.ts:335`)
```typescript
addScannedDevices(devices: Array<{deviceId: string, deviceName: string}>): void {
  devices.forEach((device) => {
    const bluetoothDevice: BluetoothDevice = {
      id: device.deviceId,
      name: device.deviceName,
      gatt: undefined // Will be acquired from Web Bluetooth when connecting
    };
    this.scannedDevices.set(device.deviceName, bluetoothDevice);
  });
}
```

### 2. CONNECT BUTTON CLICK FLOW

**UI Component**: `DeviceManagementPane` → Line 663 → `onConnectDevice={handleConnectDevice}`

#### Step-by-Step Flow:

**2.1 Initial Connection Handler** (`ElectronMotionApp.tsx:1367`)
```typescript
const handleConnectDevice = async (deviceId: string, deviceName: string) => {
  // Safety check: Prevent multiple simultaneous connection attempts
  const currentDevice = state.allDevices.get(deviceId);
  if (currentDevice?.state === "connecting") return;
  
  // Set device to connecting state
  dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "connecting" } } });
}
```

**2.2 Web Bluetooth Device Acquisition** (`ElectronMotionApp.tsx:1383`)
```typescript
// Kick off requestDevice FIRST to trigger select-bluetooth-device event in main
const requestPromise = navigator.bluetooth.requestDevice({
  acceptAllDevices: true,
  optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
});

// Immediately instruct main process to select our target deviceId
await window.electronAPI?.bluetooth?.selectDevice(deviceId);

// Await the actual BluetoothDevice returned from requestDevice
let webBtDevice: any = null;
webBtDevice = (await requestPromise) as any;
```

**2.3 BluetoothService Device Selection** (`BluetoothService.ts:45`)
```typescript
selectDevice(deviceId: string): ApiResponse {
  if (!this.deviceCallback) {
    return { success: false, message: 'No pending device selection' };
  }
  
  try {
    this.deviceCallback(deviceId);
    this.deviceCallback = null;
    return { success: true, message: 'Device selected successfully' };
  } catch (error) {
    return { success: false, message: `Device selection failed: ${error.message}` };
  }
}
```

**2.4 MuseManager Connection Attempts** (`ElectronMotionApp.tsx:1410`)
```typescript
// Preferred: If we obtained a Web Bluetooth device from requestDevice
if (webBtDevice) {
  connected = await museManager.connectWebBluetoothDevice(
    webBtDevice,
    CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT,
  );
}

// Fallback 1: Fast reconnection using previously authorized devices
if (!connected) {
  const previousDevices = await museManager.reconnectToPreviousDevices();
  const targetDevice = previousDevices.find(d => d.name === deviceName || d.id === deviceId);
  if (targetDevice) {
    connected = await museManager.connectWebBluetoothDevice(targetDevice, CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT);
  }
}

// Fallback 2: Standard SDK connection via registry + getDevices
if (!connected) {
  connected = await museManager.connectToScannedDevice(deviceId, deviceName);
}
```

**2.5 MuseManager GATT Connection** (`MuseManager.ts:356`)
```typescript
async connectToScannedDevice(deviceId: string, deviceName: string): Promise<boolean> {
  // Enhanced connection state validation
  if (this.connectedDevices.has(deviceName)) {
    const device = this.connectedDevices.get(deviceName);
    if (device?.server?.connected) {
      return true; // Already connected
    }
  }
  
  // Find the actual Web Bluetooth device (with GATT interface)
  let webBluetoothDevice: BluetoothDevice | null = null;
  if (navigator.bluetooth.getDevices) {
    const pairedDevices = await navigator.bluetooth.getDevices();
    webBluetoothDevice = pairedDevices.find(d => {
      const nameLc = (d.name || '').toLowerCase();
      const targetNameLc = (deviceName || '').toLowerCase();
      return nameLc === targetNameLc || d.id === deviceId;
    }) || null;
  }
  
  // Attempt connection with timeout
  const connectionSuccess = await this.connectToDeviceWithTimeout(webBluetoothDevice!, this.CONNECTION_TIMEOUT_MS);
}
```

**2.6 GATT Server Connection & SDK Initialization** (`MuseManager.ts:203`)
```typescript
private async connectToDevice(device: BluetoothDevice): Promise<boolean> {
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(MuseHardware.BLEConfig.SERVICE_UUID);
  const commandChar = await service.getCharacteristic(MuseHardware.BLEConfig.CMD_UUID);
  const dataChar = await service.getCharacteristic(MuseHardware.BLEConfig.DATA_UUID);
  
  // CRITICAL: Use SDK commands for real device initialization
  await this.sendCommand(commandChar, MuseCommands.Cmd_GetDeviceID());
  await this.sendCommand(commandChar, MuseCommands.Cmd_GetSystemState());
  await this.sendCommand(commandChar, MuseCommands.Cmd_GetSensorsFullScale());
  
  // Store device using its name as the key
  this.connectedDevices.set(deviceName, {
    device, server,
    characteristics: { command: commandChar, data: dataChar }
  });
  
  // Use SDK command to get real battery level
  await this.updateBatteryLevelWithSDK(deviceName);
}
```

**2.7 Post-Connection Updates** (`ElectronMotionApp.tsx:1454`)
```typescript
if (connected) {
  // Trigger device discovery after successful connection
  setTimeout(async () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "trigger_device_discovery",
        data: { action: "post_connection_scan", deviceName, deviceId },
        timestamp: Date.now(),
      }));
    }
  }, CONSTANTS.TIMEOUTS.DEVICE_DISCOVERY_TRIGGER);
  
  // Update battery levels
  await museManager.updateBatteryLevel(deviceName);
  const batteryLevel = museManager.getBatteryLevel(deviceName);
  
  // Update unified device state with successful connection
  dispatch({ type: "TRANSITION_FROM_CONNECTING", payload: { deviceId, newState: "connected" } });
  dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { batteryLevel } } });
  
  // Update battery levels periodically
  startBatteryUpdateTimer();
}
```

### 3. CONNECT ALL BUTTON CLICK FLOW

**UI Component**: `DeviceManagementPane` → Line 542 → `onConnectAll={handleConnectAll}`

#### Step-by-Step Flow:

**3.1 Connect All Handler** (`ElectronMotionApp.tsx:1793`)
```typescript
const handleConnectAll = async () => {
  const discoveredDevices = Array.from(state.allDevices.values()).filter(d => d.state === "discovered");
  if (discoveredDevices.length === 0) {
    alert("No devices available to connect");
    return;
  }
  
  // Connect sequentially to avoid concurrent Web Bluetooth chooser conflicts
  for (const device of discoveredDevices) {
    // Update UI state to connecting
    dispatch({ type: "UPDATE_DEVICE", payload: { deviceId: device.id, updates: { state: "connecting" } } });
    
    try {
      await handleConnectDevice(device.id, device.name);
    } catch (error) {
      console.error(`❌ Connection failed for ${device.name}:`, error);
    }
  }
}
```

**3.2 Sequential Connection Process**
For each discovered device, the system:
1. Sets device state to "connecting"
2. Calls `handleConnectDevice()` (see Connect Button Flow above)
3. Processes results and moves to next device
4. Updates final state based on connection success/failure

### 4. RECORD BUTTON CLICK FLOW

**UI Component**: `MotionAnalysisCard` → Line 1058 → `onStartStop={handleRecording}`

#### Step-by-Step Flow:

**4.1 Recording State Handler** (`ElectronMotionApp.tsx:1607`)
```typescript
const handleRecording = async () => {
  const currentStreamingState = museManager.getIsStreaming();
  
  if (state.isRecording) {
    // STOP RECORDING FLOW
    // 1. Stop real quaternion streaming via GATT service
    if (currentStreamingState) {
      await museManager.stopStreaming();
    }
    
    // 2. Stop motion processing coordinator recording
    if (motionProcessingCoordinator) {
      await motionProcessingCoordinator.stopRecording();
    }
    
    // 3. Stop recording in main process
    if (window.electronAPI) {
      const result = await window.electronAPI.motion.stopRecording();
    }
    
    // Update recording state
    dispatch({ type: "SET_RECORDING", payload: { isRecording: false, startTime: null } });
    
    // Update all devices to stop streaming state
    state.allDevices.forEach((device, deviceId) => {
      if (device.state === "streaming") {
        dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "connected" } } });
      }
    });
  }
}
```

**4.2 Start Recording Flow** (`ElectronMotionApp.tsx:1641`)
```typescript
else {
  // START RECORDING FLOW
  // Check connected devices
  const connectedDevices = museManager.getConnectedDevices();
  if (connectedDevices.size === 0) {
    alert("Please connect at least one device before recording");
    return;
  }
  
  // 1. Initialize motion processing coordinator
  if (!motionProcessingCoordinator) {
    motionProcessingCoordinator = MotionProcessingCoordinator.getInstance();
  }
  
  // 2. Start motion processing recording session
  const sessionData = {
    sessionId: `session_${Date.now()}`,
    exerciseId: `exercise_${Date.now()}`,
    setNumber: 1,
  };
  const motionRecordingStarted = motionProcessingCoordinator.startRecording(
    sessionData.sessionId, sessionData.exerciseId, sessionData.setNumber
  );
}
```

**4.3 SDK Streaming Initialization** (`ElectronMotionApp.tsx:1675`)
```typescript
// 3. Start real quaternion streaming via GATT service
const streamingSuccess = await museManager.startStreaming((deviceName: string, data: any) => {
  // Send data to motion processing pipeline
  if (motionProcessingCoordinator) {
    motionProcessingCoordinator.processNewData(deviceName, data);
  }
  
  // Also send to main process via WebSocket for recording/storage
  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({
      type: "motion_data",
      data: { deviceName, timestamp: data.timestamp, quaternion: data.quaternion },
      timestamp: Date.now(),
    }));
  }
});
```

**4.4 MuseManager Streaming Setup** (`MuseManager.ts:526`)
```typescript
async startStreaming(callback: (deviceName: string, data: IMUData) => void): Promise<boolean> {
  this.dataCallback = callback;
  
  for (const [deviceName, device] of this.connectedDevices.entries()) {
    if (!device.characteristics?.data || !device.characteristics?.command) continue;
    
    const dataChar = device.characteristics.data;
    await dataChar.startNotifications();
    
    dataChar.addEventListener('characteristicvaluechanged', (event: Event) => {
      if (!this.dataCallback) return;
      
      const characteristic = event.target as unknown as BluetoothRemoteGATTCharacteristic;
      const value = characteristic.value;
      if (!value) return;
      
      try {
        const rawData = new Uint8Array(value.buffer);
        const data = MuseDataParser.decodePacket(rawData, Date.now(), MuseHardware.DataMode.QUATERNION, 
          { FullScale: 2000, Sensitivity: 1.0 }, { FullScale: 16, Sensitivity: 1.0 }, { FullScale: 4912, Sensitivity: 1.0 }
        );
        this.dataCallback(deviceName, data);
      } catch (error) {
        console.error('Data processing error:', error);
      }
    });
    
    // Use proper SDK command for streaming
    const streamCommand = MuseCommands.Cmd_StartStream(MuseHardware.DataMode.QUATERNION, MuseHardware.DataFrequency.HZ_100);
    await device.characteristics.command.writeValue(streamCommand.buffer as ArrayBuffer);
  }
  
  this.isStreaming = true;
  return true;
}
```

**4.5 Final State Updates** (`ElectronMotionApp.tsx:1699`)
```typescript
if (streamingSuccess) {
  // Update recording state immediately
  dispatch({ type: "SET_RECORDING", payload: { isRecording: true, startTime: new Date() } });
  
  // Update devices to show streaming state
  const streamingDeviceNames = museManager.getStreamingDeviceNames();
  state.allDevices.forEach((device, deviceId) => {
    if (streamingDeviceNames.includes(device.name) && device.state === "connected") {
      dispatch({ type: "UPDATE_DEVICE", payload: { deviceId, updates: { state: "streaming" } } });
    }
  });
  
  // 4. Start recording in main process (for storage/backup)
  if (window.electronAPI) {
    const result = await window.electronAPI.motion.startRecording(sessionData);
  }
}
```

## State Management Flow

### Device State Machine
Each device progresses through these states:
- `discovered` → `connecting` → `connected` → `streaming` → `connected` → `disconnected`

### State Transitions
1. **Scan**: Devices move to `discovered` state
2. **Connect**: `discovered` → `connecting` → `connected`
3. **Record Start**: `connected` → `streaming`
4. **Record Stop**: `streaming` → `connected`
5. **Disconnect**: Any state → `disconnected`

### Error Handling
- Connection timeouts revert `connecting` → `discovered`
- GATT errors trigger cleanup and state reset
- Streaming failures stop recording and revert to `connected`

## WebSocket Communication

### Message Types
- `device_scan_result`: Device discovery results
- `device_status`: Connection state updates  
- `motion_data`: Real-time streaming data
- `recording_state`: Recording start/stop events
- `status_update`: General system status

### Data Flow
1. **UI → WebSocket**: User actions trigger messages to main process
2. **WebSocket → UI**: Device state changes and data updates
3. **SDK → WebSocket**: Motion data streaming for storage
4. **SDK → UI**: Direct data callbacks for real-time display

## Key Integration Points

### 1. Web Bluetooth ↔ Electron
- `navigator.bluetooth.requestDevice()` triggers `select-bluetooth-device` event
- Main process handles device selection via BluetoothService
- Renderer receives selected device for GATT operations

### 2. MuseManager ↔ UI State  
- Device registry maintains discovered devices
- Connection state synced with React component state
- Battery levels updated via periodic polling

### 3. Streaming Data Pipeline
- **GATT Notifications** → **MuseManager** → **Motion Processor** → **UI Display**
- **GATT Notifications** → **MuseManager** → **WebSocket** → **Main Process Storage**

## Critical Dependencies

### Required APIs
- **Web Bluetooth**: `navigator.bluetooth.requestDevice()`, `device.gatt.connect()`
- **Electron IPC**: `window.electronAPI.motion.*`, `window.electronAPI.bluetooth.*`
- **WebSocket**: Real-time communication with main process

### Hardware Requirements  
- Bluetooth 4.0+ adapter
- TropX motion sensors with specific GATT service UUID: `c8c0a708-e361-4b5e-a365-98fa6b0a836f`
- Compatible characteristic UUIDs for command and data channels

### Error Recovery Mechanisms
- Connection retry with exponential backoff
- GATT operation queuing to prevent conflicts
- State cleanup on connection failures
- Automatic device reconnection attempts

---

This map provides complete traceability of all BLE operations from user interaction to hardware communication, enabling effective debugging and system understanding.