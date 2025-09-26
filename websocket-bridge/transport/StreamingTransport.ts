import { BaseMessage } from '../types/Interfaces';
import { MessageType, DELIVERY_MODES, DeliveryMode } from '../types/MessageTypes';
import { ReliableTransport, ReliableTransportConfig } from './ReliableTransport';
import { UnreliableTransport, UnreliableTransportConfig } from './UnreliableTransport';

export interface StreamingConfig {
  defaultMode: DeliveryMode;
  messageTypeOverrides: Map<MessageType, DeliveryMode>;
  enableAdaptiveMode: boolean;
  performanceThresholds: {
    maxLatency: number;
    maxErrorRate: number;
    switchToUnreliableDelay: number;
  };
}

export interface StreamingStats {
  reliable: {
    sent: number;
    acked: number;
    timeout: number;
    retries: number;
  };
  unreliable: {
    sent: number;
    dropped: number;
    queued: number;
  };
  adaptive: {
    switches: number;
    currentMode: DeliveryMode;
    lastSwitch: number;
  };
}

const DEFAULT_CONFIG: StreamingConfig = {
  defaultMode: DELIVERY_MODES.FIRE_AND_FORGET,
  messageTypeOverrides: new Map(),
  enableAdaptiveMode: false,
  performanceThresholds: {
    maxLatency: 100,
    maxErrorRate: 0.05,
    switchToUnreliableDelay: 5000,
  },
} as const;

export class StreamingTransport {
  private reliableTransport: ReliableTransport;
  private unreliableTransport: UnreliableTransport;
  private config: StreamingConfig;
  private stats: StreamingStats;

