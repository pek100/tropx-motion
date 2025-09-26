import { BaseMessage } from '../types/Interfaces';

export interface UnreliableTransportConfig {
  enableRateLimiting: boolean;
  messagesPerSecond: number;
  dropOldMessages: boolean;
  maxQueueSize: number;
}

export interface UnreliableStats {
  messagesSent: number;
  messagesDropped: number;
  messagesQueued: number;
  rateLimitHits: number;
}

const DEFAULT_CONFIG: UnreliableTransportConfig = {
  enableRateLimiting: false,
  messagesPerSecond: 1000,
  dropOldMessages: true,
  maxQueueSize: 100,
} as const;

interface QueuedMessage {
  message: BaseMessage;
  clientId: string;
  timestamp: number;
}

export class UnreliableTransport {
  private config: UnreliableTransportConfig;
  private stats: UnreliableStats;
  private messageQueue: QueuedMessage[] = [];
  private rateLimitWindow = new Map<string, number[]>(); // clientId -> timestamps
  private sendFunction: ((message: BaseMessage, clientId: string) => Promise<boolean>) | null = null;
  private processingTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<UnreliableTransportConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.stats = {
      messagesSent: 0,
      messagesDropped: 0,
      messagesQueued: 0,
      rateLimitHits: 0,
    };

