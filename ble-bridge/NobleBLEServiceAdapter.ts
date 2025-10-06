/**
 * Noble BLE Service Adapter for WebSocket Bridge Integration
 *
 * Replaces the broken Web Bluetooth BLEServiceAdapter with Noble-based implementation
 */

import { NobleBluetoothService, MotionData, TropXDeviceInfo } from './index';
import { QuaternionBinaryProtocol } from './QuaternionBinaryProtocol';
import { deviceStateManager } from './DeviceStateManager';
import { deviceRegistry } from '../registry-management';
import { TimeSyncManager } from '../time-sync';
import { TropXTimeSyncAdapter } from '../time-sync/adapters/TropXTimeSyncAdapter';
import { DeviceLocateService } from './DeviceLocateService';

// BLE Service interface from WebSocket Bridge
interface BLEService {
  scanForDevices(): Promise<{ success: boolean; devices: any[]; message?: string }>;
  connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }>;
  disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }>;
  startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  stopRecording(): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  getConnectedDevices(): any[];
  isRecording(): boolean;
}

// Device info conversion
interface DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  batteryLevel: number | null;
}

export class NobleBLEServiceAdapter implements BLEService {
  private nobleService: NobleBluetoothService;
  private broadcastFunction: ((message: any, clientIds: string[]) => Promise<void>) | null = null;
  private motionCoordinator: any = null;
  private isCurrentlyRecording = false;
  private timeSyncManager = new TimeSyncManager();
  private deviceLocateService = new DeviceLocateService();
  private locateBroadcastInterval: NodeJS.Timeout | null = null;
  private static scanSequence = 0;
  private lastScanStart = 0;
  private readonly MIN_RESTART_INTERVAL_MS = 700; // avoid thrash

  constructor() {
    // Initialize Noble service with callbacks
    this.nobleService = new NobleBluetoothService(
      this.handleMotionData.bind(this),
      this.handleDeviceEvent.bind(this)
    );

    // Wire up immediate UI notifications from state manager
    this.setupStateManagerEventListeners();
  }

  // Initialize the adapter
  async initialize(): Promise<boolean> {
    try {
      console.log('🔧 Initializing Noble BLE Service Adapter...');
      const initialized = await this.nobleService.initialize();

      if (initialized) {
        console.log('✅ Noble BLE Service Adapter ready');
      } else {
        console.error('❌ Failed to initialize Noble BLE Service Adapter');
      }

      return initialized;
    } catch (error) {
      console.error('❌ Noble BLE Service Adapter initialization error:', error);
      return false;
    }
  }

  // Set broadcast function for WebSocket communication
  setBroadcastFunction(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
    this.broadcastFunction = broadcastFn;
    console.log('📡 [NobleBLEServiceAdapter] WebSocket broadcast function configured');

    // If motion coordinator is already connected, configure it now
    if (this.motionCoordinator && this.motionCoordinator.setWebSocketBroadcast) {
      this.motionCoordinator.setWebSocketBroadcast(broadcastFn);
      console.log('📡 [NobleBLEServiceAdapter] Configured motion coordinator to broadcast processed joint angles via WebSocket (from setBroadcastFunction)');
    }
  }

  // Connect motion coordinator for processing operations
  connect(motionCoordinator: any): void {
    this.motionCoordinator = motionCoordinator;
    console.log('🔗 [NobleBLEServiceAdapter] Connected to Motion Processing Coordinator');

    // Configure motion coordinator to send processed joint angles via WebSocket
    if (this.broadcastFunction && this.motionCoordinator.setWebSocketBroadcast) {
      this.motionCoordinator.setWebSocketBroadcast(this.broadcastFunction);
      console.log('📡 [NobleBLEServiceAdapter] Configured motion coordinator to broadcast processed joint angles via WebSocket (from connect)');
    }
  }


