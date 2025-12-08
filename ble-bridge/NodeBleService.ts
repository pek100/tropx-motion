/**
 * node-ble Service - BlueZ DBus-based BLE implementation for Linux/Raspberry Pi
 *
 * Uses chrvadala/node-ble which communicates with BlueZ via DBus instead of HCI sockets
 * This should provide better performance and reliability on Raspberry Pi
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
} from '../ble-management';
import { bleLogger } from './BleLogger';
import { NodeBleToNobleAdapter } from './NodeBleToNobleAdapter';
import { ConnectionQueue } from './ConnectionQueue';

// node-ble imports
const { createBluetooth } = require('node-ble');

export class NodeBleService {
  private bluetooth: any;
  private destroy: any;
  private adapter: any;
  private devices = new Map<string, TropXDevice>();
  private discoveredDevices = new Map<string, any>(); // node-ble Device objects
  private isScanning = false;
  private isStartingScanning = false; // Tracks if startScanning() is in progress
  private isInitialized = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private isCleaningUp = false;

  // Connection lock - prevents scanning while connecting devices
  private isConnecting = false;
  // Per-device connection lock - prevents duplicate connection attempts
  private connectingDevices = new Set<string>();

  // CRITICAL: Connection queue for Linux/node-ble
  // Ensures sequential connections with state-based progression
  private connectionQueue: ConnectionQueue;

  // Burst scanning support (kept for compatibility)
  private burstEnabled: boolean = BLE_CONFIG.SCAN_BURST_ENABLED;
  private nextBurstTimer: NodeJS.Timeout | null = null;
  private burstTimeoutTimer: NodeJS.Timeout | null = null;

  // State polling support
  private statePollingTimer: NodeJS.Timeout | null = null;
  private isStatePollingEnabled = false;
  private deviceStates = new Map<string, { state: number; stateName: string; lastUpdate: number }>();

  // NOTE: Auto-reconnect is now handled by ReconnectionManager singleton
  // See: ble-management/ReconnectionManager.ts

  // Callbacks
  private motionDataCallback: MotionDataCallback | null = null;
  private deviceEventCallback: DeviceEventCallback | null = null;

  constructor(
    motionCallback?: MotionDataCallback,
    eventCallback?: DeviceEventCallback
  ) {
    this.motionDataCallback = motionCallback || null;
    this.deviceEventCallback = eventCallback || null;

    // Initialize connection queue
    this.connectionQueue = new ConnectionQueue();
    // Set up the connection handler - this does the actual connection work
    this.connectionQueue.setConnectionHandler(async (deviceId: string) => {
      const result = await this.connectSingleDeviceInternal(deviceId);
      // Ensure message is always defined
      return {
        success: result.success,
        deviceId: result.deviceId,
        message: result.message || (result.success ? 'Connected successfully' : 'Connection failed')
      };
    });
  }

  // Initialize node-ble
  async initialize(): Promise<boolean> {
    try {
      console.log('🔍 Initializing node-ble (BlueZ DBus) service...');

      // Create bluetooth instance
      const result = createBluetooth();
      this.bluetooth = result.bluetooth;
      this.destroy = result.destroy;

      console.log('✅ node-ble bluetooth instance created');

      // Get default adapter
      this.adapter = await this.bluetooth.defaultAdapter();
      const adapterName = await this.adapter.getName();
      const adapterAddress = await this.adapter.getAddress();

      console.log(`✅ Bluetooth adapter ready: ${adapterName} (${adapterAddress})`);

      // Clear stale device states
      UnifiedBLEStateStore.clear();
      UnifiedBLEStateStore.setGlobalState(GlobalState.IDLE);
      console.log('🧹 Cleared stale device states from previous session');

      // CRITICAL: Disconnect any zombie devices left from previous session
      // This handles the case where app was closed while devices were still connected
      await this.cleanupZombieDevices();

      this.isInitialized = true;
      console.log('✅ node-ble service initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize node-ble service:', error);
      return false;
    }
  }

  // Clean up zombie devices (devices still connected from previous session)
  // ENHANCED: Force disconnect ALL TropX devices regardless of connection state
  private async cleanupZombieDevices(): Promise<void> {
    try {
      console.log('🔍 Performing aggressive zombie device cleanup (all TropX devices)...');

      // Get all known device addresses from BlueZ
      const deviceAddresses = await this.adapter.devices();

      if (deviceAddresses.length === 0) {
        console.log('✅ No devices in BlueZ - clean state');
        return;
      }

      console.log(`🔍 Found ${deviceAddresses.length} device(s) in BlueZ, checking for TropX devices...`);

      let tropxDeviceCount = 0;
      let disconnectedCount = 0;
      let errorCount = 0;

      // Force disconnect ALL TropX devices, regardless of reported state
      // This handles cases where BlueZ has stale GATT connections not reported by isConnected()
      for (const address of deviceAddresses) {
        try {
          const device = await this.adapter.getDevice(address);

          // Get device name for filtering
          let deviceName = address;
          try {
            deviceName = await device.getName();
          } catch (e) {
            // Try alias as fallback
            try {
              deviceName = await device.getAlias();
            } catch (e2) {
              // Name not available, use address
            }
          }

          // Check if it's a TropX device
          const nameLower = deviceName.toLowerCase();
          const isTropXDevice = BLE_CONFIG.DEVICE_PATTERNS.some(pattern =>
            nameLower.includes(pattern.toLowerCase())
          );

          if (!isTropXDevice) {
            continue; // Skip non-TropX devices
          }

          tropxDeviceCount++;

          // Get detailed state information for debugging
          let isConnected = false;
          let isPaired = false;
          let isTrusted = false;

          try {
            isConnected = await device.isConnected();
          } catch (e) {}

          try {
            isPaired = await device.isPaired();
          } catch (e) {}

          try {
            isTrusted = await device.isTrusted();
          } catch (e) {}

          console.log(`🔍 TropX device: ${deviceName} (${address}) | Connected: ${isConnected}, Paired: ${isPaired}, Trusted: ${isTrusted}`);

          // CRITICAL: Force disconnect regardless of state
          // BlueZ can have stale GATT connections even when isConnected() returns false
          try {
            console.log(`🧹 Force disconnecting: ${deviceName}...`);
            await device.disconnect();
            disconnectedCount++;
            console.log(`✅ Disconnected: ${deviceName}`);
          } catch (disconnectError: any) {
            // "Not Connected" error is actually success - device was already disconnected
            if (disconnectError.type === 'org.bluez.Error.NotConnected' ||
                disconnectError.text?.includes('Not Connected')) {
              console.log(`✅ ${deviceName} already disconnected`);
              disconnectedCount++;
            } else {
              errorCount++;
              console.warn(`⚠️ Failed to disconnect ${deviceName}:`, disconnectError.type || disconnectError.message);
            }
          }

        } catch (deviceError) {
          // Ignore errors for individual devices (may be inaccessible)
          console.warn(`⚠️ Error processing device ${address}:`, deviceError);
          errorCount++;
        }
      }

      if (tropxDeviceCount > 0) {
        console.log(`🧹 Zombie cleanup complete: ${disconnectedCount}/${tropxDeviceCount} TropX devices cleaned (${errorCount} errors)`);
      } else {
        console.log('✅ No TropX devices found in BlueZ - clean state');
      }

    } catch (error) {
      console.error('❌ Error during zombie device cleanup:', error);
      // Don't throw - initialization should continue even if cleanup fails
    }
  }

  // Start scanning for TropX devices
  async startScanning(): Promise<BleScanResult> {
    console.log('🔍 NodeBleService.startScanning called');

    // CRITICAL: Prevent duplicate concurrent startScanning calls
    // Check and set this flag FIRST before any other logic
    if (this.isStartingScanning) {
      console.log('⏸️ Scan already starting - rejecting duplicate call');
      return { success: false, devices: [], message: 'Scan already starting' };
    }
    this.isStartingScanning = true; // Set lock immediately

    // Now check other conditions
    if (!this.isInitialized || !this.adapter) {
      console.log('❌ Service not initialized');
      this.isStartingScanning = false; // Release lock
      return { success: false, devices: [], message: 'BLE service not initialized' };
    }

    // CRITICAL: Prevent scanning while connecting devices
    if (this.isConnecting) {
      console.log('⏸️ Cannot start scan - device connection in progress');
      this.isStartingScanning = false; // Release lock
      return { success: false, devices: [], message: 'Connection in progress - scanning disabled' };
    }

    if (this.isScanning) {
      this.isStartingScanning = false; // Release lock
      return { success: false, devices: [], message: 'Already scanning' };
    }

    try {
      console.log(`📡 Starting BLE scan for devices (${BLE_CONFIG.DEVICE_PATTERNS.join(', ')})...`);
      this.isScanning = true;

      // ALWAYS try to stop any existing discovery first (unconditionally)
      // This handles race conditions and stale states more reliably
      console.log('🔄 Stopping any existing discovery session...');
      try {
        await this.adapter.stopDiscovery();
        console.log('✅ Stopped existing discovery');
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for cleanup
      } catch (stopError: any) {
        // Ignore "Not Authorized" or "Does Not Exist" errors (means no discovery running)
        if (stopError.type === 'org.bluez.Error.DoesNotExist' ||
            stopError.text?.includes('Does Not Exist')) {
          console.log('ℹ️ No existing discovery to stop');
        } else {
          console.warn('⚠️ Error stopping existing discovery:', stopError.type || stopError.message);
        }
      }

      // Start fresh discovery
      console.log('🚀 Starting fresh discovery session...');
      await this.adapter.startDiscovery();

      // Poll for new devices during scan
      this.pollForDevices();

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
    } finally {
      // Always release the starting lock
      this.isStartingScanning = false;
    }
  }

  // Poll for discovered devices
  private async pollForDevices(): Promise<void> {
    if (!this.isScanning) return;

    try {
      const deviceAddresses = await this.adapter.devices();

      for (const address of deviceAddresses) {
        // Skip if already processed
        if (this.discoveredDevices.has(address)) continue;

        try {
          const device = await this.adapter.getDevice(address);

          // Try to get device name - use Alias as fallback (includes address if no name)
          let name: string;
          try {
            name = await device.getName();
          } catch (nameError: any) {
            // Name property not available during discovery - try Alias
            try {
              name = await device.getAlias();
            } catch (aliasError) {
              // No name available - skip this device
              console.log(`⚠️ Skipping device ${address} - no name available`);
              continue;
            }
          }

          // Check if this is a TropX device
          const nameLower = name.toLowerCase();
          const isTargetDevice = BLE_CONFIG.DEVICE_PATTERNS.some(pattern =>
            nameLower.includes(pattern.toLowerCase())
          );

          if (!isTargetDevice) {
            console.log(`⏭️ Skipping device: ${name} (${address}) - not a target device`);
            continue;
          }

          // Get RSSI
          let rssi = -100;
          try {
            rssi = parseInt(await device.getRSSI());
          } catch (e) {
            // RSSI might not be available yet
          }

          // Check RSSI threshold
          if (rssi < BLE_CONFIG.MIN_RSSI) {
            console.log(`❌ Weak signal: ${name} (RSSI ${rssi} < ${BLE_CONFIG.MIN_RSSI})`);
            continue;
          }

          console.log(`✅ Discovered device: ${name} (${address}, RSSI: ${rssi})`);

          // Store device
          this.discoveredDevices.set(address, device);

          // Create device info and update state manager
          const deviceInfo: TropXDeviceInfo = {
            id: address,
            name: name,
            address: address,
            rssi: rssi,
            state: 'discovered' as DeviceConnectionState,
            batteryLevel: null,
            lastSeen: new Date()
          };

          // Register device in UnifiedBLEStateStore
          let storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(address);
          if (!storeDeviceId) {
            storeDeviceId = UnifiedBLEStateStore.registerDevice(address, name);
          }

          // Update RSSI if registered
          if (storeDeviceId) {
            UnifiedBLEStateStore.updateDeviceFields(storeDeviceId, { rssi });
            const existingDevice = UnifiedBLEStateStore.getDevice(storeDeviceId);
            if (existingDevice?.state === DeviceState.DISCONNECTED) {
              try {
                UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCOVERED);
              } catch (e) { /* ignore */ }
            }
          }

          // Notify event callback
          if (this.deviceEventCallback) {
            this.deviceEventCallback(address, 'discovered', deviceInfo);
          }

        } catch (deviceError) {
          console.warn(`⚠️ Error processing device ${address}:`, deviceError);
        }
      }

    } catch (error) {
      console.error('❌ Error polling for devices:', error);
    }

    // Continue polling if still scanning
    if (this.isScanning) {
      setTimeout(() => this.pollForDevices(), 1000);
    }
  }

  // Stop scanning
  async stopScanning(suppressNext: boolean = false): Promise<void> {
    if (!this.isScanning || !this.adapter) return;

    try {
      console.log('🛑 Stopping BLE scan...');

      await this.adapter.stopDiscovery();
      this.isScanning = false;

      if (this.scanTimer) {
        clearTimeout(this.scanTimer);
        this.scanTimer = null;
      }

      const discoveredDevices = Array.from(this.discoveredDevices.values());
      console.log(`✅ Scan completed. Found ${discoveredDevices.length} devices`);

      // Schedule next burst if enabled
      if (!suppressNext && this.burstEnabled && !this.isCleaningUp) {
        this.scheduleNextBurst();
      }

    } catch (error) {
      console.error('Error stopping scan:', error);
    }
  }

  // Get discovered devices
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

  // Connect to single device (uses queue system)
  async connectToDevice(deviceId: string): Promise<BleConnectionResult> {
    console.log(`🔗 connectToDevice called for ${deviceId} - adding to queue`);

    // Use the connection queue to ensure sequential connections
    return await this.connectionQueue.enqueue(deviceId);
  }

  // Connect to multiple devices (uses queue system)
  async connectToDevices(deviceIds: string[]): Promise<BleConnectionResult[]> {
    console.log(`🔗 connectToDevices called for ${deviceIds.length} device(s) - adding all to queue`);

    // Add all devices to the queue - they will be processed sequentially
    const promises = deviceIds.map(deviceId => this.connectionQueue.enqueue(deviceId));

    // Wait for all to complete
    return await Promise.all(promises);
  }

  // OLD IMPLEMENTATION - kept as reference but not used anymore
  // The queue system handles all of this logic now
  private async connectToDevicesOld(deviceIds: string[]): Promise<BleConnectionResult[]> {
    if (deviceIds.length === 0) {
      return [];
    }

    // CRITICAL: Reject concurrent connection attempts BEFORE entering
    if (this.isConnecting) {
      console.log('⏸️ Connection already in progress - rejecting duplicate request');
      return deviceIds.map(deviceId => ({
        success: false,
        deviceId,
        message: 'Connection already in progress'
      }));
    }

    try {
      // CRITICAL: Set connection lock
      console.log(`🔗 Connecting to ${deviceIds.length} device(s) - LOCKING scanning...`);
      this.isConnecting = true;

      // Stop scanning before connecting
      if (this.isScanning) {
        console.log('🛑 Stopping scan before connection...');
        await this.stopScanning(true);
      }

      // Cancel any pending burst timers
      if (this.nextBurstTimer) {
        clearTimeout(this.nextBurstTimer);
        this.nextBurstTimer = null;
      }

      // CRITICAL: Ensure discovery is completely stopped
      // BlueZ can have race conditions if connection attempts happen too soon after scanning
      console.log('🔄 Ensuring discovery is fully stopped...');
      try {
        await this.adapter.stopDiscovery();
        console.log('✅ Discovery explicitly stopped');
      } catch (stopError: any) {
        // Ignore "Does Not Exist" error (means discovery already stopped)
        if (stopError.type !== 'org.bluez.Error.DoesNotExist') {
          console.warn('⚠️ Error stopping discovery:', stopError.type || stopError.message);
        }
      }

      // Give BlueZ time to stabilize after scanning
      console.log('⏳ Waiting 1s for BlueZ to stabilize after scanning...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('✅ BlueZ stabilized, ready to connect');

      // Update devices to connecting state
      deviceIds.forEach(deviceId => {
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        if (storeDeviceId) {
          try {
            UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTING);
          } catch (e) { /* ignore */ }
        }
      });

      // CRITICAL: Connect devices SEQUENTIALLY, not in parallel
      // BlueZ can only establish ONE connection at a time due to state machine limitations
      // Attempting parallel connections causes "le-connection-abort-by-local" errors
      // See: https://stackoverflow.com/questions/33484600/establishing-multiple-ble-connections-simultaneously-using-bluez
      console.log(`🔗 Connecting ${deviceIds.length} device(s) SEQUENTIALLY...`);

      const results: BleConnectionResult[] = [];

      for (let i = 0; i < deviceIds.length; i++) {
        const deviceId = deviceIds[i];
        console.log(`🚀 [${i + 1}/${deviceIds.length}] Starting connection to ${deviceId}`);

        const result = await this.connectSingleDeviceInternal(deviceId);
        results.push(result);

        if (result.success) {
          console.log(`✅ [${i + 1}/${deviceIds.length}] Connected ${deviceId} successfully`);

          // CRITICAL: Give BlueZ time to stabilize between connections
          // This prevents state machine conflicts when connecting multiple devices
          if (i < deviceIds.length - 1) {
            console.log(`⏳ Waiting 500ms before next connection...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } else {
          console.error(`❌ [${i + 1}/${deviceIds.length}] Failed to connect ${deviceId}: ${result.message}`);

          // Add a small delay even on failure to let BlueZ recover
          if (i < deviceIds.length - 1) {
            console.log(`⏳ Waiting 500ms before retrying next device...`);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Sequential connection completed: ${successCount}/${deviceIds.length} device(s) connected`);

      return results;

    } finally {
      // ALWAYS release connection lock
      this.isConnecting = false;
      console.log('🔓 Connection lock released');

      // Resume scanning if burst mode enabled
      if (this.burstEnabled && !this.isScanning && !this.isCleaningUp) {
        console.log('🔁 Resuming burst scanning after connection...');
        this.scheduleNextBurst();
      }
    }
  }

  // Connect to single device (internal - called by connection queue)
  private async connectSingleDeviceInternal(deviceId: string): Promise<BleConnectionResult> {
    // CRITICAL: Reject duplicate connection attempts
    if (this.connectingDevices.has(deviceId)) {
      bleLogger.warn(`Connection already in progress for ${deviceId} - rejecting duplicate attempt`, {}, 'CONNECTION');
      return {
        success: false,
        deviceId,
        message: 'Connection already in progress'
      };
    }

    const nodeBleDevice = this.discoveredDevices.get(deviceId);
    if (!nodeBleDevice) {
      bleLogger.error(`Device not found: ${deviceId}`, {}, 'CONNECTION');
      return {
        success: false,
        deviceId,
        message: 'Device not found - start scanning first'
      };
    }

    // Add to connecting set
    this.connectingDevices.add(deviceId);

    try {
      const deviceName = await nodeBleDevice.getName();
      bleLogger.logConnection(deviceId, deviceName, 'SERVICE_CONNECT_START', {});

      console.log(`🔗 [${deviceId}] Connecting to device: ${deviceName}`);

      const connectStartTime = Date.now();

      // CRITICAL: Retry connection with exponential backoff
      // The "le-connection-abort-by-local" error is often transient due to BlueZ timing
      // Also handle stale device objects by re-fetching from BlueZ
      // Optimized: Retry up to 3 times with faster delays (100ms, 400ms, 1000ms)
      const MAX_RETRIES = 3;
      let lastError: any = null;
      let currentDevice = nodeBleDevice;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          if (attempt > 0) {
            // Optimized: 100ms * 4^(attempt-1) = 100ms, 400ms, 1600ms (but cap at 1000ms)
            const retryDelay = Math.min(100 * Math.pow(4, attempt - 1), 1000); // 100ms, 400ms, 1000ms
            console.log(`🔄 [${deviceId}] Retry attempt ${attempt + 1}/${MAX_RETRIES} after ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));

            // CRITICAL: Re-fetch device from BlueZ to handle stale device objects
            // DBus errors like "Method 'Get' doesn't exist" indicate stale references
            try {
              console.log(`🔄 [${deviceId}] Re-fetching device from BlueZ...`);
              currentDevice = await this.adapter.getDevice(deviceId);
              this.discoveredDevices.set(deviceId, currentDevice);
              console.log(`✅ [${deviceId}] Device re-fetched successfully`);
            } catch (refetchError) {
              console.warn(`⚠️ [${deviceId}] Could not re-fetch device:`, refetchError);
              // Continue with existing device reference
            }
          }

          // Connect using node-ble (low-level connection only)
          await currentDevice.connect();

          // Connection successful, break out of retry loop
          console.log(`✅ [${deviceId}] Connection attempt ${attempt + 1} succeeded`);
          lastError = null;
          break;

        } catch (connectError: any) {
          lastError = connectError;
          const errorMessage = String(connectError.message || connectError);
          const errorType = connectError.type || '';
          const fullError = errorType + ' ' + errorMessage;

          console.error(`❌ [${deviceId}] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, fullError);

          // Check if this is a retryable error
          const isRetryable =
            fullError.includes('le-connection-abort-by-local') ||
            fullError.includes('le-connection-abort') ||
            fullError.includes('DBus.Properties') ||
            fullError.includes('Method') && fullError.includes('doesn\'t exist');

          if (isRetryable) {
            console.warn(`⚠️ [${deviceId}] Transient error detected - will retry`);

            if (attempt < MAX_RETRIES - 1) {
              continue; // Try again
            } else {
              console.error(`❌ [${deviceId}] All ${MAX_RETRIES} connection attempts exhausted`);
              throw connectError; // Out of retries, throw the error
            }
          } else {
            // Different error - don't retry, throw immediately
            console.error(`❌ [${deviceId}] Non-retryable error - aborting`);
            throw connectError;
          }
        }
      }

      // If we still have an error after all retries, throw it
      if (lastError) {
        throw lastError;
      }

      // Update the stored device reference if it was re-fetched
      if (currentDevice !== nodeBleDevice) {
        this.discoveredDevices.set(deviceId, currentDevice);
      }

      const connectDuration = Date.now() - connectStartTime;

      bleLogger.logConnection(deviceId, deviceName, 'CONNECT_SUCCESS', {
        durationMs: connectDuration
      });

      console.log(`✅ [${deviceId}] Low-level connection established in ${connectDuration}ms`);

      // Get device info
      const address = await nodeBleDevice.getAddress();
      let rssi = -100;
      try {
        rssi = parseInt(await nodeBleDevice.getRSSI());
      } catch (e) {}

      const deviceInfo: TropXDeviceInfo = {
        id: deviceId,
        name: deviceName,
        address: address,
        rssi: rssi,
        state: 'connecting' as DeviceConnectionState, // Still connecting until TropXDevice completes
        batteryLevel: null,
        lastSeen: new Date()
      };

      // Wrap node-ble device with Noble-compatible adapter
      const nobleAdapter = new NodeBleToNobleAdapter(nodeBleDevice, deviceInfo);

      // Create TropXDevice wrapper
      const tropxDevice = new TropXDevice(
        nobleAdapter, // Pass adapted device that looks like Noble peripheral
        deviceInfo,
        this.motionDataCallback || undefined,
        this.deviceEventCallback || undefined
      );

      // CRITICAL: Call TropXDevice.connect() to discover services, characteristics, and read battery
      // This matches Noble's behavior exactly
      const connected = await tropxDevice.connect();

      if (!connected) {
        bleLogger.logConnectionError(deviceId, deviceName, 'TROPX_CONNECT_FAILED', new Error('TropXDevice connection failed'));
        console.error(`❌ [${deviceId}] TropXDevice connection failed`);
        const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        if (storeDeviceId) {
          UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.CONNECTION_FAILED, 'TropXDevice connection failed');
        }
        return {
          success: false,
          deviceId,
          message: 'TropXDevice connection failed'
        };
      }

      this.devices.set(deviceId, tropxDevice);
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.CONNECTED);
        } catch (e) { /* ignore */ }
      }

      console.log(`✅ [${deviceId}] Full connection complete with battery reading`)

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

    } catch (error) {
      bleLogger.logConnectionError(deviceId, deviceId, 'SERVICE_CONNECT_EXCEPTION', error);
      console.error(`❌ [${deviceId}] Connection error:`, error);
      const storeDeviceIdErr = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceIdErr) {
        UnifiedBLEStateStore.transitionToError(storeDeviceIdErr, DeviceErrorType.CONNECTION_FAILED, String(error));
      }
      return {
        success: false,
        deviceId,
        message: `Connection error: ${error}`
      };
    } finally {
      // ALWAYS remove from connecting set
      this.connectingDevices.delete(deviceId);
    }
  }

  // Disconnect device
  async disconnectDevice(deviceId: string): Promise<BleConnectionResult> {
    const device = this.devices.get(deviceId);
    if (!device) {
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
        } catch (e) { /* ignore */ }
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

      this.devices.delete(deviceId);
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        try {
          UnifiedBLEStateStore.transition(storeDeviceId, DeviceState.DISCONNECTED);
        } catch (e) { /* ignore */ }
      }

      console.log(`✅ [${deviceId}] Disconnected successfully`);
      return {
        success: true,
        deviceId,
        message: 'Disconnected successfully'
      };

    } catch (error) {
      console.error(`❌ [${deviceId}] Disconnect error:`, error);
      const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
      if (storeDeviceId) {
        UnifiedBLEStateStore.transitionToError(storeDeviceId, DeviceErrorType.UNKNOWN, `Disconnect error: ${error}`);
      }
      return {
        success: false,
        deviceId,
        message: `Disconnect error: ${error}`
      };
    }
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

  // Start global streaming (delegates to existing implementation)
  async startGlobalStreaming(): Promise<{ success: boolean; started: number; total: number; results: any[]; error?: string }> {
    const connectedDevices = UnifiedBLEStateStore.getConnectedDevices();

    if (connectedDevices.length === 0) {
      return { success: false, started: 0, total: 0, results: [] };
    }

    console.log(`🎬 Starting global streaming on ${connectedDevices.length} connected devices...`);
    // NOTE: GlobalState is managed by BLEServiceAdapter - do not set here

    // Disable burst scanning during streaming
    if (this.burstEnabled) {
      console.log('🛑 Disabling burst scanning during streaming');
      await this.stopScanning(true);
      this.setBurstScanningEnabled(false);
    }

    // Start streaming on all devices in parallel
    const streamingTasks = connectedDevices.map(device => this.startDeviceStreaming(device.bleAddress));
    const results = await Promise.all(streamingTasks);

    const successCount = results.filter(result => result.success).length;

    // NOTE: GlobalState is managed by BLEServiceAdapter based on return value
    if (successCount > 0) {
      console.log(`✅ Global streaming started: ${successCount}/${connectedDevices.length} devices streaming`);
    } else {
      console.log(`❌ Global streaming failed: no devices started streaming`);
    }

    return {
      success: successCount > 0,
      started: successCount,
      total: connectedDevices.length,
      results
    };
  }

  async stopGlobalStreaming(): Promise<{ success: boolean; stopped: number; total: number }> {
    const streamingDevices = UnifiedBLEStateStore.getStreamingDevices();

    if (streamingDevices.length === 0) {
      // NOTE: GlobalState managed by BLEServiceAdapter
      return { success: true, stopped: 0, total: 0 };
    }

    console.log(`🛑 Stopping global streaming on ${streamingDevices.length} devices...`);
    // NOTE: GlobalState managed by BLEServiceAdapter

    const stoppingTasks = streamingDevices.map(device => this.stopDeviceStreaming(device.bleAddress));
    const results = await Promise.all(stoppingTasks);

    const successCount = results.filter(result => result.success).length;
    // NOTE: GlobalState managed by BLEServiceAdapter

    console.log(`✅ Global streaming stopped: ${successCount}/${streamingDevices.length} devices stopped`);

    // Re-enable burst scanning
    if (BLE_CONFIG.SCAN_BURST_ENABLED && !this.burstEnabled) {
      console.log('🔁 Re-enabling burst scanning');
      this.setBurstScanningEnabled(true);
    }

    return {
      success: true,
      stopped: successCount,
      total: streamingDevices.length
    };
  }

  async stopStreamingAll(): Promise<void> {
    await this.stopGlobalStreaming();
  }

  // Start streaming on device
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
          } catch (e) { /* ignore */ }
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

  // Stop streaming on device
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
        } catch (e) { /* ignore */ }
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

  // Auto-recovery for newly connected devices
  async recoverStreamingForDevice(deviceId: string): Promise<boolean> {
    if (UnifiedBLEStateStore.getGlobalState() !== GlobalState.STREAMING) {
      return false;
    }

    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
    if (!storeDeviceId) {
      return false;
    }

    const device = UnifiedBLEStateStore.getDevice(storeDeviceId);
    if (!device || device.state !== DeviceState.CONNECTED) {
      return false;
    }

    console.log(`🔄 [${deviceId}] Auto-recovering streaming...`);
    const result = await this.startDeviceStreaming(deviceId);
    return result.success;
  }

  // Get device instance (for time sync, etc.)
  getDeviceInstance(deviceId: string): TropXDevice | null {
    return this.devices.get(deviceId) || null;
  }

  /**
   * Check if a device is actually connected at the BLE level
   * Used by Watchdog to verify disconnection before triggering reconnect
   */
  isDeviceActuallyConnected(bleAddress: string): boolean {
    const device = this.devices.get(bleAddress);
    if (!device) {
      return false;
    }
    return device.isConnected;
  }

  // Get battery levels
  async getAllBatteryLevels(): Promise<Map<string, number>> {
    const batteryLevels = new Map<string, number>();

    for (const [deviceId, device] of this.devices.entries()) {
      if (device.isConnected) {
        const battery = await device.getBatteryLevel();
        if (battery !== null) {
          batteryLevels.set(deviceId, battery);
        }
      }
    }

    return batteryLevels;
  }

  // Burst scanning controls
  setBurstScanningEnabled(enabled: boolean): void {
    if (this.burstEnabled === enabled) return;
    this.burstEnabled = enabled;
    console.log(`🔁 Burst scanning ${enabled ? 'enabled' : 'disabled'}`);
    if (enabled && !this.isScanning && !this.nextBurstTimer) {
      this.startScanning().catch(err => console.error('Burst start error:', err));
    } else if (!enabled && this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }
  }

  isScanningActive(): boolean {
    return this.isScanning;
  }

  get isBurstScanningEnabled(): boolean {
    return this.burstEnabled;
  }

  private scheduleNextBurst(): void {
    if (this.isScanning || this.nextBurstTimer) return;
    if (!this.burstEnabled) return;

    // Don't schedule burst scans during any BLE-intensive operation
    const globalState = UnifiedBLEStateStore.getGlobalState();
    const blockedStates = [GlobalState.STREAMING, GlobalState.SYNCING, GlobalState.LOCATING, GlobalState.CONNECTING];
    if (blockedStates.includes(globalState)) {
      return;
    }

    if (this.isConnecting) {
      return;
    }

    console.log(`⏳ Scheduling next scan burst in ${BLE_CONFIG.SCAN_BURST_GAP}ms`);
    this.nextBurstTimer = setTimeout(async () => {
      this.nextBurstTimer = null;
      if (this.burstEnabled && !this.isScanning && !this.isCleaningUp && !this.isConnecting) {
        await this.startScanning();
      }
    }, BLE_CONFIG.SCAN_BURST_GAP);
  }

  // Cleanup
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up node-ble service...');
    this.isCleaningUp = true;

    // Clear connection queue
    this.connectionQueue.clear();

    if (this.isScanning) {
      await this.stopScanning(true);
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
          console.error('Error disconnecting device:', error)
        )
      );
    });

    await Promise.allSettled(disconnectPromises);
    this.devices.clear();
    this.discoveredDevices.clear();

    // Destroy bluetooth instance
    if (this.destroy) {
      this.destroy();
    }

    console.log('✅ node-ble service cleanup complete');
    this.isCleaningUp = false;
  }

  // State polling and auto-reconnect (kept for compatibility, implementations TBD)
  startStatePolling(): void {
    console.log('ℹ️  State polling not yet implemented for node-ble');
  }

  stopStatePolling(): void {
    console.log('ℹ️  State polling not yet implemented for node-ble');
  }

  // NOTE: Reconnection is now handled by ReconnectionManager singleton
  // See: ble-management/ReconnectionManager.ts

  async removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    const { UnifiedBLEStateStore, formatDeviceID } = await import('../ble-management');
    const storeDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);

    if (storeDeviceId) {
      UnifiedBLEStateStore.unregisterDevice(storeDeviceId);
      console.log(`🗑️ Device ${formatDeviceID(storeDeviceId)} removed successfully`);
      return { success: true, message: 'Device removed' };
    }
    return { success: false, message: 'Device not found' };
  }

  getDeviceState(deviceId: string): { state: number; stateName: string; lastUpdate: number } | null {
    return this.deviceStates.get(deviceId) || null;
  }

  get isBluetoothReady(): boolean {
    return this.isInitialized;
  }

  enableBurstScanningFor(durationMs: number): void {
    console.log(`🔄 Enabling burst scanning for ${durationMs}ms`);
    this.burstEnabled = true;

    if (!this.isScanning && !this.isCleaningUp) {
      this.startScanning().catch(err => console.error('Failed to start burst scan:', err));
    }

    this.burstTimeoutTimer = setTimeout(() => {
      console.log(`⏱️ Burst scanning duration elapsed - disabling`);
      this.disableBurstScanning();
      this.burstTimeoutTimer = null;
    }, durationMs);
  }

  disableBurstScanning(): void {
    console.log('🛑 Disabling burst scanning');
    this.burstEnabled = false;

    if (this.burstTimeoutTimer) {
      clearTimeout(this.burstTimeoutTimer);
      this.burstTimeoutTimer = null;
    }

    if (this.nextBurstTimer) {
      clearTimeout(this.nextBurstTimer);
      this.nextBurstTimer = null;
    }

    if (this.isScanning) {
      this.stopScanning(true).catch(err => console.error('Failed to stop scan:', err));
    }
  }

  /**
   * Clear stale GATT cache for a device (Linux/BlueZ implementation)
   *
   * CRITICAL for reconnection after device has been gone for >10 seconds.
   * BlueZ caches GATT services/characteristics and connection parameters.
   * Stale cache causes reconnection failures until cleared.
   *
   * Implementation: Remove device from BlueZ adapter (forces cache clear)
   *
   * @param bleAddress - Device BLE address to clear cache for
   * @returns Promise<boolean> - true if cleared successfully
   */
  async clearDeviceCache(bleAddress: string): Promise<boolean> {
    if (!this.isInitialized || !this.adapter) {
      console.warn(`⚠️ [${bleAddress}] Cannot clear cache - service not initialized`);
      return false;
    }

    try {
      console.log(`🧹 [${bleAddress}] Clearing stale BlueZ GATT cache...`);

      // Get device object from BlueZ
      const device = await this.adapter.getDevice(bleAddress);

      // Get device name for logging
      let deviceName = bleAddress;
      try {
        deviceName = await device.getName();
      } catch (e) {
        try {
          deviceName = await device.getAlias();
        } catch (e2) {
          // Name not available, use address
        }
      }

      // Check if device is connected
      let isConnected = false;
      try {
        isConnected = await device.isConnected();
      } catch (e) {}

      // CRITICAL: Disconnect first if connected
      // Cannot remove device from adapter while connected
      if (isConnected) {
        console.log(`🔌 [${deviceName}] Disconnecting before cache clear...`);
        try {
          await device.disconnect();
          // Wait for disconnect to complete
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (disconnectError: any) {
          // Ignore "Not Connected" errors
          if (disconnectError.type !== 'org.bluez.Error.NotConnected') {
            console.warn(`⚠️ [${deviceName}] Disconnect error before cache clear:`, disconnectError.type || disconnectError.message);
          }
        }
      }

      // CRITICAL: Remove device from BlueZ adapter
      // This forces BlueZ to clear all cached GATT data, connection parameters, and ATT MTU
      // Next connection will be treated as a fresh device discovery
      try {
        await this.adapter.removeDevice(device);
        console.log(`✅ [${deviceName}] BlueZ cache cleared successfully`);

        // Remove from internal discovered devices map
        // This ensures we don't try to use the stale device object
        this.discoveredDevices.delete(bleAddress);

        // Wait for BlueZ to process the removal
        await new Promise(resolve => setTimeout(resolve, 200));

        return true;
      } catch (removeError: any) {
        // If device doesn't exist, that's fine - cache is already clear
        if (removeError.type === 'org.bluez.Error.DoesNotExist' ||
            removeError.text?.includes('Does Not Exist')) {
          console.log(`✅ [${deviceName}] Device not in BlueZ - cache already clear`);
          this.discoveredDevices.delete(bleAddress);
          return true;
        }

        throw removeError;
      }

    } catch (error: any) {
      console.error(`❌ [${bleAddress}] Failed to clear cache:`, error.type || error.message || error);
      return false;
    }
  }
}
