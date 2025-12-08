/**
 * Unified BLE Service
 * Platform-agnostic BLE service using transport and strategy abstractions
 * Single implementation for all platforms (Windows, macOS, Linux/Pi)
 */

import {
  TropXDeviceInfo,
  BleScanResult,
  BleConnectionResult,
  MotionDataCallback,
  DeviceEventCallback,
  DeviceConnectionState,
} from './BleBridgeTypes';

import { BLE_CONFIG } from './BleBridgeConstants';
import { TropXDevice } from './TropXDevice';
import { ITransport, IPeripheral, DiscoveredDevice } from './interfaces/ITransport';
import { IConnectionStrategy, ConnectionResult } from './interfaces/IConnectionStrategy';

import {
  UnifiedBLEStateStore,
  DeviceState,
  GlobalState,
  DeviceErrorType,
  BLE_CONFIG as BLE_RECONNECT_CONFIG,
} from '../ble-management';

// ─────────────────────────────────────────────────────────────────────────────
// Unified BLE Service
// ─────────────────────────────────────────────────────────────────────────────

export class UnifiedBLEService {
  private transport: ITransport;
  private strategy: IConnectionStrategy;

  // Device tracking
  private devices = new Map<string, TropXDevice>();
  private isCleaningUp = false;

  // Burst scanning
  private burstEnabled: boolean = BLE_CONFIG.SCAN_BURST_ENABLED;
  private nextBurstTimer: NodeJS.Timeout | null = null;
  private burstTimeoutTimer: NodeJS.Timeout | null = null;

  // Extended scan tracking - for verifying persistent devices
  private scanStartTime: number = 0;
  private devicesToVerify: Map<number, { bleName: string; lastSeenBefore: number }> = new Map();
  private isExtendedScan: boolean = false;

  // State polling
  private statePollingTimer: NodeJS.Timeout | null = null;
  private isStatePollingEnabled = false;
  private deviceStates = new Map<string, { state: number; stateName: string; lastUpdate: number }>();

  // State change subscription
  private stateChangeUnsubscribe: (() => void) | null = null;

  // Callbacks
  private motionDataCallback: MotionDataCallback | null = null;
  private deviceEventCallback: DeviceEventCallback | null = null;

