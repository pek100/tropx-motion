/**
 * Noble BLE Service Adapter for WebSocket Bridge Integration
 *
 * Replaces the broken Web Bluetooth BLEServiceAdapter with Noble-based implementation
 */

import { NobleBluetoothService, MotionData, TropXDeviceInfo } from './index';
import { QuaternionBinaryProtocol } from './QuaternionBinaryProtocol';
import { deviceStateManager } from './DeviceStateManager';

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

    // If motion coordinator is already connected, configure it now
    if (this.motionCoordinator && this.motionCoordinator.setWebSocketBroadcast) {
      this.motionCoordinator.setWebSocketBroadcast(broadcastFn);
      console.log('📡 Configured motion processing to broadcast joint angles via WebSocket (from setBroadcastFunction)');
    }
  }

  // Connect motion coordinator for recording operations
  connect(motionCoordinator: any): void {
    this.motionCoordinator = motionCoordinator;
    console.log('🔗 Connected to Motion Processing Coordinator');

    // Configure motion coordinator to send processed joint angles via WebSocket
    if (this.broadcastFunction && this.motionCoordinator.setWebSocketBroadcast) {
      this.motionCoordinator.setWebSocketBroadcast(this.broadcastFunction);
      console.log('📡 Configured motion processing to broadcast joint angles via WebSocket');
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
        // Broadcast device status update
        try {
          await this.broadcastDeviceStatus();
        } catch (broadcastError) {
          console.warn(`⚠️ Failed to broadcast device status:`, broadcastError);
          // Don't fail the connection due to broadcast issues
        }
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

      if (result.success) {
        // Broadcast device status update
        await this.broadcastDeviceStatus();
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

      // Start motion processing coordinator if available
      if (this.motionCoordinator) {
        const coordinatorSuccess = this.motionCoordinator.startRecording(sessionId, exerciseId, setNumber);
        if (!coordinatorSuccess) {
          return { success: false, message: 'Failed to start motion processing' };
        }
      }

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

      // Stop motion processing coordinator if available
      if (this.motionCoordinator) {
        await this.motionCoordinator.stopRecording();
      }

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
    const devices = deviceStateManager.getConnectedDevices();
    return devices.map(this.convertToDeviceInfo);
  }

  // Check if recording
  isRecording(): boolean {
    return this.isCurrentlyRecording;
  }

  // Handle motion data from Noble devices
  private async handleMotionData(deviceId: string, motionData: MotionData): Promise<void> {
    console.log(`🎯 [NobleBLEServiceAdapter] Received motion data from ${deviceId}: q(${motionData.quaternion.w.toFixed(3)}, ${motionData.quaternion.x.toFixed(3)}, ${motionData.quaternion.y.toFixed(3)}, ${motionData.quaternion.z.toFixed(3)})`);

    try {
      // Always process through motion coordinator when available (not just when recording)
      if (this.motionCoordinator) {
        console.log(`🏭 [NobleBLEServiceAdapter] Sending quaternion data to motion processing pipeline for ${deviceId}`);

        // Convert to legacy IMU format for motion coordinator
        const legacyData = {
          timestamp: motionData.timestamp,
          gyr: { x: 0, y: 0, z: 0 },       // Not needed for quaternion-only
          axl: { x: 0, y: 0, z: 0 },       // Not needed for quaternion-only
          mag: { x: 0, y: 0, z: 0 },       // Not needed for quaternion-only
          quaternion: motionData.quaternion
        };

        this.motionCoordinator.processNewData(deviceId, legacyData);
      } else {
        console.warn(`⚠️ [NobleBLEServiceAdapter] No motion coordinator available - quaternion data for ${deviceId} will not be processed!`);
      }

      // Note: Raw quaternion data is NOT broadcast directly to UI
      // The motion processing pipeline will process this data and send processed results
      // Only broadcast raw quaternions if motion coordinator is not available (fallback)
      if (!this.motionCoordinator && this.broadcastFunction) {
        console.log(`📡 [${deviceId}] No motion coordinator - broadcasting raw quaternion as fallback`);

        const message = {
          type: 0x30, // MESSAGE_TYPES.MOTION_DATA
          requestId: 0, // Fire-and-forget streaming data
          timestamp: motionData.timestamp,
          deviceId: deviceId,
          quaternion: motionData.quaternion,
          data: {
            deviceId: deviceId,
            quaternion: motionData.quaternion,
            timestamp: motionData.timestamp
          }
        };

        await this.broadcastFunction(message, []);
      }

    } catch (error) {
      console.error(`Error handling motion data from ${deviceId}:`, error);
    }
  }

  // Handle device events
  private async handleDeviceEvent(deviceId: string, event: string, data?: any): Promise<void> {
    console.log(`📱 Device event: ${deviceId} - ${event}`, data ? data : '');

    // Broadcast device status updates
    if (['connected', 'disconnected', 'discovered'].includes(event)) {
      await this.broadcastDeviceStatus();
    }

    // Handle battery updates
    if (event === 'battery_updated' && data) {
      await this.broadcastBatteryUpdate(deviceId, data.batteryLevel);
    }
  }

  // Broadcast device status update
  private async broadcastDeviceStatus(): Promise<void> {
    if (!this.broadcastFunction) return;

    try {
      const connectedDevices = this.getConnectedDevices();
      const batteryRecord: Record<string, number> = {};

      // Build battery record from state manager data
      connectedDevices.forEach(device => {
        if (device.batteryLevel !== null) {
          batteryRecord[device.id] = device.batteryLevel;
        }
      });

      const statusData = QuaternionBinaryProtocol.serializeDeviceStatus(connectedDevices, batteryRecord);

      const message = {
        type: 0x31, // MESSAGE_TYPES.DEVICE_STATUS
        requestId: 0,
        timestamp: Date.now(),
        devices: connectedDevices,
        batteryLevels: batteryRecord,
        data: statusData
      };

      console.log(`🔋 Broadcasting device status for ${connectedDevices.length} devices:`, batteryRecord);

      await this.broadcastFunction(message, []);

    } catch (error) {
      console.error('Error broadcasting device status:', error);
    }
  }

  // Broadcast battery update
  private async broadcastBatteryUpdate(deviceId: string, batteryLevel: number): Promise<void> {
    if (!this.broadcastFunction) return;

    try {
      const batteryData = QuaternionBinaryProtocol.serializeBatteryUpdate(deviceId, batteryLevel);

      const message = {
        type: 'battery_update',
        data: batteryData,
        timestamp: Date.now(),
        binary: true
      };

      await this.broadcastFunction(message, []);

    } catch (error) {
      console.error('Error broadcasting battery update:', error);
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

  // Cleanup resources
  async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Noble BLE Service Adapter...');

    if (this.isCurrentlyRecording) {
      await this.stopRecording();
    }

    await this.nobleService.cleanup();
  }
}