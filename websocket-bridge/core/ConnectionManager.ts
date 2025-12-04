import { WebSocketServer } from './WebSocketServer';
import { BaseMessage } from '../types/Interfaces';
import { MESSAGE_TYPES } from '../types/MessageTypes';

export interface ConnectionHealth {
  clientId: string;
  connected: boolean;
  lastSeen: number;
  messagesSent: number;
  messagesReceived: number;
  errors: number;
  latency: number;
}

export interface SystemHealth {
  server: {
    running: boolean;
    port: number;
    uptime: number;
    totalConnections: number;
  };
  clients: ConnectionHealth[];
  performance: {
    messagesPerSecond: number;
    errorRate: number;
    averageLatency: number;
  };
}

interface ClientMetrics {
  messagesSent: number;
  messagesReceived: number;
  errors: number;
  lastPingTime: number;
  lastPongTime: number;
}

// Client metadata types
export interface ClientAction {
  id: string;
  label: string;
  icon?: string;
  category?: string;
}

export interface ClientMetadata {
  clientId: string;
  name: string;
  type: 'main' | 'recording' | 'monitor' | 'custom';
  capabilities?: string[];
  actions?: ClientAction[];
  registeredAt: number;
  lastUpdated: number;
}

const HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
const PERFORMANCE_WINDOW = 60000; // 1 minute

export class ConnectionManager {
  private server: WebSocketServer;
  private clientMetrics = new Map<string, ClientMetrics>();
  private clientRegistry = new Map<string, ClientMetadata>();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private performanceHistory: Array<{ timestamp: number; messages: number; errors: number }> = [];

  private healthChangeHandler: ((health: SystemHealth) => void) | null = null;
  private clientListChangeHandler: ((clients: ClientMetadata[]) => void) | null = null;
  private newClientConnectHandler: ((clientId: string) => Promise<void>) | null = null;

  constructor() {
    this.server = new WebSocketServer();
    this.setupEventHandlers();
  }

  // Set handler for new client connections (used to push initial state)
  onNewClientConnect(handler: (clientId: string) => Promise<void>): void {
    this.newClientConnectHandler = handler;
  }

  // Start connection manager
  async start(port?: number): Promise<number> {
    const serverPort = await this.server.start(port);
    this.startHealthMonitoring();
    console.log(`Connection manager started on port ${serverPort}`);
    return serverPort;
  }

  // Stop connection manager
  async stop(): Promise<void> {
    this.stopHealthMonitoring();
    await this.server.stop();
    this.clientMetrics.clear();
    this.clientRegistry.clear();
    this.performanceHistory = [];
    console.log('Connection manager stopped');
  }

  // Set message handler
  onMessage(handler: (message: BaseMessage, clientId: string) => Promise<void>): void {
    this.server.onMessage(async (message, clientId) => {
      this.trackMessageReceived(clientId);
      await handler(message, clientId);
    });
  }

  // Set health change handler
  onHealthChange(handler: (health: SystemHealth) => void): void {
    this.healthChangeHandler = handler;
  }

  // Set client list change handler
  onClientListChange(handler: (clients: ClientMetadata[]) => void): void {
    this.clientListChangeHandler = handler;
  }

  // Send message to client with tracking
  async sendToClient(clientId: string, message: BaseMessage): Promise<boolean> {
    const success = await this.server.sendToClient(clientId, message);
    if (success) {
      this.trackMessageSent(clientId);
    } else {
      this.trackError(clientId);
    }
    return success;
  }

  // Broadcast message with tracking
  async broadcast(message: BaseMessage): Promise<number> {
    const sentCount = await this.server.broadcast(message);

    // Track sent messages for each client
    this.server.getClientIds().forEach((clientId) => {
      if (this.server.isClientConnected(clientId)) {
        this.trackMessageSent(clientId);
      }
    });

    return sentCount;
  }

  // Get current system health
  getSystemHealth(): SystemHealth {
    const serverStats = this.server.getStats();
    const clients = this.getClientHealth();
    const performance = this.calculatePerformanceMetrics();

    return {
      server: {
        running: true,
        port: serverStats.uptime > 0 ? 8080 : 0, // Approximate, could be improved
        uptime: serverStats.uptime,
        totalConnections: serverStats.connections,
      },
      clients,
      performance,
    };
  }

