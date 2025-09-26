# WebSocket Bridge Interface Refactor

## Overview
This document outlines the interface changes required to migrate from the existing IPC+WebSocket hybrid system to the new pure WebSocket architecture with binary protocol support.

## Critical Changes

### 1. Communication Protocol

#### OLD: IPC + WebSocket Hybrid
```javascript
// IPC calls for device operations
await electronAPI.bluetooth.selectDevice(deviceId)
await electronAPI.motion.startRecording(sessionData)
await electronAPI.motion.stopRecording()

// WebSocket for streaming data only
websocket.send(JSON.stringify({ type: 'motion_data', data: {...} }))
```

#### NEW: Pure WebSocket with Binary Protocol
```javascript
// All operations via WebSocket with request/response pattern
const response = await websocketBridge.sendReliable({
  type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
  deviceId: 'device123',
  deviceName: 'tropx_device_1',
  requestId: generateId(),
  timestamp: Date.now()
})

// Binary streaming data (Float32Array optimized)
websocketBridge.sendUnreliable({
  type: MESSAGE_TYPES.MOTION_DATA,
  deviceName: 'tropx_device_1',
  data: new Float32Array([leftCurrent, leftMax, leftMin, rightCurrent, rightMax, rightMin]),
  timestamp: Date.now()
})
```

### 2. Message Types

#### OLD: Mixed String/JSON Types
```javascript
// IPC message types (method names)
'bluetooth.selectDevice'
'motion.startRecording'
'motion.stopRecording'

// WebSocket string types
'motion_data'
'device_status'
'heartbeat'
```

#### NEW: Binary Message Type Constants
```javascript
// All operations use numeric message types
MESSAGE_TYPES.BLE_SCAN_REQUEST = 0x10
MESSAGE_TYPES.BLE_CONNECT_REQUEST = 0x12
MESSAGE_TYPES.RECORD_START_REQUEST = 0x20
MESSAGE_TYPES.MOTION_DATA = 0x30
MESSAGE_TYPES.DEVICE_STATUS = 0x31
```

### 3. Data Serialization

#### OLD: JSON Everywhere
```javascript
// Motion data as JSON (inefficient)
{
  type: 'motion_data',
  left: { current: 45.2, max: 90.0, min: 0.0 },
  right: { current: 30.1, max: 85.0, min: -5.0 },
  timestamp: 1638360000000
}
```

#### NEW: Binary Protocol with Float32Array
```javascript
// Motion data as Float32Array (24 bytes vs ~120 bytes JSON)
const motionData = new Float32Array([
  45.2,  // leftCurrent
  90.0,  // leftMax
  0.0,   // leftMin
  30.1,  // rightCurrent
  85.0,  // rightMax
  -5.0   // rightMin
])
```

### 4. Error Handling

#### OLD: Mixed Error Handling
```javascript
// IPC errors as exceptions
try {
  await electronAPI.bluetooth.selectDevice(deviceId)
} catch (error) {
  console.error('IPC error:', error)
}

// WebSocket errors as events
websocket.onerror = (error) => { ... }
```

#### NEW: Unified Error Messages
```javascript
// All errors as structured WebSocket messages
{
  type: MESSAGE_TYPES.ERROR,
  code: ERROR_CODES.CONNECTION_FAILED,
  message: 'Failed to connect to device',
  requestId: originalRequestId,
  timestamp: Date.now()
}
```

### 5. Request/Response Pattern

#### OLD: IPC Promise-based + WebSocket Events
```javascript
// IPC request/response
const result = await electronAPI.bluetooth.selectDevice(deviceId)

// WebSocket one-way messages
websocket.send(JSON.stringify(message))
websocket.onmessage = (event) => { ... }
```

#### NEW: WebSocket Request/Response with Reliable Transport
```javascript
// Request/response over WebSocket
const response = await reliableTransport.sendReliable({
  type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
  deviceId: deviceId,
  requestId: generateRequestId(),
  timestamp: Date.now()
}, clientId)

// Response matched by requestId
{
  type: MESSAGE_TYPES.BLE_CONNECT_RESPONSE,
  requestId: matchingRequestId,
  success: true,
  deviceId: deviceId,
  timestamp: Date.now()
}
```

## Required Code Changes

### 1. Renderer Process (ElectronMotionApp.tsx)

#### Remove IPC Calls
```javascript
// REMOVE these lines:
await electronAPI.bluetooth.selectDevice(deviceId)
await electronAPI.motion.startRecording(sessionData)
await electronAPI.motion.stopRecording()

// REPLACE with WebSocket calls:
await websocketBridge.sendReliable({
  type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
  deviceId: deviceId,
  deviceName: deviceName,
  requestId: generateId(),
  timestamp: Date.now()
})
```

