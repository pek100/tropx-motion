// Example usage of TropxWSClient
import { TropxWSClient, EVENT_TYPES } from './index';

async function example() {
  // Create client
  const client = new TropxWSClient({
    reconnectDelay: 2000,
    maxReconnectAttempts: 5
  });

  // Setup event listeners
  client.on(EVENT_TYPES.CONNECTED, () => {
    console.log('✅ Connected to server');
  });

  client.on(EVENT_TYPES.DISCONNECTED, ({ code, reason }) => {
    console.log('❌ Disconnected:', code, reason);
  });

  client.on(EVENT_TYPES.RECONNECTING, ({ attempt, delay }) => {
    console.log(`🔄 Reconnecting (attempt ${attempt}, delay ${delay}ms)`);
  });

  client.on(EVENT_TYPES.MOTION_DATA, (data) => {
    console.log('📊 Motion data:', data);
  });

  client.on(EVENT_TYPES.DEVICE_STATUS, (status) => {
    console.log('📱 Device status:', status);
  });

  // Connect
  const connectResult = await client.connect('ws://localhost:8080');
  if (!connectResult.success) {
    console.error('Connection failed:', connectResult.error);
    return;
  }

  // Scan for devices
  const scanResult = await client.scanDevices();
  if (scanResult.success) {
    console.log('Found devices:', scanResult.data.devices);
  } else {
    console.error('Scan failed:', scanResult.error);
  }

  // Connect to device
  if (scanResult.success && scanResult.data.devices.length > 0) {
    const device = scanResult.data.devices[0];
    const connectDeviceResult = await client.connectDevice(device.id, device.name);
    if (connectDeviceResult.success) {
      console.log('Device connected:', connectDeviceResult.data.deviceId);
    }
  }

  // Start recording
  const recordResult = await client.startRecording('session-123', 'exercise-456', 1);
  if (recordResult.success) {
    console.log('Recording started:', recordResult.data.recordingId);
  }

  // Wait a bit
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Stop recording
  const stopResult = await client.stopRecording();
  if (stopResult.success) {
    console.log('Recording stopped:', stopResult.data.recordingId);
  }

  // Get stats
  const stats = client.getStats();
  console.log('Client stats:', stats);

  // Disconnect
  client.disconnect();
}

// Run example
example().catch(console.error);
