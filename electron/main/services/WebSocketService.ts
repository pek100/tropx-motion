import { WebSocket, WebSocketServer } from 'ws';
import { CONFIG, MESSAGE_TYPES, ERROR_CODES } from '../../shared/config';
import { WSMessage, ClientMessage, ErrorMessage, MotionDataUpdate } from '../../shared/types';
import { UnifiedBinaryProtocol } from '../../shared/BinaryProtocol';
import { StreamBatcher } from './StreamBatcher';

export class WebSocketService {
  private server: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private port: number = CONFIG.WEBSOCKET.DEFAULT_PORT;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageHandlers = new Map<string, (data: unknown, clientId: string) => void>();
  private streamBatcher!: StreamBatcher;
  
  // Performance optimization: pre-allocated buffers (deprecated cache removed in practice)
  private messageBuffer = new Map<string, Buffer>();

  // Backpressure threshold (~256KB) - skip motion frame to slow clients if exceeded
  private static readonly BACKPRESSURE_BYTES = 256 * 1024;

  async initialize(): Promise<void> {
    this.port = await this.findAvailablePort();
    await this.createServer();
    this.initializeBatcher();
    this.startHeartbeat();
  }

  // Register message handler for specific message type
  onMessage(type: string, handler: (data: unknown, clientId: string) => void): void {
    this.messageHandlers.set(type, handler);
  }

  // Broadcast message to all connected clients using unified binary protocol
  broadcast(message: WSMessage): void {
    if (this.clients.size === 0) return;

    // Route high-frequency motion data through batcher to reduce churn
    if (message.type === MESSAGE_TYPES.MOTION_DATA) {
      try {
        this.streamBatcher.addMotionData(message.data as MotionDataUpdate);
      } catch {
        // Fallback to direct send if batcher is unavailable
        this.sendMotionDataToAll(message.data as MotionDataUpdate, message.timestamp);
      }
      return;
    }

    try {
      const binaryData = UnifiedBinaryProtocol.serialize(
        message.type,
        message.data,
        message.timestamp
      );
      this.broadcastBinary(binaryData);
    } catch (error) {
      console.error('Failed to serialize message to binary:', error);
      this.broadcastJSON(message);
    }
  }

