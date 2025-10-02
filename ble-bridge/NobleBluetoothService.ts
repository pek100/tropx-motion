/**
 * Noble-based Bluetooth Service - Main BLE implementation
 *
 * NOTE: Requires @abandonware/noble installation with native compilation
 * Windows: Requires Visual Studio Build Tools or similar
 */

import {
  TropXDeviceInfo,
  BleScanResult,
  BleConnectionResult,
  MotionDataCallback,
  DeviceEventCallback,
  DeviceConnectionState,
  MotionData
} from './BleBridgeTypes';

import {
  BLE_CONFIG,
  TIMING
} from './BleBridgeConstants';

import { TropXDevice } from './TropXDevice';
import { deviceStateManager, GlobalStreamingState } from './DeviceStateManager';

// Noble import - will be dynamically loaded
let noble: any = null;

export class NobleBluetoothService {
  private devices = new Map<string, TropXDevice>();
  private discoveredPeripherals = new Map<string, any>();
  private isScanning = false;
  private isInitialized = false;
  private scanTimer: NodeJS.Timeout | null = null;

  // Callbacks
  private motionDataCallback: MotionDataCallback | null = null;
  private deviceEventCallback: DeviceEventCallback | null = null;

  constructor(
    motionCallback?: MotionDataCallback,
    eventCallback?: DeviceEventCallback
  ) {
    this.motionDataCallback = motionCallback || null;
    this.deviceEventCallback = eventCallback || null;
  }

  // Initialize Noble BLE
  async initialize(): Promise<boolean> {
    try {
      console.log('🔍 Initializing Noble BLE service...');
      console.log('🔍 Initial isInitialized state:', this.isInitialized);

      // Dynamically import Noble to handle missing dependencies gracefully
      try {
        console.log('🔍 Attempting to require Noble...');
        noble = require('@abandonware/noble');
        console.log('🔍 Noble imported successfully:', !!noble);

        console.log('✅ Noble BLE library loaded, proceeding with real Noble implementation');

      } catch (nobleError) {
        console.log('🔍 Noble import failed, using mock service. Error:', (nobleError as Error).message);
        console.warn('⚠️ Noble not available, falling back to mock service');
        console.warn('💡 To use real BLE: npm install @abandonware/noble');
        console.warn('💡 Windows: Requires Visual Studio Build Tools');

        // Try to use mock service as fallback
        try {
          console.log('🔍 Loading MockNobleService...');
          const { MockNobleService } = require('./MockNobleService');
          console.log('🔍 MockNobleService loaded successfully');

          console.log('🔍 Creating MockNobleService instance...');
          const mockService = new MockNobleService(this.motionDataCallback, this.deviceEventCallback);
          console.log('🔍 MockNobleService instance created');

          console.log('🔍 Initializing MockNobleService...');
          await mockService.initialize();
          console.log('🔍 MockNobleService initialized successfully');

          console.log('🔍 Replacing service methods with mock implementations...');
          // Replace this service methods with mock service methods
          this.startScanning = async () => {
            console.log('🧪 Mock service startScanning method called');
            const result = await mockService.startScanning();
            console.log('🧪 Mock service scan result:', result);
            // Update discovered devices for getDiscoveredDevices method
            if (result.success && result.devices) {
              this.discoveredPeripherals.clear();
              result.devices.forEach((device: any) => {
                this.discoveredPeripherals.set(device.id, {
                  id: device.id,
                  advertisement: { localName: device.name },
                  rssi: device.rssi,
                  address: device.address
                });
              });
              console.log(`🧪 Added ${result.devices.length} mock devices to discoveredPeripherals`);
            }
            return result;
          };
          this.stopScanning = mockService.cleanup.bind(mockService);
          this.connectToDevice = mockService.connectToDevice.bind(mockService);
          this.disconnectDevice = mockService.disconnectDevice.bind(mockService);
          this.startStreamingAll = mockService.startStreamingAll.bind(mockService);
          this.stopStreamingAll = mockService.stopStreamingAll.bind(mockService);
          this.getConnectedDevices = mockService.getConnectedDevices.bind(mockService);
          this.getAllBatteryLevels = mockService.getAllBatteryLevels.bind(mockService);
          this.cleanup = mockService.cleanup.bind(mockService);

          console.log('✅ Mock Noble service initialized (for testing)');
          console.log('🔍 Setting isInitialized to true...');
          this.isInitialized = true;
          console.log('🔍 isInitialized is now:', this.isInitialized);
          console.log('🔍 Returning true from initialization');
          return true;
        } catch (mockError) {
          console.error('❌ Failed to initialize mock service:', mockError);
          return false;
        }
      }

      // Setup Noble event handlers
      this.setupNobleEvents();

      // Wait for Bluetooth adapter to be ready
      try {
        await this.waitForBluetoothReady();
        this.isInitialized = true;
        console.log('✅ Noble BLE service initialized');
        return true;
      } catch (bluetoothError) {
        console.warn('⚠️ Bluetooth not available, falling back to mock service');
        console.warn('💡 Bluetooth error:', bluetoothError);

        // Fallback to mock service when Bluetooth is not available
        try {
          const { MockNobleService } = require('./MockNobleService');
          const mockService = new MockNobleService(this.motionDataCallback, this.deviceEventCallback);
          await mockService.initialize();

          // Replace this service methods with mock service methods
          this.startScanning = async () => {
            const result = await mockService.startScanning();
            // Update discovered devices for getDiscoveredDevices method
            if (result.success && result.devices) {
              this.discoveredPeripherals.clear();
              result.devices.forEach((device: any) => {
                this.discoveredPeripherals.set(device.id, {
                  id: device.id,
                  advertisement: { localName: device.name },
                  rssi: device.rssi,
                  address: device.address
                });
              });
            }
            return result;
          };
          this.stopScanning = mockService.cleanup.bind(mockService);
          this.connectToDevice = mockService.connectToDevice.bind(mockService);
          this.disconnectDevice = mockService.disconnectDevice.bind(mockService);
          this.startStreamingAll = mockService.startStreamingAll.bind(mockService);
          this.stopStreamingAll = mockService.stopStreamingAll.bind(mockService);
          this.getConnectedDevices = mockService.getConnectedDevices.bind(mockService);
          this.getAllBatteryLevels = mockService.getAllBatteryLevels.bind(mockService);
          this.cleanup = mockService.cleanup.bind(mockService);

          console.log('✅ Mock Noble service initialized (Bluetooth fallback)');
          this.isInitialized = true;
          return true;
        } catch (mockError) {
          console.error('❌ Failed to initialize mock service:', mockError);
          return false;
        }
      }

    } catch (error) {
      console.error('❌ Failed to initialize Noble BLE service:', error);
      return false;
    }
  }

