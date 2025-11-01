# Migration Guide: WebSocketBridgeClient → TropxWSClient

## Overview

This guide shows how to migrate from the old `WebSocketBridgeClient` to the new `TropxWSClient`.

## Key Changes

### 1. Import Statements

```typescript
// OLD
import { WebSocketBridgeClient } from './utils/WebSocketBridgeClient';
import { MESSAGE_TYPES } from './utils/BinaryProtocol';

// NEW
import { TropxWSClient, EVENT_TYPES } from '../../tropx-ws-client';
```

### 2. Client Initialization

```typescript
// OLD
const bridgeClient = new WebSocketBridgeClient({
  url: `ws://localhost:${port}`,
  reconnectDelay: 2000,
  maxReconnectAttempts: 5
});
await bridgeClient.connect();

// NEW
const client = new TropxWSClient({
  reconnectDelay: 2000,
  maxReconnectAttempts: 5
});
const result = await client.connect(`ws://localhost:${port}`);
if (!result.success) {
  console.error('Connection failed:', result.error);
}
```

### 3. Event Handlers

```typescript
// OLD
bridgeClient.onMessage(MESSAGE_TYPES.MOTION_DATA, (message) => {
  // Handle motion data
});

bridgeClient.onMessage(MESSAGE_TYPES.DEVICE_STATUS, (message) => {
  // Handle device status
});

// NEW
client.on(EVENT_TYPES.MOTION_DATA, (message) => {
  // Handle motion data
});

client.on(EVENT_TYPES.DEVICE_STATUS, (message) => {
  // Handle device status
});

// Connection events (NEW!)
client.on(EVENT_TYPES.CONNECTED, () => {
  console.log('Connected!');
});

client.on(EVENT_TYPES.DISCONNECTED, ({ code, reason }) => {
  console.log('Disconnected:', code, reason);
});

client.on(EVENT_TYPES.RECONNECTING, ({ attempt, delay }) => {
  console.log(`Reconnecting attempt ${attempt} in ${delay}ms`);
});
```

### 4. BLE Operations

```typescript
// OLD - Scan
const scanResult = await bridgeClient.scanForDevices();
if (scanResult.success) {
  setDevices(scanResult.devices);
}

// NEW - Scan (with Result type)
const scanResult = await client.scanDevices();
if (scanResult.success) {
  setDevices(scanResult.data.devices);
} else {
  console.error('Scan failed:', scanResult.error);
}

// OLD - Connect
const connectResult = await bridgeClient.connectToDevice(deviceId, deviceName);

// NEW - Connect
const connectResult = await client.connectDevice(deviceId, deviceName);
if (connectResult.success) {
  console.log('Connected:', connectResult.data.deviceId);
}

// OLD - Disconnect
await bridgeClient.disconnectFromDevice(deviceId);

// NEW - Disconnect
const disconnectResult = await client.disconnectDevice(deviceId);
```

### 5. Recording Operations

```typescript
// OLD - Start Recording
const result = await bridgeClient.startRecording(sessionId, exerciseId, setNumber);

// NEW - Start Recording
const result = await client.startRecording(sessionId, exerciseId, setNumber);
if (result.success) {
  console.log('Recording started:', result.data.recordingId);
}

// OLD - Stop Recording
const result = await bridgeClient.stopRecording();

// NEW - Stop Recording
const result = await client.stopRecording();
if (result.success) {
  console.log('Recording stopped:', result.data.recordingId);
}
```

### 6. Connection Status

```typescript
// OLD
const isConnected = bridgeClient.getConnectionStatus();

// NEW
const isConnected = client.isConnected();
const state = client.getConnectionState(); // 'connected' | 'connecting' | 'disconnected' | 'reconnecting'
```

### 7. Disconnect

```typescript
// OLD
bridgeClient.disconnect();

// NEW
client.disconnect();
```

## Complete Example: ElectronMotionApp Migration

### Before

```typescript
const bridgeClientRef = useRef<WebSocketBridgeClient | null>(null);

useEffect(() => {
  const initializeBridgeClient = async () => {
    const port = await window.ipcRenderer.invoke('get-ws-port');
    const bridgeClient = new WebSocketBridgeClient({
      url: `ws://localhost:${port}`,
      reconnectDelay: 2000,
      maxReconnectAttempts: 5
    });

    setupBridgeMessageHandlers(bridgeClient);

    await bridgeClient.connect();
    bridgeClientRef.current = bridgeClient;
  };

  initializeBridgeClient();
}, []);

const setupBridgeMessageHandlers = (bridgeClient: WebSocketBridgeClient) => {
  bridgeClient.onMessage(MESSAGE_TYPES.MOTION_DATA, (message) => {
    // Handle motion data
  });

  bridgeClient.onMessage(MESSAGE_TYPES.DEVICE_STATUS, (message) => {
    // Handle device status
  });
};

const handleScan = async () => {
  const result = await bridgeClientRef.current?.scanForDevices();
  if (result?.success) {
    setDevices(result.devices);
  }
};
```

### After

```typescript
const clientRef = useRef<TropxWSClient | null>(null);

useEffect(() => {
  const initializeClient = async () => {
    const port = await window.ipcRenderer.invoke('get-ws-port');

    const client = new TropxWSClient({
      reconnectDelay: 2000,
      maxReconnectAttempts: 5
    });

    // Setup event handlers
    client.on(EVENT_TYPES.MOTION_DATA, (message) => {
      // Handle motion data
    });

    client.on(EVENT_TYPES.DEVICE_STATUS, (message) => {
      // Handle device status
    });

    client.on(EVENT_TYPES.CONNECTED, () => {
      dispatch({ type: 'SET_CONNECTED', payload: true });
    });

    client.on(EVENT_TYPES.DISCONNECTED, () => {
      dispatch({ type: 'SET_CONNECTED', payload: false });
    });

    // Connect
    const result = await client.connect(`ws://localhost:${port}`);
    if (result.success) {
      clientRef.current = client;
    } else {
      console.error('Connection failed:', result.error);
    }
  };

  initializeClient();

  return () => {
    clientRef.current?.disconnect();
  };
}, []);

const handleScan = async () => {
  const result = await clientRef.current?.scanDevices();
  if (result?.success) {
    setDevices(result.data.devices);
  } else {
    console.error('Scan failed:', result.error);
  }
};
```

## Benefits of New Client

1. **Cleaner API**: Single class for all operations
2. **Better Error Handling**: Explicit Result type
3. **Type Safety**: Full TypeScript coverage
4. **Event-Driven**: Modern event system with connection events
5. **Connection State**: Easy to track connection state
6. **Self-Contained**: No server-side dependencies
7. **Consistent**: All methods follow same pattern

## Breaking Changes

1. **Event names changed**: `MESSAGE_TYPES.*` → `EVENT_TYPES.*`
2. **Response structure**: Operations now return `Result<T>` type
3. **Method names**: Some methods renamed for consistency:
   - `scanForDevices()` → `scanDevices()`
   - `connectToDevice()` → `connectDevice()`
   - `disconnectFromDevice()` → `disconnectDevice()`
4. **Connection**: `url` is now passed to `connect()` instead of constructor

## Checklist

- [ ] Update imports
- [ ] Update client initialization
- [ ] Update event handlers (MESSAGE_TYPES → EVENT_TYPES)
- [ ] Update operation calls to handle Result type
- [ ] Update method names
- [ ] Add connection event handlers (optional but recommended)
- [ ] Test all operations
- [ ] Remove old imports
