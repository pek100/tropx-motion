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
import { deviceStateManager, GlobalStreamingState } from './DeviceStateManager';
import { bleLogger } from './BleLogger';
import { NodeBleToNobleAdapter } from './NodeBleToNobleAdapter';

// node-ble imports
const { createBluetooth } = require('node-ble');

export class NodeBleService {
  private bluetooth: any;
  private destroy: any;
  private adapter: any;
  private devices = new Map<string, TropXDevice>();
  private discoveredDevices = new Map<string, any>(); // node-ble Device objects
  private isScanning = false;
  private isInitialized = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private isCleaningUp = false;

  // Connection lock - prevents scanning while connecting devices
  private isConnecting = false;
  // Per-device connection lock - prevents duplicate connection attempts
  private connectingDevices = new Set<string>();

  // Burst scanning support (kept for compatibility)
  private burstEnabled: boolean = BLE_CONFIG.SCAN_BURST_ENABLED;
  private nextBurstTimer: NodeJS.Timeout | null = null;
  private burstTimeoutTimer: NodeJS.Timeout | null = null;

  // State polling support
  private statePollingTimer: NodeJS.Timeout | null = null;
  private isStatePollingEnabled = false;
  private deviceStates = new Map<string, { state: number; stateName: string; lastUpdate: number }>();

  // Auto-reconnect support
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  private reconnectAttempts = new Map<string, number>();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly BASE_RECONNECT_DELAY = 2000;
  private readonly MAX_RECONNECT_DELAY = 60000;

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
      deviceStateManager.clearAllDevices();
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
      console.log('🧹 Cleared stale device states from previous session');

