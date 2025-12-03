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
// Use UnifiedBLEStateStore as the single source of truth
import {
  UnifiedBLEStateStore,
  DeviceState,
  GlobalState,
  DeviceErrorType,
  identifyDevice,
} from '../ble-management';

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
  private readonly BASE_RECONNECT_DELAY = 500; // 0.5 second - aggressive
  private readonly MAX_RECONNECT_DELAY = 15000; // 15 seconds max
  private stateChangeUnsubscribe: (() => void) | null = null;

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

      // Load Noble - fail fast if not available
      try {
        noble = require('@abandonware/noble');
        console.log('✅ Noble BLE library loaded');
      } catch (nobleError) {
        console.error('❌ Noble not available:', (nobleError as Error).message);
        console.error('💡 To use BLE: npm install @abandonware/noble');
        console.error('💡 Windows: Requires Visual Studio Build Tools');
        return false;
      }

      // Setup Noble event handlers
      this.setupNobleEvents();

      // Wait for Bluetooth adapter to be ready
      try {
        await this.waitForBluetoothReady();

        // Clear stale device states from previous session
        UnifiedBLEStateStore.clear();
        UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
        console.log('🧹 Cleared stale device states from previous session');

        // Subscribe to state changes to clear retry attempts
        this.subscribeToStateChanges();

        this.isInitialized = true;
        console.log('✅ Noble BLE service initialized');
        return true;
      } catch (bluetoothError) {
        console.error('❌ Bluetooth adapter not available:', bluetoothError);
        return false;
      }

    } catch (error) {
      console.error('❌ Failed to initialize Noble BLE service:', error);
      return false;
    }
  }

  // Start scanning for TropX devices
  async startScanning(): Promise<BleScanResult> {
    if (!this.isInitialized || !noble) {
      console.error('❌ BLE service not initialized');
      return { success: false, devices: [], message: 'BLE service not initialized' };
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
    // Use UnifiedBLEStateStore as single source of truth
    return UnifiedBLEStateStore.getAllDevices().map(d => ({
      id: d.bleAddress,
      name: d.bleName,
      address: d.bleAddress,
      rssi: d.rssi ?? -100,
      state: d.state as unknown as DeviceConnectionState,
      batteryLevel: d.batteryLevel,
      lastSeen: new Date(d.lastSeen),
    }));
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
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTING);
        } catch (e) { /* ignore transition error */ }
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
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.CONNECTION_FAILED, 'Device not found');
      }
      return result;
    }

    try {
      console.log(`🔗 [${deviceId}] Connecting to device: ${peripheral.advertisement?.localName || deviceId}`);

      // Create device wrapper with state management
      const deviceInfo = this.createDeviceInfo(peripheral);
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTING);
        } catch (e) { /* ignore transition error */ }
      }

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
        if (storeDeviceId) {
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTED);
          } catch (e) { /* ignore transition error */ }
        }

        console.log(`✅ [${deviceId}] Connected successfully`);

        // Check if app is IDLE but device might be streaming (reconnect after disconnect during streaming)
        // If so, stop streaming on the device to ensure it's in a clean state
        if (UnifiedBLEStateStore.getGlobalState() !== GlobalState.STREAMING) {
          await this.ensureDeviceNotStreaming(tropxDevice, deviceId);
        }

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
        if (storeDeviceId) {
          UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.CONNECTION_FAILED, 'Connection failed');
        }
        return {
          success: false,
          deviceId,
          message: 'Connection failed'
        };
      }

    } catch (error) {
      console.error(`❌ [${deviceId}] Connection error:`, error);
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.CONNECTION_FAILED, String(error));
      }
      return {
        success: false,
        deviceId,
        message: `Connection error: ${error}`
      };
    }
  }

  // Global streaming management with per-device control and state validation
  async startGlobalStreaming(): Promise<{ success: boolean; started: number; total: number; results: any[]; error?: string }> {
    const connectedDevices = UnifiedBLEStateStore.getConnectedDevices().map(d => ({
      id: d.bleAddress,
      name: d.bleName,
    }));

    if (connectedDevices.length === 0) {
      return { success: false, started: 0, total: 0, results: [] };
    }

    const globalStreamingStartTime = Date.now();
    console.log(`🎬 Starting global streaming on ${connectedDevices.length} connected devices...`);
    UnifiedBLEStateStore.setGlobalState(GlobalState.STREAMING);

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
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
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
      UnifiedBLEStateStore.setGlobalState(GlobalState.STREAMING);
      console.log(`✅ Global streaming started: ${successCount}/${connectedDevices.length} devices streaming (${globalStreamingTime}ms total)`);
    } else {
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
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
    const streamingDevices = UnifiedBLEStateStore.getStreamingDevices().map(d => ({
      id: d.bleAddress,
      name: d.bleName,
    }));

    if (streamingDevices.length === 0) {
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return { success: true, stopped: 0, total: 0 };
    }

    console.log(`🛑 Stopping global streaming on ${streamingDevices.length} devices...`);
    // Note: No "STOPPING" state in new GlobalState, just set to IDLE after

    // Stop streaming on all streaming devices in parallel
    const stoppingTasks = streamingDevices.map(device => this.stopDeviceStreaming(device.id));
    const results = await Promise.all(stoppingTasks);

    const successCount = results.filter(result => result.success).length;
    UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);

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
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        if (storeDeviceId) {
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.STREAMING);
          } catch (e) { /* ignore transition error */ }
        }
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
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTED);
        } catch (e) { /* ignore transition error */ }
      }

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
    if (UnifiedBLEStateStore.getGlobalState() !== GlobalState.STREAMING) {
      return false;
    }

    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (!storeDeviceId) return false;
    const device = UnifiedBLEStateStore.getDevice(storeDeviceId);
    if (!device || device.state !== DeviceState.CONNECTED) {
      return false;
    }

    console.log(`🔄 [${deviceId}] Auto-recovering streaming (global streaming is active)...`);
    const result = await this.startDeviceStreaming(deviceId);
    return result.success;
  }

  /**
   * Ensure device is not streaming (for reconnect during IDLE state)
   * Device may have been streaming when it disconnected and still be in streaming state
   */
  private async ensureDeviceNotStreaming(tropxDevice: TropXDevice, deviceId: string): Promise<void> {
    try {
      const { TropXCommands } = await import('./TropXCommands');
      const { TROPX_STATES } = await import('./BleBridgeConstants');

      const deviceState = await tropxDevice.getSystemState();
      const stateName = TropXCommands.getStateName(deviceState);

      // Check if device is in a streaming state
      if (deviceState === TROPX_STATES.TX_DIRECT || deviceState === TROPX_STATES.TX_BUFFERED) {
        console.log(`⚠️ [${deviceId}] Device is streaming (state: ${stateName}) but app is IDLE - stopping...`);
        const resetSuccess = await tropxDevice.resetToIdle();
        if (resetSuccess) {
          console.log(`✅ [${deviceId}] Device reset to IDLE - ready for clean state`);
        } else {
          console.warn(`⚠️ [${deviceId}] Could not reset device to IDLE`);
        }
      } else {
        console.log(`✅ [${deviceId}] Device not streaming (state: ${stateName}) - no reset needed`);
      }
    } catch (error) {
      console.warn(`⚠️ [${deviceId}] Could not check/reset device streaming state:`, error);
      // Don't fail connection - device might still work
    }
  }

  // Disconnect device with state management
  async disconnectDevice(deviceId: string): Promise<BleConnectionResult> {
    const device = this.devices.get(deviceId);
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

    if (!device) {
      // Update state manager even if device not found locally
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
        } catch (e) { /* ignore transition error */ }
      }
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
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
        } catch (e) { /* ignore transition error */ }
      }

      console.log(`✅ [${deviceId}] Disconnected successfully`);
      return {
        success: true,
        deviceId,
        message: 'Disconnected successfully'
      };

    } catch (error) {
      console.error(`❌ [${deviceId}] Disconnect error:`, error);
      if (storeDeviceId) {
        UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.UNKNOWN, String(error));
      }
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

  /**
   * Check if a device is actually connected at the BLE level
   * This checks the Noble peripheral state, not the application state
   * Used by Watchdog to verify disconnection before triggering reconnect
   */
  isDeviceActuallyConnected(bleAddress: string): boolean {
    const device = this.devices.get(bleAddress);
    if (!device) {
      return false;
    }
    return device.isConnected;
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
    if (UnifiedBLEStateStore.getGlobalState() === GlobalState.STREAMING) {
      // Schedule next poll
      this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
      return;
    }

    const connectedDevices = UnifiedBLEStateStore.getConnectedDevices().map(d => ({
      id: d.bleAddress,
      name: d.bleName,
    }));
    if (connectedDevices.length === 0) {
      // No devices to poll, schedule next check
      this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
      return;
    }

    // Poll all devices in parallel
    const { TropXCommands } = await import('./TropXCommands');

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

        // Update UnifiedBLEStateStore (single source of truth)
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceInfo.id);
        if (storeDeviceId) {
          // Device operational state is separate from connection status
          // Just update lastSeen for now
          UnifiedBLEStateStore.updateLastSeen(storeDeviceId);
        }

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
  // NOTE: State transition to RECONNECTING is handled by BLEServiceAdapter.handleDeviceEvent()
  // This method just schedules the timer and updates reconnect metadata
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

      // Auto-remove device from state store (synchronously)
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        UnifiedBLEStateStore.unregisterDevice(storeDeviceId);
      }
      return;
    }

    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, attempts),
      this.MAX_RECONNECT_DELAY
    );

    // Update reconnect metadata (state transition already done by BLEServiceAdapter)
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (storeDeviceId) {
      UnifiedBLEStateStore.setReconnectState(storeDeviceId, attempts + 1, Date.now() + delay);
    }

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

    // CRITICAL: Clean up old TropXDevice AND peripheral handlers
    const oldDevice = this.devices.get(deviceId);
    if (oldDevice) {
      console.log(`🧹 [${deviceName}] Cleaning up old device instance before reconnect`);
      this.devices.delete(deviceId);
    }

    // CRITICAL: Remove ALL listeners from peripheral to prevent handler accumulation
    // Each failed reconnection attempt adds handlers that interfere with subsequent attempts
    const peripheral = this.discoveredPeripherals.get(deviceId);
    if (peripheral) {
      console.log(`🧹 [${deviceName}] Removing stale handlers from peripheral`);
      peripheral.removeAllListeners('disconnect');
      peripheral.removeAllListeners('connect');
      peripheral.removeAllListeners('servicesDiscover');
    }

    // Transition to CONNECTING before attempting
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (storeDeviceId) {
      try {
        UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTING);
      } catch (e) { /* ignore invalid transition */ }
    }

    // FAST PATH: Try existing peripheral first (no scan delay)
    const existingPeripheral = this.discoveredPeripherals.get(deviceId);
    if (existingPeripheral) {
      console.log(`⚡ [${deviceName}] Fast path: trying existing peripheral...`);
      const result = await this.connectToDevice(deviceId);

      if (result.success) {
        console.log(`✅ [${deviceName}] Reconnected via fast path!`);
        this.reconnectAttempts.delete(deviceId);
        this.reconnectTimers.delete(deviceId);
        if (storeDeviceId) {
          // Clear reconnect state AND force immediate broadcast
          UnifiedBLEStateStore.setReconnectState(storeDeviceId, 0, null);
          UnifiedBLEStateStore.clearReconnectState(storeDeviceId);
        }
        return;
      }

      console.log(`⚠️ [${deviceName}] Fast path failed, trying rescan...`);
    }

    // SLOW PATH: Rescan to get fresh peripheral (2 second timeout)
    console.log(`🔍 [${deviceName}] Scanning for fresh peripheral...`);
    const freshPeripheral = await this.scanForDevice(deviceId, deviceName, 2000);

    if (!freshPeripheral) {
      console.log(`⚠️ [${deviceName}] Device not found - will retry later`);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.RECONNECTING);
        } catch (e) { /* ignore invalid transition */ }
      }
      this.scheduleReconnect(deviceId, deviceName);
      return;
    }

    console.log(`✅ [${deviceName}] Fresh peripheral found, connecting...`);
    const result = await this.connectToDevice(deviceId);

    if (result.success) {
      console.log(`✅ [${deviceName}] Reconnected successfully!`);
      this.reconnectAttempts.delete(deviceId);
      this.reconnectTimers.delete(deviceId);

      // Clear reconnecting state AND force immediate broadcast
      if (storeDeviceId) {
        UnifiedBLEStateStore.setReconnectState(storeDeviceId, 0, null);
        UnifiedBLEStateStore.clearReconnectState(storeDeviceId);
      }
    } else {
      console.log(`❌ [${deviceName}] Reconnect failed: ${result.message}`);
      // Transition back to RECONNECTING before scheduling next attempt
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.RECONNECTING);
        } catch (e) { /* ignore invalid transition */ }
      }
      // Schedule next attempt
      this.scheduleReconnect(deviceId, deviceName);
    }
  }

  /**
   * Scan for a specific device by ID
   * Used before reconnection to get a fresh peripheral object
   * @returns The peripheral if found, null if not found within timeout
   */
  private async scanForDevice(deviceId: string, deviceName: string, timeoutMs: number): Promise<any | null> {
    return new Promise(async (resolve) => {
      let found = false;
      let scanStarted = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!found) {
          console.log(`⏱️ [${deviceName}] Scan timeout after ${timeoutMs}ms`);
          if (scanStarted && this.isScanning) {
            this.stopScanning(true).catch(() => {});
          }
          resolve(null);
        }
      }, timeoutMs);

      // Check if device is already in discovered peripherals and still valid
      const existingPeripheral = this.discoveredPeripherals.get(deviceId);
      if (existingPeripheral) {
        // Check if peripheral is still usable (Noble peripheral state check)
        const peripheralState = existingPeripheral.state;
        if (peripheralState === 'disconnected') {
          // Peripheral exists and is in disconnected state - might be usable
          // But let's still try a quick scan to refresh it
          console.log(`📋 [${deviceName}] Found cached peripheral (state: ${peripheralState}), refreshing...`);
        }
      }

      // Set up a listener for this specific device
      const discoverHandler = (peripheral: any) => {
        const name = peripheral.advertisement?.localName || '';
        if (peripheral.id === deviceId || name === deviceName) {
          found = true;
          clearTimeout(timeout);

          // Update the cached peripheral with fresh reference
          this.discoveredPeripherals.set(peripheral.id, peripheral);
          console.log(`✅ [${deviceName}] Device rediscovered during reconnect scan`);

          // Stop scanning
          if (this.isScanning) {
            this.stopScanning(true).catch(() => {});
          }

          // Remove listener
          if (noble) {
            noble.removeListener('discover', discoverHandler);
          }

          resolve(peripheral);
        }
      };

      // Add discover listener
      if (noble) {
        noble.on('discover', discoverHandler);
      }

      // Start scanning
      try {
        // Only start if not already scanning
        if (!this.isScanning) {
          scanStarted = true;
          await noble.startScanningAsync([], false);
          this.isScanning = true;
        } else {
          // Already scanning, just wait
          console.log(`📡 [${deviceName}] Scan already in progress, waiting for device...`);
        }
      } catch (error) {
        console.warn(`⚠️ [${deviceName}] Failed to start reconnect scan:`, error);
        clearTimeout(timeout);
        if (noble) {
          noble.removeListener('discover', discoverHandler);
        }
        // Even if scan fails, try with existing peripheral
        resolve(existingPeripheral || null);
      }
    });
  }

  cancelReconnect(deviceId: string): void {
    const timer = this.reconnectTimers.get(deviceId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(deviceId);
    }
    this.reconnectAttempts.delete(deviceId);

    // Clear reconnecting state in UnifiedBLEStateStore (synchronous)
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (storeDeviceId) {
      // Transition back to DISCONNECTED and clear reconnect state
      try {
        UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
      } catch (e) { /* ignore invalid transition */ }
      UnifiedBLEStateStore.setReconnectState(storeDeviceId, 0, null);
    }
  }

  async removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      // Cancel any ongoing reconnect
      this.cancelReconnect(deviceId);

      // Remove from UnifiedBLEStateStore (using already imported module)
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

      if (storeDeviceId) {
        UnifiedBLEStateStore.unregisterDevice(storeDeviceId);
        console.log(`🗑️ Device 0x${storeDeviceId.toString(16)} removed successfully`);
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

  // Subscribe to state changes to clear retry attempts
  private subscribeToStateChanges(): void {
    const handler = (change: { deviceId: number; previousState: DeviceState; newState: DeviceState }) => {
      // Get the BLE address for this device ID
      const device = UnifiedBLEStateStore.getDevice(change.deviceId);
      if (!device) return;

      const bleAddress = device.bleAddress;

      // Clear retry attempts on ANY state change
      // This ensures fresh retry counts when a device reconnects later
      if (this.reconnectAttempts.has(bleAddress)) {
        console.log(`🔄 [${device.bleName}] Clearing retry attempts on state change: ${change.previousState} → ${change.newState}`);
        this.reconnectAttempts.delete(bleAddress);
      }

      // Also clear any pending reconnect timer if device state changed
      const timer = this.reconnectTimers.get(bleAddress);
      if (timer && change.newState !== DeviceState.RECONNECTING && change.newState !== DeviceState.CONNECTING) {
        console.log(`⏹️ [${device.bleName}] Cancelling pending reconnect timer on state change`);
        clearTimeout(timer);
        this.reconnectTimers.delete(bleAddress);
      }
    };

    UnifiedBLEStateStore.on('deviceStateChanged', handler);

    // Store unsubscribe function for cleanup
    this.stateChangeUnsubscribe = () => {
      UnifiedBLEStateStore.removeListener('deviceStateChanged', handler);
    };
  }

  // Cleanup and disconnect all
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Noble BLE service...');
    this.isCleaningUp = true;

    // Unsubscribe from state changes
    if (this.stateChangeUnsubscribe) {
      this.stateChangeUnsubscribe();
      this.stateChangeUnsubscribe = null;
    }

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
        const isCurrentlyStreaming = UnifiedBLEStateStore.getGlobalState() === GlobalState.STREAMING;

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

    // Register device in UnifiedBLEStateStore (single source of truth)
    const bleAddress = peripheral.id;

    // Check if device was previously registered
    let storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(bleAddress);

    if (!storeDeviceId) {
      // Register new device - this identifies it from the name pattern
      storeDeviceId = UnifiedBLEStateStore.registerDevice(bleAddress, deviceName);
      if (!storeDeviceId) {
        console.warn(`⚠️ Could not register device: ${deviceName} - unknown pattern`);
        return;
      }
    }

    // Update RSSI
    UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, {
      rssi: peripheral.rssi,
    });

    // Get current state to check if we need to transition
    const existingDevice = UnifiedBLEStateStore.getDevice(storeDeviceId);
    if (existingDevice) {
      // Only transition to DISCOVERED if currently DISCONNECTED
      if (existingDevice.state === DeviceState.DISCONNECTED) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCOVERED);
        } catch (e) { /* ignore transition error */ }
      } else if (existingDevice.state === DeviceState.CONNECTED || existingDevice.state === DeviceState.STREAMING) {
        console.log(`🔄 Device ${deviceName} rediscovered - preserving ${existingDevice.state} state`);
      }
    }

    // Create device info for event callback
    const deviceInfo = this.createDeviceInfo(peripheral);

    // Notify event callback
    if (this.deviceEventCallback) {
      console.log(`📱 Device event: ${peripheral.id} - discovered`, deviceInfo);
      this.deviceEventCallback(peripheral.id, 'discovered', deviceInfo);
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
      }, 15000); // Increased timeout to 15s to allow for state transitions

      const stateChangeHandler = (state: string) => {
        console.log(`🔄 Bluetooth state during initialization: ${state}`);
        if (state === 'poweredOn') {
          clearTimeout(timeout);
          noble.removeListener('stateChange', stateChangeHandler);
          resolve();
        }
        // Don't reject on other states - keep waiting for poweredOn
        // Only timeout will cause rejection if poweredOn never arrives
      };

      noble.on('stateChange', stateChangeHandler);
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
    if (UnifiedBLEStateStore.getGlobalState() === GlobalState.STREAMING) {
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