  // Start scanning for TropX devices
  async startScanning(): Promise<BleScanResult> {
    console.log('🔍 NobleBluetoothService.startScanning called');
    console.log('🔍 isInitialized:', this.isInitialized);
    console.log('🔍 noble:', !!noble);

    if (!this.isInitialized) {
      console.log('❌ Service not initialized, returning error');
      return { success: false, devices: [], message: 'BLE service not initialized' };
    }

    // If noble is null, we're using the mock service - methods were replaced during initialization
    if (!noble) {
      console.log('🧪 Using mock service for scanning (noble is null)');
      console.log('❌ This should not happen - mock service should have replaced this method');
      // The startScanning method should have been replaced with mock implementation
      // This shouldn't happen, but if it does, return an error
      return { success: false, devices: [], message: 'Mock service not properly initialized' };
    }

    if (this.isScanning) {
      return { success: false, devices: [], message: 'Already scanning' };
    }

    try {
      console.log(`📡 Starting BLE scan for devices (${BLE_CONFIG.DEVICE_PATTERNS.join(', ')})...`);

      // Don't clear existing devices - keep them available for connection
      console.log(`🔍 Keeping ${this.discoveredPeripherals.size} previously discovered devices`);
      this.isScanning = true;

      // Start scanning for all devices (TropX doesn't advertise service UUID, must filter by name)
      // Note: Many BLE devices don't include service UUID in advertisement to save space
      console.log('🔍 Scanning for BLE devices (filtering by device name)...');
      await noble.startScanningAsync([], false);

      // Auto-stop scanning after timeout
      this.scanTimer = setTimeout(async () => {
        await this.stopScanning();
      }, BLE_CONFIG.SCAN_TIMEOUT);

      console.log(`🔍 Scanning for ${BLE_CONFIG.SCAN_TIMEOUT / 1000} seconds...`);

      return {
        success: true,
        devices: [],
        message: 'Scanning started - devices will be discovered during scan'
      };

    } catch (error) {
      console.error('❌ Failed to start scanning:', error);
      this.isScanning = false;
      return { success: false, devices: [], message: `Scan failed: ${error}` };
    }
  }