#### Update Event Handlers
```javascript
// REMOVE IPC event listeners:
electronAPI.on('device-connected', handleDeviceConnected)

// REPLACE with WebSocket message handlers:
websocketBridge.onMessage(MESSAGE_TYPES.DEVICE_STATUS, (message) => {
  if (message.connected) {
    handleDeviceConnected(message.deviceName)
  }
})
```

### 2. Main Process Integration

#### Remove IPC Handlers
```javascript
// REMOVE from MainProcess.ts:
ipcMain.handle('bluetooth:selectDevice', async (event, deviceId) => { ... })
ipcMain.handle('motion:startRecording', async (event, sessionData) => { ... })

// Integration handled by WebSocket handlers in websocket-bridge
```

#### Update MuseManager Integration
```javascript
// NEW integration via BLE service interface:
const bleService = {
  scanForDevices: () => museManager.reconnectToPreviousDevices(),
  connectToDevice: (deviceId, deviceName) => museManager.connectToScannedDevice(deviceId, deviceName),
  disconnectDevice: (deviceId) => museManager.disconnectDevice(deviceId),
  // ... other methods
}

bleHandler.setBLEService(bleService)
```

### 3. WebSocket Client Changes

#### Update Connection Logic
```javascript
// OLD WebSocket connection:
const websocket = new WebSocket(`ws://localhost:${port}`)
websocket.onmessage = (event) => {
  const data = JSON.parse(event.data)
  // handle JSON data
}

// NEW WebSocket with binary protocol:
const websocket = new WebSocket(`ws://localhost:${port}`)
websocket.binaryType = 'arraybuffer'
websocket.onmessage = (event) => {
  const message = BinaryProtocol.deserialize(event.data)
  messageRouter.route(message, clientId)
}
```

#### Update Data Sending
```javascript
// OLD JSON sending:
websocket.send(JSON.stringify({
  type: 'scan_devices',
  timestamp: Date.now()
}))

// NEW binary sending:
const message = {
  type: MESSAGE_TYPES.BLE_SCAN_REQUEST,
  requestId: generateRequestId(),
  timestamp: Date.now()
}
const binaryData = BinaryProtocol.serialize(message)
websocket.send(binaryData)
```

## Migration Steps

### Phase 1: Infrastructure Setup
1. ✅ Deploy websocket-bridge infrastructure
2. ✅ Configure binary protocol handlers
3. ✅ Set up message routing
4. Update main process to integrate bridge

### Phase 2: Backend Integration
1. Connect BLEHandler to existing MuseManager
2. Connect StreamingHandler to motion processing
3. Connect SystemHandler to monitoring services
4. Remove existing IPC handlers

### Phase 3: Frontend Migration
1. Update ElectronMotionApp.tsx WebSocket client
2. Replace IPC calls with WebSocket messages
3. Update UI event handlers for new message format
4. Test all BLE operations via WebSocket

### Phase 4: Optimization
1. Enable binary protocol for motion data
2. Configure reliable/unreliable transport per message type
3. Tune performance parameters
4. Add error recovery mechanisms

## Performance Benefits

### Bandwidth Reduction
- **Motion Data**: ~75% reduction (24 bytes vs 120+ bytes)
- **Control Messages**: ~50% reduction (binary headers vs JSON)

### Latency Improvement
- **Direct Binary**: No JSON parsing overhead
- **Request/Response**: Optimized timeout and retry logic
- **Streaming**: Fire-and-forget for high-frequency data

### Memory Efficiency
- **Float32Array**: Direct typed array usage
- **Binary Protocol**: Minimal allocation overhead
- **Connection Pooling**: Single WebSocket vs multiple IPC channels

## Breaking Changes Summary

1. **All IPC calls removed** - Replace with WebSocket messages
2. **Message types changed** - String types → Binary type constants
3. **Data format changed** - JSON → Binary protocol with Float32Array
4. **Error handling unified** - All errors via ERROR message type
5. **Request/response pattern** - All operations use requestId correlation

## Testing Strategy

1. **Unit Tests**: Binary protocol serialization/deserialization
2. **Integration Tests**: Handler → Service integration
3. **Performance Tests**: Throughput and latency benchmarks
4. **Migration Tests**: Old vs new interface compatibility
5. **Load Tests**: High-frequency motion data streaming

## Rollback Plan

If issues arise, the migration can be rolled back by:
1. Re-enabling IPC handlers in main process
2. Reverting renderer WebSocket client changes
3. Keeping existing JSON WebSocket streaming as fallback
4. Gradual re-migration with fixes applied