  // Get health status for all clients
  getClientHealth(): ConnectionHealth[] {
    return this.server.getClientIds().map((clientId) => {
      const metrics = this.clientMetrics.get(clientId) || this.createDefaultMetrics();
      const isConnected = this.server.isClientConnected(clientId);

      return {
        clientId,
        connected: isConnected,
        lastSeen: isConnected ? Date.now() : 0,
        messagesSent: metrics.messagesSent,
        messagesReceived: metrics.messagesReceived,
        errors: metrics.errors,
        latency: this.calculateLatency(metrics),
      };
    });
  }

  // Check if system is healthy
  isHealthy(): boolean {
    const health = this.getSystemHealth();

    // Server must be running
    if (!health.server.running) return false;

    // Performance thresholds
    if (health.performance.errorRate > 0.1) return false; // >10% error rate
    if (health.performance.averageLatency > 1000) return false; // >1s latency

    // Client health checks
    const unhealthyClients = health.clients.filter(client =>
      client.connected && (
        client.errors > 10 || // Too many errors
        client.latency > 2000 || // High latency
        Date.now() - client.lastSeen > 30000 // Not seen recently
      )
    );

    return unhealthyClients.length === 0;
  }

  // Force health check and notify if needed
  async performHealthCheck(): Promise<void> {
    const health = this.getSystemHealth();

    // Record performance metrics
    const now = Date.now();
    this.performanceHistory.push({
      timestamp: now,
      messages: health.server.totalConnections,
      errors: health.clients.reduce((sum, client) => sum + client.errors, 0),
    });

    // Clean old performance data
    this.performanceHistory = this.performanceHistory.filter(
      entry => now - entry.timestamp < PERFORMANCE_WINDOW
    );

    // Ping all clients to check latency
    await this.pingAllClients();

    // Notify health change handler
    this.healthChangeHandler?.(health);
  }

  // Register client with metadata
  registerClient(clientId: string, metadata: Omit<ClientMetadata, 'clientId' | 'registeredAt' | 'lastUpdated'>): void {
    const now = Date.now();
    const fullMetadata: ClientMetadata = {
      ...metadata,
      clientId,
      registeredAt: now,
      lastUpdated: now,
    };

    this.clientRegistry.set(clientId, fullMetadata);
    this.notifyClientListChange();
    console.log(`Client registered: ${clientId} (${metadata.name})`);
  }

  // Update client metadata
  updateClientMetadata(clientId: string, updates: Partial<Omit<ClientMetadata, 'clientId' | 'registeredAt'>>): void {
    const existing = this.clientRegistry.get(clientId);
    if (!existing) return;

    const updated: ClientMetadata = {
      ...existing,
      ...updates,
      clientId: existing.clientId,
      registeredAt: existing.registeredAt,
      lastUpdated: Date.now(),
    };

    this.clientRegistry.set(clientId, updated);
    this.notifyClientListChange();
    console.log(`Client metadata updated: ${clientId}`);
  }

  // Add action to client
  addClientAction(clientId: string, action: ClientAction): void {
    const existing = this.clientRegistry.get(clientId);
    if (!existing) return;

    const actions = existing.actions || [];
    const actionExists = actions.some(a => a.id === action.id);
    if (actionExists) return;

    this.updateClientMetadata(clientId, {
      actions: [...actions, action],
    });
  }

  // Remove action from client
  removeClientAction(clientId: string, actionId: string): void {
    const existing = this.clientRegistry.get(clientId);
    if (!existing || !existing.actions) return;

    this.updateClientMetadata(clientId, {
      actions: existing.actions.filter(a => a.id !== actionId),
    });
  }

  // Get all registered clients
  getRegisteredClients(): ClientMetadata[] {
    return Array.from(this.clientRegistry.values());
  }

  // Get client metadata by ID
  getClientMetadata(clientId: string): ClientMetadata | null {
    return this.clientRegistry.get(clientId) || null;
  }

  // Remove client from registry
  unregisterClient(clientId: string): void {
    const existed = this.clientRegistry.delete(clientId);
    if (existed) {
      this.notifyClientListChange();
      console.log(`Client unregistered: ${clientId}`);
    }
  }

