/**
 * UnifiedWebSocketTranslator.ts
 *
 * Centralized translation layer for all binary WebSocket operations.
 * This provides a single interface for client-server communication
 * with automatic binary protocol handling and type safety.
 */

import { WebSocketBridgeClient } from './WebSocketBridgeClient';
import { BinaryProtocol, MESSAGE_TYPES, BaseMessage } from './BinaryProtocol';

// Unified response types for type safety
export interface DeviceInfo {
  id: string;
  name: string;
  address: string;
  rssi: number;
  state: 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';
  batteryLevel: number | null;
  lastSeen: Date;
}

export interface ScanResponse {
  success: boolean;
  devices: DeviceInfo[];
  message?: string;
}

export interface ConnectionResponse {
  success: boolean;
  deviceId: string;
  message?: string;
}

export interface RecordingResponse {
  success: boolean;
  sessionId?: string;
  recordingId?: string;
  message?: string;
}

export interface StreamingStatus {
  isActive: boolean;
  connectedDevices: number;
  streamingDevices: number;
  globalState: 'stopped' | 'starting' | 'active' | 'stopping';
}

/**
 * Unified WebSocket translator that provides high-level methods
 * for all BLE operations with automatic binary protocol handling
 */
export class UnifiedWebSocketTranslator {
  private client: WebSocketBridgeClient;
  private isInitialized = false;

  constructor(url: string) {
    this.client = new WebSocketBridgeClient({
      url,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10
    });
  }

  async initialize(): Promise<boolean> {
    try {
      await this.client.connect();
      this.isInitialized = true;
      console.log('✅ UnifiedWebSocketTranslator initialized');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize UnifiedWebSocketTranslator:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.isInitialized = false;
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('UnifiedWebSocketTranslator not initialized. Call initialize() first.');
    }
  }

  // ===== BLE Operations =====

  /**
   * Scan for BLE devices
   */
  async scanForDevices(): Promise<ScanResponse> {
    this.ensureInitialized();

    const message = {
      type: MESSAGE_TYPES.BLE_SCAN_REQUEST
    };

    try {
      const response = await this.client.sendReliable<ScanResponse>(message);
      console.log(`🔍 Scan completed: ${response.devices?.length || 0} devices found`);
      return response;
    } catch (error) {
      console.error('❌ Scan failed:', error);
      return {
        success: false,
        devices: [],
        message: error instanceof Error ? error.message : 'Unknown scan error'
      };
    }
  }

  /**
   * Connect to a single device
   */
  async connectToDevice(deviceId: string, deviceName: string): Promise<ConnectionResponse> {
    this.ensureInitialized();

    const message = {
      type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
      deviceId,
      deviceName
    };

    try {
      const response = await this.client.sendReliable<ConnectionResponse>(message);
      if (response.success) {
        console.log(`✅ Connected to device: ${deviceName}`);
      } else {
        console.warn(`⚠️ Connection failed: ${deviceName} - ${response.message}`);
      }
      return response;
    } catch (error) {
      console.error(`❌ Connection error for ${deviceName}:`, error);
      return {
        success: false,
        deviceId,
        message: error instanceof Error ? error.message : 'Unknown connection error'
      };
    }
  }

  /**
   * Connect to multiple devices in parallel
   */
  async connectToDevices(devices: Array<{id: string, name: string}>): Promise<ConnectionResponse[]> {
    this.ensureInitialized();

    console.log(`🔗 Starting parallel connections to ${devices.length} device(s)...`);

    // Create parallel connection tasks
    const connectionTasks = devices.map(device =>
      this.connectToDevice(device.id, device.name)
    );

    // Execute all connections in parallel
    const results = await Promise.all(connectionTasks);

    const successCount = results.filter(result => result.success).length;
    console.log(`✅ Parallel connections completed: ${successCount}/${devices.length} successful`);

    return results;
  }