  // Stop scanning
  async stopScanning(): Promise<void> {
    if (!this.isScanning || !noble) return;

    try {
      console.log('🛑 Stopping BLE scan...');

      await noble.stopScanningAsync();
      this.isScanning = false;

      if (this.scanTimer) {
        clearTimeout(this.scanTimer);
        this.scanTimer = null;
      }

      const discoveredDevices = Array.from(this.discoveredPeripherals.values())
        .map(peripheral => this.createDeviceInfo(peripheral));

      console.log(`✅ Scan completed. Found ${discoveredDevices.length} devices`);

    } catch (error) {
      console.error('Error stopping scan:', error);
    }
  }

  // Get discovered devices from centralized state manager
  getDiscoveredDevices(): TropXDeviceInfo[] {
    // Use state manager as single source of truth
    return deviceStateManager.getAllDevices();
  }

  // Connect to device
  // Single device connection (wrapper for parallel system)
  async connectToDevice(deviceId: string): Promise<BleConnectionResult> {
    const results = await this.connectToDevices([deviceId]);
    return results[0] || {
      success: false,
      deviceId,
      message: 'Connection failed - no result returned'
    };
  }

  // Parallel connection system (like Python asyncio.gather)
  async connectToDevices(deviceIds: string[]): Promise<BleConnectionResult[]> {
    if (deviceIds.length === 0) {
      return [];
    }

    console.log(`🔗 Connecting to ${deviceIds.length} device(s) in parallel...`);

    // Update all devices to connecting state immediately
    deviceIds.forEach(deviceId => {
      const peripheral = this.discoveredPeripherals.get(deviceId);
      if (peripheral) {
        const deviceInfo = this.createDeviceInfo(peripheral);
        deviceStateManager.updateDevice(deviceInfo, 'connecting');
      }
    });

    // Create connection tasks for parallel execution (like Python asyncio.gather)
    const connectionTasks = deviceIds.map(deviceId => this.connectSingleDevice(deviceId));

    // Execute all connections in parallel
    const results = await Promise.all(connectionTasks);

    const successCount = results.filter(result => result.success).length;
    console.log(`✅ Parallel connection completed: ${successCount}/${deviceIds.length} device(s) connected`);

    return results;
  }

  // Internal method for single device connection with state management
  private async connectSingleDevice(deviceId: string): Promise<BleConnectionResult> {
    const peripheral = this.discoveredPeripherals.get(deviceId);
    if (!peripheral) {
      const result = {
        success: false,
        deviceId,
        message: 'Device not found - start scanning first'
      };
      deviceStateManager.setDeviceConnectionState(deviceId, 'error');
      return result;
    }

    try {
      console.log(`🔗 [${deviceId}] Connecting to device: ${peripheral.advertisement?.localName || deviceId}`);

      // Create device wrapper with state management
      const deviceInfo = this.createDeviceInfo(peripheral);
      deviceStateManager.updateDevice(deviceInfo, 'connecting');

      const tropxDevice = new TropXDevice(
        peripheral,
        deviceInfo,
        this.motionDataCallback || undefined,
        this.deviceEventCallback || undefined
      );

      // Attempt connection
      const connected = await tropxDevice.connect();
      if (connected) {
        this.devices.set(deviceId, tropxDevice);
        deviceStateManager.setDeviceConnectionState(deviceId, 'connected');

        console.log(`✅ [${deviceId}] Connected successfully`);

        // Auto-recovery: start streaming if global streaming is active
        const streamingRecovered = await this.recoverStreamingForDevice(deviceId);
        const finalMessage = streamingRecovered
          ? 'Connected successfully - streaming auto-recovered'
          : 'Connected successfully';

        return {
          success: true,
          deviceId,
          message: finalMessage
        };
      } else {
        deviceStateManager.setDeviceConnectionState(deviceId, 'error');
        return {
          success: false,
          deviceId,
          message: 'Connection failed'
        };
      }

    } catch (error) {
      console.error(`❌ [${deviceId}] Connection error:`, error);
      deviceStateManager.setDeviceConnectionState(deviceId, 'error');
      return {
        success: false,
        deviceId,
        message: `Connection error: ${error}`
      };
    }
  }

