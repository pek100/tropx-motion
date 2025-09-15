// GATT Operation Queue to prevent "GATT operation already in progress" errors
interface GATTOperation {
  id: string;
  deviceId: string;
  operation: () => Promise<unknown>;
  priority: number; // Higher = more important
  timeout: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class GATTOperationQueue {
  private static instance: GATTOperationQueue | null = null;
  private queues = new Map<string, GATTOperation[]>(); // Per-device queues
  private activeOperations = new Map<string, GATTOperation>(); // Currently executing
  private operationTimeouts = new Map<string, NodeJS.Timeout>();

  static getInstance(): GATTOperationQueue {
    if (!this.instance) {
      this.instance = new GATTOperationQueue();
    }
    return this.instance;
  }

  // Queue a GATT operation with priority
  async queueOperation<T>(
    deviceId: string,
    operationType: string,
    operation: () => Promise<T>,
    priority: number = 1,
    timeout: number = 5000
  ): Promise<T> {
    const operationId = `${deviceId}_${operationType}_${Date.now()}`;

    return new Promise<T>((resolve, reject) => {
      const gattOp: GATTOperation = {
        id: operationId,
        deviceId,
        operation: operation as () => Promise<unknown>,
        priority,
        timeout,
        resolve: resolve as (value: unknown) => void,
        reject
      };

      // Add to device queue
      if (!this.queues.has(deviceId)) {
        this.queues.set(deviceId, []);
      }

      const deviceQueue = this.queues.get(deviceId)!;

      // CRITICAL FIX: Insert in priority order instead of expensive full sort
      const insertIndex = deviceQueue.findIndex(op => op.priority < gattOp.priority);
      if (insertIndex === -1) {
        deviceQueue.push(gattOp);
      } else {
        deviceQueue.splice(insertIndex, 0, gattOp);
      }

      // Process queue
      this.processQueue(deviceId);
    });
  }

  // Process the queue for a specific device
  private async processQueue(deviceId: string): Promise<void> {
    // Skip if already processing
    if (this.activeOperations.has(deviceId)) {
      return;
    }

    const deviceQueue = this.queues.get(deviceId);
    if (!deviceQueue || deviceQueue.length === 0) {
      return;
    }

    const operation = deviceQueue.shift()!;
    this.activeOperations.set(deviceId, operation);

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      this.activeOperations.delete(deviceId);
      this.operationTimeouts.delete(deviceId);
      operation.reject(new Error(`GATT operation timeout: ${operation.id}`));
      
      // Process next operation
      this.processQueue(deviceId);
    }, operation.timeout);

    this.operationTimeouts.set(deviceId, timeoutHandle);

    try {
      const result = await operation.operation();
      
      // Clear timeout
      const timeout = this.operationTimeouts.get(deviceId);
      if (timeout) {
        clearTimeout(timeout);
        this.operationTimeouts.delete(deviceId);
      }

      this.activeOperations.delete(deviceId);
      operation.resolve(result);

      // CRITICAL FIX: Process immediately for streaming performance
      this.processQueue(deviceId);
    } catch (error) {
      // Clear timeout
      const timeout = this.operationTimeouts.get(deviceId);
      if (timeout) {
        clearTimeout(timeout);
        this.operationTimeouts.delete(deviceId);
      }

      this.activeOperations.delete(deviceId);
      operation.reject(error as Error);

      // CRITICAL FIX: Process immediately even on error, but add small delay
      setTimeout(() => this.processQueue(deviceId), 10); // Minimal delay on error
    }
  }

  // Cancel all operations for a device
  cancelDeviceOperations(deviceId: string): void {
    const deviceQueue = this.queues.get(deviceId);
    if (deviceQueue) {
      deviceQueue.forEach(op => {
        op.reject(new Error(`Operation cancelled: ${op.id}`));
      });
      deviceQueue.length = 0;
    }

    // Cancel active operation and clean up timeout
    const activeOp = this.activeOperations.get(deviceId);
    if (activeOp) {
      activeOp.reject(new Error(`Active operation cancelled: ${activeOp.id}`));
      this.activeOperations.delete(deviceId);
    }

    // Clean up timeout for this device
    const timeout = this.operationTimeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.operationTimeouts.delete(deviceId);
    }
  }

  // Get queue status for monitoring
  getQueueStatus(deviceId?: string): Record<string, unknown> {
    if (deviceId) {
      return {
        deviceId,
        queueSize: this.queues.get(deviceId)?.length || 0,
        isActive: this.activeOperations.has(deviceId),
        activeOperation: this.activeOperations.get(deviceId)?.id || null
      };
    }

    const status: Record<string, unknown> = {};
    for (const [devId] of this.queues) {
      status[devId] = this.getQueueStatus(devId);
    }
    return status;
  }

  // Clear all queues (for cleanup)
  clearAllQueues(): void {
    for (const [deviceId] of this.queues) {
      this.cancelDeviceOperations(deviceId);
    }
    this.queues.clear();
    this.activeOperations.clear();

    // Clear all timeouts
    this.operationTimeouts.forEach(timeout => clearTimeout(timeout));
    this.operationTimeouts.clear();
  }

  // Periodic cleanup of stale operations and timeouts
  performPeriodicCleanup(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    // Clean up queues for devices that haven't had operations recently
    this.queues.forEach((queue, deviceId) => {
      if (queue.length === 0 && !this.activeOperations.has(deviceId)) {
        const lastOpTime = queue.length > 0 ?
          parseInt(queue[queue.length - 1].id.split('_')[2]) : 0;

        if (now - lastOpTime > staleThreshold) {
          this.queues.delete(deviceId);
        }
      }
    });

    // Log queue status for monitoring
    if (this.queues.size > 0) {
      const queueSizes = Array.from(this.queues.entries()).map(([id, q]) => `${id}:${q.length}`);
      console.log('🧹 GATT Queue cleanup - Active queues:', queueSizes.join(', '));
    }
  }

  // Get current memory usage statistics
  getMemoryStats(): { queueCount: number; activeOperations: number; pendingTimeouts: number } {
    return {
      queueCount: this.queues.size,
      activeOperations: this.activeOperations.size,
      pendingTimeouts: this.operationTimeouts.size
    };
  }
}