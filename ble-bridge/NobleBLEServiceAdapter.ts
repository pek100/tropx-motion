/**
 * Noble BLE Service Adapter for WebSocket Bridge Integration
 *
 * Replaces the broken Web Bluetooth BLEServiceAdapter with Noble-based implementation
 */

import { NobleBluetoothService, MotionData, TropXDeviceInfo } from './index';
import { QuaternionBinaryProtocol } from './QuaternionBinaryProtocol';
import { deviceStateManager } from './DeviceStateManager';
import { deviceRegistry } from '../registry-management';

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
      console.log('📡 Noble: Starting device scan...');

      const result = await this.nobleService.startScanning();

      if (result.success) {
        // For real Noble: wait for scan to complete
        // For mock service: devices are immediately available
        const isRealNoble = result.message && !result.message.includes('Mock');

        if (isRealNoble) {
          await this.delay(8000); // 8 second scan (shorter than WebSocket timeout)
        } else {
          // Mock service - devices available immediately
          console.log('🧪 Mock service detected - getting devices immediately');
        }

        const discoveredDevices = deviceStateManager.getDiscoveredDevices();
        const deviceList = discoveredDevices.map(this.convertToDeviceInfo);

        console.log(`✅ Noble scan completed: ${deviceList.length} devices found`);

        return {
          success: true,
          devices: deviceList,
          message: `Found ${deviceList.length} TropX devices`
        };
      } else {
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

        // Broadcast device status update (connection complete)
        try {
          await this.broadcastDeviceStatus();
        } catch (broadcastError) {
          console.warn(`⚠️ Failed to broadcast device status:`, broadcastError);
          // Don't fail the connection due to broadcast issues
        }

        // Hardware Time Synchronization (Muse v3 Protocol)
        // Run in background to avoid blocking connection
        setImmediate(async () => {
          try {
            console.log(`⏱️ Starting hardware time sync for ${deviceName}...`);
            const tropxDevice = this.nobleService.getDeviceInstance(deviceId);

            if (!tropxDevice) {
              console.warn(`⚠️ Could not get device instance for time sync: ${deviceName}`);
              return;
            }

            // Step 1: Initialize device RTC with current Unix epoch time
            const rtcInitialized = await tropxDevice.initializeDeviceRTC();
            if (!rtcInitialized) {
              console.warn(`⚠️ RTC initialization failed for ${deviceName}, skipping time sync`);
              deviceRegistry.setClockOffset(deviceId, 0);
              return;
            }

            // Step 2: Fine-tune clock offset via TimeSync protocol
            const clockOffset = await tropxDevice.syncTime();
            deviceRegistry.setClockOffset(deviceId, clockOffset);

            console.log(`✅ Hardware time sync complete for ${deviceName}: offset=${clockOffset.toFixed(2)}ms`);

            // Broadcast updated device status
            await this.broadcastDeviceStatus();

          } catch (timeSyncError) {
            console.warn(`⚠️ Time sync failed for ${deviceName}, using default offset (0ms):`, timeSyncError);
            deviceRegistry.setClockOffset(deviceId, 0);
          }
        });
      } else {
        console.error(`❌ Noble: Connection failed for ${deviceName}: ${result.message}`);
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
          // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
          // console.log(`🚀 [NobleBLEServiceAdapter] Sending to motion coordinator for processing: ${deviceId}`);

          // Use device name for motion processing instead of device ID for pattern matching
          const deviceName = this.getDeviceNameById(deviceId);
          // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
          // console.log(`🏷️ [NobleBLEServiceAdapter] Using device name for motion processing: ${deviceId} → ${deviceName}`);

          this.motionCoordinator.processNewData(deviceName, legacyData);
          // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
          // console.log(`✅ [NobleBLEServiceAdapter] Motion coordinator processing initiated for ${deviceName} (${deviceId})`);
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
      const batteryRecord: Record<string, number> = {};

      // PERFORMANCE: Use for...of instead of forEach (faster)
      for (const device of allDevices) {
        if (device.batteryLevel !== null) {
          batteryRecord[device.id] = device.batteryLevel;
        }
      }

      // PERFORMANCE: Avoid double map() call - convert once
      const deviceInfoList = allDevices.map(this.convertToDeviceInfo);

      const statusData = QuaternionBinaryProtocol.serializeDeviceStatus(
        deviceInfoList,
        batteryRecord
      );

      const message = {
        type: 0x31, // MESSAGE_TYPES.DEVICE_STATUS
        requestId: 0,
        timestamp: Date.now(),
        devices: deviceInfoList,
        batteryLevels: batteryRecord,
        data: statusData
      };

      console.log(`📡 Broadcasting device status for ${allDevices.length} devices (all states)`);

      // Use setImmediate to yield event loop
      setImmediate(() => {
        this.broadcastFunction!(message, []);
      });

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
      const batteryData = QuaternionBinaryProtocol.serializeBatteryUpdate(deviceId, batteryLevel);

      const message = {
        type: 'battery_update',
        data: batteryData,
        timestamp: Date.now(),
        binary: true
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

  // Clear device registry (manual cleanup, e.g., before new session)
  clearDeviceRegistry(): void {
    console.log('🗑️ Manually clearing device registry...');
    deviceRegistry.clearAll();
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Noble BLE Service Adapter...');

    if (this.isCurrentlyRecording) {
      await this.stopRecording();
    }

    await this.nobleService.cleanup();
  }
}