import { WebSocketTransport, ConnectionState } from './transport/WebSocketTransport';
import { MESSAGE_TYPES, BaseMessage, DeviceInfo } from './types/messages';
import type { Result, ScanResponse, ConnectionResponse, RecordingResponse, SyncResponse, StatusResponse, ClientStats } from './types/responses';
import type { EventType, EventHandler } from './types/events';
import { Ok, Err } from './types/responses';

export interface TropxWSClientOptions {
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

// Main unified WebSocket client
export class TropxWSClient {
  private transport: WebSocketTransport;
  private stats: ClientStats = {
    messagesSent: 0,
    messagesReceived: 0,
    errors: 0,
    uptime: 0,
    latency: 0,
  };
  private startTime = 0;

  constructor(options: TropxWSClientOptions = {}) {
    this.transport = new WebSocketTransport(options);
    this.setupEventForwarding();
  }

  // Connection management
  async connect(url: string): Promise<Result<void>> {
    try {
      await this.transport.connect(url);
      this.startTime = Date.now();
      return Ok(undefined);
    } catch (error) {
      this.stats.errors++;
      return Err((error as Error).message, 'CONNECTION_FAILED');
    }
  }

  disconnect(): void {
    this.transport.disconnect();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  getConnectionState(): ConnectionState {
    return this.transport.getState();
  }

  // BLE operations
  async scanDevices(): Promise<Result<ScanResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_SCAN_REQUEST, {});
    if (!result.success) return result;
    const response: ScanResponse = {
      devices: result.data.devices || [],
      message: result.data.message
    };
    return Ok(response);
  }

  async connectDevice(id: string, name: string): Promise<Result<ConnectionResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_CONNECT_REQUEST, { deviceId: id, deviceName: name });
    if (!result.success) return result;
    const response: ConnectionResponse = {
      deviceId: id,
      message: result.data.message
    };
    return Ok(response);
  }

  async connectDevices(devices: Array<{ id: string; name: string }>): Promise<Result<ConnectionResponse[]>> {
    const results = await Promise.all(
      devices.map(device => this.connectDevice(device.id, device.name))
    );
    const responses: ConnectionResponse[] = [];
    for (const result of results) {
      if (result.success) {
        responses.push(result.data);
      }
    }
    return Ok(responses);
  }

  async disconnectDevice(id: string): Promise<Result<ConnectionResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_DISCONNECT_REQUEST, { deviceId: id });
    if (!result.success) return result;
    const response: ConnectionResponse = {
      deviceId: id,
      message: result.data.message
    };
    return Ok(response);
  }

  async removeDevice(id: string): Promise<Result<ConnectionResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_DEVICE_REMOVE_REQUEST, { deviceId: id });
    if (!result.success) return result;
    const response: ConnectionResponse = {
      deviceId: id,
      message: result.data.message
    };
    return Ok(response);
  }

  async syncAllDevices(): Promise<Result<SyncResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_SYNC_REQUEST, {});
    if (!result.success) return result;
    const response: SyncResponse = {
      results: result.data.results || [],
      message: result.data.message
    };
    return Ok(response);
  }

  async startLocateMode(): Promise<Result<void>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_LOCATE_START_REQUEST, {});
    return result.success ? Ok(undefined) : result;
  }

  async stopLocateMode(): Promise<Result<void>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_LOCATE_STOP_REQUEST, {});
    return result.success ? Ok(undefined) : result;
  }

  async startBurstScan(): Promise<Result<void>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_BURST_SCAN_START_REQUEST, {});
    return result.success ? Ok(undefined) : result;
  }

  async stopBurstScan(): Promise<Result<void>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.BLE_BURST_SCAN_STOP_REQUEST, {});
    return result.success ? Ok(undefined) : result;
  }

  async getDevicesState(): Promise<Result<DeviceInfo[]>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.GET_DEVICES_STATE_REQUEST, {});
    if (!result.success) return result;
    return Ok(result.data.devices || []);
  }

  // Recording operations
  async startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<Result<RecordingResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.RECORD_START_REQUEST, { sessionId, exerciseId, setNumber });
    if (!result.success) return result;
    const response: RecordingResponse = {
      sessionId: result.data.sessionId,
      recordingId: result.data.recordingId,
      message: result.data.message
    };
    return Ok(response);
  }

  async stopRecording(): Promise<Result<RecordingResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.RECORD_STOP_REQUEST, {});
    if (!result.success) return result;
    const response: RecordingResponse = {
      recordingId: result.data.recordingId,
      message: result.data.message
    };
    return Ok(response);
  }

  // System operations
  async getStatus(): Promise<Result<StatusResponse>> {
    const result = await this.sendRequest<any>(MESSAGE_TYPES.STATUS, {});
    if (!result.success) return result;
    return Ok(result.data as StatusResponse);
  }

  async ping(): Promise<Result<number>> {
    const start = Date.now();
    const result = await this.sendRequest<any>(MESSAGE_TYPES.PING, {});
    if (!result.success) return result;
    const latency = Date.now() - start;
    this.stats.latency = latency;
    return Ok(latency);
  }

  // Event listeners (typed)
  on<E extends EventType>(event: E, handler: EventHandler<E>): void {
    this.transport.on(event, handler);
  }

  off<E extends EventType>(event: E, handler: EventHandler<E>): void {
    this.transport.off(event, handler);
  }

  once<E extends EventType>(event: E, handler: EventHandler<E>): void {
    this.transport.once(event, handler);
  }

  // Get client statistics
  getStats(): ClientStats {
    return {
      ...this.stats,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  private async sendRequest<T>(type: number, payload: Record<string, any>): Promise<Result<T>> {
    try {
      const message = { type, ...payload };
      const response = await this.transport.sendReliable<BaseMessage>(message);
      this.stats.messagesSent++;
      this.stats.messagesReceived++;
      if (response.type === MESSAGE_TYPES.ERROR) {
        const errorMsg = response as any;
        this.stats.errors++;
        return Err(errorMsg.message || 'Unknown error', errorMsg.code);
      }
      return Ok(response as any as T);
    } catch (error) {
      this.stats.errors++;
      return Err((error as Error).message, 'REQUEST_FAILED');
    }
  }

  private setupEventForwarding(): void {
    this.transport.on('motionData', () => this.stats.messagesReceived++);
    this.transport.on('deviceStatus', () => this.stats.messagesReceived++);
    this.transport.on('batteryUpdate', () => this.stats.messagesReceived++);
    this.transport.on('error', () => this.stats.errors++);
  }
}