  // Scan for TropX devices using Noble
  async scanForDevices(): Promise<{ success: boolean; devices: any[]; message?: string }> {
    try {
      const seq = ++NobleBLEServiceAdapter.scanSequence;
      const scanningActive = typeof (this.nobleService as any).isScanningActive === 'function' && (this.nobleService as any).isScanningActive();
      console.log(`📡 [SCAN:${seq}] Noble: Starting (or snapshotting). active=${scanningActive}`);

      if (scanningActive) {
        // If active scan has been running long enough, restart to force fresh discovery cycle
        const elapsed = Date.now() - this.lastScanStart;
        if (elapsed > this.MIN_RESTART_INTERVAL_MS) {
          console.log(`♻️ [SCAN:${seq}] Restarting active scan after ${elapsed}ms for burst cycle`);
          try { await (this.nobleService as any).stopScanning(); } catch (e) { console.warn('⚠️ Stop scan error (ignored):', e); }
        } else {
          const snapshot = deviceStateManager.getDiscoveredDevices().map(this.convertToDeviceInfo);
          console.log(`📸 [SCAN:${seq}] Snapshot during active scan: count=${snapshot.length}`);
          return { success: true, devices: snapshot, message: `Snapshot (${snapshot.length}) during active scan [${seq}]` };
        }
      }

      const result = await this.nobleService.startScanning();
      if (result.success) {
        this.lastScanStart = Date.now();
        const isRealNoble = result.message && !result.message.includes('Mock');
        if (!isRealNoble) {
          console.log(`🧪 [SCAN:${seq}] Mock service immediate devices`);
        }
        const discoveredDevices = deviceStateManager.getDiscoveredDevices();
        const deviceList = discoveredDevices.map(this.convertToDeviceInfo);
        console.log(`✅ [SCAN:${seq}] Kickoff returned ${deviceList.length} devices (non-blocking)`);
        return {
            success: true,
            devices: deviceList,
            message: `Scan started (non-blocking), current ${deviceList.length} [${seq}]`
        };
      } else {
        console.warn(`⚠️ [SCAN:${seq}] Scan start failed: ${result.message}`);
        return result;
      }

    } catch (error) {
      console.error('❌ Noble scan failed:', error);
      return {
        success: false,
        devices: [],
        message: `Scan failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Connect to device using Noble
  async connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.log(`🔗 Noble: Connecting to device ${deviceName} (${deviceId})`);

      const result = await this.nobleService.connectToDevice(deviceId);

      if (result.success) {
        console.log(`✅ Noble: Successfully connected to ${deviceName}`);

        // Register device in registry (assigns deviceID based on name pattern)
        const registeredDevice = deviceRegistry.registerDevice(deviceId, deviceName);
        if (!registeredDevice) {
          console.error(`❌ Failed to register device "${deviceName}" - unknown device pattern`);
          return {
            success: false,
            message: `Device "${deviceName}" doesn't match any known patterns. Please check device naming or add manual override.`
          };
        }

        console.log(`📋 Device registered: ${deviceName} → ID 0x${registeredDevice.deviceID.toString(16)} (${registeredDevice.joint}, ${registeredDevice.position})`);

        // CRITICAL: Clear registry sync state FIRST before any device instance access
        // This prevents stale registry state from being copied to device instance
        deviceRegistry.setClockOffset(deviceId, 0, 'not_synced');
        console.log(`🔄 [${deviceName}] Cleared registry sync state - forcing fresh time sync`);

        // CRITICAL: Clear device instance sync state
        // Must be done AFTER registry clear
        const tropxDeviceInstance = this.nobleService.getDeviceInstance(deviceId);
        if (tropxDeviceInstance) {
          // Reset sync state to ensure fresh time sync
          (tropxDeviceInstance as any).wrapper.deviceInfo.syncState = 'not_synced';
          (tropxDeviceInstance as any).wrapper.deviceInfo.clockOffset = undefined;
          console.log(`🔄 [${deviceName}] Cleared device instance sync state`);
        }

        // Broadcast device status update (connection complete)
        try {
          await this.broadcastDeviceStatus();
        } catch (broadcastError) {
          console.warn(`⚠️ Failed to broadcast device status:`, broadcastError);
          // Don't fail the connection due to broadcast issues
        }

        // Auto-sync disabled - will be handled in batch after all connections complete
      } else {
        console.error(`❌ Noble: Connection failed for ${deviceName}: ${result.message}`);

        // Broadcast device status update on failure (to update UI)
        try {
          await this.broadcastDeviceStatus();
        } catch (broadcastError) {
          console.warn(`⚠️ Failed to broadcast device status on error:`, broadcastError);
        }
      }

