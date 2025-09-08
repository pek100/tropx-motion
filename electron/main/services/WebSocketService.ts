import { WebSocket, WebSocketServer } from 'ws';
import { CONFIG, MESSAGE_TYPES, ERROR_CODES } from '../../shared/config';
import { WSMessage, ClientMessage, ErrorMessage } from '../../shared/types';

export class WebSocketService {
  private server: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();
  private port: number = CONFIG.WEBSOCKET.DEFAULT_PORT;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private messageHandlers = new Map<string, (data: unknown, clientId: string) => void>();

  async initialize(): Promise<void> {
    this.port = await this.findAvailablePort();
    await this.createServer();
    this.startHeartbeat();
  }

  // Register message handler for specific message type
  onMessage(type: string, handler: (data: unknown, clientId: string) => void): void {
    this.messageHandlers.set(type, handler);
  }

  // Broadcast message to all connected clients
  broadcast(message: WSMessage): void {
    if (this.clients.size === 0) return;

    const data = JSON.stringify(message);
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

  // Send message to specific client
  sendToClient(client: WebSocket, message: WSMessage): void {
    if (client.readyState !== WebSocket.OPEN) return;

    try {
      client.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send message to client:', error);
      this.clients.delete(client);
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

    this.clients.forEach(client => client.close());
    this.clients.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.messageHandlers.clear();
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

  // Create and configure WebSocket server
  private async createServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = new WebSocketServer({
        port: this.port,
        perMessageDeflate: false,
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