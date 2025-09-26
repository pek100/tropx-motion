import { BaseMessage, MessageHandler, HeartbeatMessage, StatusMessage, ErrorMessage, DeviceInfo } from '../types/Interfaces';
import { MESSAGE_TYPES, ERROR_CODES, MessageType, ErrorCode } from '../types/MessageTypes';

// System service interface (will be injected)
export interface SystemService {
  getSystemStatus(): {
    isRecording: boolean;
    connectedDevices: DeviceInfo[];
    wsPort: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage?: number;
  };
  getPerformanceMetrics(): {
    wsConnections: number;
    messagesPerSecond: number;
    errorRate: number;
    averageLatency: number;
  };
  performSystemCleanup(): Promise<{ cleaned: number; errors: number }>;
  restartServices(): Promise<{ success: boolean; message: string }>;
}

interface SystemHandlerStats {
  heartbeats: number;
  statusRequests: number;
  errors: number;
  cleanupOperations: number;
  restartOperations: number;
  uptime: number;
}

export class SystemHandler {
  private systemService: SystemService | null = null;
  private stats: SystemHandlerStats;
  private startTime: number;

  // Automatic heartbeat
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatInterval: number = 30000; // 30 seconds
  private broadcastFunction: ((message: BaseMessage, clientIds: string[]) => Promise<void>) | null = null;
  private connectedClients: string[] = [];

  constructor() {
    this.startTime = Date.now();
    this.stats = {
      heartbeats: 0,
      statusRequests: 0,
      errors: 0,
      cleanupOperations: 0,
      restartOperations: 0,
      uptime: 0,
    };

    this.startAutomaticHeartbeat();
  }

  // Inject system service dependency
  setSystemService(service: SystemService): void {
    this.systemService = service;
  }

  // Set broadcast function for system messages
  setBroadcastFunction(broadcastFn: (message: BaseMessage, clientIds: string[]) => Promise<void>): void {
    this.broadcastFunction = broadcastFn;
  }

  // Update connected clients list
  setConnectedClients(clientIds: string[]): void {
    this.connectedClients = [...clientIds];
  }

  // Get message handlers for registration
  getHandlers(): Array<{ type: MessageType; handler: MessageHandler }> {
    return [
      { type: MESSAGE_TYPES.HEARTBEAT, handler: this.handleHeartbeat.bind(this) },
      { type: MESSAGE_TYPES.STATUS, handler: this.handleStatusRequest.bind(this) },
    ];
  }

  // Handle heartbeat request
  private async handleHeartbeat(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    console.log(`💓 SystemHandler.handleHeartbeat called for client ${clientId}, requestId: ${message.requestId}`);

    this.stats.heartbeats++;
    this.stats.uptime = Date.now() - this.startTime;

    const response: HeartbeatMessage = {
      type: MESSAGE_TYPES.HEARTBEAT,
      requestId: message.requestId,
      timestamp: Date.now(),
    };

    console.log(`💓 SystemHandler sending heartbeat response:`, response);
    return response;
  }

  // Handle status request
  private async handleStatusRequest(message: BaseMessage, clientId: string): Promise<BaseMessage> {
    this.stats.statusRequests++;

    if (!this.systemService) {
      return this.createErrorResponse(
        ERROR_CODES.INVALID_MESSAGE,
        'System service not available',
        message.requestId
      );
    }

    try {
      const systemStatus = this.systemService.getSystemStatus();
      const performanceMetrics = this.systemService.getPerformanceMetrics();

      const response: StatusMessage = {
        type: MESSAGE_TYPES.STATUS,
        requestId: message.requestId,
        timestamp: Date.now(),
        isRecording: systemStatus.isRecording,
        connectedDevices: systemStatus.connectedDevices,
        wsPort: systemStatus.wsPort,
      };

      return response;

    } catch (error) {
      this.stats.errors++;
      return this.createErrorResponse(
        ERROR_CODES.INVALID_MESSAGE,
        `Status request failed: ${error instanceof Error ? error.message : String(error)}`,
        message.requestId
      );
    }
  }

  // Get comprehensive system status
  getComprehensiveStatus(): {
    system: any;
    performance: any;
    handler: SystemHandlerStats;
  } {
    const systemStatus = this.systemService?.getSystemStatus();
    const performanceMetrics = this.systemService?.getPerformanceMetrics();

    return {
      system: systemStatus || { error: 'System service not available' },
      performance: performanceMetrics || { error: 'Performance metrics not available' },
      handler: {
        ...this.stats,
        uptime: Date.now() - this.startTime,
      },
    };
  }