  constructor(
    transport: ITransport,
    strategy: IConnectionStrategy,
    motionCallback?: MotionDataCallback,
    eventCallback?: DeviceEventCallback
  ) {
    this.transport = transport;
    this.strategy = strategy;
    this.motionDataCallback = motionCallback || null;
    this.deviceEventCallback = eventCallback || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  async initialize(): Promise<boolean> {
    try {
      console.log('[UnifiedBLEService] Initializing...');

      const initialized = await this.transport.initialize();
      if (!initialized) {
        console.error('[UnifiedBLEService] Transport initialization failed');
        return false;
      }

      // Setup transport event handlers
      this.setupTransportEvents();

      // Clear stale state
      UnifiedBLEStateStore.clear();
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      console.log('[UnifiedBLEService] Cleared stale device states');

      // Subscribe to state changes
      this.subscribeToStateChanges();

      console.log('[UnifiedBLEService] Initialized successfully');
      return true;

    } catch (error) {
      console.error('[UnifiedBLEService] Initialization failed:', error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    console.log('[UnifiedBLEService] Cleaning up...');
    this.isCleaningUp = true;

    // Unsubscribe from state changes
    if (this.stateChangeUnsubscribe) {
      this.stateChangeUnsubscribe();
      this.stateChangeUnsubscribe = null;
    }

    // Stop state polling
    this.stopStatePolling();

    // Stop scanning
    if (this.transport.isScanning) {
      await this.stopScanning(true);
    }

    // Clear burst timers
    if (this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }
    if (this.burstTimeoutTimer) {
      clearTimeout(this.burstTimeoutTimer);
      this.burstTimeoutTimer = null;
    }

    // Disconnect all devices
    const disconnectPromises: Promise<void>[] = [];
    this.devices.forEach(device => {
      disconnectPromises.push(
        device.disconnect().catch(error =>
          console.error('[UnifiedBLEService] Error disconnecting device:', error)
        )
      );
    });

    await Promise.allSettled(disconnectPromises);
    this.devices.clear();

    // Cleanup transport
    await this.transport.cleanup();

    console.log('[UnifiedBLEService] Cleanup complete');
    this.isCleaningUp = false;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Scanning
  // ─────────────────────────────────────────────────────────────────────────────

  async startScanning(): Promise<BleScanResult> {
    if (!this.transport.isInitialized) {
      return { success: false, devices: [], message: 'BLE service not initialized' };
    }

    if (this.transport.isScanning) {
      return { success: false, devices: [], message: 'Already scanning' };
    }

    try {
      console.log(`[UnifiedBLEService] Starting scan for: ${BLE_CONFIG.DEVICE_PATTERNS.join(', ')}`);

      // Clear burst timer
      if (this.nextBurstTimer) {
        clearTimeout(this.nextBurstTimer);
        this.nextBurstTimer = null;
      }

      await this.transport.startScan();

      return {
        success: true,
        devices: [],
        message: 'Scanning started - devices will be discovered during scan'
      };

    } catch (error) {
      console.error('[UnifiedBLEService] Failed to start scanning:', error);
      return { success: false, devices: [], message: `Scan failed: ${error}` };
    }
  }

  async stopScanning(suppressNext: boolean = false): Promise<void> {
    if (!this.transport.isScanning) return;

    try {
      console.log('[UnifiedBLEService] Stopping scan...');
      await this.transport.stopScan();

      const discoveredDevices = this.getDiscoveredDevices();
      console.log(`[UnifiedBLEService] Scan stopped. Found ${discoveredDevices.length} devices`);

      // Schedule next burst if enabled
      if (!suppressNext && this.burstEnabled && !this.isCleaningUp) {
        this.scheduleNextBurst();
      }

    } catch (error) {
      console.error('[UnifiedBLEService] Error stopping scan:', error);
    }
  }

  isScanningActive(): boolean {
    return this.transport.isScanning;
  }

  getDiscoveredDevices(): TropXDeviceInfo[] {
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

  // ─────────────────────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────────────────────

  async connectToDevice(deviceId: string): Promise<BleConnectionResult> {
    // Check if device is in ERROR state - handle based on global state
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (storeDeviceId) {
      const device = UnifiedBLEStateStore.getDevice(storeDeviceId);
      if (device && device.state === DeviceState.ERROR) {
        const globalState = UnifiedBLEStateStore.getGlobalState();

        // During streaming: can't scan, inform user to stop streaming first
        if (globalState === GlobalState.STREAMING) {
          console.log(`[UnifiedBLEService] Device ${device.bleName} is in ERROR state but streaming is active - cannot auto-scan`);
          return {
            success: false,
            deviceId,
            message: 'Device unavailable. Stop streaming first, then scan to rediscover.'
          };
        }

        // Not streaming: auto-scan to rediscover the device
        console.log(`[UnifiedBLEService] Device ${device.bleName} is in ERROR state - auto-scanning to rediscover...`);

        // Clear the stale peripheral from transport cache first
        await this.transport.forgetPeripheral(deviceId);

        // Start a short scan to rediscover the device
        const SCAN_TIMEOUT_MS = 8000; // 8 seconds to find the device
        const scanStartTime = Date.now();

        // Start scanning
        await this.startScanning();

        // Wait for device to be rediscovered (poll state store)
        let rediscovered = false;
        while (Date.now() - scanStartTime < SCAN_TIMEOUT_MS) {
          await this.delay(500); // Check every 500ms

          const updatedDevice = UnifiedBLEStateStore.getDevice(storeDeviceId);
          if (updatedDevice && updatedDevice.state === DeviceState.DISCOVERED) {
            rediscovered = true;
            console.log(`[UnifiedBLEService] Device ${device.bleName} rediscovered after ${Date.now() - scanStartTime}ms`);
            break;
          }
        }

        // Stop scanning
        await this.stopScanning(true);

        if (!rediscovered) {
          console.log(`[UnifiedBLEService] Device ${device.bleName} not found after ${SCAN_TIMEOUT_MS}ms scan`);
          return {
            success: false,
            deviceId,
            message: 'Device not found. It may be powered off or out of range.'
          };
        }

        // Device rediscovered - fall through to normal connection flow
        console.log(`[UnifiedBLEService] Proceeding with connection to rediscovered device ${device.bleName}`);
      }
    }

    const results = await this.connectToDevices([deviceId]);
    return results[0] || {
      success: false,
      deviceId,
      message: 'Connection failed - no result returned'
    };
  }

  async connectToDevices(deviceIds: string[]): Promise<BleConnectionResult[]> {
    if (deviceIds.length === 0) {
      return [];
    }

    console.log(`[UnifiedBLEService] Connecting to ${deviceIds.length} device(s)...`);

    const results: BleConnectionResult[] = [];

    // Process each device with retry logic
    // Sequential processing respects the Pi's BLE stack limitations
    for (const deviceId of deviceIds) {
      const result = await this.connectSingleDeviceWithRetry(deviceId);
      results.push(result);
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[UnifiedBLEService] Connection completed: ${successCount}/${deviceIds.length} connected`);

    return results;
  }

  /**
   * Connect to a single device with automatic retry on failure
   * Uses RECONNECTING state and exponential backoff
   */
  private async connectSingleDeviceWithRetry(deviceId: string): Promise<BleConnectionResult> {
    const { reconnect } = BLE_RECONNECT_CONFIG;
    const maxAttempts = reconnect.maxAttempts;

    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    const peripheral = this.transport.getPeripheral(deviceId);

    // Check if peripheral exists
    if (!peripheral) {
      if (storeDeviceId) {
        console.log(`[UnifiedBLEService] Device ${deviceId} not found - marking as unavailable`);
        UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.CONNECTION_FAILED, 'Device not found - may be powered off or out of range');
        UnifiedBLEStateStore.forceBroadcast();
      }
      return {
        success: false,
        deviceId,
        message: 'Device unavailable - may be powered off or out of range'
      };
    }

    // Reset reconnect attempts for fresh connection attempt
    if (storeDeviceId) {
      UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { reconnectAttempts: 0 });
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[UnifiedBLEService] Connection attempt ${attempt}/${maxAttempts} for ${peripheral.name}`);

      // Transition to CONNECTING state
      if (storeDeviceId) {
        try {
          // First attempt: DISCOVERED → CONNECTING
          // Retry attempts: RECONNECTING → CONNECTING
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTING);
          UnifiedBLEStateStore.forceBroadcast();
        } catch (e) {
          console.debug(`[UnifiedBLEService] State transition to CONNECTING failed:`, e);
        }
      }

      // Use strategy to connect (single device)
      const connectionResults = await this.strategy.connect([peripheral]);
      const result = connectionResults[0];

      if (result?.success && result.peripheral) {
        // Connection successful - setup the device
        const bleResult = await this.setupConnectedDevice(result.deviceId, result.peripheral);
        if (bleResult.success) {
          // Reset reconnect attempts on success
          if (storeDeviceId) {
            UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { reconnectAttempts: 0 });
          }
          return bleResult;
        }
        // setupConnectedDevice failed - treat as connection failure
      }

      // Connection failed
      const error = result?.error || 'Connection failed';
      console.log(`[UnifiedBLEService] Attempt ${attempt}/${maxAttempts} failed: ${error}`);

      // Update reconnect attempts in state store
      if (storeDeviceId) {
        UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { reconnectAttempts: attempt });
      }

      // Check if we should retry
      if (attempt < maxAttempts) {
        // Transition to RECONNECTING state
        if (storeDeviceId) {
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.RECONNECTING);

            // Calculate backoff delay with exponential increase
            const delayMs = Math.min(
              reconnect.baseDelayMs * Math.pow(reconnect.backoffMultiplier, attempt - 1),
              reconnect.maxDelayMs
            );
            const nextReconnectAt = Date.now() + delayMs;
            UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { nextReconnectAt });
            UnifiedBLEStateStore.forceBroadcast();

            console.log(`[UnifiedBLEService] Retrying ${peripheral.name} in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
            await this.delay(delayMs);
          } catch (e) {
            console.debug(`[UnifiedBLEService] State transition to RECONNECTING failed:`, e);
          }
        }
      }
    }

    // All attempts exhausted - mark as unavailable (ERROR state)
    if (storeDeviceId) {
      console.log(`[UnifiedBLEService] All ${maxAttempts} attempts failed for ${peripheral.name} - marking as unavailable`);
      UnifiedBLEStateStore.transitionToError(
        storeDeviceId,
        DeviceErrorType.MAX_RECONNECT_EXCEEDED,
        `Connection failed after ${maxAttempts} attempts`
      );
      UnifiedBLEStateStore.forceBroadcast();
    }

    return {
      success: false,
      deviceId,
      message: `Device unavailable after ${maxAttempts} connection attempts`
    };
  }

  private async setupConnectedDevice(deviceId: string, peripheral: IPeripheral): Promise<BleConnectionResult> {
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

    console.log(`[UnifiedBLEService] setupConnectedDevice called with:`);
    console.log(`[UnifiedBLEService]   deviceId (from strategy): "${deviceId}"`);
    console.log(`[UnifiedBLEService]   peripheral.id: "${peripheral.id}"`);
    console.log(`[UnifiedBLEService]   peripheral.address: "${peripheral.address}"`);
    console.log(`[UnifiedBLEService]   peripheral.name: "${peripheral.name}"`);
    console.log(`[UnifiedBLEService]   storeDeviceId (numeric): ${storeDeviceId !== null ? `0x${storeDeviceId.toString(16)}` : 'null'}`);

    try {
      // Create device info
      const deviceInfo: TropXDeviceInfo = {
        id: deviceId,
        name: peripheral.name,
        address: peripheral.address,
        rssi: peripheral.rssi,
        state: 'connected',
        batteryLevel: null,
        lastSeen: new Date()
      };

      // Create TropXDevice
      // NOTE: TropXDevice will be refactored to use IPeripheral
      // For now, we pass the peripheral and it works because IPeripheral matches the Noble interface
      const tropxDevice = new TropXDevice(
        peripheral,
        deviceInfo,
        this.motionDataCallback || undefined,
        this.deviceEventCallback || undefined
      );

      // Connect the TropXDevice (service discovery, characteristics, etc.)
      const connected = await tropxDevice.connect();

      if (connected) {
        console.log(`[UnifiedBLEService] Storing TropXDevice in map with key: "${deviceId}"`);
        this.devices.set(deviceId, tropxDevice);

        if (storeDeviceId) {
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTED);
            // Reset reconnect attempts on successful connection
            UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { reconnectAttempts: 0, nextReconnectAt: null });
            // CRITICAL: Force immediate broadcast for CONNECTED state
            // This ensures UI shows connected state with battery level immediately
            UnifiedBLEStateStore.forceBroadcast();
            console.log(`📡 [UnifiedBLEService] Forced broadcast for CONNECTED state`);
          } catch (e) {
            console.debug(`[UnifiedBLEService] State transition to CONNECTED failed for ${deviceId}:`, e);
          }
        }

        console.log(`[UnifiedBLEService] ${peripheral.name} connected successfully`);

        // Check if we need to recover streaming
        if (UnifiedBLEStateStore.getGlobalState() !== GlobalState.STREAMING) {
          await this.ensureDeviceNotStreaming(tropxDevice, deviceId);
        }

        const streamingRecovered = await this.recoverStreamingForDevice(deviceId);
        const message = streamingRecovered
          ? 'Connected successfully - streaming auto-recovered'
          : 'Connected successfully';

        return { success: true, deviceId, message };
      } else {
        // Connection failed - DON'T transition to ERROR here
        // The retry logic in connectSingleDeviceWithRetry handles state transitions
        console.log(`[UnifiedBLEService] TropXDevice.connect() failed for ${deviceId}`);
        return { success: false, deviceId, message: 'Connection failed' };
      }

    } catch (error) {
      // Connection error - DON'T transition to ERROR here
      // The retry logic in connectSingleDeviceWithRetry handles state transitions
      console.error(`[UnifiedBLEService] Connection error for ${deviceId}:`, error);
      return { success: false, deviceId, message: `Connection error: ${error}` };
    }
  }

  async disconnectDevice(deviceId: string): Promise<BleConnectionResult> {
    const device = this.devices.get(deviceId);
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

    if (!device) {
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
        } catch (e) {
          console.debug(`[UnifiedBLEService] State transition to DISCONNECTED failed for ${deviceId}:`, e);
        }
      }
      return { success: false, deviceId, message: 'Device not connected' };
    }

    try {
      console.log(`[UnifiedBLEService] Disconnecting ${deviceId}...`);
      await device.disconnect();

      this.devices.delete(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
        } catch (e) {
          console.debug(`[UnifiedBLEService] State transition to DISCONNECTED failed for ${deviceId}:`, e);
        }
      }

      return { success: true, deviceId, message: 'Disconnected successfully' };

    } catch (error) {
      console.error(`[UnifiedBLEService] Disconnect error:`, error);
      if (storeDeviceId) {
        UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.UNKNOWN, String(error));
      }
      return { success: false, deviceId, message: `Disconnect error: ${error}` };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Streaming
  // ─────────────────────────────────────────────────────────────────────────────

  async startGlobalStreaming(): Promise<{ success: boolean; started: number; total: number; results: any[]; error?: string }> {
    // CRITICAL FIX: Use this.devices map directly instead of state store
    // The state store might have different keys than what we stored devices with
    const connectedDevices: { id: string; name: string }[] = [];
    this.devices.forEach((device, deviceId) => {
      if (device.isConnected) {
        connectedDevices.push({
          id: deviceId,  // Use the key from this.devices map (guaranteed to match)
          name: device.deviceInfo.name,
        });
      }
    });

    console.log(`[UnifiedBLEService] startGlobalStreaming: Found ${connectedDevices.length} connected TropXDevice instances`);

    // Debug: Also show state store for comparison
    const storeDevices = UnifiedBLEStateStore.getConnectedDevices();
    console.log(`[UnifiedBLEService] startGlobalStreaming: State store has ${storeDevices.length} connected devices`);

    // Log the device IDs for debugging
    if (connectedDevices.length > 0) {
      console.log(`[UnifiedBLEService] TropXDevice map devices: ${connectedDevices.map(d => `${d.name}(${d.id})`).join(', ')}`);
    }
    if (storeDevices.length > 0) {
      console.log(`[UnifiedBLEService] State store devices: ${storeDevices.map(d => `${d.bleName}(${d.bleAddress})`).join(', ')}`);
    }

    if (connectedDevices.length === 0) {
      console.warn('[UnifiedBLEService] No connected TropXDevice instances found - cannot start streaming');
      return { success: false, started: 0, total: 0, results: [], error: 'No connected devices' };
    }

    const startTime = Date.now();
    console.log(`[UnifiedBLEService] Starting global streaming on ${connectedDevices.length} devices...`);

    // Set global state to STREAMING
    UnifiedBLEStateStore.setGlobalState(GlobalState.STREAMING);

    // Disable burst scanning during streaming
    if (this.burstEnabled) {
      console.log('[UnifiedBLEService] Disabling burst scanning during streaming');
      await this.stopScanning(true);
      this.setBurstScanningEnabled(false);
    }

    // Validate and reset device states
    const resetResult = await this.validateAndResetDeviceStates(connectedDevices, 2);
    if (!resetResult.success) {
      // Reset global state on failure
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return {
        success: false,
        started: 0,
        total: connectedDevices.length,
        results: [],
        error: resetResult.error
      };
    }

    // Start streaming on all devices
    const streamingTasks = connectedDevices.map(device => this.startDeviceStreaming(device.id));
    const results = await Promise.all(streamingTasks);

    const successCount = results.filter(r => r.success).length;
    const elapsed = Date.now() - startTime;

    if (successCount > 0) {
      console.log(`[UnifiedBLEService] Global streaming started: ${successCount}/${connectedDevices.length} (${elapsed}ms)`);
    } else {
      console.log(`[UnifiedBLEService] Global streaming failed: no devices started (${elapsed}ms)`);
      // Reset global state if no devices started
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
    }

    return {
      success: successCount > 0,
      started: successCount,
      total: connectedDevices.length,
      results
    };
  }

  async stopGlobalStreaming(): Promise<{ success: boolean; stopped: number; total: number }> {
    const streamingDevices = UnifiedBLEStateStore.getStreamingDevices().map(d => ({
      id: d.bleAddress,
      name: d.bleName,
    }));

    if (streamingDevices.length === 0) {
      // Reset global state even if no streaming devices
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      return { success: true, stopped: 0, total: 0 };
    }

    console.log(`[UnifiedBLEService] Stopping global streaming on ${streamingDevices.length} devices...`);

    const stoppingTasks = streamingDevices.map(device => this.stopDeviceStreaming(device.id));
    const results = await Promise.all(stoppingTasks);

    const successCount = results.filter(r => r.success).length;
    console.log(`[UnifiedBLEService] Global streaming stopped: ${successCount}/${streamingDevices.length}`);

    // Reset global state to IDLE
    UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);

    // Re-enable burst scanning
    if (BLE_CONFIG.SCAN_BURST_ENABLED && !this.burstEnabled) {
      console.log('[UnifiedBLEService] Re-enabling burst scanning');
      this.setBurstScanningEnabled(true);
    }

    return {
      success: true,
      stopped: successCount,
      total: streamingDevices.length
    };
  }

  /**
   * Stop streaming on all devices (alias for stopGlobalStreaming with Promise<void> return)
   */
  async stopStreamingAll(): Promise<void> {
    await this.stopGlobalStreaming();
  }

  private async startDeviceStreaming(deviceId: string): Promise<{ success: boolean; deviceId: string; message: string }> {
    const device = this.devices.get(deviceId);
    if (!device) {
      // Debug: Log map keys to help diagnose lookup failures
      const deviceKeys: string[] = [];
      this.devices.forEach((_, key) => deviceKeys.push(key));
      console.warn(`[UnifiedBLEService] startDeviceStreaming: Device '${deviceId}' not found in devices map`);
      console.warn(`[UnifiedBLEService] Available device keys: [${deviceKeys.join(', ')}]`);
      return { success: false, deviceId, message: 'Device not connected - not found in devices map' };
    }

    try {
      console.log(`[UnifiedBLEService] Starting streaming on ${deviceId}...`);
      const success = await device.startStreaming();

      if (success) {
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        if (storeDeviceId) {
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.STREAMING);
          } catch (e) {
            console.debug(`[UnifiedBLEService] State transition to STREAMING failed for ${deviceId}:`, e);
          }
        }
        console.log(`[UnifiedBLEService] Streaming started successfully on ${deviceId}`);
        return { success: true, deviceId, message: 'Streaming started' };
      } else {
        console.warn(`[UnifiedBLEService] startStreaming() returned false for ${deviceId}`);
        return { success: false, deviceId, message: 'Failed to start streaming' };
      }
    } catch (error) {
      console.error(`[UnifiedBLEService] Streaming error for ${deviceId}:`, error);
      return { success: false, deviceId, message: `Streaming error: ${error}` };
    }
  }

  private async stopDeviceStreaming(deviceId: string): Promise<{ success: boolean; deviceId: string; message: string }> {
    const device = this.devices.get(deviceId);
    if (!device) {
      console.warn(`[UnifiedBLEService] stopDeviceStreaming: Device '${deviceId}' not found in devices map`);
      return { success: false, deviceId, message: 'Device not connected' };
    }

    try {
      console.log(`[UnifiedBLEService] Stopping streaming on ${deviceId}...`);
      await device.stopStreaming();

      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTED);
        } catch (e) {
          console.debug(`[UnifiedBLEService] State transition to CONNECTED failed for ${deviceId}:`, e);
        }
      }

      console.log(`[UnifiedBLEService] Streaming stopped on ${deviceId}`);
      return { success: true, deviceId, message: 'Streaming stopped' };
    } catch (error) {
      console.error(`[UnifiedBLEService] Stop streaming error for ${deviceId}:`, error);
      return { success: false, deviceId, message: `Stop streaming error: ${error}` };
    }
  }

  private async validateAndResetDeviceStates(
    connectedDevices: { id: string; name: string }[],
    maxAttempts: number
  ): Promise<{ success: boolean; error?: string }> {
    const { TropXCommands } = await import('./TropXCommands');

    // Debug: Check if any devices are missing from this.devices map
    const missingDevices: string[] = [];
    for (const deviceState of connectedDevices) {
      const device = this.devices.get(deviceState.id);
      if (!device) {
        missingDevices.push(`${deviceState.name} (${deviceState.id})`);
      }
    }

    if (missingDevices.length > 0) {
      console.error(`[UnifiedBLEService] CRITICAL: ${missingDevices.length} device(s) NOT FOUND in TropXDevice map:`);
      console.error(`[UnifiedBLEService]   Missing: ${missingDevices.join(', ')}`);
      const deviceKeys: string[] = [];
      this.devices.forEach((_, key) => deviceKeys.push(key));
      console.error(`[UnifiedBLEService]   Available keys in this.devices: [${deviceKeys.join(', ')}]`);
      console.error(`[UnifiedBLEService]   This indicates an ID mismatch between state store (bleAddress) and devices map (peripheral.id)`);

      // Return error immediately - no point in retrying if devices aren't in the map
      return {
        success: false,
        error: `Devices not found in TropXDevice map: ${missingDevices.join(', ')}. Check ID mismatch between state store and devices map.`
      };
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[UnifiedBLEService] State validation attempt ${attempt}/${maxAttempts}...`);

      const stateChecks = connectedDevices.map(async (deviceState) => {
        const device = this.devices.get(deviceState.id);
        if (!device) {
          console.warn(`[UnifiedBLEService] Device ${deviceState.name} (${deviceState.id}) not found in devices map`);
          return { id: deviceState.id, name: deviceState.name, state: 0x00, stateName: 'NOT_FOUND', valid: false };
        }

        const state = await device.getSystemState();
        const valid = TropXCommands.isValidForStreaming(state);
        const stateName = TropXCommands.getStateName(state);

        console.log(`[UnifiedBLEService] Device ${deviceState.name}: state=${stateName} (0x${state.toString(16)}), valid=${valid}`);

        return {
          id: deviceState.id,
          name: deviceState.name,
          state,
          stateName,
          valid
        };
      });

      const deviceStates = await Promise.all(stateChecks);
      const invalidDevices = deviceStates.filter(d => !d.valid);

      if (invalidDevices.length === 0) {
        console.log('[UnifiedBLEService] All devices in valid state for streaming');
        return { success: true };
      }

      if (attempt < maxAttempts) {
        console.log(`[UnifiedBLEService] ${invalidDevices.length} device(s) not ready, resetting...`);
        invalidDevices.forEach(d => console.log(`[UnifiedBLEService]   - ${d.name}: ${d.stateName}`));

        const resetTasks = invalidDevices.map(async (deviceInfo) => {
          const device = this.devices.get(deviceInfo.id);
          if (device) {
            console.log(`[UnifiedBLEService] Resetting ${deviceInfo.name} to IDLE...`);
            return await device.resetToIdle();
          }
          console.warn(`[UnifiedBLEService] Cannot reset ${deviceInfo.name} - device not found`);
          return false;
        });

        await Promise.all(resetTasks);
        await this.delay(500);
      } else {
        const deviceList = invalidDevices.map(d => `${d.name} (${d.stateName || 'UNKNOWN'})`).join(', ');
        const error = `Failed to reset devices after ${maxAttempts} attempts: ${deviceList}`;
        console.error(`[UnifiedBLEService] ${error}`);
        return { success: false, error };
      }
    }

    return { success: false, error: 'Unexpected error in state validation' };
  }

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

    console.log(`[UnifiedBLEService] Auto-recovering streaming for ${deviceId}...`);
    const result = await this.startDeviceStreaming(deviceId);
    return result.success;
  }

