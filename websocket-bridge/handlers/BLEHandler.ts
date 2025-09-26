import {
  BaseMessage,
  MessageHandler,
  BLEScanRequest,
  BLEScanResponse,
  BLEConnectRequest,
  BLEConnectResponse,
  RecordStartRequest,
  RecordStartResponse,
  DeviceInfo
} from '../types/Interfaces';
import { MESSAGE_TYPES, ERROR_CODES, MessageType } from '../types/MessageTypes';

// BLE service interface (will be injected)
export interface BLEService {
  scanForDevices(): Promise<{ success: boolean; devices: DeviceInfo[]; message?: string }>;
  connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }>;
  disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }>;
  startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  stopRecording(): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  getConnectedDevices(): DeviceInfo[];
  isRecording(): boolean;
}

interface BLEHandlerStats {
  scanRequests: number;
  connectRequests: number;
  disconnectRequests: number;
  recordingRequests: number;
  errors: number;
}

export class BLEHandler {
  private bleService: BLEService | null = null;
  private stats: BLEHandlerStats;

  constructor() {
    this.stats = {
      scanRequests: 0,
      connectRequests: 0,
      disconnectRequests: 0,
      recordingRequests: 0,
      errors: 0,
    };
  }

  // Inject BLE service dependency
  setBLEService(service: BLEService): void {
    this.bleService = service;
  }

  // Get message handlers for registration
  getHandlers(): Array<{ type: MessageType; handler: MessageHandler }> {
    return [
      { type: MESSAGE_TYPES.BLE_SCAN_REQUEST, handler: this.handleScanRequest.bind(this) },
      { type: MESSAGE_TYPES.BLE_CONNECT_REQUEST, handler: this.handleConnectRequest.bind(this) },
      { type: MESSAGE_TYPES.BLE_DISCONNECT_REQUEST, handler: this.handleDisconnectRequest.bind(this) },
      { type: MESSAGE_TYPES.RECORD_START_REQUEST, handler: this.handleRecordStartRequest.bind(this) },
      { type: MESSAGE_TYPES.RECORD_STOP_REQUEST, handler: this.handleRecordStopRequest.bind(this) },
    ];
  }