  // High-performance binary broadcasting
  private broadcastBinary(data: Buffer): void {
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          console.error('Failed to send binary data to client:', error);
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  // Motion-data specialized sender: binary-only with backpressure skip per client
  private sendMotionDataToAll(data: MotionDataUpdate, timestamp: number): void {
    let payload: Buffer;
    try {
      payload = UnifiedBinaryProtocol.serialize(MESSAGE_TYPES.MOTION_DATA, data, timestamp);
    } catch (e) {
      // As a last resort, fall back to JSON (larger payload)
      const json = JSON.stringify({ type: MESSAGE_TYPES.MOTION_DATA, data, timestamp });
      payload = Buffer.from(json, 'utf8');
    }

    this.clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) {
        this.clients.delete(client);
        return;
      }
      const buffered = this.getBufferedAmount(client);
      if (buffered > WebSocketService.BACKPRESSURE_BYTES) {
        // Skip this motion frame for this slow client; keep latest-only semantics
        return;
      }
      try {
        client.send(payload);
      } catch (error) {
        console.error('Failed to send motion data to client:', error);
        this.clients.delete(client);
      }
    });
  }

  // Best-effort bufferedAmount for ws; fall back to underlying socket bufferSize
  private getBufferedAmount(client: WebSocket): number {
    const anyClient = client as any;
    return (
      (typeof anyClient.bufferedAmount === 'number' ? anyClient.bufferedAmount : 0) ||
      (anyClient._socket && typeof anyClient._socket.bufferSize === 'number' ? anyClient._socket.bufferSize : 0)
    );
  }

  // Standard JSON broadcasting (no caching to avoid churn)
  private broadcastJSON(message: WSMessage): void {
    const data = Buffer.from(JSON.stringify(message), 'utf8');
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(data);
        } catch (error) {
          console.error('Failed to send message to client:', error);
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  // Send message to specific client using unified binary protocol
  sendToClient(client: WebSocket, message: WSMessage): void {
    if (client.readyState !== WebSocket.OPEN) return;

    try {
      // Use unified binary protocol for ALL messages
      const binaryData = UnifiedBinaryProtocol.serialize(
        message.type,
        message.data,
        message.timestamp
      );
      
      client.send(binaryData);
    } catch (error) {
      console.error('Failed to send binary message to client:', error);
      // Fallback to JSON if binary serialization fails
      try {
        client.send(JSON.stringify(message));
      } catch (fallbackError) {
        console.error('Failed to send fallback JSON message:', fallbackError);
        this.clients.delete(client);
      }
    }
  }

  getPort(): number {
    return this.port;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.streamBatcher) {
      this.streamBatcher.cleanup();
    }

    this.clients.forEach(client => client.close());
    this.clients.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.messageHandlers.clear();
    this.messageBuffer.clear();
  }

  // Find available port starting from default
  private async findAvailablePort(): Promise<number> {
    const net = require('net');
    
    for (let port = CONFIG.WEBSOCKET.DEFAULT_PORT; 
         port < CONFIG.WEBSOCKET.DEFAULT_PORT + CONFIG.WEBSOCKET.PORT_SCAN_RANGE; 
         port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const server = net.createServer();
          server.listen(port, () => {
            server.close(() => resolve());
          });
          server.on('error', () => reject());
        });
        return port;
      } catch {
        continue;
      }
    }
    
    throw new Error(`No available ports found starting from ${CONFIG.WEBSOCKET.DEFAULT_PORT}`);
  }

  // Initialize stream batcher for performance optimization
  private initializeBatcher(): void {
    this.streamBatcher = new StreamBatcher(
      CONFIG.WEBSOCKET.BATCH_INTERVAL, 
      CONFIG.WEBSOCKET.MAX_BATCH_SIZE
    );
    
    // Subscribe to batched messages
    this.streamBatcher.subscribe((messages) => {
      for (const message of messages) {
        if (message.type === MESSAGE_TYPES.MOTION_DATA || message.type === 'motion_data') {
          this.sendMotionDataToAll(message.data as MotionDataUpdate, message.timestamp);
        } else {
          this.broadcast({
            type: message.type as any,
            data: message.data,
            timestamp: message.timestamp
          });
        }
      }
    });
  }

  // Create and configure WebSocket server with performance optimizations
  private async createServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = new WebSocketServer({
        port: this.port,
        perMessageDeflate: !CONFIG.WEBSOCKET.DISABLE_COMPRESSION,
        maxPayload: CONFIG.WEBSOCKET.MAX_PAYLOAD_SIZE,
        backlog: CONFIG.WEBSOCKET.CONNECTION_BACKLOG,
        // Disable client verification for speed
        handleProtocols: () => false, // No subprotocol handling for speed
        clientTracking: true, // Enable client tracking
      });

      this.server.on('listening', () => {
        console.log(`WebSocket server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('connection', (ws) => {
        this.handleConnection(ws);
      });

      this.server.on('error', (error) => {
        console.error('WebSocket server error:', error);
        reject(error);
      });
    });
  }

  // Handle new client connection
  private handleConnection(ws: WebSocket): void {
    const clientId = this.generateClientId();
    console.log(`New WebSocket client connected: ${clientId}`);

    this.clients.add(ws);
    this.sendCurrentStatus(ws);

    ws.on('message', (data) => {
      this.handleClientMessage(ws, data.toString(), clientId);
    });

    ws.on('close', () => {
      console.log(`Client disconnected: ${clientId}`);
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket client error (${clientId}):`, error);
      this.clients.delete(ws);
    });
  }

  // Process incoming client messages
  private handleClientMessage(ws: WebSocket, message: string, clientId: string): void {
    try {
      const parsed: ClientMessage = JSON.parse(message);
      
      if (parsed.type === 'ping') {
        this.sendToClient(ws, {
          type: MESSAGE_TYPES.PONG,
          data: { timestamp: Date.now() },
          timestamp: Date.now()
        });
        return;
      }

      const handler = this.messageHandlers.get(parsed.type);
      if (handler) {
        handler(parsed.data, clientId);
      } else {
        console.warn(`Unknown message type: ${parsed.type}`);
      }
    } catch (error) {
      console.error('Error parsing client message:', error);
      this.sendErrorToClient(ws, ERROR_CODES.INVALID_DATA, 'Invalid message format');
    }
  }

  // Send error message to specific client
  private sendErrorToClient(client: WebSocket, code: string, message: string): void {
    const errorMessage: ErrorMessage = {
      type: MESSAGE_TYPES.ERROR,
      data: {
        code: code as any,
        message,
      },
      timestamp: Date.now()
    };
    this.sendToClient(client, errorMessage);
  }

  // Send current system status to new client
  private sendCurrentStatus(ws: WebSocket): void {
    this.sendToClient(ws, {
      type: MESSAGE_TYPES.STATUS_UPDATE,
      data: {
        connected: true,
        timestamp: Date.now()
      },
      timestamp: Date.now()
    });
  }

  // Start heartbeat to keep connections alive
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      this.broadcast({
        type: MESSAGE_TYPES.HEARTBEAT,
        data: { timestamp: Date.now() },
        timestamp: Date.now()
      });
    }, CONFIG.WEBSOCKET.HEARTBEAT_INTERVAL);
  }

  // Generate unique client ID
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}