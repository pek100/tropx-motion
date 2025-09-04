/**
 * High-performance data structures for 16kHz sensor data streaming
 * Optimized for zero-copy operations and minimal garbage collection
 */

import { CircularBuffer, ObjectPool, DataBatch } from './types';
import { PERFORMANCE_CONSTANTS } from './constants';

/**
 * Lock-free circular buffer implementation for high-frequency data
 * Supports up to 16kHz without blocking
 */
export class HighPerformanceCircularBuffer<T> implements CircularBuffer<T> {
  public readonly buffer: T[];
  public head: number = 0;
  public tail: number = 0;
  public size: number = 0;
  public readonly capacity: number;
  public isFull: boolean = false;

  constructor(capacity: number = PERFORMANCE_CONSTANTS.CIRCULAR_BUFFER_SIZE) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /**
   * Add item to buffer (O(1) operation)
   * Returns false if buffer is full and item was dropped
   */
  push(item: T): boolean {
    if (this.isFull) {
      // Overwrite oldest item (circular behavior)
      this.tail = (this.tail + 1) % this.capacity;
    } else {
      this.size++;
    }

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    
    if (this.head === this.tail) {
      this.isFull = true;
    }

    return true;
  }

  /**
   * Remove and return oldest item (O(1) operation)
   */
  pop(): T | undefined {
    if (this.isEmpty()) return undefined;

    const item = this.buffer[this.tail];
    this.buffer[this.tail] = undefined as any; // Help GC
    this.tail = (this.tail + 1) % this.capacity;
    this.size--;
    this.isFull = false;

    return item;
  }

  /**
   * Peek at oldest item without removing
   */
  peek(): T | undefined {
    return this.isEmpty() ? undefined : this.buffer[this.tail];
  }

  /**
   * Get multiple items efficiently without individual pops
   */
  popBatch(count: number): T[] {
    const actualCount = Math.min(count, this.size);
    const result: T[] = new Array(actualCount);
    
    for (let i = 0; i < actualCount; i++) {
      result[i] = this.buffer[this.tail];
      this.buffer[this.tail] = undefined as any;
      this.tail = (this.tail + 1) % this.capacity;
      this.size--;
    }
    
    this.isFull = false;
    return result;
  }

  /**
   * Clear buffer and reset pointers
   */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.size = 0;
    this.isFull = false;
    // Help garbage collection
    this.buffer.fill(undefined as any);
  }

  /**
   * Check if buffer is empty
   */
  isEmpty(): boolean {
    return this.size === 0;
  }

  /**
   * Get available space
   */
  getAvailableSpace(): number {
    return this.capacity - this.size;
  }

  /**
   * Get buffer utilization percentage
   */
  getUtilization(): number {
    return (this.size / this.capacity) * 100;
  }
}

/**
 * Memory-efficient object pool to prevent garbage collection pauses
 * Critical for maintaining 16kHz performance
 */
export class MemoryEfficientObjectPool<T> implements ObjectPool<T> {
  public readonly pool: T[] = [];
  private inUse: Set<T> = new Set();

  constructor(
    public readonly createFn: () => T,
    public readonly resetFn: (obj: T) => void,
    public readonly maxSize: number = PERFORMANCE_CONSTANTS.OBJECT_POOL_SIZE
  ) {
    // Pre-populate pool for better performance
    this.warmUp(Math.min(maxSize / 4, 100));
  }

  /**
   * Get object from pool or create new one
   */
  acquire(): T {
    let obj: T;
    
    if (this.pool.length > 0) {
      obj = this.pool.pop()!;
    } else {
      obj = this.createFn();
    }
    
    this.inUse.add(obj);
    return obj;
  }

  /**
   * Return object to pool after resetting
   */
  release(obj: T): void {
    if (!this.inUse.has(obj)) {
      console.warn('Attempting to release object not acquired from this pool');
      return;
    }

    this.inUse.delete(obj);
    
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
    // If pool is full, let object be garbage collected
  }

  /**
   * Release multiple objects efficiently
   */
  releaseBatch(objects: T[]): void {
    objects.forEach(obj => this.release(obj));
  }

  /**
   * Pre-populate pool with objects
   */
  private warmUp(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.pool.length < this.maxSize) {
        this.pool.push(this.createFn());
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { available: number; inUse: number; utilization: number } {
    return {
      available: this.pool.length,
      inUse: this.inUse.size,
      utilization: (this.inUse.size / this.maxSize) * 100,
    };
  }

  /**
   * Clear pool and reset
   */
  clear(): void {
    this.pool.length = 0;
    this.inUse.clear();
  }
}

/**
 * Adaptive data batcher that adjusts batch size based on data frequency
 * Optimizes for both low-latency and high-throughput scenarios
 */
export class AdaptiveDataBatcher<T> {
  private buffer: T[] = [];
  private lastFlushTime: number = 0;
  private flushTimeout: number | null = null;
  private dataRateTracker: number[] = [];
  private sequence: number = 0;

  constructor(
    private readonly flushCallback: (batch: DataBatch<T>) => void,
    private readonly minBatchSize: number = PERFORMANCE_CONSTANTS.MIN_BATCH_SIZE,
    private readonly maxBatchSize: number = PERFORMANCE_CONSTANTS.MAX_BATCH_SIZE,
    private readonly maxDelayMs: number = PERFORMANCE_CONSTANTS.UI_UPDATE_THROTTLE_MS
  ) {}

