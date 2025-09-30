import { BinaryProtocol, MESSAGE_TYPES, BaseMessage } from './BinaryProtocol';

// Message interfaces
interface BLEScanRequestMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.BLE_SCAN_REQUEST;
}

interface BLEConnectRequestMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.BLE_CONNECT_REQUEST;
  deviceId: string;
  deviceName: string;
}

interface BLEDisconnectRequestMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.BLE_DISCONNECT_REQUEST;
  deviceId: string;
}

interface RecordStartRequestMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.RECORD_START_REQUEST;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
}

interface RecordStopRequestMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.RECORD_STOP_REQUEST;
}

interface WebSocketBridgeClientConfig {
  url: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export class WebSocketBridgeClient {
  private ws: WebSocket | null = null;
  private config: WebSocketBridgeClientConfig;
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: number | null = null;
  private messageHandlers = new Map<number, (message: BaseMessage) => void>();
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void; timeout: number }>();
  private requestIdCounter = 1;

  constructor(config: WebSocketBridgeClientConfig) {
    this.config = {
      reconnectDelay: 2000,
      maxReconnectAttempts: 5,
      ...config,
    };
  }

  // Connect to WebSocket bridge
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        console.log('🔌 Connecting to WebSocket Bridge:', this.config.url);

        this.ws = new WebSocket(this.config.url);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          console.log('✅ Connected to WebSocket Bridge');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
          }
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event);
        };

        this.ws.onclose = () => {
          console.log('❌ WebSocket Bridge disconnected');
          this.isConnected = false;
          this.ws = null;
          this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
          console.error('🚨 WebSocket Bridge error:', error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  // Disconnect from bridge
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  // Send reliable message (with response expected)
  async sendReliable<T = any>(message: Omit<BaseMessage, 'requestId' | 'timestamp'>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected || !this.ws) {
        reject(new Error('WebSocket Bridge not connected'));
        return;
      }

      const requestId = this.generateRequestId();
      const fullMessage: BaseMessage = {
        ...message,
        requestId,
        timestamp: Date.now(),
      };

      // Store pending request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }, 10000); // 10s timeout

      this.pendingRequests.set(requestId, { resolve, reject, timeout });

      try {
        const binaryData = BinaryProtocol.serialize(fullMessage);
        this.ws.send(binaryData);
      } catch (error) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  // Send unreliable message (fire and forget)
  sendUnreliable(message: Omit<BaseMessage, 'timestamp'>): void {
    if (!this.isConnected || !this.ws) {
      console.warn('Cannot send unreliable message - not connected');
      return;
    }

    const fullMessage: BaseMessage = {
      ...message,
      timestamp: Date.now(),
    };

    try {
      const binaryData = BinaryProtocol.serialize(fullMessage);
      this.ws.send(binaryData);
    } catch (error) {
      console.error('Failed to send unreliable message:', error);
    }
  }

  // Register message handler
  onMessage(messageType: number, handler: (message: BaseMessage) => void): void {
    this.messageHandlers.set(messageType, handler);
  }

  // Remove message handler
  removeHandler(messageType: number): void {
    this.messageHandlers.delete(messageType);
  }

  // BLE Operations
  async scanForDevices(): Promise<any> {
    const message: BLEScanRequestMessage = {
      type: MESSAGE_TYPES.BLE_SCAN_REQUEST,
    };
    return this.sendReliable(message);
  }

  async connectToDevice(deviceId: string, deviceName: string): Promise<any> {
    const message: BLEConnectRequestMessage = {
      type: MESSAGE_TYPES.BLE_CONNECT_REQUEST,
      deviceId,
      deviceName,
    };
    return this.sendReliable(message);
  }

  async disconnectFromDevice(deviceId: string): Promise<any> {
    const message: BLEDisconnectRequestMessage = {
      type: MESSAGE_TYPES.BLE_DISCONNECT_REQUEST,
      deviceId,
    };
    return this.sendReliable(message);
  }

  // Recording Operations
  async startRecording(sessionId: string, exerciseId: string, setNumber: number): Promise<any> {
    const message: RecordStartRequestMessage = {
      type: MESSAGE_TYPES.RECORD_START_REQUEST,
      sessionId,
      exerciseId,
      setNumber,
    };
    return this.sendReliable(message);
  }

  async stopRecording(): Promise<any> {
    const message: RecordStopRequestMessage = {
      type: MESSAGE_TYPES.RECORD_STOP_REQUEST,
    };
    console.log(`🛑 [WebSocketBridgeClient] Sending stop recording request:`, {
      messageType: message.type,
      messageTypeHex: `0x${message.type.toString(16)}`,
      MESSAGE_TYPES_RECORD_STOP_REQUEST: MESSAGE_TYPES.RECORD_STOP_REQUEST,
      fullMessage: message
    });
    return this.sendReliable(message);
  }

  // System Operations
  async getStatus(): Promise<any> {
    const message: BaseMessage = {
      type: MESSAGE_TYPES.STATUS,
    };
    return this.sendReliable(message);
  }

  async sendHeartbeat(): Promise<any> {
    const message: BaseMessage = {
      type: MESSAGE_TYPES.HEARTBEAT,
    };
    return this.sendReliable(message);
  }

  // Connection status
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  // Private methods
  private handleMessage(event: MessageEvent): void {
    try {
      const message = BinaryProtocol.deserialize(event.data as ArrayBuffer);

      // Handle response to pending request
      if (message.requestId && this.pendingRequests.has(message.requestId)) {
        const pendingRequest = this.pendingRequests.get(message.requestId)!;
        this.pendingRequests.delete(message.requestId);
        clearTimeout(pendingRequest.timeout);

        if (message.type === MESSAGE_TYPES.ERROR) {
          pendingRequest.reject(new Error((message as any).message || 'Unknown error'));
        } else {
          pendingRequest.resolve(message);
        }
        // DON'T return here - let it also trigger message handlers
      }

      // Handle broadcast/streaming messages AND request-response messages
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        handler(message);
      }
    } catch (error) {
      console.error('Failed to process WebSocket Bridge message:', error);
    }
  }

  private generateRequestId(): number {
    return this.requestIdCounter++;
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts!) {
      console.error('Max reconnect attempts reached for WebSocket Bridge');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.config.reconnectDelay! * this.reconnectAttempts, 10000);

    console.log(`🔄 Attempting to reconnect to WebSocket Bridge in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Failed to reconnect to WebSocket Bridge:', error);
      });
    }, delay);
  }
}