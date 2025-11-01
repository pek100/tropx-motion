# TropX WebSocket Client

Clean, type-safe WebSocket client for TropX Motion Capture system.

## Features

- ✅ **Single Responsibility** - One client class for all WS operations
- ✅ **Type-Safe** - Full TypeScript support with generics
- ✅ **Event-Driven** - Modern typed event emitter for streaming data
- ✅ **Promise-Based** - Async/await for all operations
- ✅ **Auto-Reconnect** - Exponential backoff retry logic
- ✅ **Result Type** - Explicit success/error handling
- ✅ **Binary Protocol** - Optimized message serialization
- ✅ **Self-Contained** - No server-side dependencies

## Installation

```typescript
import { TropxWSClient } from './tropx-ws-client';
```

## Quick Start

```typescript
// Create client
const client = new TropxWSClient({
  reconnectDelay: 2000,
  maxReconnectAttempts: 5
});

// Connect
const result = await client.connect('ws://localhost:8080');
if (!result.success) {
  console.error('Connection failed:', result.error);
  return;
}

// Listen to streaming events
client.on('motionData', (data) => {
  console.log('Motion data:', data);
});

client.on('deviceStatus', (status) => {
  console.log('Device status:', status);
});

client.on('connected', () => console.log('Connected!'));
client.on('disconnected', ({ code, reason }) => console.log('Disconnected:', code, reason));
client.on('reconnecting', ({ attempt, delay }) => console.log(`Reconnecting attempt ${attempt} in ${delay}ms`));

// Scan for devices
const scanResult = await client.scanDevices();
if (scanResult.success) {
  console.log('Found devices:', scanResult.data.devices);
}

// Connect to device
const connectResult = await client.connectDevice('device-id', 'device-name');
if (connectResult.success) {
  console.log('Device connected:', connectResult.data);
}

// Start recording
const recordResult = await client.startRecording('session-123', 'exercise-456', 1);
if (recordResult.success) {
  console.log('Recording started:', recordResult.data);
}

// Stop recording
const stopResult = await client.stopRecording();
if (stopResult.success) {
  console.log('Recording stopped:', stopResult.data);
}

// Disconnect
client.disconnect();
```

## API Reference

### Connection Management

```typescript
// Connect to server
connect(url: string): Promise<Result<void>>

// Disconnect from server
disconnect(): void

// Check connection status
isConnected(): boolean

// Get connection state
getConnectionState(): ConnectionState
```

### BLE Operations

```typescript
// Scan for BLE devices
scanDevices(): Promise<Result<ScanResponse>>

// Connect to single device
connectDevice(id: string, name: string): Promise<Result<ConnectionResponse>>

// Connect to multiple devices in parallel
connectDevices(devices: Array<{id: string, name: string}>): Promise<Result<ConnectionResponse[]>>

// Disconnect device
disconnectDevice(id: string): Promise<Result<ConnectionResponse>>

// Sync all devices
syncAllDevices(): Promise<Result<SyncResponse>>
```

### Recording Operations

```typescript
// Start recording session
startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<Result<RecordingResponse>>

// Stop recording session
stopRecording(): Promise<Result<RecordingResponse>>
```

### System Operations

```typescript
// Get server status
getStatus(): Promise<Result<StatusResponse>>

// Ping server (returns latency in ms)
ping(): Promise<Result<number>>

// Get client statistics
getStats(): ClientStats
```

### Event Listeners

```typescript
// Register event handler
on<E extends EventType>(event: E, handler: EventHandler<E>): void

// Remove event handler
off<E extends EventType>(event: E, handler: EventHandler<E>): void

// Register one-time handler
once<E extends EventType>(event: E, handler: EventHandler<E>): void
```

## Event Types

```typescript
'connected'       // Connection established
'disconnected'    // Connection closed { code, reason }
'reconnecting'    // Reconnection attempt { attempt, delay }
'error'           // Error occurred (Error)
'motionData'      // Motion data received (MotionDataMessage)
'deviceStatus'    // Device status update (DeviceStatusMessage)
'batteryUpdate'   // Battery update (BatteryUpdateMessage)
'message'         // Error message (ErrorMessage)
```

## Result Type

All operations return a `Result<T>` type for explicit error handling:

```typescript
type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Usage
const result = await client.scanDevices();
if (result.success) {
  console.log(result.data.devices);
} else {
  console.error(result.error, result.code);
}
```

## Type Definitions

```typescript
interface ScanResponse {
  devices: DeviceInfo[];
  message?: string;
}

interface DeviceInfo {
  id: string;
  name: string;
  address: string;
  rssi: number;
  state: 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';
  batteryLevel: number | null;
  lastSeen: Date;
}

interface ConnectionResponse {
  deviceId: string;
  message?: string;
}

interface RecordingResponse {
  sessionId?: string;
  recordingId?: string;
  message?: string;
}
```

## Advanced Usage

### Parallel Device Connection

```typescript
const devices = [
  { id: 'device-1', name: 'Tropx_Left' },
  { id: 'device-2', name: 'Tropx_Right' }
];

const result = await client.connectDevices(devices);
if (result.success) {
  console.log(`Connected ${result.data.length} devices`);
}
```

### Connection State Monitoring

```typescript
client.on('connected', () => {
  console.log('State:', client.getConnectionState()); // 'connected'
});

client.on('reconnecting', ({ attempt, delay }) => {
  console.log('State:', client.getConnectionState()); // 'reconnecting'
});
```

### Statistics Tracking

```typescript
setInterval(() => {
  const stats = client.getStats();
  console.log('Stats:', {
    messagesSent: stats.messagesSent,
    messagesReceived: stats.messagesReceived,
    errors: stats.errors,
    uptime: stats.uptime,
    latency: stats.latency
  });
}, 5000);
```

## Migration from Old Client

```typescript
// OLD (WebSocketBridgeClient + UnifiedWebSocketTranslator)
const translator = new UnifiedWebSocketTranslator('ws://localhost:8080');
await translator.initialize();
const scanResult = await translator.scanForDevices();

// NEW (TropxWSClient)
const client = new TropxWSClient();
await client.connect('ws://localhost:8080');
const scanResult = await client.scanDevices();
```

## Architecture

```
TropxWSClient (Public API)
    ↓
WebSocketTransport (Connection + Auto-reconnect)
    ↓
TypedEventEmitter (Event system)
    ↓
BinaryProtocol (Serialization)
```

## License

MIT
