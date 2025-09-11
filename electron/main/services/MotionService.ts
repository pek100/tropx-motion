import { WebSocketService } from './WebSocketService';
import { DataBroadcastService } from './DataBroadcastService';
import { motionProcessingCoordinator } from '../../../motionProcessing/MotionProcessingCoordinator';
import { museManager } from '../../../muse_sdk/core/MuseManager';
import { CONFIG, MESSAGE_TYPES } from '../../shared/config';
import { 
  ServiceStatus, 
  DeviceInfo, 
  RecordingSession, 
  ApiResponse, 
  RecordingResponse,
  MotionDataUpdate 
} from '../../shared/types';

export class MotionService {
  private wsService: WebSocketService;
  private broadcaster: DataBroadcastService;
  private isInitialized = false;
  private isRecording = false;
  private currentSessionId: string | null = null;
  private recordingStartTime: Date | null = null;

  constructor() {
    this.wsService = new WebSocketService();
    this.broadcaster = new DataBroadcastService();
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Motion Service...');

      await this.wsService.initialize();
      this.setupWebSocketHandlers();
      this.setupMotionProcessingCallbacks();
      this.isInitialized = true;

      console.log('Motion Service initialized successfully');
      this.broadcastStatus();
    } catch (error) {
      console.error('Failed to initialize Motion Service:', error);
      throw error;
    }
  }

  async startRecording(sessionData: RecordingSession): Promise<RecordingResponse> {
    if (this.isRecording) {
      return { success: false, message: 'Recording already in progress' };
    }

    try {
      console.log('Starting recording session:', sessionData);

      const motionSuccess = motionProcessingCoordinator.startRecording(
        sessionData.sessionId,
        sessionData.exerciseId,
        sessionData.setNumber
      );

      if (!motionSuccess) {
        return { success: false, message: 'Failed to start motion processing' };
      }

      const recordingStarted = await museManager.startRecordingOnDevices();
      
      if (!recordingStarted) {
        await motionProcessingCoordinator.stopRecording();
        return { success: false, message: 'Failed to start recording on devices' };
      }

      this.isRecording = true;
      this.recordingStartTime = new Date();
      this.currentSessionId = sessionData.sessionId;

      this.broadcaster.broadcastRecordingState(true, sessionData);
      
      return { 
        success: true, 
        message: 'Recording started successfully',
        recordingId: sessionData.sessionId
      };
    } catch (error) {
      console.error('Recording start error:', error);
      return { 
        success: false, 
        message: `Failed to start recording: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  async stopRecording(): Promise<RecordingResponse> {
    if (!this.isRecording) {
      return { success: false, message: 'No recording in progress' };
    }

    try {
      console.log('Stopping recording session...');

      await museManager.stopRecordingOnDevices();
      const success = await motionProcessingCoordinator.stopRecording();

      const sessionId = this.currentSessionId;
      this.isRecording = false;
      this.recordingStartTime = null;
      this.currentSessionId = null;

      this.broadcaster.broadcastRecordingState(false);

      return {
        success,
        message: success ? 'Recording stopped successfully' : 'Recording stopped with errors',
        recordingId: sessionId || undefined
      };
    } catch (error) {
      console.error('Recording stop error:', error);
      return { 
        success: false, 
        message: `Failed to stop recording: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  async connectDevices(): Promise<ApiResponse> {
    try {
      console.log('Triggering device connection...');
      
      this.broadcaster.subscribe((message) => {
        this.wsService.broadcast(message);
      });

      this.wsService.broadcast({
        type: MESSAGE_TYPES.SCAN_REQUEST,
        data: { 
          action: 'trigger_bluetooth_scan',
          message: 'Triggering Web Bluetooth scan for device selection'
        },
        timestamp: Date.now()
      });

      return { 
        success: true, 
        message: 'Device connection initiated'
      };
    } catch (error) {
      console.error('Device connection trigger failed:', error);
      return { 
        success: false, 
        message: `Connection trigger failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  async scanForDevices(): Promise<ApiResponse> {
    try {
      console.log('Triggering device scan...');
      
      this.wsService.broadcast({
        type: MESSAGE_TYPES.SCAN_REQUEST,
        data: { 
          action: 'trigger_bluetooth_scan',
          message: 'Trigger Web Bluetooth scan for device discovery'
        },
        timestamp: Date.now()
      });

      return { 
        success: true, 
        message: 'Device scan initiated'
      };
    } catch (error) {
      console.error('Scan trigger failed:', error);
      return { 
        success: false, 
        message: `Scan trigger failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  async connectToDevice(deviceName: string): Promise<ApiResponse> {
    try {
      console.log(`Connecting to device: ${deviceName}`);

      const success = await museManager.connectToScannedDevice('', deviceName);

      if (success) {
        this.broadcastDeviceStatus();
        return { success: true, message: `Connected to ${deviceName}` };
      } else {
        return { success: false, message: `Failed to connect to ${deviceName}` };
      }
    } catch (error) {
      console.error(`Connection error for ${deviceName}:`, error);
      return { 
        success: false, 
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  getStatus(): ServiceStatus {
    const sdkDevices = museManager.getAllDevices();
    const batteryLevels = Object.fromEntries(museManager.getAllBatteryLevels());

    return {
      isInitialized: this.isInitialized,
      isRecording: this.isRecording,
      connectedDevices: sdkDevices.map(d => ({
        id: d.id,
        name: d.name,
        connected: d.connected,
        batteryLevel: d.batteryLevel
      })),
      batteryLevels,
      recordingStartTime: this.recordingStartTime?.toISOString(),
      wsPort: this.wsService.getPort(),
      clientCount: this.wsService.getClientCount(),
      motionProcessingReady: motionProcessingCoordinator.getInitializationStatus(),
      deviceManagerReady: true
    };
  }

  getWebSocketPort(): number {
    return this.wsService.getPort();
  }

  // Public method for broadcasting messages
  broadcastMessage(type: string, data: unknown): void {
    this.wsService.broadcast({
      type: type as any,
      data,
      timestamp: Date.now()
    });
  }

  cleanup(): void {
    console.log('Cleaning up Motion Service...');
    
    this.broadcaster.cleanup();
    this.wsService.cleanup();
    
    if (this.isRecording) {
      motionProcessingCoordinator.stopRecording().catch(console.error);
    }

    console.log('Motion Service cleanup complete');
  }

  // Setup WebSocket message handlers
  private setupWebSocketHandlers(): void {
    this.wsService.onMessage('motion_data', (data) => {
      this.processMotionDataFromRenderer(data);
    });

    this.wsService.onMessage('request_status', (data, clientId) => {
      // Status will be sent automatically on connection
    });

    this.wsService.onMessage('trigger_device_discovery', (data) => {
      console.log('Device discovery trigger received:', data);
    });
  }

  // Setup motion processing data callbacks
  private setupMotionProcessingCallbacks(): void {
    motionProcessingCoordinator.subscribeToUI((data: unknown) => {
      const motionData: MotionDataUpdate = {
        left: (data as any).left || { current: 0, max: 0, min: 0, rom: 0 },
        right: (data as any).right || { current: 0, max: 0, min: 0, rom: 0 },
        timestamp: Date.now()
      };

      this.broadcaster.broadcastMotionData(motionData);
    });

    // Subscribe broadcaster to WebSocket service
    this.broadcaster.subscribe((message) => {
      this.wsService.broadcast(message);
    });
  }

  // Process motion data received from renderer
  private processMotionDataFromRenderer(data: unknown): void {
    try {
      if (!data || typeof data !== 'object') {
        console.error('Invalid motion data provided');
        return;
      }

      const deviceData = data as any;
      const deviceName = deviceData.deviceName || `device_${Date.now()}`;

      const imuData = {
        timestamp: deviceData.timestamp || Date.now(),
        quaternion: deviceData.quaternion || { w: 1, x: 0, y: 0, z: 0 },
        gyr: deviceData.gyroscope || { x: 0, y: 0, z: 0 },
        axl: deviceData.accelerometer || { x: 0, y: 0, z: 0 },
        mag: deviceData.magnetometer || { x: 0, y: 0, z: 0 }
      };

      if (motionProcessingCoordinator.getInitializationStatus()) {
        motionProcessingCoordinator.processNewData(deviceName, imuData as any);
      }
    } catch (error) {
      console.error('Error processing motion data from renderer:', error);
    }
  }

  // Broadcast current status to all clients
  private broadcastStatus(): void {
    this.wsService.broadcast({
      type: MESSAGE_TYPES.STATUS_UPDATE,
      data: this.getStatus(),
      timestamp: Date.now()
    });
  }

  // Broadcast device status update
  private broadcastDeviceStatus(): void {
    const sdkDevices = museManager.getAllDevices();
    const batteryLevels = Object.fromEntries(museManager.getAllBatteryLevels());

    this.broadcaster.broadcastDeviceStatus(
      sdkDevices.map(d => ({
        id: d.id,
        name: d.name,
        connected: d.connected,
        batteryLevel: d.batteryLevel
      })),
      batteryLevels
    );
  }
}