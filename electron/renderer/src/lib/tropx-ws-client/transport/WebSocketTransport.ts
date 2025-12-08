import { TypedEventEmitter } from '../handlers/TypedEventEmitter';
import { BinaryProtocol } from '../protocol/BinaryProtocol';
import { BaseMessage, EVENT_TYPES, MESSAGE_TYPES } from '../types';
import { CONNECTION, calculateBackoff } from '../utils';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface TransportOptions {
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

// Low-level WebSocket transport with auto-reconnect
export class WebSocketTransport extends TypedEventEmitter {
  private ws: WebSocket | null = null;
  private url = '';
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private options: Required<TransportOptions>;
  private pendingRequests = new Map<number, { resolve: (msg: BaseMessage) => void; reject: (err: Error) => void; timeout: number }>();
  private requestIdCounter = 1;

  constructor(options: TransportOptions = {}) {
    super();
    this.options = {
      reconnectDelay: options.reconnectDelay ?? CONNECTION.DEFAULT_RECONNECT_DELAY,
      maxReconnectAttempts: options.maxReconnectAttempts ?? CONNECTION.MAX_RECONNECT_ATTEMPTS,
    };
  }

  // Connect to WebSocket server
  async connect(url: string): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      throw new Error(`Already ${this.state}`);
    }
    this.url = url;
    this.state = 'connecting';
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
        this.ws.binaryType = 'arraybuffer';
        this.ws.onopen = () => {
          this.state = 'connected';
          this.reconnectAttempts = 0;
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
          this.emit(EVENT_TYPES.CONNECTED, undefined);
          resolve();
        };
        this.ws.onmessage = (event) => this.handleMessage(event);
        this.ws.onclose = (event) => this.handleClose(event);
        this.ws.onerror = (error) => {
          this.emit(EVENT_TYPES.ERROR, new Error('WebSocket error'));
          reject(error);
        };
      } catch (error) {
        this.state = 'disconnected';
        reject(error);
      }
    });
  }

  // Disconnect from server
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
    this.pendingRequests.forEach(({ reject, timeout }) => {
      clearTimeout(timeout);
      reject(new Error('Connection closed'));
    });
    this.pendingRequests.clear();
  }

  // Send message with response expected
  async sendReliable<T extends BaseMessage>(message: Omit<BaseMessage, 'requestId' | 'timestamp'>): Promise<T> {
    if (!this.isConnected()) {
      throw new Error('Not connected');
    }
    return new Promise((resolve, reject) => {
      const requestId = this.requestIdCounter++;
      const fullMessage: BaseMessage = {
        ...message,
        requestId,
        timestamp: Date.now(),
      };
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, CONNECTION.REQUEST_TIMEOUT);
      this.pendingRequests.set(requestId, { resolve: resolve as any, reject, timeout });
      try {
        const buffer = BinaryProtocol.serialize(fullMessage);
        this.ws!.send(buffer);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  // Send message without response (fire-and-forget)
  sendUnreliable(message: Omit<BaseMessage, 'timestamp'>): void {
    if (!this.isConnected()) {
      console.warn('Cannot send unreliable message - not connected');
      return;
    }
    const fullMessage: BaseMessage = {
      ...message,
      timestamp: Date.now(),
    };
    try {
      const buffer = BinaryProtocol.serialize(fullMessage);
      this.ws!.send(buffer);
    } catch (error) {
      console.error('Failed to send unreliable message:', error);
    }
  }

  // Get connection state
  getState(): ConnectionState {
    return this.state;
  }

  // Check if connected
  isConnected(): boolean {
    return this.state === 'connected' && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private handleMessage(event: MessageEvent): void {
    try {
      // HOT PATH: Called at 60Hz during streaming - no logging allowed
      const message = BinaryProtocol.deserialize(event.data as ArrayBuffer);
      if (!message) {
        return;
      }
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        const { resolve, timeout } = this.pendingRequests.get(message.requestId)!;
        this.pendingRequests.delete(message.requestId);
        clearTimeout(timeout);
        resolve(message);
      }
      this.emitMessageEvent(message);
    } catch (error) {
      console.error('❌ Error handling message:', error);
      this.emit(EVENT_TYPES.ERROR, error as Error);
    }
  }

  private emitMessageEvent(message: BaseMessage): void {
    switch (message.type) {
      case MESSAGE_TYPES.MOTION_DATA:
        this.emit(EVENT_TYPES.MOTION_DATA, message as any);
        break;
      case MESSAGE_TYPES.DEVICE_STATUS:
        this.emit(EVENT_TYPES.DEVICE_STATUS, message as any);
        break;
      case MESSAGE_TYPES.BATTERY_UPDATE:
        this.emit(EVENT_TYPES.BATTERY_UPDATE, message as any);
        break;
      case MESSAGE_TYPES.SYNC_STARTED:
        this.emit(EVENT_TYPES.SYNC_STARTED, message as any);
        break;
      case MESSAGE_TYPES.SYNC_PROGRESS:
        this.emit(EVENT_TYPES.SYNC_PROGRESS, message as any);
        break;
      case MESSAGE_TYPES.SYNC_COMPLETE:
        this.emit(EVENT_TYPES.SYNC_COMPLETE, message as any);
        break;
      case MESSAGE_TYPES.DEVICE_VIBRATING:
        this.emit(EVENT_TYPES.DEVICE_VIBRATING, message as any);
        break;
      case MESSAGE_TYPES.STATE_UPDATE:
        // STATE_UPDATE - broadcast as DEVICE_STATUS for UI updates
        this.emit(EVENT_TYPES.DEVICE_STATUS, message as any);
        break;
      case MESSAGE_TYPES.CLIENT_LIST_UPDATE:
        this.emit(EVENT_TYPES.CLIENT_LIST_UPDATE, message as any);
        break;
      case MESSAGE_TYPES.ERROR:
        this.emit(EVENT_TYPES.MESSAGE, message as any);
        break;
    }
  }

  private handleClose(event: CloseEvent): void {
    this.state = 'disconnected';
    this.ws = null;
    this.emit(EVENT_TYPES.DISCONNECTED, { code: event.code, reason: event.reason });
    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }
    this.state = 'reconnecting';
    this.reconnectAttempts++;
    const delay = calculateBackoff(this.reconnectAttempts - 1, this.options.reconnectDelay);
    this.emit(EVENT_TYPES.RECONNECTING, { attempt: this.reconnectAttempts, delay });
    this.reconnectTimeout = setTimeout(() => {
      this.connect(this.url).catch(error => {
        console.error('Reconnect failed:', error);
      });
    }, delay) as any;
  }
}
