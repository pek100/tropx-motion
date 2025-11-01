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
  // Burst scanning support
  private burstEnabled: boolean = BLE_CONFIG.SCAN_BURST_ENABLED;
  private nextBurstTimer: NodeJS.Timeout | null = null;
  private burstTimeoutTimer: NodeJS.Timeout | null = null;
  private isCleaningUp = false;

  // State polling support
  private statePollingTimer: NodeJS.Timeout | null = null;
  private isStatePollingEnabled = false;
  private deviceStates = new Map<string, { state: number; stateName: string; lastUpdate: number }>();

  // Auto-reconnect support
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private reconnectAttempts = new Map<string, number>();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly BASE_RECONNECT_DELAY = 2000; // 2 seconds
  private readonly MAX_RECONNECT_DELAY = 60000; // 60 seconds

  // Expose scanning state (for snapshot-based burst scanning)
  public isScanningActive(): boolean {
    return this.isScanning;
  }

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

          // Clear stale device states from previous session
          const { deviceStateManager: dsm, GlobalStreamingState: gss } = await import('./DeviceStateManager');
          dsm.clearAllDevices();
          dsm.setGlobalStreamingState(gss.STOPPED);
          console.log('🧹 Cleared stale device states from previous session');

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

        // Clear stale device states from previous session
        const { deviceStateManager, GlobalStreamingState } = await import('./DeviceStateManager');
        deviceStateManager.clearAllDevices();
        deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
        console.log('🧹 Cleared stale device states from previous session');

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

          // Clear stale device states from previous session
          const { deviceStateManager: dsm2, GlobalStreamingState: gss2 } = await import('./DeviceStateManager');
          dsm2.clearAllDevices();
          dsm2.setGlobalStreamingState(gss2.STOPPED);
          console.log('🧹 Cleared stale device states from previous session');

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

    if (!noble) {
      console.log('🧪 Using mock service for scanning (noble is null)');
      console.log('❌ This should not happen - mock service should have replaced this method');
      return { success: false, devices: [], message: 'Mock service not properly initialized' };
    }

    if (this.isScanning) {
      return { success: false, devices: [], message: 'Already scanning' };
    }

    try {
      console.log(`📡 Starting BLE scan for devices (${BLE_CONFIG.DEVICE_PATTERNS.join(', ')})...`);
      console.log(`🔍 Keeping ${this.discoveredPeripherals.size} previously discovered devices`);
      this.isScanning = true;

      await noble.startScanningAsync([], false);

      // Clear any pending burst timers when a new scan starts
      if (this.nextBurstTimer) {
        clearTimeout(this.nextBurstTimer);
        this.nextBurstTimer = null;
      }

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

  // Stop scanning (optionally suppress scheduling next burst)
  async stopScanning(suppressNext: boolean = false): Promise<void> {
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

      // Schedule next burst if enabled
      if (!suppressNext && this.burstEnabled && !this.isCleaningUp) {
        this.scheduleNextBurst();
      } else if (suppressNext) {
        console.log('⏹️ Burst scheduling suppressed for this stop.');
      }

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

  // Global streaming management with per-device control and state validation
  async startGlobalStreaming(): Promise<{ success: boolean; started: number; total: number; results: any[]; error?: string }> {
    const connectedDevices = deviceStateManager.getConnectedDevices();

    if (connectedDevices.length === 0) {
      return { success: false, started: 0, total: 0, results: [] };
    }

    const globalStreamingStartTime = Date.now();
    console.log(`🎬 Starting global streaming on ${connectedDevices.length} connected devices...`);
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STARTING);

    // CRITICAL: Disable burst scanning to prevent interference with active notifications
    // Noble scan state changes can disrupt GATT notification subscriptions
    if (this.burstEnabled) {
      console.log('🛑 Disabling burst scanning during streaming (prevents notification interference)');
      await this.stopScanning(true); // Stop any active scan, suppress next burst
      this.setBurstScanningEnabled(false);
    }

    // STEP 1: Validate and reset device states (up to 2 attempts)
    const resetResult = await this.validateAndResetDeviceStates(connectedDevices, 2);
    if (!resetResult.success) {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
      return {
        success: false,
        started: 0,
        total: connectedDevices.length,
        results: [],
        error: resetResult.error
      };
    }

    // STEP 2: Start streaming on all connected devices in parallel
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

  /**
   * Validate device states and reset non-IDLE devices
   * Retries up to maxAttempts times
   */
  private async validateAndResetDeviceStates(
    connectedDevices: any[],
    maxAttempts: number
  ): Promise<{ success: boolean; error?: string }> {
    const { TropXCommands } = await import('./TropXCommands');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`🔍 State validation attempt ${attempt}/${maxAttempts}...`);

      // Check all device states in parallel
      const stateChecks = connectedDevices.map(async (deviceState) => {
        const device = this.devices.get(deviceState.id);
        if (!device) return { id: deviceState.id, name: deviceState.name, state: 0x00, valid: false };

        const state = await device.getSystemState();
        const valid = TropXCommands.isValidForStreaming(state);

        return {
          id: deviceState.id,
          name: deviceState.name,
          state,
          stateName: TropXCommands.getStateName(state),
          valid
        };
      });

      const deviceStates = await Promise.all(stateChecks);

      // Check if all devices are valid
      const invalidDevices = deviceStates.filter(d => !d.valid);

      if (invalidDevices.length === 0) {
        console.log(`✅ All devices in valid state for streaming`);
        return { success: true };
      }

      // If this is not the last attempt, try to reset invalid devices
      if (attempt < maxAttempts) {
        console.log(`⚠️ ${invalidDevices.length} device(s) not ready: ${invalidDevices.map(d => `${d.name} (${d.stateName})`).join(', ')}`);
        console.log(`🔄 Resetting devices to IDLE state...`);

        // Reset all invalid devices in parallel
        const resetTasks = invalidDevices.map(async (deviceInfo) => {
          const device = this.devices.get(deviceInfo.id);
          if (device) {
            return await device.resetToIdle();
          }
          return false;
        });

        await Promise.all(resetTasks);

        // Wait for devices to settle
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        // Last attempt failed
        const deviceList = invalidDevices.map(d => `${d.name} (${d.stateName})`).join(', ');
        const error = `Failed to reset devices to IDLE state: ${deviceList}. Please check if all devices are powered on.`;
        console.error(`❌ ${error}`);
        return { success: false, error };
      }
    }

    return { success: false, error: 'Unexpected error in state validation' };
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

    // Re-enable burst scanning now that streaming is stopped (allows discovery of new devices)
    if (BLE_CONFIG.SCAN_BURST_ENABLED && !this.burstEnabled) {
      console.log('🔁 Re-enabling burst scanning (streaming stopped)');
      this.setBurstScanningEnabled(true);
    }

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

  // Get TropXDevice instance by ID (for time sync and other operations)
  getDeviceInstance(deviceId: string): TropXDevice | null {
    return this.devices.get(deviceId) || null;
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

  // State Polling - Poll device states every 5 seconds when not streaming
  startStatePolling(): void {
    if (this.isStatePollingEnabled) {
      console.log('ℹ️  State polling already enabled');
      return;
    }

    console.log('🔄 Starting device state polling (every 5 seconds)');
    this.isStatePollingEnabled = true;
    this.pollDeviceStates(); // Start immediately
  }

  stopStatePolling(): void {
    if (!this.isStatePollingEnabled) return;

    console.log('🛑 Stopping device state polling');
    this.isStatePollingEnabled = false;

    if (this.statePollingTimer) {
      clearTimeout(this.statePollingTimer);
      this.statePollingTimer = null;
    }
  }

  private async pollDeviceStates(): Promise<void> {
    if (!this.isStatePollingEnabled) return;

    // Don't poll during streaming - BLE is busy
    const isStreaming = deviceStateManager.getGlobalStreamingState() === GlobalStreamingState.ACTIVE;
    if (isStreaming) {
      // Schedule next poll
      this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
      return;
    }

    const connectedDevices = deviceStateManager.getConnectedDevices();
    if (connectedDevices.length === 0) {
      // No devices to poll, schedule next check
      this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
      return;
    }

    // Poll all devices in parallel
    const { TropXCommands } = await import('./TropXCommands');
    const { deviceRegistry } = await import('../registry-management');

    await Promise.all(connectedDevices.map(async (deviceInfo) => {
      const device = this.devices.get(deviceInfo.id);
      if (!device) return;

      try {
        const state = await device.getSystemState();
        const stateName = TropXCommands.getStateName(state);

        // Store state locally
        const previousState = this.deviceStates.get(deviceInfo.id);
        this.deviceStates.set(deviceInfo.id, {
          state,
          stateName,
          lastUpdate: Date.now()
        });

        // Update registry (single source of truth) - registry will notify UI
        deviceRegistry.setDeviceState(deviceInfo.id, stateName, state);

        // Notify via event callback (for backwards compatibility)
        if (!previousState || previousState.state !== state) {
          if (this.deviceEventCallback) {
            this.deviceEventCallback(deviceInfo.id, 'state_changed', { state, stateName });
          }
        }
      } catch (error) {
        console.error(`❌ [${deviceInfo.name}] Failed to poll state:`, error);
      }
    }));

    // Schedule next poll
    this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
  }

  getDeviceState(deviceId: string): { state: number; stateName: string; lastUpdate: number } | null {
    return this.deviceStates.get(deviceId) || null;
  }

  // Auto-reconnect with exponential backoff
  scheduleReconnect(deviceId: string, deviceName: string): void {
    // Clear any existing timer
    const existingTimer = this.reconnectTimers.get(deviceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const attempts = this.reconnectAttempts.get(deviceId) || 0;

    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`❌ [${deviceName}] Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Auto-removing device.`);
      this.reconnectAttempts.delete(deviceId);
      this.reconnectTimers.delete(deviceId);

      // Auto-remove device from registry
      (async () => {
        const { deviceRegistry } = await import('../registry-management');
        deviceRegistry.clearReconnecting(deviceId);
        deviceRegistry.removeDevice(deviceId);
      })();
      return;
    }

    // Set reconnecting state in registry
    (async () => {
      const { deviceRegistry } = await import('../registry-management');
      deviceRegistry.setReconnecting(deviceId, attempts + 1);
    })();

    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, attempts),
      this.MAX_RECONNECT_DELAY
    );

    console.log(`🔄 [${deviceName}] Scheduling reconnect attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(deviceId);
      await this.attemptReconnect(deviceId, deviceName);
    }, delay);

    this.reconnectTimers.set(deviceId, timer);
    this.reconnectAttempts.set(deviceId, attempts + 1);
  }

  private async attemptReconnect(deviceId: string, deviceName: string): Promise<void> {
    if (this.isCleaningUp) return;

    const attempts = this.reconnectAttempts.get(deviceId) || 0;
    console.log(`🔌 [${deviceName}] Reconnect attempt ${attempts}/${this.MAX_RECONNECT_ATTEMPTS}...`);

    const result = await this.connectToDevice(deviceId);

    if (result.success) {
      console.log(`✅ [${deviceName}] Reconnected successfully!`);
      this.reconnectAttempts.delete(deviceId);
      this.reconnectTimers.delete(deviceId);

      // Clear reconnecting state in registry
      const { deviceRegistry } = await import('../registry-management');
      deviceRegistry.clearReconnecting(deviceId);
    } else {
      console.log(`❌ [${deviceName}] Reconnect failed: ${result.message}`);
      // Schedule next attempt
      this.scheduleReconnect(deviceId, deviceName);
    }
  }

  cancelReconnect(deviceId: string): void {
    const timer = this.reconnectTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(deviceId);
    }
    this.reconnectAttempts.delete(deviceId);

    // Clear reconnecting state in registry
    (async () => {
      const { deviceRegistry } = await import('../registry-management');
      deviceRegistry.clearReconnecting(deviceId);
    })();
  }

  async removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      // Cancel any ongoing reconnect
      this.cancelReconnect(deviceId);

      // Remove from registry
      const { deviceRegistry } = await import('../registry-management');
      const removed = deviceRegistry.removeDevice(deviceId);

      if (removed) {
        console.log(`🗑️ Device ${deviceId} removed successfully`);
        return { success: true, message: 'Device removed' };
      } else {
        return { success: false, message: 'Device not found' };
      }
    } catch (error) {
      console.error(`Failed to remove device ${deviceId}:`, error);
      return {
        success: false,
        message: `Failed to remove device: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Cleanup and disconnect all
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Noble BLE service...');
    this.isCleaningUp = true;

    // Stop state polling
    this.stopStatePolling();

    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();

    if (this.isScanning) {
      await this.stopScanning(true); // suppress next burst during cleanup
    }
    if (this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
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
    this.isCleaningUp = false;
  }

  // Setup Noble event handlers
  private setupNobleEvents(): void {
    noble.on('stateChange', (state: string) => {
      console.log(`📶 Bluetooth state changed: ${state}`);
      if (state !== 'poweredOn') {
        if (this.isScanning) {
          // Suppress scheduling next burst while adapter is down
            this.stopScanning(true);
        }
      } else {
        // Adapter came back - resume burst scanning if enabled
        // BUT: Don't resume if we're currently streaming (prevents interference)
        const isCurrentlyStreaming = deviceStateManager.getGlobalStreamingState() === GlobalStreamingState.ACTIVE
          || deviceStateManager.getGlobalStreamingState() === GlobalStreamingState.STARTING;

        if (this.burstEnabled && !this.isScanning && !this.nextBurstTimer && !isCurrentlyStreaming) {
          this.scheduleNextBurst();
        } else if (isCurrentlyStreaming) {
          console.log('⏸️ Skipping burst resume - streaming is active');
        }
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
  private waitForBluetoothReady(): Promise<void> {
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

  get isBurstScanningEnabled(): boolean {
    return this.burstEnabled;
  }

  // Enable/disable burst scanning externally
  public setBurstScanningEnabled(enabled: boolean): void {
    if (this.burstEnabled === enabled) return;
    this.burstEnabled = enabled;
    console.log(`🔁 Burst scanning ${enabled ? 'enabled' : 'disabled'}`);
    if (enabled && !this.isScanning && !this.nextBurstTimer) {
      // Kick off an immediate scan
      this.startScanning().catch(err => console.error('Burst start error:', err));
    } else if (!enabled && this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }
  }

  // Enable burst scanning for a duration (e.g., 10 seconds)
  enableBurstScanningFor(durationMs: number): void {
    console.log(`🔄 Enabling burst scanning for ${durationMs}ms`);

    // Clear any existing burst timeout
    if (this.burstTimeoutTimer) {
      clearTimeout(this.burstTimeoutTimer);
      this.burstTimeoutTimer = null;
    }

    // Enable burst mode
    this.burstEnabled = true;

    // Start first scan immediately if not already scanning
    if (!this.isScanning && !this.isCleaningUp) {
      this.startScanning().catch(err => console.error('Failed to start burst scan:', err));
    }

    // Auto-disable after duration
    this.burstTimeoutTimer = setTimeout(() => {
      console.log(`⏱️ Burst scanning duration (${durationMs}ms) elapsed - disabling`);
      this.disableBurstScanning();
      this.burstTimeoutTimer = null;
    }, durationMs);
  }

  // Manually disable burst scanning (e.g., when user clicks refresh to stop)
  disableBurstScanning(): void {
    console.log('🛑 Disabling burst scanning');
    this.burstEnabled = false;

    // Clear burst timeout timer
    if (this.burstTimeoutTimer) {
      clearTimeout(this.burstTimeoutTimer);
      this.burstTimeoutTimer = null;
    }

    // Clear next burst timer
    if (this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }

    // Stop current scan
    if (this.isScanning) {
      this.stopScanning(true).catch(err => console.error('Failed to stop scan:', err));
    }
  }

  private scheduleNextBurst(): void {
    if (this.isScanning || this.nextBurstTimer) return;
    if (!this.burstEnabled) return;

    // GUARD: Never schedule bursts during streaming
    const streamingState = deviceStateManager.getGlobalStreamingState();
    if (streamingState === GlobalStreamingState.ACTIVE || streamingState === GlobalStreamingState.STARTING) {
      console.log('⏸️ Skipping burst schedule - streaming is active');
      return;
    }

    console.log(`⏳ Scheduling next scan burst in ${BLE_CONFIG.SCAN_BURST_GAP}ms`);
    this.nextBurstTimer = setTimeout(async () => {
      this.nextBurstTimer = null;
      if (this.burstEnabled && !this.isScanning && !this.isCleaningUp) {
        console.log('🚀 Starting next scan burst');
        await this.startScanning();
      }
    }, BLE_CONFIG.SCAN_BURST_GAP);
  }
}