  // Handle BLE scan request
  private async handleScanRequest(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    const request = message as BLEScanRequest;
    this.stats.scanRequests++;

    if (!this.bleService) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.BLE_UNAVAILABLE,
        'BLE service not available',
        request.requestId
      );
    }

    try {
      const result = await this.bleService.scanForDevices();

      const response: BLEScanResponse = {
        type: MESSAGE_TYPES.BLE_SCAN_RESPONSE,
        requestId: request.requestId,
        timestamp: Date.now(),
        success: result.success,
        devices: result.devices,
        message: result.message,
      };

      return response;

    } catch (error) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.BLE_UNAVAILABLE,
        `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
        request.requestId
      );
    }
  }

  // Handle BLE connect request
  private async handleConnectRequest(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    const request = message as BLEConnectRequest;
    this.stats.connectRequests++;

    if (!this.bleService) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.BLE_UNAVAILABLE,
        'BLE service not available',
        request.requestId
      );
    }

    if (!request.deviceId || !request.deviceName) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.INVALID_MESSAGE,
        'Device ID and name required',
        request.requestId
      );
    }

    try {
      // Check if already connected
      const connectedDevices = this.bleService.getConnectedDevices();
      const alreadyConnected = connectedDevices.find(d => d.id === request.deviceId);

      if (alreadyConnected) {
        const response: BLEConnectResponse = {
          type: MESSAGE_TYPES.BLE_CONNECT_RESPONSE,
          requestId: request.requestId,
          timestamp: Date.now(),
          success: true,
          deviceId: request.deviceId,
          message: 'Device already connected',
        };
        return response;
      }

      const result = await this.bleService.connectToDevice(request.deviceId, request.deviceName);

      const response: BLEConnectResponse = {
        type: MESSAGE_TYPES.BLE_CONNECT_RESPONSE,
        requestId: request.requestId,
        timestamp: Date.now(),
        success: result.success,
        deviceId: request.deviceId,
        message: result.message,
      };

      return response;

    } catch (error) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.CONNECTION_FAILED,
        `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
        request.requestId
      );
    }
  }

  // Handle BLE disconnect request
  private async handleDisconnectRequest(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    const request = message as any; // Extend interface if needed
    this.stats.disconnectRequests++;

    if (!this.bleService) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.BLE_UNAVAILABLE,
        'BLE service not available',
        request.requestId
      );
    }

    if (!request.deviceId) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.INVALID_MESSAGE,
        'Device ID required',
        request.requestId
      );
    }

    try {
      const result = await this.bleService.disconnectDevice(request.deviceId);

      const response = {
        type: MESSAGE_TYPES.BLE_DISCONNECT_RESPONSE,
        requestId: request.requestId,
        timestamp: Date.now(),
        success: result.success,
        deviceId: request.deviceId,
        message: result.message,
      };

      return response;

    } catch (error) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.CONNECTION_FAILED,
        `Disconnection failed: ${error instanceof Error ? error.message : String(error)}`,
        request.requestId
      );
    }
  }

  // Handle record start request
  private async handleRecordStartRequest(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    const request = message as RecordStartRequest;
    this.stats.recordingRequests++;

    if (!this.bleService) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.BLE_UNAVAILABLE,
        'BLE service not available',
        request.requestId
      );
    }

    // Check if already recording
    if (this.bleService.isRecording()) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.RECORDING_ACTIVE,
        'Recording already in progress',
        request.requestId
      );
    }

    // Check if any devices are connected
    const connectedDevices = this.bleService.getConnectedDevices();
    if (connectedDevices.length === 0) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.NOT_CONNECTED,
        'No devices connected for recording',
        request.requestId
      );
    }

    try {
      const result = await this.bleService.startRecording(
        request.sessionId,
        request.exerciseId,
        request.setNumber
      );

      const response: RecordStartResponse = {
        type: MESSAGE_TYPES.RECORD_START_RESPONSE,
        requestId: request.requestId,
        timestamp: Date.now(),
        success: result.success,
        sessionId: request.sessionId,
        message: result.message,
      };

      return response;

    } catch (error) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.RECORDING_ACTIVE,
        `Recording start failed: ${error instanceof Error ? error.message : String(error)}`,
        request.requestId
      );
    }
  }

  // Handle record stop request
  private async handleRecordStopRequest(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    const request = message as any; // Extend interface if needed
    this.stats.recordingRequests++;

    if (!this.bleService) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.BLE_UNAVAILABLE,
        'BLE service not available',
        request.requestId
      );
    }

    // Check if recording is active
    if (!this.bleService.isRecording()) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.NO_RECORDING,
        'No recording in progress',
        request.requestId
      );
    }

    try {
      const result = await this.bleService.stopRecording();

      const response = {
        type: MESSAGE_TYPES.RECORD_STOP_RESPONSE,
        requestId: request.requestId,
        timestamp: Date.now(),
        success: result.success,
        message: result.message,
      };

      return response;

    } catch (error) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.NO_RECORDING,
        `Recording stop failed: ${error instanceof Error ? error.message : String(error)}`,
        request.requestId
      );
    }
  }

  // Get handler statistics
  getStats(): BLEHandlerStats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      scanRequests: 0,
      connectRequests: 0,
      disconnectRequests: 0,
      recordingRequests: 0,
      errors: 0,
    };
  }

  // Get current device status
  getCurrentDeviceStatus(): DeviceInfo[] {
    if (!this.bleService) return [];
    return this.bleService.getConnectedDevices();
  }

  // Check if recording is active
  isRecordingActive(): boolean {
    if (!this.bleService) return false;
    return this.bleService.isRecording();
  }

  // Create standardized error response
  private createErrorResponse(code: number, message: string, requestId?: number): import('../types/Interfaces').ErrorMessage {
    return {
      type: MESSAGE_TYPES.ERROR,
      requestId,
      timestamp: Date.now(),
      code: code as import('../types/MessageTypes').ErrorCode,
      message,
    };
  }

  // Validate BLE service is available
  private validateBLEService(): boolean {
    return this.bleService !== null;
  }

  // Get performance metrics
  getPerformanceMetrics(): { totalRequests: number; errorRate: number; successRate: number } {
    const totalRequests = this.stats.scanRequests + this.stats.connectRequests +
                         this.stats.disconnectRequests + this.stats.recordingRequests;

    const errorRate = totalRequests > 0 ? this.stats.errors / totalRequests : 0;
    const successRate = 1 - errorRate;

    return {
      totalRequests,
      errorRate,
      successRate,
    };
  }

  // Handle emergency stop (stop recording and disconnect all)
  async handleEmergencyStop(): Promise<{ success: boolean; message: string }> {
    if (!this.bleService) {
      return { success: false, message: 'BLE service not available' };
    }

    const results: string[] = [];

    try {
      // Stop recording if active
      if (this.bleService.isRecording()) {
        const stopResult = await this.bleService.stopRecording();
        results.push(`Recording: ${stopResult.success ? 'stopped' : 'failed to stop'}`);
      }

      // Disconnect all devices
      const connectedDevices = this.bleService.getConnectedDevices();
      for (const device of connectedDevices) {
        const disconnectResult = await this.bleService.disconnectDevice(device.id);
        results.push(`${device.name}: ${disconnectResult.success ? 'disconnected' : 'failed to disconnect'}`);
      }

      return {
        success: true,
        message: `Emergency stop completed. ${results.join(', ')}`,
      };

    } catch (error) {
      return {
        success: false,
        message: `Emergency stop failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}