import { BaseMessage } from '../types/Interfaces';
import { MESSAGE_TYPES } from '../types/MessageTypes';
import { DomainProcessor, MESSAGE_DOMAINS, MessageDomain } from '../core/UnifiedMessageRouter';

// Streaming performance constants (WebRTC-style)
const STREAMING_CONFIG = {
  MAX_QUEUE_SIZE: 100,
  OVERLOAD_THRESHOLD: 1000, // msgs/sec
  SAMPLE_WINDOW_MS: 1000,
  DROP_PERCENTAGE_ON_OVERLOAD: 50,
  OVERLOAD_NOTIFICATION_INTERVAL: 5000
} as const;

// Overload notification interface
interface OverloadNotifier {
  notifyOverload(stats: StreamingStats): void;
}

// Streaming statistics
interface StreamingStats {
  processed: number;
  dropped: number;
  overloadEvents: number;
  currentThroughput: number;
  avgThroughput: number;
  queueSize: number;
}

// Message queue entry
interface QueuedMessage {
  message: BaseMessage;
  clientId: string;
  timestamp: number;
}

export class StreamingDomainProcessor implements DomainProcessor {
  private messageQueue: QueuedMessage[] = [];
  private stats: StreamingStats = {
    processed: 0,
    dropped: 0,
    overloadEvents: 0,
    currentThroughput: 0,
    avgThroughput: 0,
    queueSize: 0
  };

  private throughputSamples: number[] = [];
  private lastThroughputCheck = Date.now();
  private lastOverloadNotification = 0;
  private overloadNotifier: OverloadNotifier | null = null;
  private isProcessing = false;
  private broadcastFunction: ((message: BaseMessage) => Promise<void>) | null = null;

  constructor() {
    this.startThroughputMonitoring();
  }

  // Set broadcast function to forward messages to all clients
  setBroadcastFunction(fn: (message: BaseMessage) => Promise<void>): void {
    this.broadcastFunction = fn;
  }

  getDomain(): MessageDomain {
    return MESSAGE_DOMAINS.STREAMING;
  }

  // Set overload notifier for UI alerts
  setOverloadNotifier(notifier: OverloadNotifier): void {
    this.overloadNotifier = notifier;
  }

  // Process streaming message with WebRTC-style handling
  async process(message: BaseMessage, clientId: string): Promise<BaseMessage | void> {
    // Check for overload condition
    if (this.isOverloaded()) {
      return this.handleOverload(message, clientId);
    }

    // Add to queue for async processing
    this.enqueueMessage(message, clientId);

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }

