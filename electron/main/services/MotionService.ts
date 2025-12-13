import { createUnifiedWebSocketBridge, UnifiedWebSocketBridge } from '../../../websocket-bridge';
import { motionProcessingCoordinator } from '../../../motionProcessing/MotionProcessingCoordinator';
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
  private bridge: UnifiedWebSocketBridge | null = null;
  private bridgePort = 0;
  private isInitialized = false;
  private isRecording = false;
  private currentSessionId: string | null = null;
  private recordingStartTime: Date | null = null;

  constructor() {
    // Bridge will be initialized in initialize()
  }

  async initialize(): Promise<void> {
    try {
      console.log('Initializing Motion Service with Unified WebSocket Bridge...');

      // Create Unified WebSocket bridge with existing services
      // Noble BLE service is embedded in WebSocket Bridge
      const unifiedServices = {
        motionCoordinator: motionProcessingCoordinator,
        systemMonitor: undefined, // Optional service
      };

      const unifiedConfig = {
        // port not specified - uses PortDiscovery to find available port in range 9080-9179
        enableBinaryProtocol: true,
        performanceMode: 'high_throughput' as const,
      };

      const { bridge, port } = await createUnifiedWebSocketBridge(unifiedServices, unifiedConfig);
      this.bridge = bridge;
      this.bridgePort = port;

      this.isInitialized = true;
      console.log(`Motion Service initialized with WebSocket Bridge on port ${port}`);

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

      // Recording on devices is now managed by BLE bridge via WebSocket Bridge
      // No direct device control needed here - data flows automatically

      this.isRecording = true;
      this.recordingStartTime = new Date();
      this.currentSessionId = sessionData.sessionId;

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

      // Stop recording in motion processing coordinator
      const success = motionProcessingCoordinator.stopRecording();

      const sessionId = this.currentSessionId;
      this.isRecording = false;
      this.recordingStartTime = null;
      this.currentSessionId = null;

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
      console.log('Device connection will be handled by WebSocket Bridge BLE handlers');
      return {
        success: true,
        message: 'Device connection handled by WebSocket Bridge - use scan operation from client'
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
      console.log('Device scanning will be handled by WebSocket Bridge BLE handlers');
      return {
        success: true,
        message: 'Device scanning handled by WebSocket Bridge - use BLE_SCAN_REQUEST from client'
      };
    } catch (error) {
      console.error('Scan trigger failed:', error);
      return {
        success: false,
        message: `Scan trigger failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Manual time synchronization for all connected devices
  async syncAllDevices(): Promise<ApiResponse> {
    if (!this.bridge) {
      return { success: false, message: 'Bridge not initialized' };
    }

    try {
      console.log('🔄 Manual sync requested for all devices');
      const result = await this.bridge.syncAllDevices();
      return {
        success: result.success,
        message: result.message || 'Sync operation completed'
      };
    } catch (error) {
      console.error('Sync all devices error:', error);
      return {
        success: false,
        message: `Sync failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async connectToDevice(deviceName: string): Promise<ApiResponse> {
    try {
      console.log(`Device connection to ${deviceName} will be handled by WebSocket Bridge`);
      return {
        success: true,
        message: `Device connection handled by WebSocket Bridge - use BLE_CONNECT_REQUEST from client`
      };
    } catch (error) {
      console.error(`Connection error for ${deviceName}:`, error);
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  getStatus(): ServiceStatus {
    // Device information is now managed by BLE bridge via WebSocket Bridge
    // Return minimal status - device info should be queried via WebSocket
    return {
      isInitialized: this.isInitialized,
      isRecording: this.isRecording,
      connectedDevices: [], // Device list available via WebSocket Bridge
      batteryLevels: {},    // Battery levels available via WebSocket Bridge
      recordingStartTime: this.recordingStartTime?.toISOString(),
      wsPort: this.bridgePort,
      clientCount: this.bridge?.getStatus().connections || 0,
      motionProcessingReady: motionProcessingCoordinator.getInitializationStatus(),
      deviceManagerReady: true
    };
  }

  getWebSocketPort(): number {
    if (this.bridgePort === 0) {
      console.warn('WebSocket Bridge not initialized yet, port is 0');
    }
    return this.bridgePort;
  }

  // Public method for broadcasting messages - now handled by bridge
  broadcastMessage(type: string, data: unknown): void {
    console.log(`Broadcasting ${type} - handled by WebSocket Bridge`);
  }

  cleanup(): void {
    console.log('Cleaning up Motion Service...');

    if (this.bridge) {
      this.bridge.stop().catch(console.error);
      this.bridge = null;
    }

    if (this.isRecording) {
      motionProcessingCoordinator.stopRecording();
    }

    console.log('Motion Service cleanup complete');
  }

}