      return result;

    } catch (error) {
      console.error(`❌ Noble connection failed for ${deviceId}:`, error);
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Sync single device using new time-sync module
   */
  private async syncSingleDevice(deviceId: string): Promise<void> {
    const tropxDevice = this.nobleService.getDeviceInstance(deviceId);
    if (!tropxDevice) {
      console.warn(`⚠️ Could not get device instance for sync: ${deviceId}`);
      return;
    }

    const adapter = new TropXTimeSyncAdapter(tropxDevice);
    const result = await this.timeSyncManager.syncDevice(adapter);

    if (result.success) {
      console.log(`✅ Sync complete: ${result.deviceName}, offset=${result.finalOffset.toFixed(2)}ms`);
      await this.broadcastDeviceStatus();
    } else {
      console.error(`❌ Sync failed: ${result.deviceName}, error=${result.error}`);
    }
  }

  /**
   * Manually sync all connected devices (called by sync button)
   */
  async syncAllDevices(): Promise<{ success: boolean; results: any[] }> {
    try {
      console.log('⏱️ Manual sync: Synchronizing all connected devices...');

      // Reset manager for new sync session
      this.timeSyncManager.reset();

      // Get all connected devices
      const connectedDevices = this.nobleService.getConnectedDevices();
      if (connectedDevices.length === 0) {
        return { success: false, results: [] };
      }

      // Broadcast SYNC_STARTED
      if (this.broadcastFunction) {
        await this.broadcastFunction({
          type: 0x33, // SYNC_STARTED
          requestId: 0,
          timestamp: Date.now(),
          deviceCount: connectedDevices.length
        }, []);
      }

      // Set live sample callback to broadcast device timestamps during sync
      this.timeSyncManager.setOnSampleCallback((deviceId: string, deviceName: string, deviceTimestampMs: number) => {
        if (this.broadcastFunction) {
          this.broadcastFunction({
            type: 0x34, // SYNC_PROGRESS - reuse for live updates
            requestId: 0,
            timestamp: Date.now(),
            deviceId,
            deviceName,
            clockOffsetMs: 0, // Not calculated yet during sampling
            deviceTimestampMs,
            success: true,
            message: 'Sampling...'
          }, []).catch(err => console.error('Failed to broadcast sync sample:', err));
        }
      });

      // Create adapters
      const adapters = connectedDevices
        .map(info => {
          const device = this.nobleService.getDeviceInstance(info.id);
          return device ? new TropXTimeSyncAdapter(device) : null;
        })
        .filter((adapter): adapter is TropXTimeSyncAdapter => adapter !== null);

      // Sync all devices (SET_CLOCK_OFFSET applied inside syncDevices)
      const results = await this.timeSyncManager.syncDevices(adapters);

      // Broadcast SYNC_PROGRESS for each device with clock offset
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const deviceInfo = connectedDevices[i];

        // DEBUG: Log what we're checking
        console.log(`🔍 [SYNC] Checking result for ${deviceInfo.name}:`, {
          success: result.success,
          finalOffset: result.finalOffset,
          hasOffset: result.finalOffset !== undefined,
          deviceId: deviceInfo.id
        });

        // Store clock offset in registry for DeviceProcessor to use
        // IMPORTANT: Use DeviceID (not BLE address) as key to match DeviceProcessor lookup
        if (result.success && result.finalOffset !== undefined) {
          const registeredDevice = deviceRegistry.getDeviceByAddress(deviceInfo.id);
          if (registeredDevice) {
            deviceRegistry.setClockOffset(registeredDevice.deviceID, result.finalOffset, 'fully_synced');
            console.log(`⏱️ [SYNC] Stored clock offset for ${deviceInfo.name} (DeviceID: 0x${registeredDevice.deviceID.toString(16)}): ${result.finalOffset}ms`);
          } else {
            console.error(`❌ [SYNC] Device ${deviceInfo.name} not found in registry - cannot store offset`);
          }
        } else {
          console.warn(`⚠️ [SYNC] NOT storing offset for ${deviceInfo.name}: success=${result.success}, finalOffset=${result.finalOffset}`);
        }

        if (this.broadcastFunction && deviceInfo) {
          await this.broadcastFunction({
            type: 0x34, // SYNC_PROGRESS
            requestId: 0,
            timestamp: Date.now(),
            deviceId: deviceInfo.id,
            deviceName: deviceInfo.name,
            clockOffsetMs: result.finalOffset || 0,
            deviceTimestampMs: result.deviceTimestampMs || 0,
            success: result.success,
            message: result.error || 'Synced successfully'
          }, []);
        }
      }

      // Broadcast SYNC_COMPLETE
      const successCount = results.filter(r => r.success).length;
      if (this.broadcastFunction) {
        await this.broadcastFunction({
          type: 0x35, // SYNC_COMPLETE
          requestId: 0,
          timestamp: Date.now(),
          totalDevices: results.length,
          successCount,
          failureCount: results.length - successCount
        }, []);
      }

      // Broadcast status update
      await this.broadcastDeviceStatus();

      console.log(`✅ Manual sync complete: ${successCount}/${results.length} devices synced`);

      return { success: true, results };
    } catch (error) {
      console.error('❌ Manual sync failed:', error);
      return { success: false, results: [] };
    }
  }

  // Disconnect device using Noble
  async disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      console.log(`🔌 Noble: Disconnecting device ${deviceId}`);

      const result = await this.nobleService.disconnectDevice(deviceId);

      console.log(`🔌 Disconnect result for ${deviceId}:`, result);

      if (result.success) {
        // DO NOT unregister device from registry on disconnect!
        // Registry should persist device mappings so they can reconnect with same ID.
        // Physical disconnects (battery, interference) should not lose device identity.
        console.log(`📋 Device ${deviceId} disconnected but registry mapping preserved for reconnection`);

        // CRITICAL: Clean up device from motion processing to prevent stale data
        if (this.motionCoordinator && typeof this.motionCoordinator.removeDevice === 'function') {
          const registeredDevice = deviceRegistry.getDeviceByAddress(deviceId);
          if (registeredDevice) {
            console.log(`🧹 Cleaning up device 0x${registeredDevice.deviceID.toString(16)} from motion processing`);
            this.motionCoordinator.removeDevice(registeredDevice.deviceID);
          }
        }

        // Broadcast device status update
        await this.broadcastDeviceStatus();
      } else {
        console.warn(`⚠️ Disconnect failed for ${deviceId}: ${result.message}`);
      }

      return result;

    } catch (error) {
      console.error(`❌ Noble disconnect failed for ${deviceId}:`, error);
      return {
        success: false,
        message: `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Start recording (streaming quaternion data)
  async startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string; recordingId?: string }> {
    if (this.isCurrentlyRecording) {
      return { success: false, message: 'Recording already in progress' };
    }

    try {
      console.log(`🎬 Noble: Starting recording session ${sessionId}`);

      // Reset first packet tracking for delta calculations
      const { TropXDevice } = await import('./TropXDevice');
      TropXDevice.resetFirstPacketTracking();

      // Clear clock offsets for all devices - will be recalculated from first streaming packet
      const connectedDevices = this.nobleService.getConnectedDevices();
      for (const device of connectedDevices) {
        const registeredDevice = deviceRegistry.getDeviceByAddress(device.id);
        if (registeredDevice) {
          deviceRegistry.setClockOffset(registeredDevice.deviceID, 0, 'not_synced');
          console.log(`🔄 [${device.name}] Cleared clock offset - will recalculate from first packet`);
        }
      }

      // Motion processing will be handled in WebSocket bridge (main process)

      // Start streaming on all connected devices
      const streamingResult = await this.nobleService.startStreamingAll();

      if (streamingResult.success && streamingResult.started > 0) {
        this.isCurrentlyRecording = true;

        // Broadcast recording state
        await this.broadcastRecordingState(true, sessionId);

        return {
          success: true,
          message: `Recording started on ${streamingResult.started} device(s)`,
          recordingId: sessionId
        };
      } else {
        return {
          success: false,
          message: `Failed to start streaming: ${streamingResult.started}/${streamingResult.total} devices`
        };
      }

    } catch (error) {
      console.error('❌ Noble recording start failed:', error);
      return {
        success: false,
        message: `Recording start failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Stop recording
  async stopRecording(): Promise<{ success: boolean; message?: string; recordingId?: string }> {
    if (!this.isCurrentlyRecording) {
      return { success: false, message: 'No recording in progress' };
    }

    try {
      console.log('🛑 Noble: Stopping recording session');

      // Stop streaming on all devices
      await this.nobleService.stopStreamingAll();

      // Motion processing stop will be handled in WebSocket bridge (main process)

      this.isCurrentlyRecording = false;

      // Broadcast recording state
      await this.broadcastRecordingState(false);

      return {
        success: true,
        message: 'Recording stopped successfully'
      };

    } catch (error) {
      console.error('❌ Noble recording stop failed:', error);
      return {
        success: false,
        message: `Recording stop failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Get connected devices
  getConnectedDevices(): any[] {
    // Get devices from NobleBluetoothService which has actual TropXDevice instances with battery info
    // deviceStateManager only tracks connection states, not battery levels
    const devices = this.nobleService.getConnectedDevices();
    return devices.map(this.convertToDeviceInfo);
  }

  // Check if recording
  isRecording(): boolean {
    return this.isCurrentlyRecording;
  }

  // Handle motion data from Noble devices
  private async handleMotionData(deviceId: string, motionData: MotionData): Promise<void> {
    // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
    // console.log(`🎯 [NobleBLEServiceAdapter] Received motion data from ${deviceId}: q(${motionData.quaternion.w.toFixed(3)}, ${motionData.quaternion.x.toFixed(3)}, ${motionData.quaternion.y.toFixed(3)}, ${motionData.quaternion.z.toFixed(3)})`);

    try {
      // Process quaternions through motion coordinator FIRST, then coordinator sends processed data via WebSocket
      if (this.motionCoordinator) {
        // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
        // console.log(`🏭 [NobleBLEServiceAdapter] Processing quaternions through motion coordinator: ${deviceId}`);

        // Convert to legacy IMU format for motion coordinator
        // OPTIMIZED: Removed gyr/axl/mag object creation (was creating 200 objects/sec)
        const legacyData = {
          timestamp: motionData.timestamp,
          quaternion: motionData.quaternion
        };

        try {
          // Get the DeviceID (0x11, 0x12, etc.) from registry - most efficient identifier
          const registeredDevice = deviceRegistry.getDeviceByAddress(deviceId);
          if (!registeredDevice) {
            console.error(`❌ [NobleBLEServiceAdapter] Device ${deviceId} not found in registry - cannot process data`);
            return;
          }

          // Pass DeviceID (float) to motion coordinator for efficient lookup
          this.motionCoordinator.processNewData(registeredDevice.deviceID, legacyData);
        } catch (error) {
          console.error(`❌ [NobleBLEServiceAdapter] Error in motion coordinator processing for ${deviceId}:`, error);
        }
      } else {
        console.error(`❌ [NobleBLEServiceAdapter] No motion coordinator available - quaternions cannot be processed for ${deviceId}!`);
      }

    } catch (error) {
      console.error(`Error handling motion data from ${deviceId}:`, error);
    }
  }

  // Get device name by ID for motion processing
  private getDeviceNameById(deviceId: string): string {
    const device = deviceStateManager.getDevice(deviceId);
    return device?.name || deviceId;
  }

  // Handle device events
  private async handleDeviceEvent(deviceId: string, event: string, data?: any): Promise<void> {
    console.log(`📱 Device event: ${deviceId} - ${event}`, data ? data : '');

    // Broadcast device status updates
    if (['connected', 'disconnected', 'discovered'].includes(event)) {
      await this.broadcastDeviceStatus();
    }

    // Handle battery updates
    if (event === 'battery_update' && data) {
      await this.broadcastBatteryUpdate(deviceId, data.batteryLevel);
      // Also broadcast device status to ensure UI gets battery update
      await this.broadcastDeviceStatus();
    }
  }

  // Broadcast device status update
  // PERFORMANCE FIX: Throttle broadcasts to prevent event loop blocking
  private lastBroadcastTime = 0;
  private readonly BROADCAST_THROTTLE_MS = 100; // Max 10 broadcasts/sec
  private pendingBroadcast = false;

  private async broadcastDeviceStatus(): Promise<void> {
    if (!this.broadcastFunction) return;

    // Throttle: Schedule broadcast if too soon since last one
    const now = Date.now();
    if (now - this.lastBroadcastTime < this.BROADCAST_THROTTLE_MS) {
      if (!this.pendingBroadcast) {
        this.pendingBroadcast = true;
        setTimeout(() => {
          this.pendingBroadcast = false;
          this.flushDeviceStatusBroadcast();
        }, this.BROADCAST_THROTTLE_MS);
      }
      return;
    }

    this.flushDeviceStatusBroadcast();
  }

  private async flushDeviceStatusBroadcast(): Promise<void> {
    if (!this.broadcastFunction) return;

    this.lastBroadcastTime = Date.now();

    try {
      // Include ALL devices (discovered, connected, streaming) for real-time UI updates
      const allDevices = deviceStateManager.getAllDevices();

      console.log(`📡 Broadcasting device status for ${allDevices.length} devices (all states)`);

      // Send INDIVIDUAL DeviceStatusMessage for each device (per protocol spec)
      for (const device of allDevices) {
        const message = {
          type: 0x31, // MESSAGE_TYPES.DEVICE_STATUS
          requestId: 0,
          timestamp: Date.now(),
          deviceId: device.id,
          deviceName: device.name,
          state: device.state,
          batteryLevel: device.batteryLevel ?? undefined
        };

        // Use setImmediate to yield event loop
        setImmediate(() => {
          this.broadcastFunction!(message, []);
        });
      }

    } catch (error) {
      console.error('Error broadcasting device status:', error);
    }
  }

  // Broadcast battery update
  private async broadcastBatteryUpdate(deviceId: string, batteryLevel: number): Promise<void> {
    if (!this.broadcastFunction) {
      console.warn(`⚠️ Cannot broadcast battery - no broadcast function configured`);
      return;
    }

    try {
      console.log(`🔋 Broadcasting battery update: ${batteryLevel}% for device ${deviceId}`);

      // Get device name from state manager
      const device = deviceStateManager.getDevice(deviceId);
      const deviceName = device?.name || deviceId;

      const message = {
        type: 0x32, // MESSAGE_TYPES.BATTERY_UPDATE
        requestId: 0,
        timestamp: Date.now(),
        deviceId,
        deviceName,
        batteryLevel
      };

      await this.broadcastFunction(message, []);
      console.log(`✅ Battery broadcast complete`);

    } catch (error) {
      console.error('❌ Error broadcasting battery update:', error);
    }
  }

  // Broadcast recording state
  private async broadcastRecordingState(isRecording: boolean, sessionId?: string): Promise<void> {
    if (!this.broadcastFunction) return;

    try {
      const message = {
        type: 'recording_state',
        data: {
          isRecording,
          startTime: isRecording ? new Date().toISOString() : undefined,
          sessionId
        },
        timestamp: Date.now()
      };

      await this.broadcastFunction(message, []);

    } catch (error) {
      console.error('Error broadcasting recording state:', error);
    }
  }

  // Convert TropX device info to WebSocket Bridge format
  private convertToDeviceInfo(tropxDevice: TropXDeviceInfo): DeviceInfo {
    return {
      id: tropxDevice.id,
      name: tropxDevice.name,
      connected: tropxDevice.state === 'connected' || tropxDevice.state === 'streaming',
      batteryLevel: tropxDevice.batteryLevel
    };
  }

  // Setup event listeners for immediate UI notifications
  private setupStateManagerEventListeners(): void {
    // Listen for device state changes
    deviceStateManager.on('deviceStateChanged', async (event) => {
      try {
        if (this.broadcastFunction) {
          const message = {
            type: 'device_state_changed',
            data: {
              deviceId: event.deviceId,
              previousState: event.previousState,
              newState: event.newState,
              device: event.device
            },
            timestamp: Date.now()
          };

          await this.broadcastFunction(message, []);
        }
      } catch (error) {
        console.error('Error broadcasting device state change:', error);
      }
    });

    // Listen for global streaming state changes
    deviceStateManager.on('globalStreamingStateChanged', async (event) => {
      try {
        if (this.broadcastFunction) {
          const message = {
            type: 'global_streaming_state_changed',
            data: {
              previousState: event.previousState,
              newState: event.newState,
              affectedDevices: event.affectedDevices
            },
            timestamp: Date.now()
          };

          await this.broadcastFunction(message, []);
        }
      } catch (error) {
        console.error('Error broadcasting global streaming state change:', error);
      }
    });

    // Listen for device clearing events
    deviceStateManager.on('allDevicesCleared', async (event) => {
      try {
        if (this.broadcastFunction) {
          const message = {
            type: 'all_devices_cleared',
            data: {
              deviceIds: event.deviceIds
            },
            timestamp: Date.now()
          };

          await this.broadcastFunction(message, []);
        }
      } catch (error) {
        console.error('Error broadcasting all devices cleared:', error);
      }
    });
  }

  // Utility delay function
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get all devices (for state query on reconnect)
  getAllDevices(): { success: boolean; devices: any[] } {
    try {
      const allDevices = deviceStateManager.getAllDevices();
      return {
        success: true,
        devices: allDevices.map(d => ({
          id: d.id,
          name: d.name,
          address: d.address,
          rssi: d.rssi,
          state: d.state,
          batteryLevel: d.batteryLevel,
          isManaged: d.isManaged
        }))
      };
    } catch (error) {
      console.error('Error getting all devices:', error);
      return { success: false, devices: [] };
    }
  }

  // Clear device registry (manual cleanup, e.g., before new session)
  clearDeviceRegistry(): void {
    console.log('🗑️ Manually clearing device registry...');
    deviceRegistry.clearAll();
  }

  // Start locate mode (accelerometer-based device detection)
  async startLocateMode(): Promise<{ success: boolean; message?: string }> {
    try {
      console.log('🔍 Starting locate mode...');

      // CRITICAL: Disable burst scanning to prevent interference with accelerometer notifications
      if (this.nobleService.isBurstScanningEnabled) {
        console.log('🛑 Disabling burst scanning during locate mode (prevents notification interference)');
        this.nobleService.disableBurstScanning();
      }

      const connectedDevices = this.nobleService.getConnectedDevices();
      if (connectedDevices.length === 0) {
        return { success: false, message: 'No connected devices' };
      }

      // Get TropXDevice instances for all connected devices
      const deviceInstances = connectedDevices
        .map(info => this.nobleService.getDeviceInstance(info.id))
        .filter(device => device !== null);

      if (deviceInstances.length === 0) {
        return { success: false, message: 'No device instances available' };
      }

      // Start accelerometer streaming on all devices
      await this.deviceLocateService.startLocateMode(deviceInstances);

      // Set up periodic broadcast of vibrating devices (every 100ms for responsive UI)
      // Always broadcast, even if empty, so frontend knows locate mode is active
      let broadcastInProgress = false;
      this.locateBroadcastInterval = setInterval(() => {
        // Skip if previous broadcast still in progress (prevents event loop overflow)
        if (broadcastInProgress) {
          console.warn('⚠️ Skipping vibration broadcast - previous still in progress');
          return;
        }

        broadcastInProgress = true;
        const vibratingDeviceIds = this.deviceLocateService.getShakingDevices();

        if (this.broadcastFunction) {
          // Fire-and-forget (no await) to prevent interval pileup
          this.broadcastFunction({
            type: 0x36, // DEVICE_VIBRATING
            requestId: 0,
            timestamp: Date.now(),
            vibratingDeviceIds
          }, []).finally(() => {
            broadcastInProgress = false;
          });
        } else {
          broadcastInProgress = false;
        }
      }, 100);

      console.log(`✅ Locate mode started for ${deviceInstances.length} devices`);
      return { success: true };

    } catch (error) {
      console.error('❌ Failed to start locate mode:', error);
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Stop locate mode
  async stopLocateMode(): Promise<{ success: boolean; message?: string }> {
    try {
      console.log('🛑 Stopping locate mode...');

      // Clear broadcast interval
      if (this.locateBroadcastInterval) {
        clearInterval(this.locateBroadcastInterval);
        this.locateBroadcastInterval = null;
      }

      // Stop accelerometer streaming
      await this.deviceLocateService.stopLocateMode();

      console.log('✅ Locate mode stopped');
      return { success: true };

    } catch (error) {
      console.error('❌ Failed to stop locate mode:', error);
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // Enable burst scanning for a duration (called on auto-start and refresh)
  enableBurstScanningFor(durationMs: number): void {
    this.nobleService.enableBurstScanningFor(durationMs);
  }

  // Manually disable burst scanning (called when user stops refresh)
  disableBurstScanning(): void {
    this.nobleService.disableBurstScanning();
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Noble BLE Service Adapter...');

    if (this.isCurrentlyRecording) {
      await this.stopRecording();
    }

    // Stop locate mode if active
    if (this.locateBroadcastInterval) {
      await this.stopLocateMode();
    }

    // Disable burst scanning
    this.nobleService.disableBurstScanning();

    await this.nobleService.cleanup();
  }
}