    // Fire-and-forget - no response for streaming messages
    return undefined;
  }

  // Add message to processing queue
  private enqueueMessage(message: BaseMessage, clientId: string): void {
    // Drop oldest messages if queue is full (WebRTC-style)
    if (this.messageQueue.length >= STREAMING_CONFIG.MAX_QUEUE_SIZE) {
      this.messageQueue.shift();
      this.stats.dropped++;
    }

    this.messageQueue.push({
      message,
      clientId,
      timestamp: Date.now()
    });

    this.stats.queueSize = this.messageQueue.length;
  }

  // Process queued messages asynchronously
  private async processQueue(): Promise<void> {
    this.isProcessing = true;

    while (this.messageQueue.length > 0) {
      const item = this.messageQueue.shift();
      if (!item) break;

      try {
        await this.processStreamingMessage(item.message, item.clientId);
        this.stats.processed++;
      } catch (error) {
        console.error('Streaming message processing error:', error);
      }

      this.stats.queueSize = this.messageQueue.length;

      // Yield control to prevent blocking
      if (this.messageQueue.length > 0) {
        await this.yieldControl();
      }
    }

    this.isProcessing = false;
  }

  // Process individual streaming message
  private async processStreamingMessage(message: BaseMessage, clientId: string): Promise<void> {
    switch (message.type) {
      case MESSAGE_TYPES.MOTION_DATA:
        await this.handleMotionData(message, clientId);
        break;

      case MESSAGE_TYPES.DEVICE_STATUS:
        await this.handleDeviceStatus(message, clientId);
        break;

      case MESSAGE_TYPES.BATTERY_UPDATE:
        await this.handleBatteryUpdate(message, clientId);
        break;

      default:
        console.warn(`Unknown streaming message type: ${message.type}`);
    }
  }

  // Handle motion data streaming
  private async handleMotionData(message: BaseMessage, clientId: string): Promise<void> {
    // Broadcast motion data to all connected clients
    if (this.broadcastFunction) {
      try {
        await this.broadcastFunction(message);
        console.log(`📊 Motion data broadcast to all clients`);
      } catch (error) {
        console.error('Failed to broadcast motion data:', error);
      }
    } else {
      console.warn('⚠️ No broadcast function set for StreamingDomainProcessor');
    }
  }

  // Handle device status updates
  private async handleDeviceStatus(message: BaseMessage, clientId: string): Promise<void> {
    // Broadcast device status to all connected clients
    if (this.broadcastFunction) {
      try {
        await this.broadcastFunction(message);
        console.log(`📱 Device status broadcast to all clients`);
      } catch (error) {
        console.error('Failed to broadcast device status:', error);
      }
    }
  }

  // Handle battery updates
  private async handleBatteryUpdate(message: BaseMessage, clientId: string): Promise<void> {
    // Broadcast battery update to all connected clients
    if (this.broadcastFunction) {
      try {
        await this.broadcastFunction(message);
        console.log(`🔋 Battery update broadcast to all clients`);
      } catch (error) {
        console.error('Failed to broadcast battery update:', error);
      }
    }
  }

  // Check if system is overloaded
  private isOverloaded(): boolean {
    return this.stats.currentThroughput > STREAMING_CONFIG.OVERLOAD_THRESHOLD ||
           this.messageQueue.length >= STREAMING_CONFIG.MAX_QUEUE_SIZE;
  }

  // Handle overload condition (WebRTC-style)
  private handleOverload(message: BaseMessage, clientId: string): BaseMessage | void {
    this.stats.overloadEvents++;

    // Drop message probabilistically
    if (Math.random() < (STREAMING_CONFIG.DROP_PERCENTAGE_ON_OVERLOAD / 100)) {
      this.stats.dropped++;
      this.logOverload();
      this.notifyOverloadIfNeeded();
      return undefined;
    }

    // Process critically important messages even during overload
    if (this.isCriticalMessage(message)) {
      this.enqueueMessage(message, clientId);
      return undefined;
    }

    // Drop non-critical messages
    this.stats.dropped++;
    return undefined;
  }

  // Check if message is critical during overload
  private isCriticalMessage(message: BaseMessage): boolean {
    // Device status and battery updates are more critical than motion data
    return message.type === MESSAGE_TYPES.DEVICE_STATUS ||
           message.type === MESSAGE_TYPES.BATTERY_UPDATE;
  }

  // Log overload condition
  private logOverload(): void {
    console.warn(`🚨 Streaming overload detected:`, {
      throughput: this.stats.currentThroughput,
      queueSize: this.stats.queueSize,
      dropRate: (this.stats.dropped / (this.stats.processed + this.stats.dropped) * 100).toFixed(2) + '%'
    });
  }

  // Notify UI about overload condition
  private notifyOverloadIfNeeded(): void {
    const now = Date.now();

    if (now - this.lastOverloadNotification > STREAMING_CONFIG.OVERLOAD_NOTIFICATION_INTERVAL) {
      this.lastOverloadNotification = now;

      if (this.overloadNotifier) {
        this.overloadNotifier.notifyOverload(this.getStats());
      }
    }
  }

  // Start throughput monitoring
  private startThroughputMonitoring(): void {
    setInterval(() => {
      this.updateThroughputStats();
    }, STREAMING_CONFIG.SAMPLE_WINDOW_MS);
  }

  // Update throughput statistics
  private updateThroughputStats(): void {
    const now = Date.now();
    const elapsed = now - this.lastThroughputCheck;

    if (elapsed >= STREAMING_CONFIG.SAMPLE_WINDOW_MS) {
      this.stats.currentThroughput = (this.stats.processed * 1000) / elapsed;

      // Keep rolling average
      this.throughputSamples.push(this.stats.currentThroughput);
      if (this.throughputSamples.length > 10) {
        this.throughputSamples.shift();
      }

      this.stats.avgThroughput = this.throughputSamples.reduce((a, b) => a + b, 0) / this.throughputSamples.length;

      // Reset counters for next sample
      this.stats.processed = 0;
      this.lastThroughputCheck = now;
    }
  }

  // Yield control to event loop (non-blocking)
  private yieldControl(): Promise<void> {
    return new Promise(resolve => setImmediate(resolve));
  }

  // Get streaming statistics
  getStats(): StreamingStats {
    return { ...this.stats };
  }

  // Reset statistics
  resetStats(): void {
    this.stats = {
      processed: 0,
      dropped: 0,
      overloadEvents: 0,
      currentThroughput: 0,
      avgThroughput: 0,
      queueSize: 0
    };
    this.throughputSamples = [];
  }
}