  // Perform system cleanup
  async performCleanup(): Promise<{ success: boolean; details: any }> {
    if (!this.systemService) {
      return {
        success: false,
        details: { error: 'System service not available' },
      };
    }

    try {
      this.stats.cleanupOperations++;
      const result = await this.systemService.performSystemCleanup();

      // Broadcast cleanup notification to all clients
      if (this.broadcastFunction && this.connectedClients.length > 0) {
        const notification: BaseMessage = {
          type: MESSAGE_TYPES.STATUS,
          timestamp: Date.now(),
        };

        await this.broadcastFunction(notification, this.connectedClients);
      }

      return {
        success: true,
        details: result,
      };

    } catch (error) {
      this.stats.errors++;
      return {
        success: false,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  // Restart system services
  async restartServices(): Promise<{ success: boolean; message: string }> {
    if (!this.systemService) {
      return {
        success: false,
        message: 'System service not available',
      };
    }

    try {
      this.stats.restartOperations++;

      // Notify all clients of impending restart
      if (this.broadcastFunction && this.connectedClients.length > 0) {
        const notification: ErrorMessage = {
          type: MESSAGE_TYPES.ERROR,
          timestamp: Date.now(),
          code: ERROR_CODES.INVALID_MESSAGE, // Using as a general notification code
          message: 'System restart in progress',
        };

        await this.broadcastFunction(notification, this.connectedClients);
      }

      const result = await this.systemService.restartServices();
      return result;

    } catch (error) {
      this.stats.errors++;
      return {
        success: false,
        message: `Restart failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Send emergency broadcast to all clients
  async sendEmergencyBroadcast(message: string, code: ErrorCode = ERROR_CODES.INVALID_MESSAGE): Promise<void> {
    if (!this.broadcastFunction || this.connectedClients.length === 0) return;

    const emergencyMessage: ErrorMessage = {
      type: MESSAGE_TYPES.ERROR,
      timestamp: Date.now(),
      code,
      message,
    };

    try {
      await this.broadcastFunction(emergencyMessage, this.connectedClients);
    } catch (error) {
      console.error('Failed to send emergency broadcast:', error);
    }
  }

  // Get handler statistics
  getStats(): SystemHandlerStats {
    return {
      ...this.stats,
      uptime: Date.now() - this.startTime,
    };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      heartbeats: 0,
      statusRequests: 0,
      errors: 0,
      cleanupOperations: 0,
      restartOperations: 0,
      uptime: 0,
    };
    this.startTime = Date.now();
  }

  // Get system health assessment
  getHealthAssessment(): {
    status: 'healthy' | 'warning' | 'critical';
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (!this.systemService) {
      issues.push('System service not available');
      recommendations.push('Restart system service');
    } else {
      try {
        const performanceMetrics = this.systemService.getPerformanceMetrics();
        const systemStatus = this.systemService.getSystemStatus();

        // Check performance metrics
        if (performanceMetrics.errorRate > 0.1) {
          issues.push(`High error rate: ${(performanceMetrics.errorRate * 100).toFixed(1)}%`);
          recommendations.push('Check system logs and restart services if needed');
        }

        if (performanceMetrics.averageLatency > 1000) {
          issues.push(`High latency: ${performanceMetrics.averageLatency.toFixed(0)}ms`);
          recommendations.push('Perform system cleanup or increase resources');
        }

        // Check memory usage
        if (systemStatus.memoryUsage) {
          const memoryUsageMB = systemStatus.memoryUsage.heapUsed / 1024 / 1024;
          if (memoryUsageMB > 500) {
            issues.push(`High memory usage: ${memoryUsageMB.toFixed(0)}MB`);
            recommendations.push('Perform cleanup or restart services');
          }
        }

        // Check connection health
        if (performanceMetrics.wsConnections === 0) {
          issues.push('No WebSocket connections');
          recommendations.push('Check client connectivity');
        }

      } catch (error) {
        issues.push('Failed to assess system health');
        recommendations.push('Check system service status');
      }
    }

    // Determine overall status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    if (issues.length > 2) {
      status = 'critical';
    } else if (issues.length > 0) {
      status = 'warning';
    }

    return { status, issues, recommendations };
  }

  // Configure heartbeat interval
  setHeartbeatInterval(intervalMs: number): void {
    if (intervalMs < 1000 || intervalMs > 300000) {
      throw new Error('Heartbeat interval must be between 1s and 5m');
    }

    this.heartbeatInterval = intervalMs;

    // Restart heartbeat timer with new interval
    this.stopAutomaticHeartbeat();
    this.startAutomaticHeartbeat();
  }

  // Cleanup resources
  cleanup(): void {
    this.stopAutomaticHeartbeat();
    this.connectedClients = [];
  }

  // Start automatic heartbeat broadcasting
  private startAutomaticHeartbeat(): void {
    this.heartbeatTimer = setInterval(async () => {
      await this.broadcastHeartbeat();
    }, this.heartbeatInterval);
  }

  // Stop automatic heartbeat
  private stopAutomaticHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Broadcast heartbeat to all connected clients
  private async broadcastHeartbeat(): Promise<void> {
    if (!this.broadcastFunction || this.connectedClients.length === 0) return;

    const heartbeat: HeartbeatMessage = {
      type: MESSAGE_TYPES.HEARTBEAT,
      timestamp: Date.now(),
    };

    try {
      await this.broadcastFunction(heartbeat, this.connectedClients);
      this.stats.heartbeats++;
    } catch (error) {
      this.stats.errors++;
      console.error('Failed to broadcast heartbeat:', error);
    }
  }

  // Create standardized error response
  private createErrorResponse(code: ErrorCode, message: string, requestId?: number): ErrorMessage {
    this.stats.errors++;
    return {
      type: MESSAGE_TYPES.ERROR,
      requestId,
      timestamp: Date.now(),
      code,
      message,
    };
  }

  // Handle system shutdown
  async handleShutdown(): Promise<void> {
    // Send shutdown notification to all clients
    await this.sendEmergencyBroadcast('System shutting down', ERROR_CODES.INVALID_MESSAGE);

    // Cleanup resources
    this.cleanup();
  }
}