  // Broadcast current client list to all connected clients
  async broadcastClientList(): Promise<void> {
    const clients = this.getRegisteredClients();
    const message: BaseMessage = {
      type: MESSAGE_TYPES.CLIENT_LIST_UPDATE,
      timestamp: Date.now(),
      clients,
    } as any;

    await this.broadcast(message);
  }

  // Notify client list change handler and broadcast
  private notifyClientListChange(): void {
    const clients = this.getRegisteredClients();
    this.clientListChangeHandler?.(clients);
    this.broadcastClientList().catch(console.error);
  }

  // Setup server event handlers
  private setupEventHandlers(): void {
    this.server.onConnection((clientId, connected) => {
      if (connected) {
        this.clientMetrics.set(clientId, this.createDefaultMetrics());
        console.log(`Client metrics initialized: ${clientId}`);

        // CRITICAL: Notify handler to push initial state to new client
        // This ensures immediate state sync without waiting for client to query
        if (this.newClientConnectHandler) {
          // Small delay to ensure client is ready to receive messages
          setTimeout(() => {
            this.newClientConnectHandler?.(clientId).catch(err => {
              console.error(`Failed to send initial state to ${clientId}:`, err);
            });
          }, 100);
        }
      } else {
        this.clientMetrics.delete(clientId);
        this.unregisterClient(clientId);
        console.log(`Client metrics cleaned up: ${clientId}`);
      }
    });
  }

  // Start health monitoring
  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        console.error('Health check failed:', error);
      });
    }, HEALTH_CHECK_INTERVAL);
  }

  // Stop health monitoring
  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // Track message sent to client
  private trackMessageSent(clientId: string): void {
    const metrics = this.clientMetrics.get(clientId);
    if (metrics) {
      metrics.messagesSent++;
    }
  }

  // Track message received from client
  private trackMessageReceived(clientId: string): void {
    const metrics = this.clientMetrics.get(clientId);
    if (metrics) {
      metrics.messagesReceived++;
    }
  }

  // Track error for client
  private trackError(clientId: string): void {
    const metrics = this.clientMetrics.get(clientId);
    if (metrics) {
      metrics.errors++;
    }
  }

  // Ping all connected clients
  private async pingAllClients(): Promise<void> {
    const now = Date.now();
    const pingPromises = this.server.getClientIds().map(async (clientId) => {
      const metrics = this.clientMetrics.get(clientId);
      if (metrics && this.server.isClientConnected(clientId)) {
        metrics.lastPingTime = now;

        await this.server.sendToClient(clientId, {
          type: MESSAGE_TYPES.PING,
          timestamp: now,
        });
      }
    });

    await Promise.all(pingPromises);
  }

  // Calculate latency for client
  private calculateLatency(metrics: ClientMetrics): number {
    if (metrics.lastPingTime && metrics.lastPongTime && metrics.lastPongTime > metrics.lastPingTime) {
      return metrics.lastPongTime - metrics.lastPingTime;
    }
    return 0;
  }

  // Calculate performance metrics
  private calculatePerformanceMetrics(): SystemHealth['performance'] {
    if (this.performanceHistory.length < 2) {
      return {
        messagesPerSecond: 0,
        errorRate: 0,
        averageLatency: 0,
      };
    }

    const latest = this.performanceHistory[this.performanceHistory.length - 1];
    const earliest = this.performanceHistory[0];
    const timeSpan = latest.timestamp - earliest.timestamp;

    const messagesPerSecond = timeSpan > 0
      ? ((latest.messages - earliest.messages) / timeSpan) * 1000
      : 0;

    const totalMessages = this.performanceHistory.reduce((sum, entry) => sum + entry.messages, 0);
    const totalErrors = this.performanceHistory.reduce((sum, entry) => sum + entry.errors, 0);
    const errorRate = totalMessages > 0 ? totalErrors / totalMessages : 0;

    const clients = this.getClientHealth();
    const averageLatency = clients.length > 0
      ? clients.reduce((sum, client) => sum + client.latency, 0) / clients.length
      : 0;

    return {
      messagesPerSecond,
      errorRate,
      averageLatency,
    };
  }

  // Create default metrics for new client
  private createDefaultMetrics(): ClientMetrics {
    return {
      messagesSent: 0,
      messagesReceived: 0,
      errors: 0,
      lastPingTime: 0,
      lastPongTime: 0,
    };
  }
}