    this.startProcessing();
  }

  // Set send function (connection to WebSocket server)
  setSendFunction(sendFn: (message: BaseMessage, clientId: string) => Promise<boolean>): void {
    this.sendFunction = sendFn;
  }

  // Send message without delivery guarantee (fire-and-forget)
  async sendUnreliable(message: BaseMessage, clientId: string): Promise<void> {
    if (!this.sendFunction) {
      throw new Error('Send function not configured');
    }

    const now = Date.now();
    const messageWithTimestamp: BaseMessage = {
      ...message,
      timestamp: now,
    };

    // Check rate limiting
    if (this.config.enableRateLimiting && this.isRateLimited(clientId)) {
      this.stats.rateLimitHits++;
      return; // Drop message due to rate limiting
    }

    // Direct send for immediate delivery
    try {
      const success = await this.sendFunction(messageWithTimestamp, clientId);
      if (success) {
        this.stats.messagesSent++;
        this.updateRateLimit(clientId, now);
      } else {
        // Queue message for retry if send failed
        this.queueMessage(messageWithTimestamp, clientId, now);
      }
    } catch (error) {
      // Queue message for retry on error
      this.queueMessage(messageWithTimestamp, clientId, now);
    }
  }

  // Broadcast message to multiple clients
  async broadcastUnreliable(message: BaseMessage, clientIds: string[]): Promise<void> {
    const promises = clientIds.map(clientId => this.sendUnreliable(message, clientId));
    await Promise.allSettled(promises); // Don't wait for all to complete
  }

  // Get transport statistics
  getStats(): UnreliableStats {
    return {
      ...this.stats,
      messagesQueued: this.messageQueue.length,
    };
  }

  // Get configuration
  getConfig(): UnreliableTransportConfig {
    return { ...this.config };
  }

  // Update configuration
  updateConfig(config: Partial<UnreliableTransportConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      messagesSent: 0,
      messagesDropped: 0,
      messagesQueued: 0,
      rateLimitHits: 0,
    };
  }

  // Clear message queue
  clearQueue(): void {
    this.stats.messagesDropped += this.messageQueue.length;
    this.messageQueue = [];
  }

  // Get queue size for specific client
  getQueueSize(clientId?: string): number {
    if (clientId) {
      return this.messageQueue.filter(msg => msg.clientId === clientId).length;
    }
    return this.messageQueue.length;
  }

  // Stop transport and cleanup
  stop(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }

    this.clearQueue();
    this.rateLimitWindow.clear();
  }

  // Queue message for retry
  private queueMessage(message: BaseMessage, clientId: string, timestamp: number): void {
    // Drop old messages if queue is full
    if (this.messageQueue.length >= this.config.maxQueueSize) {
      if (this.config.dropOldMessages) {
        const dropped = this.messageQueue.shift();
        this.stats.messagesDropped++;
        console.warn(`Dropped old message for client: ${dropped?.clientId}`);
      } else {
        this.stats.messagesDropped++;
        return; // Drop current message instead
      }
    }

    this.messageQueue.push({
      message,
      clientId,
      timestamp,
    });
  }

  // Check if client is rate limited
  private isRateLimited(clientId: string): boolean {
    if (!this.config.enableRateLimiting) return false;

    const now = Date.now();
    const windowStart = now - 1000; // 1 second window
    const timestamps = this.rateLimitWindow.get(clientId) || [];

    // Count messages in current window
    const recentMessages = timestamps.filter(ts => ts > windowStart);
    return recentMessages.length >= this.config.messagesPerSecond;
  }

  // Update rate limit tracking
  private updateRateLimit(clientId: string, timestamp: number): void {
    if (!this.config.enableRateLimiting) return;

    let timestamps = this.rateLimitWindow.get(clientId) || [];
    timestamps.push(timestamp);

    // Keep only last second of timestamps
    const windowStart = timestamp - 1000;
    timestamps = timestamps.filter(ts => ts > windowStart);

    this.rateLimitWindow.set(clientId, timestamps);
  }

  // Start background processing of queued messages
  private startProcessing(): void {
    this.processingTimer = setInterval(async () => {
      await this.processQueue();
    }, 10); // Process every 10ms for high throughput
  }

  // Process queued messages
  private async processQueue(): Promise<void> {
    if (!this.sendFunction || this.messageQueue.length === 0) return;

    const batch = this.messageQueue.splice(0, Math.min(10, this.messageQueue.length)); // Process 10 at a time
    const now = Date.now();

    const sendPromises = batch.map(async (queued) => {
      // Check if message is too old (older than 1 second)
      if (now - queued.timestamp > 1000) {
        this.stats.messagesDropped++;
        return;
      }

      // Check rate limiting
      if (this.config.enableRateLimiting && this.isRateLimited(queued.clientId)) {
        this.stats.rateLimitHits++;
        // Re-queue the message
        this.queueMessage(queued.message, queued.clientId, queued.timestamp);
        return;
      }

      try {
        const success = await this.sendFunction!(queued.message, queued.clientId);
        if (success) {
          this.stats.messagesSent++;
          this.updateRateLimit(queued.clientId, now);
        } else {
          // Re-queue if send failed and message is not too old
          if (now - queued.timestamp < 500) { // Re-queue only if less than 500ms old
            this.queueMessage(queued.message, queued.clientId, queued.timestamp);
          } else {
            this.stats.messagesDropped++;
          }
        }
      } catch (error) {
        // Re-queue on error if message is not too old
        if (now - queued.timestamp < 500) {
          this.queueMessage(queued.message, queued.clientId, queued.timestamp);
        } else {
          this.stats.messagesDropped++;
        }
      }
    });

    await Promise.allSettled(sendPromises);
  }

  // Cleanup rate limit tracking periodically
  performCleanup(): void {
    const now = Date.now();
    const windowStart = now - 5000; // Keep 5 seconds of history

    this.rateLimitWindow.forEach((timestamps, clientId) => {
      const recentTimestamps = timestamps.filter(ts => ts > windowStart);
      if (recentTimestamps.length === 0) {
        this.rateLimitWindow.delete(clientId);
      } else {
        this.rateLimitWindow.set(clientId, recentTimestamps);
      }
    });

    // Drop very old queued messages
    const expiredThreshold = now - 2000; // 2 seconds
    const originalLength = this.messageQueue.length;
    this.messageQueue = this.messageQueue.filter(msg => msg.timestamp > expiredThreshold);

    const dropped = originalLength - this.messageQueue.length;
    if (dropped > 0) {
      this.stats.messagesDropped += dropped;
      console.warn(`Dropped ${dropped} expired queued messages`);
    }
  }
}