  /**
   * Disconnect from a device
   */
  async disconnectDevice(deviceId: string): Promise<ConnectionResponse> {
    this.ensureInitialized();

    const message = {
      type: MESSAGE_TYPES.BLE_DISCONNECT_REQUEST,
      deviceId
    };

    try {
      const response = await this.client.sendReliable<ConnectionResponse>(message);
      if (response.success) {
        console.log(`🔌 Disconnected from device: ${deviceId}`);
      }
      return response;
    } catch (error) {
      console.error(`❌ Disconnect error for ${deviceId}:`, error);
      return {
        success: false,
        deviceId,
        message: error instanceof Error ? error.message : 'Unknown disconnect error'
      };
    }
  }

  // ===== Recording Operations =====

  /**
   * Start recording session
   */
  async startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<RecordingResponse> {
    this.ensureInitialized();

    const message = {
      type: MESSAGE_TYPES.RECORD_START_REQUEST,
      sessionId,
      exerciseId,
      setNumber
    };

    try {
      const response = await this.client.sendReliable<RecordingResponse>(message);
      if (response.success) {
        console.log(`🎬 Recording started: ${sessionId}`);
      } else {
        console.warn(`⚠️ Recording start failed: ${response.message}`);
      }
      return response;
    } catch (error) {
      console.error('❌ Recording start error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown recording error'
      };
    }
  }

  /**
   * Stop recording session
   */
  async stopRecording(): Promise<RecordingResponse> {
    this.ensureInitialized();

    const message = {
      type: MESSAGE_TYPES.RECORD_STOP_REQUEST
    };

    try {
      const response = await this.client.sendReliable<RecordingResponse>(message);
      if (response.success) {
        console.log('🛑 Recording stopped');
      }
      return response;
    } catch (error) {
      console.error('❌ Recording stop error:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown recording error'
      };
    }
  }

  // ===== Utility Methods =====

  /**
   * Send heartbeat to keep connection alive
   */
  async sendHeartbeat(): Promise<boolean> {
    this.ensureInitialized();

    try {
      await this.client.sendHeartbeat();
      return true;
    } catch (error) {
      console.error('❌ Heartbeat failed:', error);
      return false;
    }
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.isInitialized && this.client.getConnectionStatus();
  }

  /**
   * Register message handler for streaming data
   */
  onMessage(messageType: number, handler: (message: BaseMessage) => void): void {
    this.client.onMessage(messageType, handler);
  }

  /**
   * Remove message handler
   */
  removeMessageHandler(messageType: number): void {
    this.client.removeHandler(messageType);
  }

  // ===== Advanced Operations =====

  /**
   * Optimized workflow: Scan → Connect → Start Recording
   */
  async quickStart(sessionId: string, exerciseId: string, setNumber: number): Promise<{
    scanResult: ScanResponse;
    connectionResults: ConnectionResponse[];
    recordingResult: RecordingResponse;
    success: boolean;
  }> {
    console.log('🚀 Starting quick workflow: Scan → Connect → Record');

    // 1. Scan for devices
    const scanResult = await this.scanForDevices();
    if (!scanResult.success || scanResult.devices.length === 0) {
      return {
        scanResult,
        connectionResults: [],
        recordingResult: { success: false, message: 'No devices found' },
        success: false
      };
    }

    // 2. Connect to all discovered devices in parallel
    const devicesToConnect = scanResult.devices.map(device => ({
      id: device.id,
      name: device.name
    }));

    const connectionResults = await this.connectToDevices(devicesToConnect);
    const connectedCount = connectionResults.filter(r => r.success).length;

    if (connectedCount === 0) {
      return {
        scanResult,
        connectionResults,
        recordingResult: { success: false, message: 'No devices connected' },
        success: false
      };
    }

    // 3. Start recording
    const recordingResult = await this.startRecording(sessionId, exerciseId, setNumber);

    console.log(`✅ Quick workflow completed: ${connectedCount} devices connected, recording: ${recordingResult.success}`);

    return {
      scanResult,
      connectionResults,
      recordingResult,
      success: recordingResult.success
    };
  }
}