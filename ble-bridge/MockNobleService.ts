/**
 * Mock Noble Service for testing when Noble compilation fails
 * Simulates TropX devices for development/testing
 */

import {
  TropXDeviceInfo,
  BleScanResult,
  BleConnectionResult,
  MotionDataCallback,
  DeviceEventCallback,
  MotionData
} from './BleBridgeTypes';

export class MockNobleService {
  private isScanning = false;
  private connectedDevices = new Map<string, TropXDeviceInfo>();
  private streamingDevices = new Set<string>();
  private motionCallback: MotionDataCallback | null = null;
  private eventCallback: DeviceEventCallback | null = null;
  private streamingInterval: NodeJS.Timeout | null = null;

  constructor(motionCallback?: MotionDataCallback, eventCallback?: DeviceEventCallback) {
    this.motionCallback = motionCallback || null;
    this.eventCallback = eventCallback || null;
  }

  async initialize(): Promise<boolean> {
    console.log('🧪 Mock Noble Service initialized (for testing without Noble)');
    return true;
  }

  async startScanning(): Promise<BleScanResult> {
    console.log('🧪 Mock: Starting BLE scan...');
    this.isScanning = true;

    // Simulate scan delay
    await this.delay(2000);

    // Mock discovered devices
    const mockDevices: TropXDeviceInfo[] = [
      {
        id: 'mock_tropx_001',
        name: 'tropx_device_001',
        address: 'AA:BB:CC:DD:EE:01',
        rssi: -45,
        state: 'discovered',
        batteryLevel: 85,
        lastSeen: new Date()
      },
      {
        id: 'mock_tropx_002',
        name: 'tropx_device_002',
        address: 'AA:BB:CC:DD:EE:02',
        rssi: -52,
        state: 'discovered',
        batteryLevel: 72,
        lastSeen: new Date()
      }
    ];

    this.isScanning = false;
    console.log(`🧪 Mock: Found ${mockDevices.length} TropX devices`);

    return {
      success: true,
      devices: mockDevices,
      message: `Mock scan completed - found ${mockDevices.length} devices`
    };
  }

  async connectToDevice(deviceId: string): Promise<BleConnectionResult> {
    console.log(`🧪 Mock: Connecting to device ${deviceId}...`);

    await this.delay(1500); // Simulate connection time

    const mockDevice: TropXDeviceInfo = {
      id: deviceId,
      name: `tropx_device_${deviceId.slice(-3)}`,
      address: `AA:BB:CC:DD:EE:${deviceId.slice(-2)}`,
      rssi: -45,
      state: 'connected',
      batteryLevel: Math.floor(Math.random() * 40) + 60, // 60-100%
      lastSeen: new Date()
    };

    this.connectedDevices.set(deviceId, mockDevice);

    if (this.eventCallback) {
      this.eventCallback(deviceId, 'connected', mockDevice);
    }

    console.log(`🧪 Mock: Connected to ${deviceId}`);

    return {
      success: true,
      deviceId,
      message: 'Mock connection successful'
    };
  }

  async disconnectDevice(deviceId: string): Promise<BleConnectionResult> {
    console.log(`🧪 Mock: Disconnecting device ${deviceId}...`);

    this.connectedDevices.delete(deviceId);
    this.streamingDevices.delete(deviceId);

    if (this.eventCallback) {
      this.eventCallback(deviceId, 'disconnected');
    }

    return {
      success: true,
      deviceId,
      message: 'Mock disconnection successful'
    };
  }

  async startStreamingAll(): Promise<{ success: boolean; started: number; total: number }> {
    const connectedCount = this.connectedDevices.size;

    if (connectedCount === 0) {
      return { success: false, started: 0, total: 0 };
    }

    console.log(`🧪 Mock: Starting streaming on ${connectedCount} devices...`);

    // Mark all connected devices as streaming
    this.connectedDevices.forEach((device, deviceId) => {
      device.state = 'streaming';
      this.streamingDevices.add(deviceId);
    });

    // Start mock quaternion data streaming
    this.startMockDataStreaming();

    return {
      success: true,
      started: connectedCount,
      total: connectedCount
    };
  }

  async stopStreamingAll(): Promise<void> {
    console.log('🧪 Mock: Stopping all streaming...');

    // Stop streaming timer
    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
    }

    // Update device states
    this.connectedDevices.forEach((device, deviceId) => {
      device.state = 'connected';
      this.streamingDevices.delete(deviceId);
    });
  }

  getConnectedDevices(): TropXDeviceInfo[] {
    return Array.from(this.connectedDevices.values());
  }

  async getAllBatteryLevels(): Promise<Map<string, number>> {
    const batteryLevels = new Map<string, number>();

    this.connectedDevices.forEach((device, deviceId) => {
      if (device.batteryLevel !== null) {
        batteryLevels.set(deviceId, device.batteryLevel);
      }
    });

    return batteryLevels;
  }

  private startMockDataStreaming(): void {
    // Stream at 100Hz (10ms intervals)
    this.streamingInterval = setInterval(() => {
      this.streamingDevices.forEach(deviceId => {
        // Generate realistic quaternion data (slow rotation simulation)
        const time = Date.now() / 1000;
        const angle = (time * 0.1) % (2 * Math.PI); // Slow rotation

        const motionData: MotionData = {
          timestamp: Date.now(),
          quaternion: {
            w: Math.cos(angle / 2),
            x: Math.sin(angle / 2) * 0.3, // Small rotation around x-axis
            y: Math.sin(angle / 2) * 0.1,
            z: Math.cos(angle / 2) * 0.05
          }
        };

        // Normalize quaternion
        const magnitude = Math.sqrt(
          motionData.quaternion.w ** 2 +
          motionData.quaternion.x ** 2 +
          motionData.quaternion.y ** 2 +
          motionData.quaternion.z ** 2
        );

        motionData.quaternion.w /= magnitude;
        motionData.quaternion.x /= magnitude;
        motionData.quaternion.y /= magnitude;
        motionData.quaternion.z /= magnitude;

        // Send to callback
        if (this.motionCallback) {
          this.motionCallback(deviceId, motionData);
        }
      });
    }, 10); // 100Hz streaming
  }

  async cleanup(): Promise<void> {
    console.log('🧪 Mock: Cleaning up...');

    await this.stopStreamingAll();
    this.connectedDevices.clear();
    this.streamingDevices.clear();
  }

  // Mock getters
  get isBluetoothReady(): boolean {
    return true;
  }

  get scanningStatus(): boolean {
    return this.isScanning;
  }

  get connectedDeviceCount(): number {
    return this.connectedDevices.size;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}