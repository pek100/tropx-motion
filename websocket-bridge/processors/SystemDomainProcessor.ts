import { BaseMessage, ErrorMessage } from '../types/Interfaces';
import { MESSAGE_TYPES, ERROR_CODES } from '../types/MessageTypes';
import { DomainProcessor, MESSAGE_DOMAINS, MessageDomain } from '../core/UnifiedMessageRouter';

// System operation timeout
const SYSTEM_TIMEOUT = 5000;

// System service interface
interface SystemService {
  getSystemStatus(): any;
  getPerformanceMetrics(): any;
  performSystemCleanup(): Promise<{ cleaned: number; errors: number }>;
  restartServices(): Promise<{ success: boolean; message: string }>;
}

// System operation handler type
type SystemOperationHandler = (message: BaseMessage, service?: SystemService) => Promise<BaseMessage>;

export class SystemDomainProcessor implements DomainProcessor {
  private systemService: SystemService | null = null;
  private operationHandlers = new Map<number, SystemOperationHandler>();
  private stats = {
    processed: 0,
    errors: 0,
    heartbeats: 0,
    pings: 0
  };

  constructor() {
    this.setupOperationHandlers();
  }

  getDomain(): MessageDomain {
    return MESSAGE_DOMAINS.SYSTEM;
  }

  // Set system service dependency
  setSystemService(service: SystemService): void {
    this.systemService = service;
  }

  // Process system domain message
  async process(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    const handler = this.operationHandlers.get(message.type);
    if (!handler) {
      return this.createErrorResponse(message, 'UNSUPPORTED_SYSTEM_OPERATION');
    }

    try {
      const result = await this.executeWithTimeout(message, handler);
      this.stats.processed++;
      return result;

    } catch (error) {
      this.stats.errors++;
      console.error(`System operation error [${message.type}]:`, error);
      return this.createErrorResponse(message, 'SYSTEM_OPERATION_FAILED', (error as Error).message);
    }
  }

  // Execute handler with timeout
  private async executeWithTimeout(message: BaseMessage, handler: SystemOperationHandler): Promise<BaseMessage> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`System operation timeout after ${SYSTEM_TIMEOUT}ms`)), SYSTEM_TIMEOUT);
    });

    return Promise.race([
      handler(message, this.systemService || undefined),
      timeoutPromise
    ]);
  }

  // Setup system operation handlers
  private setupOperationHandlers(): void {
    this.operationHandlers.set(MESSAGE_TYPES.HEARTBEAT, this.handleHeartbeat);
    this.operationHandlers.set(MESSAGE_TYPES.STATUS, this.handleStatusRequest);
    this.operationHandlers.set(MESSAGE_TYPES.PING, this.handlePing);
    this.operationHandlers.set(MESSAGE_TYPES.ACK, this.handleAck);
  }

  // Heartbeat handler
  private handleHeartbeat = async (message: BaseMessage): Promise<BaseMessage> => {
    this.stats.heartbeats++;

    return {
      type: MESSAGE_TYPES.HEARTBEAT,
      requestId: message.requestId,
      timestamp: Date.now()
    };
  };

  // Status request handler
  private handleStatusRequest = async (message: BaseMessage, service?: SystemService): Promise<BaseMessage> => {
    const systemStatus = service ? service.getSystemStatus() : this.getDefaultSystemStatus();

    return {
      type: MESSAGE_TYPES.STATUS,
      requestId: message.requestId,
      timestamp: Date.now(),
      isRecording: systemStatus.isRecording || false,
      connectedDevices: systemStatus.connectedDevices || [],
      wsPort: systemStatus.wsPort || 8080
    } as BaseMessage;
  };

  // Ping handler
  private handlePing = async (message: BaseMessage): Promise<BaseMessage> => {
    this.stats.pings++;

    return {
      type: MESSAGE_TYPES.PONG,
      requestId: message.requestId,
      timestamp: Date.now()
    };
  };

  // ACK handler (typically fire-and-forget)
  private handleAck = async (message: BaseMessage): Promise<BaseMessage> => {
    // ACK messages typically don't need responses
    return {
      type: MESSAGE_TYPES.ACK,
      requestId: message.requestId,
      timestamp: Date.now()
    };
  };

  // Get basic system statistics
  private getSystemStats(): any {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        external: process.memoryUsage().external
      },
      cpu: process.cpuUsage()
    };
  }

  // Default system status when no service is available
  private getDefaultSystemStatus(): any {
    return {
      status: 'running',
      uptime: process.uptime() * 1000,
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version
    };
  }

  // Default performance metrics when no service is available
  private getDefaultPerformanceMetrics(): any {
    return {
      connections: 0,
      messagesPerSecond: 0,
      averageLatency: 0,
      errorRate: this.stats.errors / Math.max(this.stats.processed, 1),
      uptime: process.uptime() * 1000
    };
  }

  // Create standardized error response
  private createErrorResponse(message: BaseMessage, errorCode: string, details?: string): ErrorMessage {
    return {
      type: MESSAGE_TYPES.ERROR,
      requestId: message.requestId,
      timestamp: Date.now(),
      code: ERROR_CODES.INVALID_MESSAGE,
      message: details || `System operation failed: ${errorCode}`,
      details: { messageType: message.type }
    };
  }

  // Get processor statistics
  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats.processed = 0;
    this.stats.errors = 0;
    this.stats.heartbeats = 0;
    this.stats.pings = 0;
  }
}