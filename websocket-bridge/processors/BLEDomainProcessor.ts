import { BaseMessage, ErrorMessage, BLEScanResponse, BLEConnectResponse, RecordStartResponse } from '../types/Interfaces';
import { MESSAGE_TYPES, ERROR_CODES } from '../types/MessageTypes';
import { DomainProcessor, MESSAGE_DOMAINS, MessageDomain } from '../core/UnifiedMessageRouter';

// BLE operation timeout constants
const BLE_TIMEOUTS = {
  SCAN: 15000,
  CONNECT: 15000,
  DISCONNECT: 5000,
  RECORD_START: 30000,
  RECORD_STOP: 10000
} as const;

// Retry configuration
const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY: 1000,
  MAX_DELAY: 10000
} as const;

// BLE service interface
interface BLEService {
  scanForDevices(): Promise<{ success: boolean; devices: any[]; message?: string }>;
  connectToDevice(deviceId: string, deviceName: string): Promise<{ success: boolean; message?: string }>;
  disconnectDevice(deviceId: string): Promise<{ success: boolean; message?: string }>;
  syncAllDevices(): Promise<{ success: boolean; results?: any[]; message?: string }>;
  startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  stopRecording(): Promise<{ success: boolean; message?: string; recordingId?: string }>;
  getConnectedDevices(): any[];
  getAllDevices(): { success: boolean; devices: any[] };
  isRecording(): boolean;
  enableBurstScanningFor(durationMs: number): void;
  disableBurstScanning(): void;
}

// BLE operation handler type
type BLEOperationHandler = (message: BaseMessage, service: BLEService) => Promise<BaseMessage>;

export class BLEDomainProcessor implements DomainProcessor {
  private bleService: BLEService | null = null;
  private operationHandlers = new Map<number, BLEOperationHandler>();
  private stats = {
    processed: 0,
    errors: 0,
    retries: 0
  };

  constructor() {
    this.setupOperationHandlers();
  }

  getDomain(): MessageDomain {
    return MESSAGE_DOMAINS.BLE;
  }

  // Set BLE service dependency
  setBLEService(service: BLEService): void {
    this.bleService = service;
  }

  // Process BLE domain message with reliability
  async process(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    if (!this.bleService) {
      return this.createErrorResponse(message, 'BLE_SERVICE_UNAVAILABLE');
    }

    const handler = this.operationHandlers.get(message.type);
    if (!handler) {
      return this.createErrorResponse(message, 'UNSUPPORTED_BLE_OPERATION');
    }

    return this.executeWithRetry(message, handler);
  }

