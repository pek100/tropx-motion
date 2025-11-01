import { MotionDataUpdate } from '../../shared/types';
import { MESSAGE_TYPES } from '../../shared/config';

interface BatchedMessage {
  type: string;
  data: unknown;
  timestamp: number;
}

export class StreamBatcher {
  private motionDataQueue: MotionDataUpdate[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private subscribers = new Set<(messages: BatchedMessage[]) => void>();

  constructor(
    private readonly batchInterval = 16, // ~60fps batching
    private readonly maxBatchSize = 10
  ) {}

  // Add motion data to batch queue
  addMotionData(data: MotionDataUpdate): void {
    this.motionDataQueue.push(data);
    
    // Force flush if batch is full
    if (this.motionDataQueue.length >= this.maxBatchSize) {
      this.flushBatch();
      return;
    }

    // Schedule batch flush if not already scheduled
    if (!this.batchTimer) {
      this.scheduleBatchFlush();
    }
  }

  // Subscribe to batched messages
  subscribe(callback: (messages: BatchedMessage[]) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Force flush current batch
  flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const now = Date.now();
    const messages: BatchedMessage[] = [];

    // Batch motion data - send only the latest data to prevent flooding
    if (this.motionDataQueue.length > 0) {
      const latestMotionData = this.motionDataQueue[this.motionDataQueue.length - 1];
      messages.push({
        type: MESSAGE_TYPES.MOTION_DATA,
        data: latestMotionData,
        timestamp: now
      });
      this.motionDataQueue = [];
    }

    if (messages.length > 0) {
      this.notifySubscribers(messages);
    }
  }

  // Schedule next batch flush
  private scheduleBatchFlush(): void {
    if (this.batchTimer) return;
    
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.flushBatch();
    }, this.batchInterval);
  }

  // Notify all subscribers of batched messages
  private notifySubscribers(messages: BatchedMessage[]): void {
    this.subscribers.forEach(callback => {
      try {
        callback(messages);
      } catch (error) {
        console.error('Error in batch subscriber:', error);
      }
    });
  }

  // Get current queue statistics
  getStats(): { motionQueueSize: number; batchInterval: number; maxBatchSize: number } {
    return {
      motionQueueSize: this.motionDataQueue.length,
      batchInterval: this.batchInterval,
      maxBatchSize: this.maxBatchSize
    };
  }

  // Cleanup resources
  cleanup(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.motionDataQueue = [];
    this.subscribers.clear();
  }
}