  private adaptiveMode: DeliveryMode;
  private lastPerformanceCheck: number = 0;
  private performanceCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    config: Partial<StreamingConfig> = {},
    reliableConfig: Partial<ReliableTransportConfig> = {},
    unreliableConfig: Partial<UnreliableTransportConfig> = {}
  ) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      messageTypeOverrides: new Map([
        ...DEFAULT_CONFIG.messageTypeOverrides,
        ...(config.messageTypeOverrides || []),
      ]),
    };

    this.adaptiveMode = this.config.defaultMode;
    this.reliableTransport = new ReliableTransport(reliableConfig);
    this.unreliableTransport = new UnreliableTransport(unreliableConfig);

    this.stats = {
      reliable: { sent: 0, acked: 0, timeout: 0, retries: 0 },
      unreliable: { sent: 0, dropped: 0, queued: 0 },
      adaptive: {
        switches: 0,
        currentMode: this.adaptiveMode,
        lastSwitch: Date.now(),
      },
    };

    if (this.config.enableAdaptiveMode) {
      this.startAdaptiveMonitoring();
    }
  }

  // Set send function for both transports
  setSendFunction(sendFn: (message: BaseMessage, clientId: string) => Promise<boolean>): void {
    this.reliableTransport.setSendFunction(sendFn);
    this.unreliableTransport.setSendFunction(sendFn);
  }

  // Send message using configured delivery mode
  async send(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    const deliveryMode = this.getDeliveryMode(message.type);

    if (deliveryMode === DELIVERY_MODES.RELIABLE) {
      try {
        const response = await this.reliableTransport.sendReliable(message, clientId);
        this.updateReliableStats();
        return response;
      } catch (error) {
        this.updateReliableStats(true);
        throw error;
      }
    } else {
      await this.unreliableTransport.sendUnreliable(message, clientId);
      this.updateUnreliableStats();
    }
  }

  // Broadcast message to multiple clients
  async broadcast(message: BaseMessage, clientIds: string[]): Promise<void> {
    const deliveryMode = this.getDeliveryMode(message.type);

    if (deliveryMode === DELIVERY_MODES.RELIABLE) {
      const promises = clientIds.map(async (clientId) => {
        try {
          await this.reliableTransport.sendReliable(message, clientId);
          this.updateReliableStats();
        } catch (error) {
          this.updateReliableStats(true);
          throw error;
        }
      });

      await Promise.allSettled(promises);
    } else {
      await this.unreliableTransport.broadcastUnreliable(message, clientIds);
      this.updateUnreliableStats();
    }
  }

  // Handle incoming response (for reliable transport)
  handleResponse(message: BaseMessage, clientId: string): boolean {
    return this.reliableTransport.handleResponse(message, clientId);
  }

  // Handle client disconnection
  handleDisconnection(clientId: string): void {
    this.reliableTransport.handleDisconnection(clientId);
    // Unreliable transport doesn't need explicit disconnection handling
  }

  // Get delivery mode for message type
  getDeliveryMode(messageType: MessageType): DeliveryMode {
    // Check for message-specific override
    const override = this.config.messageTypeOverrides.get(messageType);
    if (override) return override;

    // Use adaptive mode if enabled
    if (this.config.enableAdaptiveMode) {
      return this.adaptiveMode;
    }

    // Use default mode
    return this.config.defaultMode;
  }

  // Set delivery mode for specific message type
  setMessageTypeMode(messageType: MessageType, mode: DeliveryMode): void {
    this.config.messageTypeOverrides.set(messageType, mode);
  }

  // Remove message type override
  removeMessageTypeMode(messageType: MessageType): boolean {
    return this.config.messageTypeOverrides.delete(messageType);
  }

  // Get streaming statistics
  getStats(): StreamingStats {
    const reliableStats = this.reliableTransport.getStats();
    const unreliableStats = this.unreliableTransport.getStats();

    return {
      reliable: {
        sent: reliableStats.messagesSent,
        acked: reliableStats.messagesAcked,
        timeout: reliableStats.messagesTimeout,
        retries: reliableStats.retries,
      },
      unreliable: {
        sent: unreliableStats.messagesSent,
        dropped: unreliableStats.messagesDropped,
        queued: unreliableStats.messagesQueued,
      },
      adaptive: this.stats.adaptive,
    };
  }

  // Reset all statistics
  resetStats(): void {
    this.reliableTransport.resetStats();
    this.unreliableTransport.resetStats();
    this.stats = {
      reliable: { sent: 0, acked: 0, timeout: 0, retries: 0 },
      unreliable: { sent: 0, dropped: 0, queued: 0 },
      adaptive: {
        switches: 0,
        currentMode: this.adaptiveMode,
        lastSwitch: Date.now(),
      },
    };
  }

  // Get configuration
  getConfig(): StreamingConfig {
    return {
      ...this.config,
      messageTypeOverrides: new Map(this.config.messageTypeOverrides),
    };
  }

  // Update configuration
  updateConfig(config: Partial<StreamingConfig>): void {
    const oldAdaptiveMode = this.config.enableAdaptiveMode;

    this.config = {
      ...this.config,
      ...config,
      messageTypeOverrides: new Map([
        ...this.config.messageTypeOverrides,
        ...(config.messageTypeOverrides || []),
      ]),
    };

    // Handle adaptive mode changes
    if (config.enableAdaptiveMode !== undefined) {
      if (config.enableAdaptiveMode && !oldAdaptiveMode) {
        this.startAdaptiveMonitoring();
      } else if (!config.enableAdaptiveMode && oldAdaptiveMode) {
        this.stopAdaptiveMonitoring();
      }
    }
  }

  // Perform periodic cleanup
  performCleanup(): void {
    this.reliableTransport.performCleanup();
    this.unreliableTransport.performCleanup();
  }

  // Stop transport and cleanup
  stop(): void {
    this.stopAdaptiveMonitoring();
    this.unreliableTransport.stop();
    // ReliableTransport doesn't need explicit stop
  }

  // Force switch adaptive mode
  switchAdaptiveMode(mode: DeliveryMode): void {
    if (!this.config.enableAdaptiveMode) return;

    if (this.adaptiveMode !== mode) {
      this.adaptiveMode = mode;
      this.stats.adaptive.switches++;
      this.stats.adaptive.currentMode = mode;
      this.stats.adaptive.lastSwitch = Date.now();

      console.log(`Adaptive mode switched to: ${mode}`);
    }
  }

  // Check if transport is performing well
  isPerformingWell(): boolean {
    const stats = this.getStats();
    const thresholds = this.config.performanceThresholds;

    // Check error rate for reliable transport
    const reliableErrorRate = stats.reliable.sent > 0
      ? stats.reliable.timeout / stats.reliable.sent
      : 0;

    if (reliableErrorRate > thresholds.maxErrorRate) return false;

    // Check if too many messages are being dropped in unreliable
    const unreliableDropRate = stats.unreliable.sent > 0
      ? stats.unreliable.dropped / stats.unreliable.sent
      : 0;

    if (unreliableDropRate > thresholds.maxErrorRate * 2) return false; // Allow 2x error rate for unreliable

    return true;
  }

  // Start adaptive performance monitoring
  private startAdaptiveMonitoring(): void {
    this.performanceCheckInterval = setInterval(() => {
      this.checkAdaptivePerformance();
    }, 1000); // Check every second
  }

  // Stop adaptive performance monitoring
  private stopAdaptiveMonitoring(): void {
    if (this.performanceCheckInterval) {
      clearInterval(this.performanceCheckInterval);
      this.performanceCheckInterval = null;
    }
  }

  // Check performance and adapt delivery mode
  private checkAdaptivePerformance(): void {
    const now = Date.now();
    const timeSinceLastSwitch = now - this.stats.adaptive.lastSwitch;

    // Don't switch too frequently
    if (timeSinceLastSwitch < this.config.performanceThresholds.switchToUnreliableDelay) {
      return;
    }

    const stats = this.getStats();
    const thresholds = this.config.performanceThresholds;

    if (this.adaptiveMode === DELIVERY_MODES.RELIABLE) {
      // Check if we should switch to unreliable for better performance
      const errorRate = stats.reliable.sent > 0 ? stats.reliable.timeout / stats.reliable.sent : 0;
      const avgLatency = this.estimateLatency();

      if (errorRate > thresholds.maxErrorRate || avgLatency > thresholds.maxLatency) {
        this.switchAdaptiveMode(DELIVERY_MODES.FIRE_AND_FORGET);
      }

    } else {
      // Check if we should switch back to reliable
      const dropRate = stats.unreliable.sent > 0 ? stats.unreliable.dropped / stats.unreliable.sent : 0;

      // Switch back to reliable if unreliable is dropping too many messages
      // and we haven't tried reliable recently
      if (dropRate > thresholds.maxErrorRate * 3 && timeSinceLastSwitch > thresholds.switchToUnreliableDelay * 2) {
        this.switchAdaptiveMode(DELIVERY_MODES.RELIABLE);
      }
    }
  }

  // Estimate current latency (simple implementation)
  private estimateLatency(): number {
    // This is a simplified estimation - in real implementation,
    // you might track actual request/response times
    const stats = this.getStats();

    // Higher retry count suggests higher latency
    const baseLatency = 50; // Base latency in ms
    const retryPenalty = stats.reliable.retries * 100; // 100ms penalty per retry

    return baseLatency + retryPenalty;
  }

  // Update reliable transport stats
  private updateReliableStats(isError: boolean = false): void {
    if (isError) {
      this.stats.reliable.timeout++;
    } else {
      this.stats.reliable.acked++;
    }
  }

  // Update unreliable transport stats
  private updateUnreliableStats(): void {
    this.stats.unreliable.sent++;
  }
}