  // Execute operation with exponential backoff retry
  private async executeWithRetry(message: BaseMessage, handler: BLEOperationHandler): Promise<BaseMessage> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_CONFIG.MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          await this.delay(this.calculateBackoffDelay(attempt));
          this.stats.retries++;
        }

        const result = await this.executeWithTimeout(message, handler);
        this.stats.processed++;
        return result;

      } catch (error) {
        lastError = error as Error;
        console.warn(`BLE operation retry ${attempt + 1}/${RETRY_CONFIG.MAX_RETRIES + 1}: ${lastError.message}`);
      }
    }

    this.stats.errors++;
    return this.createErrorResponse(message, 'BLE_OPERATION_FAILED', lastError?.message);
  }

  // Execute handler with timeout
  private async executeWithTimeout(message: BaseMessage, handler: BLEOperationHandler): Promise<BaseMessage> {
    const timeout = this.getTimeoutForMessage(message.type);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`BLE operation timeout after ${timeout}ms`)), timeout);
    });

    return Promise.race([
      handler(message, this.bleService!),
      timeoutPromise
    ]);
  }

  // Setup BLE operation handlers
  private setupOperationHandlers(): void {
    this.operationHandlers.set(MESSAGE_TYPES.BLE_SCAN_REQUEST, this.handleScanRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_CONNECT_REQUEST, this.handleConnectRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_DISCONNECT_REQUEST, this.handleDisconnectRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_DEVICE_REMOVE_REQUEST, this.handleDeviceRemoveRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_SYNC_REQUEST, this.handleSyncRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_LOCATE_START_REQUEST, this.handleLocateStartRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_LOCATE_STOP_REQUEST, this.handleLocateStopRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_BURST_SCAN_START_REQUEST, this.handleBurstScanStartRequest);
    this.operationHandlers.set(MESSAGE_TYPES.BLE_BURST_SCAN_STOP_REQUEST, this.handleBurstScanStopRequest);
    this.operationHandlers.set(MESSAGE_TYPES.RECORD_START_REQUEST, this.handleRecordStartRequest);
    this.operationHandlers.set(MESSAGE_TYPES.RECORD_STOP_REQUEST, this.handleRecordStopRequest);
    this.operationHandlers.set(MESSAGE_TYPES.GET_DEVICES_STATE_REQUEST, this.handleGetDevicesStateRequest);
  }

  // BLE scan operation handler
  private handleScanRequest = async (message: BaseMessage, service: BLEService): Promise<BaseMessage> => {
    const result = await service.scanForDevices();

    return {
      type: MESSAGE_TYPES.BLE_SCAN_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      devices: result.devices,
      message: result.message
    } as BLEScanResponse;
  };

  // BLE connect operation handler
  private handleConnectRequest = async (message: BaseMessage, service: BLEService): Promise<BaseMessage> => {
    const request = message as any;
    const result = await service.connectToDevice(request.deviceId, request.deviceName);

    return {
      type: MESSAGE_TYPES.BLE_CONNECT_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      deviceId: request.deviceId,
      message: result.message
    } as BLEConnectResponse;
  };

  // BLE disconnect operation handler
  private handleDisconnectRequest = async (message: BaseMessage, service: BLEService): Promise<BaseMessage> => {
    const request = message as any;
    const result = await service.disconnectDevice(request.deviceId);

    return {
      type: MESSAGE_TYPES.BLE_DISCONNECT_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      deviceId: request.deviceId,
      message: result.message
    } as BaseMessage;
  };

  // BLE device remove operation handler (cancel reconnect + remove from registry)
  private handleDeviceRemoveRequest = async (message: BaseMessage, service: any): Promise<BaseMessage> => {
    const request = message as any;
    const result = await service.removeDevice(request.deviceId);

    return {
      type: MESSAGE_TYPES.BLE_DEVICE_REMOVE_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      deviceId: request.deviceId,
      message: result.message
    } as BaseMessage;
  };

  // BLE sync all devices handler
  private handleSyncRequest = async (message: BaseMessage, service: any): Promise<BaseMessage> => {
    const result = await service.syncAllDevices();

    return {
      type: MESSAGE_TYPES.BLE_SYNC_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      results: result.results,
      message: result.message
    } as BaseMessage;
  };

  // Locate start operation handler
  private handleLocateStartRequest = async (message: BaseMessage, service: any): Promise<BaseMessage> => {
    const result = await service.startLocateMode();

    return {
      type: MESSAGE_TYPES.BLE_LOCATE_START_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      message: result.message
    } as BaseMessage;
  };

  // Locate stop operation handler
  private handleLocateStopRequest = async (message: BaseMessage, service: any): Promise<BaseMessage> => {
    const result = await service.stopLocateMode();

    return {
      type: MESSAGE_TYPES.BLE_LOCATE_STOP_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      message: result.message
    } as BaseMessage;
  };

  // Burst scan start operation handler
  private handleBurstScanStartRequest = async (message: BaseMessage, service: any): Promise<BaseMessage> => {
    service.enableBurstScanningFor(10000);

    return {
      type: MESSAGE_TYPES.BLE_SCAN_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: true,
      devices: [],
      message: 'Burst scanning enabled for 10 seconds'
    } as BaseMessage;
  };

  // Burst scan stop operation handler
  private handleBurstScanStopRequest = async (message: BaseMessage, service: any): Promise<BaseMessage> => {
    service.disableBurstScanning();

    return {
      type: MESSAGE_TYPES.BLE_SCAN_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: true,
      devices: [],
      message: 'Burst scanning disabled'
    } as BaseMessage;
  };

  // Record start operation handler
  private handleRecordStartRequest = async (message: BaseMessage, service: BLEService): Promise<BaseMessage> => {
    const request = message as any;

    // Idempotent: if already recording, return success
    if (service.isRecording()) {
      console.log('🎬 Recording already active - returning success (idempotent)');
      return {
        type: MESSAGE_TYPES.RECORD_START_RESPONSE,
        requestId: message.requestId,
        timestamp: Date.now(),
        success: true,
        sessionId: request.sessionId,
        message: 'Recording already active'
      } as RecordStartResponse;
    }

    const connectedDevices = service.getConnectedDevices();
    if (connectedDevices.length === 0) {
      return this.createErrorResponse(message, 'NO_DEVICES_CONNECTED');
    }

    const result = await service.startRecording(request.sessionId, request.exerciseId, request.setNumber);

    return {
      type: MESSAGE_TYPES.RECORD_START_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      sessionId: request.sessionId,
      recordingId: result.recordingId,
      message: result.message,
      error: (result as any).error  // Include error message for state validation failures
    } as RecordStartResponse;
  };

  // Record stop operation handler
  private handleRecordStopRequest = async (message: BaseMessage, service: BLEService): Promise<BaseMessage> => {
    if (!service.isRecording()) {
      return this.createErrorResponse(message, 'NO_RECORDING_ACTIVE');
    }

    const result = await service.stopRecording();

    return {
      type: MESSAGE_TYPES.RECORD_STOP_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      success: result.success,
      recordingId: result.recordingId,
      message: result.message
    } as BaseMessage;
  };

  // Get devices state operation handler (for persistence/reconnect)
  private handleGetDevicesStateRequest = async (message: BaseMessage, service: BLEService): Promise<BaseMessage> => {
    console.log('📋 [BLE_PROCESSOR] Get devices state requested');
    const result = service.getAllDevices();

    return {
      type: MESSAGE_TYPES.GET_DEVICES_STATE_RESPONSE,
      requestId: message.requestId,
      timestamp: Date.now(),
      devices: result.devices
    } as BaseMessage;
  };

  // Get timeout for specific message type
  private getTimeoutForMessage(messageType: number): number {
    switch (messageType) {
      case MESSAGE_TYPES.BLE_SCAN_REQUEST: return BLE_TIMEOUTS.SCAN;
      case MESSAGE_TYPES.BLE_CONNECT_REQUEST: return BLE_TIMEOUTS.CONNECT;
      case MESSAGE_TYPES.BLE_DISCONNECT_REQUEST: return BLE_TIMEOUTS.DISCONNECT;
      case MESSAGE_TYPES.RECORD_START_REQUEST: return BLE_TIMEOUTS.RECORD_START;
      case MESSAGE_TYPES.RECORD_STOP_REQUEST: return BLE_TIMEOUTS.RECORD_STOP;
      default: return BLE_TIMEOUTS.CONNECT;
    }
  }

  // Calculate exponential backoff delay
  private calculateBackoffDelay(attempt: number): number {
    const delay = RETRY_CONFIG.BASE_DELAY * Math.pow(2, attempt - 1);
    return Math.min(delay, RETRY_CONFIG.MAX_DELAY);
  }

  // Create standardized error response
  private createErrorResponse(message: BaseMessage, errorCode: string, details?: string): ErrorMessage {
    return {
      type: MESSAGE_TYPES.ERROR,
      requestId: message.requestId,
      timestamp: Date.now(),
      code: ERROR_CODES.INVALID_MESSAGE,
      message: details || `BLE operation failed: ${errorCode}`,
      details: { messageType: message.type }
    };
  }

  // Async delay utility
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get processor statistics
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
}