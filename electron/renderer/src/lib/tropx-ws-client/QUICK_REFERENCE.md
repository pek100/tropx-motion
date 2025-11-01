# TropX WebSocket Client - Quick Reference

## Import
```typescript
import { TropxWSClient, EVENT_TYPES, Result } from './tropx-ws-client';
```

## Create Client
```typescript
const client = new TropxWSClient({
  reconnectDelay: 2000,        // Optional: default 2000ms
  maxReconnectAttempts: 5      // Optional: default 5
});
```

## Connect/Disconnect
```typescript
// Connect
const result = await client.connect('ws://localhost:8080');
if (!result.success) console.error(result.error);

// Check connection
client.isConnected()           // boolean
client.getConnectionState()    // 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

// Disconnect
client.disconnect()
```

## Event Listeners
```typescript
client.on(EVENT_TYPES.CONNECTED, () => {})
client.on(EVENT_TYPES.DISCONNECTED, ({ code, reason }) => {})
client.on(EVENT_TYPES.RECONNECTING, ({ attempt, delay }) => {})
client.on(EVENT_TYPES.ERROR, (error) => {})
client.on(EVENT_TYPES.MOTION_DATA, (data) => {})
client.on(EVENT_TYPES.DEVICE_STATUS, (status) => {})
client.on(EVENT_TYPES.BATTERY_UPDATE, (battery) => {})

// Remove listener
client.off(EVENT_TYPES.MOTION_DATA, handler)

// One-time listener
client.once(EVENT_TYPES.CONNECTED, () => {})
```

## BLE Operations
```typescript
// Scan
const scan = await client.scanDevices();
if (scan.success) console.log(scan.data.devices);

// Connect single device
const conn = await client.connectDevice('device-id', 'Device Name');
if (conn.success) console.log(conn.data.deviceId);

// Connect multiple devices (parallel)
const devices = [
  { id: 'device-1', name: 'Left' },
  { id: 'device-2', name: 'Right' }
];
const results = await client.connectDevices(devices);
if (results.success) console.log(`Connected ${results.data.length} devices`);

// Disconnect
const disc = await client.disconnectDevice('device-id');

// Sync all
const sync = await client.syncAllDevices();
if (sync.success) console.log(sync.data.results);
```

## Recording
```typescript
// Start
const start = await client.startRecording('session-123', 'exercise-456', 1);
if (start.success) console.log(start.data.recordingId);

// Stop
const stop = await client.stopRecording();
if (stop.success) console.log(stop.data.recordingId);
```

## System
```typescript
// Status
const status = await client.getStatus();
if (status.success) console.log(status.data);

// Ping
const latency = await client.ping();
if (latency.success) console.log(`Latency: ${latency.data}ms`);

// Stats
const stats = client.getStats();
console.log(stats.messagesSent, stats.messagesReceived, stats.uptime);
```

## Result Type Pattern
```typescript
const result = await client.scanDevices();

// Pattern 1: if/else
if (result.success) {
  console.log(result.data.devices);
} else {
  console.error(result.error, result.code);
}

// Pattern 2: early return
if (!result.success) {
  console.error(result.error);
  return;
}
console.log(result.data.devices);

// Pattern 3: destructuring
const { success, data, error } = await client.scanDevices();
if (success) {
  console.log(data.devices);
}
```

## Complete Example
```typescript
const client = new TropxWSClient();

// Setup events
client.on(EVENT_TYPES.CONNECTED, () => console.log('Connected'));
client.on(EVENT_TYPES.MOTION_DATA, (data) => updateChart(data));

// Connect
await client.connect('ws://localhost:8080');

// Scan & connect
const scan = await client.scanDevices();
if (scan.success && scan.data.devices.length > 0) {
  const device = scan.data.devices[0];
  await client.connectDevice(device.id, device.name);
}

// Record
await client.startRecording('session-1', 'exercise-1', 1);
await sleep(5000);
await client.stopRecording();

// Cleanup
client.disconnect();
```

## Type Definitions
```typescript
interface Result<T> {
  success: boolean;
  data?: T;      // Present if success = true
  error?: string; // Present if success = false
  code?: string;  // Optional error code
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

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
```
