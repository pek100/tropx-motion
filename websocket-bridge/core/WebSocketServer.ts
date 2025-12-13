import { WebSocketServer as WSServer, WebSocket as WSWebSocket } from 'ws';
import { BinaryProtocol } from '../protocol/BinaryProtocol';
import { MessageValidator } from '../protocol/MessageValidator';
import { PortDiscovery } from '../utils/PortDiscovery';
import { MESSAGE_TYPES } from '../types/MessageTypes';
import { BaseMessage, ClientConnection } from '../types/Interfaces';

export interface ServerConfig {
  host: string;
  port?: number;
  maxConnections: number;
  heartbeatInterval: number;
  connectionTimeout: number;
}

export interface ServerStats {
  connections: number;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  uptime: number;
}

const DEFAULT_CONFIG: ServerConfig = {
  host: '0.0.0.0', // Bind to all interfaces for cross-platform compatibility
  maxConnections: 10,
  heartbeatInterval: 30000,
  connectionTimeout: 60000,
} as const;

export class WebSocketServer {
  private server: WSServer | null = null;
  private clients = new Map<string, ClientConnection>();
  private config: ServerConfig;
  private stats: ServerStats;
  private startTime: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  private messageHandler: ((message: BaseMessage, clientId: string) => Promise<void>) | null = null;
  private connectionHandler: ((clientId: string, connected: boolean) => void) | null = null;

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      connections: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      uptime: 0,
    };
  }

  // Start server with auto port discovery
  async start(port?: number): Promise<number> {
    if (this.server) {
      throw new Error('Server already running');
    }

    try {
      const actualPort = port || this.config.port || await PortDiscovery.findAvailablePort();
      this.config.port = actualPort;

      await this.createServer();
      this.startHeartbeat();
      this.startCleanup();
      this.startTime = Date.now();

      console.log(`WebSocket server started on ${this.config.host}:${actualPort}`);
      return actualPort;

    } catch (error) {
      this.cleanup();
      throw new Error(`Failed to start WebSocket server: ${error}`);
    }
  }

  // Stop server and cleanup resources
  async stop(): Promise<void> {
    if (!this.server) return;

    this.stopHeartbeat();
    this.stopCleanup();

    // Close all client connections
    this.clients.forEach((client) => {
      if (client.socket.readyState === WSWebSocket.OPEN) {
        client.socket.close(1000, 'Server shutting down');
      }
    });

    // Close server
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.clients.clear();
        console.log('WebSocket server stopped');
        resolve();
      });
    });
  }

  // Set message handler
  onMessage(handler: (message: BaseMessage, clientId: string) => Promise<void>): void {
    this.messageHandler = handler;
  }

  // Set connection handler
  onConnection(handler: (clientId: string, connected: boolean) => void): void {
    this.connectionHandler = handler;
  }

  // Send message to specific client
  // PERFORMANCE FIX: Removed async - socket.send is synchronous, no need for Promise overhead
  sendToClient(clientId: string, message: BaseMessage): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WSWebSocket.OPEN) return false;

    try {
      const buffer = BinaryProtocol.serialize(message);
      client.socket.send(buffer);
      this.stats.messagesSent++;
      return true;

    } catch (error) {
      this.stats.errors++;
      console.error(`Failed to send message to client ${clientId}:`, error);
      return false;
    }
  }

  // Broadcast message to all connected clients
  // PERFORMANCE FIX: Removed async - no await statements, unnecessary Promise creation overhead
  broadcast(message: BaseMessage): number {
    if (this.clients.size === 0) return 0;

    const buffer = BinaryProtocol.serialize(message);
    let sentCount = 0;

    this.clients.forEach((client, clientId) => {
      if (client.socket.readyState === WSWebSocket.OPEN) {
        try {
          client.socket.send(buffer);
          sentCount++;
        } catch (error) {
          this.stats.errors++;
          console.error(`Failed to broadcast to client ${clientId}:`, error);
        }
      }
    });

    this.stats.messagesSent += sentCount;
    return sentCount;
  }

  // Get server statistics
  getStats(): ServerStats {
    return {
      ...this.stats,
      connections: this.clients.size,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
    };
  }

  // Get connected client IDs
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  // Check if client is connected
  isClientConnected(clientId: string): boolean {
    const client = this.clients.get(clientId);
    return client?.socket.readyState === WSWebSocket.OPEN;
  }

  // Create WebSocket server
  private async createServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = new WSServer({
        host: this.config.host,
        port: this.config.port,
        maxPayload: 64 * 1024, // 64KB max payload
        perMessageDeflate: false, // Disable compression for performance
      });

      this.server.on('listening', () => resolve());
      this.server.on('error', (error) => reject(error));
      this.server.on('connection', (socket, request) => this.handleConnection(socket, request));
    });
  }

  // Handle new client connection
  private handleConnection(socket: WSWebSocket, request: any): void {
    if (this.clients.size >= this.config.maxConnections) {
      socket.close(1008, 'Server at maximum capacity');
      return;
    }

    const clientId = this.generateClientId();
    const client: ClientConnection = {
      id: clientId,
      socket,
      lastSeen: Date.now(),
      pendingRequests: new Map(),
    };

    this.clients.set(clientId, client);
    console.log(`Client connected: ${clientId} (${request.socket.remoteAddress})`);

    // Setup socket event handlers
    socket.on('message', (data) => this.handleMessage(clientId, data));
    socket.on('close', (code, reason) => this.handleDisconnection(clientId, code, reason));
    socket.on('error', (error) => this.handleSocketError(clientId, error));
    socket.on('pong', () => this.handlePong(clientId));

    // Notify connection handler
    this.connectionHandler?.(clientId, true);
  }

  // Handle incoming message from client
  private async handleMessage(clientId: string, data: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      // Validate message size - properly convert Buffer to ArrayBuffer
      let buffer: ArrayBuffer;
      if (data instanceof ArrayBuffer) {
        buffer = data;
      } else if (Buffer.isBuffer(data)) {
        // Convert Buffer to ArrayBuffer properly (only the actual content)
        const slicedBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
        buffer = slicedBuffer as ArrayBuffer;
      } else {
        // Fallback for other data types
        buffer = data.buffer || data;
      }
      const sizeValidation = MessageValidator.validateSize(buffer);
      if (!sizeValidation.valid) {
        this.sendErrorToClient(clientId, sizeValidation);
        return;
      }

      // Deserialize message
      const message = BinaryProtocol.deserialize(buffer);
      if (!message) {
        this.sendErrorToClient(clientId, { valid: false, error: 'Failed to deserialize message' });
        return;
      }

      // Validate message content
      const validation = MessageValidator.validate(message);
      if (!validation.valid) {
        this.sendErrorToClient(clientId, validation, message.requestId);
        return;
      }

      // Update client last seen
      client.lastSeen = Date.now();
      this.stats.messagesReceived++;

      // Handle ping/pong internally
      if (message.type === MESSAGE_TYPES.PING) {
        await this.sendToClient(clientId, {
          type: MESSAGE_TYPES.PONG,
          timestamp: Date.now(),
          requestId: message.requestId,
        });
        return;
      }

      // Forward to message handler
      await this.messageHandler?.(message, clientId);

    } catch (error) {
      this.stats.errors++;
      console.error(`Message handling error for client ${clientId}:`, error);
      this.sendErrorToClient(clientId, { valid: false, error: 'Internal server error' });
    }
  }

  // Handle client disconnection
  private handleDisconnection(clientId: string, code: number, reason: Buffer): void {
    const client = this.clients.get(clientId);
    if (client) {
      // Reject all pending requests
      client.pendingRequests.forEach((request) => {
        clearTimeout(request.timeout);
        request.reject(new Error('Client disconnected'));
      });

      this.clients.delete(clientId);
      console.log(`Client disconnected: ${clientId} (${code}: ${reason.toString()})`);

      // Notify connection handler
      this.connectionHandler?.(clientId, false);
    }
  }

  // Handle socket error
  private handleSocketError(clientId: string, error: Error): void {
    this.stats.errors++;
    console.error(`Socket error for client ${clientId}:`, error);
  }

  // Handle pong response
  private handlePong(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastSeen = Date.now();
    }
  }

  // Send error message to client
  private async sendErrorToClient(clientId: string, validation: { valid: boolean; error?: string }, requestId?: number): Promise<void> {
    const errorMessage = MessageValidator.createErrorMessage(validation, requestId);
    await this.sendToClient(clientId, errorMessage);
  }

  // Start heartbeat mechanism
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();

      this.clients.forEach((client, clientId) => {
        if (client.socket.readyState === WSWebSocket.OPEN) {
          // Check for timeout
          if (now - client.lastSeen > this.config.connectionTimeout) {
            console.log(`Client ${clientId} timed out`);
            client.socket.terminate();
            return;
          }

          // Send ping
          client.socket.ping();
        } else {
          // Clean up dead connections
          this.clients.delete(clientId);
        }
      });
    }, this.config.heartbeatInterval);
  }

  // Stop heartbeat
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Start periodic cleanup
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, 60000); // Every minute
  }

  // Stop cleanup
  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // Perform periodic cleanup
  private performCleanup(): void {
    const deadClients: string[] = [];

    this.clients.forEach((client, clientId) => {
      if (client.socket.readyState === WSWebSocket.CLOSED || client.socket.readyState === WSWebSocket.CLOSING) {
        deadClients.push(clientId);
      }
    });

    deadClients.forEach((clientId) => {
      this.clients.delete(clientId);
    });

    if (deadClients.length > 0) {
      console.log(`Cleaned up ${deadClients.length} dead connections`);
    }
  }

  // Generate unique client ID
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Cleanup all resources
  private cleanup(): void {
    this.stopHeartbeat();
    this.stopCleanup();
    this.clients.clear();
  }
}