  private async ensureDeviceNotStreaming(tropxDevice: TropXDevice, deviceId: string): Promise<void> {
    try {
      const { TropXCommands } = await import('./TropXCommands');
      const { TROPX_STATES } = await import('./BleBridgeConstants');

      const deviceState = await tropxDevice.getSystemState();
      const stateName = TropXCommands.getStateName(deviceState);

      if (deviceState === TROPX_STATES.TX_DIRECT || deviceState === TROPX_STATES.TX_BUFFERED) {
        console.log(`[UnifiedBLEService] ${deviceId} is streaming but app is IDLE - resetting...`);
        const resetSuccess = await tropxDevice.resetToIdle();
        if (resetSuccess) {
          console.log(`[UnifiedBLEService] ${deviceId} reset to IDLE`);
        }
      } else {
        console.log(`[UnifiedBLEService] ${deviceId} state: ${stateName}`);
      }
    } catch (error) {
      console.warn(`[UnifiedBLEService] Could not check/reset ${deviceId}:`, error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Device Access
  // ─────────────────────────────────────────────────────────────────────────────

  getConnectedDevices(): TropXDeviceInfo[] {
    const connectedDevices: TropXDeviceInfo[] = [];
    this.devices.forEach(device => {
      if (device.isConnected) {
        connectedDevices.push(device.deviceInfo);
      }
    });
    return connectedDevices;
  }

  getDeviceInstance(deviceId: string): TropXDevice | null {
    return this.devices.get(deviceId) || null;
  }

  isDeviceActuallyConnected(bleAddress: string): boolean {
    const device = this.devices.get(bleAddress);
    return device?.isConnected ?? false;
  }

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

  async removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

      if (storeDeviceId) {
        // First, remove from TropXDevice map if present
        this.devices.delete(deviceId);

        // Clear from transport cache so device can be rediscovered (includes disconnect on Noble)
        await this.transport.forgetPeripheral(deviceId);

        // Finally, unregister from state store
        UnifiedBLEStateStore.unregisterDevice(storeDeviceId);

        console.log(`[UnifiedBLEService] Device 0x${storeDeviceId.toString(16)} removed (cleared from all caches)`);
        return { success: true, message: 'Device removed' };
      } else {
        return { success: false, message: 'Device not found' };
      }
    } catch (error) {
      console.error(`[UnifiedBLEService] Failed to remove device ${deviceId}:`, error);
      return {
        success: false,
        message: `Failed to remove: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Clear GATT cache for a device
   * This is useful for reconnecting to devices after they've been gone for a while
   * Platform-specific implementation:
   * - Linux/Pi (BlueZ): Removes device from adapter (forces complete cache clear)
   * - Windows/Mac (Noble): Disconnects and forgets peripheral (limited cache clearing)
   */
  async clearDeviceCache(bleAddress: string): Promise<boolean> {
    console.log(`[UnifiedBLEService] clearDeviceCache called for ${bleAddress}`);

    try {
      // Delegate to transport implementation
      const result = await this.transport.clearDeviceCache(bleAddress);

      if (result) {
        console.log(`[UnifiedBLEService] Cache cleared successfully for ${bleAddress}`);
      } else {
        console.warn(`[UnifiedBLEService] Cache clear failed for ${bleAddress}`);
      }

      return result;
    } catch (error) {
      console.error(`[UnifiedBLEService] clearDeviceCache error for ${bleAddress}:`, error);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State Polling
  // ─────────────────────────────────────────────────────────────────────────────

  startStatePolling(): void {
    if (this.isStatePollingEnabled) {
      console.log('[UnifiedBLEService] State polling already enabled');
      return;
    }

    console.log('[UnifiedBLEService] Starting state polling (5s interval)');
    this.isStatePollingEnabled = true;
    this.pollDeviceStates();
  }

  stopStatePolling(): void {
    if (!this.isStatePollingEnabled) return;

    console.log('[UnifiedBLEService] Stopping state polling');
    this.isStatePollingEnabled = false;

    if (this.statePollingTimer) {
      clearTimeout(this.statePollingTimer);
      this.statePollingTimer = null;
    }
  }

  private async pollDeviceStates(): Promise<void> {
    if (!this.isStatePollingEnabled) return;

    const currentGlobalState = UnifiedBLEStateStore.getGlobalState();
    const blockedStates = [GlobalState.STREAMING, GlobalState.SYNCING, GlobalState.LOCATING, GlobalState.CONNECTING];

    if (blockedStates.includes(currentGlobalState)) {
      this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
      return;
    }

    const connectedDevices = UnifiedBLEStateStore.getConnectedDevices().map(d => ({
      id: d.bleAddress,
      name: d.bleName,
    }));

    if (connectedDevices.length === 0) {
      this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
      return;
    }

    const { TropXCommands } = await import('./TropXCommands');

    await Promise.all(connectedDevices.map(async (deviceInfo) => {
      const device = this.devices.get(deviceInfo.id);
      if (!device) return;

      try {
        const state = await device.getSystemState();
        const stateName = TropXCommands.getStateName(state);

        const previousState = this.deviceStates.get(deviceInfo.id);
        this.deviceStates.set(deviceInfo.id, {
          state,
          stateName,
          lastUpdate: Date.now()
        });

        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceInfo.id);
        if (storeDeviceId) {
          UnifiedBLEStateStore.updateLastSeen(storeDeviceId);
        }

        if (!previousState || previousState.state !== state) {
          if (this.deviceEventCallback) {
            this.deviceEventCallback(deviceInfo.id, 'state_changed', { state, stateName });
          }
        }
      } catch (error) {
        console.error(`[UnifiedBLEService] Failed to poll state for ${deviceInfo.name}:`, error);
      }
    }));

    this.statePollingTimer = setTimeout(() => this.pollDeviceStates(), 5000);
  }

  getDeviceState(deviceId: string): { state: number; stateName: string; lastUpdate: number } | null {
    return this.deviceStates.get(deviceId) || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Burst Scanning
  // ─────────────────────────────────────────────────────────────────────────────

  get isBluetoothReady(): boolean {
    return this.transport.isInitialized;
  }

  get isBurstScanningEnabled(): boolean {
    return this.burstEnabled;
  }

  setBurstScanningEnabled(enabled: boolean): void {
    if (this.burstEnabled === enabled) return;

    this.burstEnabled = enabled;
    console.log(`[UnifiedBLEService] Burst scanning ${enabled ? 'enabled' : 'disabled'}`);

    if (enabled && !this.transport.isScanning && !this.nextBurstTimer) {
      this.startScanning().catch(err => console.error('[UnifiedBLEService] Burst start error:', err));
    } else if (!enabled && this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }
  }

  enableBurstScanningFor(durationMs: number): void {
    console.log(`[UnifiedBLEService] Enabling burst scanning for ${durationMs}ms`);

    if (this.burstTimeoutTimer) {
      clearTimeout(this.burstTimeoutTimer);
      this.burstTimeoutTimer = null;
    }

    // Capture existing non-connected devices to verify during scan
    this.scanStartTime = Date.now();
    this.devicesToVerify.clear();
    this.isExtendedScan = false;

    const existingDevices = UnifiedBLEStateStore.getAllDevices();
    for (const device of existingDevices) {
      // Only track devices that are DISCOVERED or DISCONNECTED (not connected/streaming)
      if (device.state === DeviceState.DISCOVERED || device.state === DeviceState.DISCONNECTED) {
        this.devicesToVerify.set(device.deviceId, {
          bleName: device.bleName,
          lastSeenBefore: device.lastSeen,
        });
      }
    }

    if (this.devicesToVerify.size > 0) {
      console.log(`[UnifiedBLEService] Tracking ${this.devicesToVerify.size} device(s) to verify during scan`);
    }

    this.burstEnabled = true;

    // Set global state to SCANNING - UI will use this to show scan button state
    UnifiedBLEStateStore.setGlobalState(GlobalState.SCANNING);

    if (!this.transport.isScanning && !this.isCleaningUp) {
      this.startScanning().catch(err => console.error('[UnifiedBLEService] Burst scan error:', err));
    }

    this.burstTimeoutTimer = setTimeout(() => {
      this.handleScanDurationElapsed(durationMs);
    }, durationMs);
  }

  private handleScanDurationElapsed(originalDurationMs: number): void {
    const EXTENDED_SCAN_DURATION_MS = 10000; // 10 seconds extension

    // Check for undetected devices
    const undetectedDevices: Array<{ deviceId: number; bleName: string }> = [];

    for (const [deviceId, info] of this.devicesToVerify) {
      const currentDevice = UnifiedBLEStateStore.getDevice(deviceId);
      if (currentDevice) {
        // Device was re-discovered if lastSeen was updated after scan started
        if (currentDevice.lastSeen <= info.lastSeenBefore) {
          undetectedDevices.push({ deviceId, bleName: info.bleName });
        }
      }
    }

    if (undetectedDevices.length > 0 && !this.isExtendedScan) {
      // First scan completed, some devices not found - extend scan
      console.log(`[UnifiedBLEService] ${undetectedDevices.length} device(s) not re-discovered:`);
      undetectedDevices.forEach(d => console.log(`[UnifiedBLEService]   - ${d.bleName}`));
      console.log(`[UnifiedBLEService] Extending scan by ${EXTENDED_SCAN_DURATION_MS}ms...`);

      this.isExtendedScan = true;
      this.burstTimeoutTimer = setTimeout(() => {
        this.handleScanDurationElapsed(originalDurationMs);
      }, EXTENDED_SCAN_DURATION_MS);
      return;
    }

    if (undetectedDevices.length > 0 && this.isExtendedScan) {
      // Extended scan completed, still some devices not found
      // BUT: On Windows/macOS (Noble), devices aren't re-reported during scan if already known
      // Only mark unavailable if peripheral is ALSO missing from transport cache
      console.log(`[UnifiedBLEService] Extended scan completed. Checking ${undetectedDevices.length} undetected device(s):`);

      let markedUnavailable = 0;
      for (const { deviceId, bleName } of undetectedDevices) {
        const device = UnifiedBLEStateStore.getDevice(deviceId);
        const bleAddress = device?.bleAddress;

        // Check if peripheral still exists in transport cache
        // If it does, the device is still "known" and reachable - just not actively advertising
        const peripheralExists = bleAddress ? !!this.transport.getPeripheral(bleAddress) : false;

        if (peripheralExists) {
          // Device is still in transport cache - don't mark as unavailable
          // This is the expected behavior on Windows where Noble doesn't re-report known devices
          console.log(`[UnifiedBLEService]   - ${bleName}: Still in transport cache, keeping DISCOVERED state`);
        } else {
          // Device truly not found - mark as unavailable
          console.log(`[UnifiedBLEService]   - Marking ${bleName} (0x${deviceId.toString(16)}) as unavailable (not in transport cache)`);
          try {
            UnifiedBLEStateStore.transitionToError(deviceId, DeviceErrorType.CONNECTION_FAILED, 'Device not found during scan - may be powered off or out of range');
            markedUnavailable++;
          } catch (error) {
            console.error(`[UnifiedBLEService] Failed to mark device ${bleName} as unavailable:`, error);
          }
        }
      }

      // Force broadcast to update UI only if we actually marked something unavailable
      if (markedUnavailable > 0) {
        UnifiedBLEStateStore.forceBroadcast();
      }
    } else if (this.devicesToVerify.size > 0) {
      console.log(`[UnifiedBLEService] All ${this.devicesToVerify.size} tracked device(s) re-discovered successfully`);
    }

    // Cleanup
    this.devicesToVerify.clear();
    this.isExtendedScan = false;
    this.burstTimeoutTimer = null;

    console.log(`[UnifiedBLEService] Burst scanning duration elapsed`);
    this.disableBurstScanning();
  }

  disableBurstScanning(): void {
    console.log('[UnifiedBLEService] Disabling burst scanning');
    this.burstEnabled = false;

    if (this.burstTimeoutTimer) {
      clearTimeout(this.burstTimeoutTimer);
      this.burstTimeoutTimer = null;
    }

    if (this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }

    if (this.transport.isScanning) {
      this.stopScanning(true).catch(err => console.error('[UnifiedBLEService] Stop scan error:', err));
    }

    // Reset global state to IDLE - UI will use this to stop showing scan button state
    if (UnifiedBLEStateStore.getGlobalState() === GlobalState.SCANNING) {
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
    }
  }

  private scheduleNextBurst(): void {
    if (this.transport.isScanning || this.nextBurstTimer) return;
    if (!this.burstEnabled) return;

    if (UnifiedBLEStateStore.getGlobalState() === GlobalState.STREAMING) {
      console.log('[UnifiedBLEService] Skipping burst - streaming active');
      return;
    }

    console.log(`[UnifiedBLEService] Scheduling next burst in ${BLE_CONFIG.SCAN_BURST_GAP}ms`);
    this.nextBurstTimer = setTimeout(async () => {
      this.nextBurstTimer = null;
      if (this.burstEnabled && !this.transport.isScanning && !this.isCleaningUp) {
        console.log('[UnifiedBLEService] Starting next burst');
        await this.startScanning();
      }
    }, BLE_CONFIG.SCAN_BURST_GAP);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Event Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private setupTransportEvents(): void {
    this.transport.on('deviceDiscovered', (device: DiscoveredDevice) => {
      this.handleDeviceDiscovered(device);
    });

    this.transport.on('scanStarted', () => {
      console.log('[UnifiedBLEService] Scan started');
    });

    this.transport.on('scanStopped', () => {
      console.log('[UnifiedBLEService] Scan stopped');

      // Schedule next burst if enabled
      if (!this.isCleaningUp && this.burstEnabled && !this.nextBurstTimer) {
        this.scheduleNextBurst();
      }
    });

    this.transport.on('error', (error: Error) => {
      console.error('[UnifiedBLEService] Transport error:', error);
    });
  }

  private handleDeviceDiscovered(device: DiscoveredDevice): void {
    // Register in state store
    let storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(device.id);

    if (!storeDeviceId) {
      storeDeviceId = UnifiedBLEStateStore.registerDevice(device.id, device.name);
      if (!storeDeviceId) {
        console.warn(`[UnifiedBLEService] Could not register: ${device.name}`);
        return;
      }
    }

    // Update RSSI and lastSeen (critical for extended scan detection)
    UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, {
      rssi: device.rssi,
    });
    UnifiedBLEStateStore.updateLastSeen(storeDeviceId);

    // Transition to DISCOVERED if currently DISCONNECTED or ERROR (recovery from unavailable)
    const existingDevice = UnifiedBLEStateStore.getDevice(storeDeviceId);
    if (existingDevice) {
      if (existingDevice.state === DeviceState.DISCONNECTED || existingDevice.state === DeviceState.ERROR) {
        try {
          console.log(`[UnifiedBLEService] Recovering ${device.name} from ${existingDevice.state} → DISCOVERED`);
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCOVERED);
        } catch (e) {
          console.debug(`[UnifiedBLEService] State transition to DISCOVERED failed for ${device.name}:`, e);
        }
      }
    }

    // Create device info for event callback
    const deviceInfo: TropXDeviceInfo = {
      id: device.id,
      name: device.name,
      address: device.address,
      rssi: device.rssi,
      state: 'discovered',
      batteryLevel: null,
      lastSeen: new Date()
    };

    if (this.deviceEventCallback) {
      this.deviceEventCallback(device.id, 'discovered', deviceInfo);
    }
  }

  private subscribeToStateChanges(): void {
    const handler = (change: { deviceId: number; previousState: DeviceState; newState: DeviceState }) => {
      const device = UnifiedBLEStateStore.getDevice(change.deviceId);
      if (!device) return;

      if (change.newState === DeviceState.CONNECTED) {
        console.log(`[UnifiedBLEService] ${device.bleName} connected successfully`);
      }
    };

    UnifiedBLEStateStore.on('deviceStateChanged', handler);

    this.stateChangeUnsubscribe = () => {
      UnifiedBLEStateStore.removeListener('deviceStateChanged', handler);
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────────────────────────────────────

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