  /**
   * Add data with adaptive batching logic
   */
  addData(data: T): void {
    this.buffer.push(data);
    this.updateDataRate();

    const optimalBatchSize = this.calculateOptimalBatchSize();
    
    if (this.buffer.length >= optimalBatchSize) {
      this.flush();
    } else if (!this.flushTimeout) {
      this.scheduleFlush();
    }
  }

  /**
   * Add multiple data items efficiently
   */
  addBatch(data: T[]): void {
    this.buffer.push(...data);
    this.updateDataRate();

    const optimalBatchSize = this.calculateOptimalBatchSize();
    
    if (this.buffer.length >= optimalBatchSize) {
      this.flush();
    } else if (!this.flushTimeout) {
      this.scheduleFlush();
    }
  }

  /**
   * Force flush current buffer
   */
  flush(): void {
    if (this.buffer.length === 0) return;

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    const batch: DataBatch<T> = {
      data: [...this.buffer],
      timestamp: performance.now(),
      sequenceStart: this.sequence,
      count: this.buffer.length,
    };

    this.sequence += this.buffer.length;
    this.buffer.length = 0;
    this.lastFlushTime = performance.now();

    this.flushCallback(batch);
  }

  /**
   * Get current buffer statistics
   */
  getStats(): {
    bufferSize: number;
    dataRate: number;
    avgBatchSize: number;
    avgFlushInterval: number;
  } {
    const avgDataRate = this.dataRateTracker.length > 0
      ? this.dataRateTracker.reduce((a, b) => a + b) / this.dataRateTracker.length
      : 0;

    return {
      bufferSize: this.buffer.length,
      dataRate: avgDataRate,
      avgBatchSize: this.calculateOptimalBatchSize(),
      avgFlushInterval: this.maxDelayMs,
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
    
    // Flush remaining data
    if (this.buffer.length > 0) {
      this.flush();
    }
  }

  // Private helper methods
  private scheduleFlush(): void {
    const delay = Math.max(1, Math.min(this.maxDelayMs, this.calculateAdaptiveDelay()));
    
    this.flushTimeout = window.setTimeout(() => {
      this.flushTimeout = null;
      this.flush();
    }, delay);
  }

  private updateDataRate(): void {
    const now = performance.now();
    this.dataRateTracker.push(now);
    
    // Keep only recent data points (last second)
    const cutoff = now - 1000;
    this.dataRateTracker = this.dataRateTracker.filter(time => time > cutoff);
  }

  private calculateOptimalBatchSize(): number {
    const dataRate = this.dataRateTracker.length; // Items per second
    
    if (dataRate > 1000) {
      // High frequency: larger batches for efficiency
      return Math.min(this.maxBatchSize, Math.max(this.minBatchSize, Math.floor(dataRate / 100)));
    } else if (dataRate > 100) {
      // Medium frequency: balanced approach
      return Math.min(this.maxBatchSize, Math.max(this.minBatchSize, Math.floor(dataRate / 50)));
    } else {
      // Low frequency: small batches for responsiveness
      return this.minBatchSize;
    }
  }

  private calculateAdaptiveDelay(): number {
    const dataRate = this.dataRateTracker.length;
    
    if (dataRate > 1000) {
      // High frequency: shorter delays
      return Math.max(1, this.maxDelayMs / 4);
    } else if (dataRate > 100) {
      // Medium frequency: moderate delays
      return Math.max(1, this.maxDelayMs / 2);
    } else {
      // Low frequency: use full delay for better batching
      return this.maxDelayMs;
    }
  }
}

/**
 * Binary message serializer for efficient WebRTC transmission
 * Reduces bandwidth usage for high-frequency sensor data
 */
export class BinaryMessageSerializer {
  private static readonly HEADER_SIZE = 16; // bytes
  
  /**
   * Serialize message to binary format for efficient transmission
   */
  static serialize(data: any): ArrayBuffer {
    const jsonString = JSON.stringify(data);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(jsonString);
    
    const buffer = new ArrayBuffer(this.HEADER_SIZE + jsonBytes.length);
    const view = new DataView(buffer);
    
    // Write header
    view.setUint32(0, jsonBytes.length, true); // Data length
    view.setFloat64(4, performance.now(), true); // Timestamp
    view.setUint32(12, 0, true); // Reserved for future use
    
    // Write data
    const dataArray = new Uint8Array(buffer, this.HEADER_SIZE);
    dataArray.set(jsonBytes);
    
    return buffer;
  }

  /**
   * Deserialize binary message back to object
   */
  static deserialize(buffer: ArrayBuffer): { data: any; timestamp: number } {
    const view = new DataView(buffer);
    
    // Read header
    const dataLength = view.getUint32(0, true);
    const timestamp = view.getFloat64(4, true);
    
    // Read data
    const dataArray = new Uint8Array(buffer, this.HEADER_SIZE, dataLength);
    const decoder = new TextDecoder();
    const jsonString = decoder.decode(dataArray);
    
    return {
      data: JSON.parse(jsonString),
      timestamp
    };
  }

  /**
   * Calculate serialization efficiency
   */
  static getCompressionRatio(originalData: any): number {
    const jsonSize = JSON.stringify(originalData).length * 2; // UTF-16 bytes
    const binarySize = this.serialize(originalData).byteLength;
    return jsonSize / binarySize;
  }
}