      this.isInitialized = true;
      console.log('✅ node-ble service initialized successfully');
      return true;

    } catch (error) {
      console.error('❌ Failed to initialize node-ble service:', error);
      return false;
    }
  }

  // Start scanning for TropX devices
  async startScanning(): Promise<BleScanResult> {
    console.log('🔍 NodeBleService.startScanning called');

    if (!this.isInitialized || !this.adapter) {
      console.log('❌ Service not initialized');
      return { success: false, devices: [], message: 'BLE service not initialized' };
    }

    // CRITICAL: Prevent scanning while connecting devices
    if (this.isConnecting) {
      console.log('⏸️ Cannot start scan - device connection in progress');
      return { success: false, devices: [], message: 'Connection in progress - scanning disabled' };
    }

    if (this.isScanning) {
      return { success: false, devices: [], message: 'Already scanning' };
    }

    try {
      console.log(`📡 Starting BLE scan for devices (${BLE_CONFIG.DEVICE_PATTERNS.join(', ')})...`);
      this.isScanning = true;

      // Start discovery if not already discovering
      const isDiscovering = await this.adapter.isDiscovering();
      if (!isDiscovering) {
        await this.adapter.startDiscovery();
      }

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
          const name = await device.getName();

          // Check if this is a TropX device
          const nameLower = name.toLowerCase();
          const isTargetDevice = BLE_CONFIG.DEVICE_PATTERNS.some(pattern =>
            nameLower.includes(pattern.toLowerCase())
          );

          if (!isTargetDevice) continue;

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

          // Check if device was previously connected
          const existingDevice = deviceStateManager.getDevice(address);
          let targetState: DeviceConnectionState = 'discovered';

          if (existingDevice && (existingDevice.state === 'connected' || existingDevice.state === 'streaming')) {
            targetState = existingDevice.state;
            console.log(`🔄 Device ${name} rediscovered - preserving ${targetState} state`);
          }

          // Update device in state manager
          const managedDevice = deviceStateManager.updateDevice(deviceInfo, targetState);

          // Notify event callback
          if (this.deviceEventCallback) {
            this.deviceEventCallback(address, 'discovered', managedDevice);
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
    return deviceStateManager.getAllDevices();
  }

  // Connect to single device
  async connectToDevice(deviceId: string): Promise<BleConnectionResult> {
    const results = await this.connectToDevices([deviceId]);
    return results[0] || {
      success: false,
      deviceId,
      message: 'Connection failed - no result returned'
    };
  }

  // Connect to multiple devices sequentially
  async connectToDevices(deviceIds: string[]): Promise<BleConnectionResult[]> {
    if (deviceIds.length === 0) {
      return [];
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

      // Give adapter time to stabilize
      await new Promise(resolve => setTimeout(resolve, 500));

      // Update devices to connecting state
      deviceIds.forEach(deviceId => {
        const device = this.discoveredDevices.get(deviceId);
        if (device) {
          deviceStateManager.setDeviceConnectionState(deviceId, 'connecting');
        }
      });

      // Connect sequentially
      console.log(`🔗 Connecting devices sequentially...`);
      const results: BleConnectionResult[] = [];

      for (const deviceId of deviceIds) {
        const result = await this.connectSingleDevice(deviceId);
        results.push(result);

        // Delay between connections
        if (result.success) {
          console.log(`✅ Device connected, waiting 500ms before next connection...`);
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Connection completed: ${successCount}/${deviceIds.length} device(s) connected`);

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

  // Connect to single device (internal)
  private async connectSingleDevice(deviceId: string): Promise<BleConnectionResult> {
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

      // Connect using node-ble
      await nodeBleDevice.connect();

      const connectDuration = Date.now() - connectStartTime;

      bleLogger.logConnection(deviceId, deviceName, 'CONNECT_SUCCESS', {
        durationMs: connectDuration
      });

      console.log(`✅ [${deviceId}] Connected successfully in ${connectDuration}ms`);

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
        state: 'connected' as DeviceConnectionState,
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

      this.devices.set(deviceId, tropxDevice);
      deviceStateManager.setDeviceConnectionState(deviceId, 'connected');

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
      deviceStateManager.setDeviceConnectionState(deviceId, 'error');
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
    const connectedDevices = deviceStateManager.getConnectedDevices();

    if (connectedDevices.length === 0) {
      return { success: false, started: 0, total: 0, results: [] };
    }

    console.log(`🎬 Starting global streaming on ${connectedDevices.length} connected devices...`);
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STARTING);

    // Disable burst scanning during streaming
    if (this.burstEnabled) {
      console.log('🛑 Disabling burst scanning during streaming');
      await this.stopScanning(true);
      this.setBurstScanningEnabled(false);
    }

    // Start streaming on all devices in parallel
    const streamingTasks = connectedDevices.map(device => this.startDeviceStreaming(device.id));
    const results = await Promise.all(streamingTasks);

    const successCount = results.filter(result => result.success).length;

    if (successCount > 0) {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.ACTIVE);
      console.log(`✅ Global streaming started: ${successCount}/${connectedDevices.length} devices streaming`);
    } else {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
      console.log(`❌ Global streaming failed: no devices started streaming`);
    }

    return {
      success: successCount > 0,
      started: successCount,
      total: connectedDevices.length,
      results
    };
  }

  // Stop global streaming
  async stopGlobalStreaming(): Promise<{ success: boolean; stopped: number; total: number }> {
    const streamingDevices = deviceStateManager.getStreamingDevices();

    if (streamingDevices.length === 0) {
      deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);
      return { success: true, stopped: 0, total: 0 };
    }

    console.log(`🛑 Stopping global streaming on ${streamingDevices.length} devices...`);
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPING);

    const stoppingTasks = streamingDevices.map(device => this.stopDeviceStreaming(device.id));
    const results = await Promise.all(stoppingTasks);

    const successCount = results.filter(result => result.success).length;
    deviceStateManager.setGlobalStreamingState(GlobalStreamingState.STOPPED);

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

  // Auto-recovery for newly connected devices
  async recoverStreamingForDevice(deviceId: string): Promise<boolean> {
    if (!deviceStateManager.isGlobalStreamingActive()) {
      return false;
    }

    const device = deviceStateManager.getDevice(deviceId);
    if (!device || device.state !== 'connected') {
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

    const streamingState = deviceStateManager.getGlobalStreamingState();
    if (streamingState === GlobalStreamingState.ACTIVE || streamingState === GlobalStreamingState.STARTING) {
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

  scheduleReconnect(deviceId: string, deviceName: string): void {
    console.log(`ℹ️  Auto-reconnect not yet implemented for node-ble: ${deviceName}`);
  }

  cancelReconnect(deviceId: string): void {
    console.log(`ℹ️  Cancel reconnect not yet implemented for node-ble`);
  }

  async removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    this.cancelReconnect(deviceId);
    const { deviceRegistry } = await import('../registry-management');
    const removed = deviceRegistry.removeDevice(deviceId);
    return removed
      ? { success: true, message: 'Device removed' }
      : { success: false, message: 'Device not found' };
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
}