  // Global streaming management with per-device control
  async startGlobalStreaming(): Promise<{ success: boolean; started: number; total: number; results: any[] }> {
    const connectedDevices = deviceStateManager.getConnectedDevices();

    if (connectedDevices.length === 0) {
      return { success: false, started: 0, total: 0, results: [] };
    }

    const globalStreamingStartTime = Date.now();
    console.log(`🎬 Starting global streaming on ${connectedDevices.length} connected devices...`);
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STARTING);

    // Start streaming on all connected devices in parallel
    const streamingTasks = connectedDevices.map(device => this.startDeviceStreaming(device.id));
    const results = await Promise.all(streamingTasks);

    const successCount = results.filter(result => result.success).length;
    const globalStreamingTime = Date.now() - globalStreamingStartTime;

    if (successCount > 0) {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.ACTIVE);
      console.log(`✅ Global streaming started: ${successCount}/${connectedDevices.length} devices streaming (${globalStreamingTime}ms total)`);
    } else {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
      console.log(`❌ Global streaming failed: no devices started streaming (${globalStreamingTime}ms total)`);
    }

    return {
      success: successCount > 0,
      started: successCount,
      total: connectedDevices.length,
      results
    };
  }

  async stopGlobalStreaming(): Promise<{ success: boolean; stopped: number; total: number }> {
    const streamingDevices = deviceStateManager.getStreamingDevices();

    if (streamingDevices.length === 0) {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
      return { success: true, stopped: 0, total: 0 };
    }

    console.log(`🛑 Stopping global streaming on ${streamingDevices.length} devices...`);
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPING);

    // Stop streaming on all streaming devices in parallel
    const stoppingTasks = streamingDevices.map(device => this.stopDeviceStreaming(device.id));
    const results = await Promise.all(stoppingTasks);

    const successCount = results.filter(result => result.success).length;
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);

    console.log(`✅ Global streaming stopped: ${successCount}/${streamingDevices.length} devices stopped`);

    return {
      success: true,
      stopped: successCount,
      total: streamingDevices.length
    };
  }

  // Per-device streaming control with state management
  private async startDeviceStreaming(deviceId: string): Promise<{ success: boolean; deviceId: string; message: string }> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return {
        success: false,
        deviceId,
        message: 'Device not connected'
      };
    }

    try {
      console.log(`🎬 [${deviceId}] Starting streaming...`);
      const success = await device.startStreaming();

      if (success) {
        deviceStateManager.setDeviceConnectionState(deviceId, 'streaming');
        console.log(`✅ [${deviceId}] Streaming started`);
        return {
          success: true,
          deviceId,
          message: 'Streaming started successfully'
        };
      } else {
        return {
          success: false,
          deviceId,
          message: 'Failed to start streaming'
        };
      }
    } catch (error) {
      console.error(`❌ [${deviceId}] Streaming start error:`, error);
      return {
        success: false,
        deviceId,
        message: `Streaming error: ${error}`
      };
    }
  }

  private async stopDeviceStreaming(deviceId: string): Promise<{ success: boolean; deviceId: string; message: string }> {
    const device = this.devices.get(deviceId);
    if (!device) {
      return {
        success: false,
        deviceId,
        message: 'Device not connected'
      };
    }

    try {
      console.log(`🛑 [${deviceId}] Stopping streaming...`);
      await device.stopStreaming();
      deviceStateManager.setDeviceConnectionState(deviceId, 'connected');

      console.log(`✅ [${deviceId}] Streaming stopped`);
      return {
        success: true,
        deviceId,
        message: 'Streaming stopped successfully'
      };
    } catch (error) {
      console.error(`❌ [${deviceId}] Streaming stop error:`, error);
      return {
        success: false,
        deviceId,
        message: `Stop streaming error: ${error}`
      };
    }
  }

  // Auto-recovery for newly connected devices when global streaming is active
  async recoverStreamingForDevice(deviceId: string): Promise<boolean> {
    if (!deviceStateManager.isGlobalStreamingActive()) {
      return false;
    }

    const device = deviceStateManager.getDevice(deviceId);
    if (!device || device.state !== 'connected') {
      return false;
    }

    console.log(`🔄 [${deviceId}] Auto-recovering streaming (global streaming is active)...`);
    const result = await this.startDeviceStreaming(deviceId);
    return result.success;
  }

  // Disconnect device with state management
  async disconnectDevice(deviceId: string): Promise<BleConnectionResult> {
    const device = this.devices.get(deviceId);
    if (!device) {
      // Update state manager even if device not found locally
      deviceStateManager.setDeviceConnectionState(deviceId, 'disconnected');
      return {
        success: false,
        deviceId,
        message: 'Device not connected'
      };
    }

    try {
      console.log(`🔌 [${deviceId}] Disconnecting device...`);
      await device.disconnect();

      // Clean up local reference and update state
      this.devices.delete(deviceId);
      deviceStateManager.setDeviceConnectionState(deviceId, 'disconnected');

      console.log(`✅ [${deviceId}] Disconnected successfully`);
      return {
        success: true,
        deviceId,
        message: 'Disconnected successfully'
      };

    } catch (error) {
      console.error(`❌ [${deviceId}] Disconnect error:`, error);
      deviceStateManager.setDeviceConnectionState(deviceId, 'error');
      return {
        success: false,
        deviceId,
        message: `Disconnect error: ${error}`
      };
    }
  }

  // Start streaming on device
  async startStreaming(deviceId: string): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (!device || !device.isConnected) {
      console.error(`Cannot start streaming - device ${deviceId} not connected`);
      return false;
    }

    return await device.startStreaming();
  }

  // Stop streaming on device
  async stopStreaming(deviceId: string): Promise<boolean> {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    try {
      await device.stopStreaming();
      return true;
    } catch (error) {
      console.error(`Error stopping streaming for device ${deviceId}:`, error);
      return false;
    }
  }

  // Start streaming on all connected devices
  async startStreamingAll(): Promise<{ success: boolean; started: number; total: number }> {
    const connectedDevices: TropXDevice[] = [];
    this.devices.forEach(device => {
      if (device.isConnected) {
        connectedDevices.push(device);
      }
    });

    // Start streaming in parallel for all devices (much faster than sequential)
    const results = await Promise.all(
      connectedDevices.map(device => device.startStreaming())
    );

    const started = results.filter(result => result).length;

    return {
      success: started > 0,
      started,
      total: connectedDevices.length
    };
  }

  // Stop streaming on all devices
  async stopStreamingAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    this.devices.forEach(device => {
      if (device.isStreaming) {
        promises.push(device.stopStreaming());
      }
    });

    await Promise.allSettled(promises);
  }

  // Get connected devices
  getConnectedDevices(): TropXDeviceInfo[] {
    const connectedDevices: TropXDeviceInfo[] = [];
    this.devices.forEach(device => {
      if (device.isConnected) {
        connectedDevices.push(device.deviceInfo);
      }
    });
    return connectedDevices;
  }

  // Get device battery levels
  async getAllBatteryLevels(): Promise<Map<string, number>> {
    const batteryLevels = new Map<string, number>();

    const deviceEntries: Array<[string, TropXDevice]> = [];
    this.devices.forEach((device, deviceId) => {
      deviceEntries.push([deviceId, device]);
    });

    for (const [deviceId, device] of deviceEntries) {
      if (device.isConnected) {
        const battery = await device.getBatteryLevel();
        if (battery !== null) {
          batteryLevels.set(deviceId, battery);
        }
      }
    }

    return batteryLevels;
  }

  // Cleanup and disconnect all
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Noble BLE service...');

    if (this.isScanning) {
      await this.stopScanning();
    }

    // Disconnect all devices
    const disconnectPromises: Promise<void>[] = [];
    this.devices.forEach(device => {
      disconnectPromises.push(
        device.disconnect().catch(error =>
          console.error('Error disconnecting device during cleanup:', error)
        )
      );
    });

    await Promise.allSettled(disconnectPromises);
    this.devices.clear();
    this.discoveredPeripherals.clear();

    console.log('✅ Noble BLE service cleanup complete');
  }

  // Setup Noble event handlers
  private setupNobleEvents(): void {
    noble.on('stateChange', (state: string) => {
      console.log(`📶 Bluetooth state changed: ${state}`);
      if (state !== 'poweredOn' && this.isScanning) {
        this.stopScanning();
      }
    });

    noble.on('discover', (peripheral: any) => {
      this.handleDeviceDiscovered(peripheral);
    });

    noble.on('scanStart', () => {
      console.log('🔍 BLE scan started');
    });

    noble.on('scanStop', () => {
      console.log('🛑 BLE scan stopped');
      this.isScanning = false;
    });
  }

  // Handle discovered device
  private handleDeviceDiscovered(peripheral: any): void {
    const deviceName = peripheral.advertisement?.localName || '';

    // Quick filter: Check for TropX or Muse devices (case-insensitive)
    const nameLower = deviceName.toLowerCase();
    const isTargetDevice = BLE_CONFIG.DEVICE_PATTERNS.some(pattern =>
      nameLower.includes(pattern.toLowerCase())
    );

    if (!isTargetDevice) {
      return; // Silent reject - don't log non-target devices
    }

    // Check RSSI threshold
    if (peripheral.rssi < BLE_CONFIG.MIN_RSSI) {
      console.log(`❌ Weak signal: ${deviceName} (RSSI ${peripheral.rssi} < ${BLE_CONFIG.MIN_RSSI})`);
      return;
    }

    console.log(`✅ Discovered device: ${deviceName} (${peripheral.id}, RSSI: ${peripheral.rssi})`);
    this.discoveredPeripherals.set(peripheral.id, peripheral);

    // Create device info and update state manager with state preservation
    const deviceInfo = this.createDeviceInfo(peripheral);

    // Check if device was previously connected - preserve connection state during rescan
    const existingDevice = deviceStateManager.getDevice(peripheral.id);
    let targetState: DeviceConnectionState = 'discovered';

    if (existingDevice) {
      // Preserve connected/streaming states during rescan, update discovery info
      if (existingDevice.state === 'connected' || existingDevice.state === 'streaming') {
        targetState = existingDevice.state;
        console.log(`🔄 Device ${deviceName} rediscovered - preserving ${targetState} state`);
      }
    }

    // Update device in state manager (this provides centralized state)
    const managedDevice = deviceStateManager.updateDevice(deviceInfo, targetState);

    // Notify event callback with managed device
    if (this.deviceEventCallback) {
      console.log(`📱 Device event: ${peripheral.id} - discovered`, managedDevice);
      this.deviceEventCallback(peripheral.id, 'discovered', managedDevice);
    }
  }

  // Create device info from peripheral
  private createDeviceInfo(peripheral: any): TropXDeviceInfo {
    return {
      id: peripheral.id,
      name: peripheral.advertisement?.localName || 'TropX Device',
      address: peripheral.address || peripheral.id,
      rssi: peripheral.rssi || -100,
      state: 'discovered' as DeviceConnectionState,
      batteryLevel: null,
      lastSeen: new Date()
    };
  }

  // Wait for Bluetooth to be ready
  private async waitForBluetoothReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (noble.state === 'poweredOn') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Bluetooth adapter timeout'));
      }, 10000);

      noble.once('stateChange', (state: string) => {
        clearTimeout(timeout);
        if (state === 'poweredOn') {
          resolve();
        } else {
          reject(new Error(`Bluetooth not ready: ${state}`));
        }
      });
    });
  }

  // Getters
  get isBluetoothReady(): boolean {
    return noble?.state === 'poweredOn';
  }

  get scanningStatus(): boolean {
    return this.isScanning;
  }

  get connectedDeviceCount(): number {
    let count = 0;
    this.devices.forEach(device => {
      if (device.isConnected) {
        count++;
      }
    });
    return count;
  }
}