/**
 * Connection Queue for node-ble (Linux only)
 *
 * This queue system ensures that BLE connections are established sequentially,
 * waiting for actual "connected" state confirmation before proceeding to the next device.
 *
 * This is necessary because BlueZ can only establish ONE connection at a time.
 * Multiple concurrent connection attempts cause "le-connection-abort-by-local" errors.
 */

import { EventEmitter } from 'events';
import { deviceStateManager } from './DeviceStateManager';

interface QueuedConnectionRequest {
  deviceId: string;
  resolve: (result: ConnectionQueueResult) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

export interface ConnectionQueueResult {
  success: boolean;
  deviceId: string;
  message: string;
}

type ConnectionHandler = (deviceId: string) => Promise<ConnectionQueueResult>;

export class ConnectionQueue extends EventEmitter {
  private queue: QueuedConnectionRequest[] = [];
  private isProcessing: boolean = false;
  private connectionHandler: ConnectionHandler | null = null;
  private currentDeviceId: string | null = null;
  private stateCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Set the connection handler that will actually perform the connection
   */
  setConnectionHandler(handler: ConnectionHandler): void {
    this.connectionHandler = handler;
  }

  /**
   * Add a device connection request to the queue
   */
  async enqueue(deviceId: string): Promise<ConnectionQueueResult> {
    console.log(`📥 [ConnectionQueue] Enqueueing connection request for ${deviceId}`);
    console.log(`📊 [ConnectionQueue] Current queue length: ${this.queue.length}, processing: ${this.isProcessing}`);

    return new Promise<ConnectionQueueResult>((resolve, reject) => {
      const request: QueuedConnectionRequest = {
        deviceId,
        resolve,
        reject,
        timestamp: Date.now()
      };

      this.queue.push(request);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processNext();
      }
    });
  }

  /**
   * Process the next item in the queue
   */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      console.log(`✅ [ConnectionQueue] Queue empty, stopping processor`);
      this.isProcessing = false;
      return;
    }

    if (this.isProcessing) {
      console.log(`⏸️ [ConnectionQueue] Already processing, waiting...`);
      return;
    }

    this.isProcessing = true;
    const request = this.queue.shift()!;
    this.currentDeviceId = request.deviceId;

    console.log(`🚀 [ConnectionQueue] Processing connection for ${request.deviceId} (${this.queue.length} remaining in queue)`);

    if (!this.connectionHandler) {
      console.error(`❌ [ConnectionQueue] No connection handler set!`);
      request.reject(new Error('No connection handler configured'));
      this.isProcessing = false;
      this.currentDeviceId = null;
      this.processNext();
      return;
    }

    try {
      // Set device to connecting state
      deviceStateManager.setDeviceConnectionState(request.deviceId, 'connecting');

      // Start the connection attempt
      console.log(`🔗 [ConnectionQueue] Calling connection handler for ${request.deviceId}...`);
      const result = await this.connectionHandler(request.deviceId);

      if (result.success) {
        console.log(`✅ [ConnectionQueue] Connection handler returned success for ${request.deviceId}`);

        // CRITICAL: Wait for actual "connected" state confirmation
        // Don't just trust the return value - verify the state
        const isConnected = await this.waitForConnectedState(request.deviceId, 10000); // 10s timeout

        if (isConnected) {
          console.log(`✅ [ConnectionQueue] Confirmed connected state for ${request.deviceId}`);
          request.resolve(result);

          // CRITICAL: Give BlueZ time to stabilize before next connection
          // Optimized: Reduced from 500ms to 200ms for faster sequential connections
          console.log(`⏳ [ConnectionQueue] Waiting 200ms before processing next device...`);
          await new Promise(resolve => setTimeout(resolve, 200));
        } else {
          console.error(`❌ [ConnectionQueue] Timed out waiting for connected state for ${request.deviceId}`);
          request.resolve({
            success: false,
            deviceId: request.deviceId,
            message: 'Connection timeout - device did not reach connected state'
          });
        }
      } else {
        console.error(`❌ [ConnectionQueue] Connection handler failed for ${request.deviceId}: ${result.message}`);
        request.resolve(result);

        // Add delay even on failure to let BlueZ recover
        // Optimized: Reduced from 500ms to 200ms
        console.log(`⏳ [ConnectionQueue] Waiting 200ms after failure before processing next device...`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }

    } catch (error) {
      console.error(`❌ [ConnectionQueue] Exception during connection for ${request.deviceId}:`, error);
      request.reject(error as Error);

      // Add delay after exception
      // Optimized: Reduced from 500ms to 200ms
      await new Promise(resolve => setTimeout(resolve, 200));
    } finally {
      this.isProcessing = false;
      this.currentDeviceId = null;
    }

    // Process next item in queue
    this.processNext();
  }

  /**
   * Wait for device to reach "connected" or "streaming" state
   */
  private async waitForConnectedState(deviceId: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 200; // Check every 200ms

    return new Promise<boolean>((resolve) => {
      const checkState = () => {
        const device = deviceStateManager.getDevice(deviceId);

        if (device && (device.state === 'connected' || device.state === 'streaming')) {
          console.log(`✅ [ConnectionQueue] Device ${deviceId} reached state: ${device.state}`);
          resolve(true);
          return;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed >= timeoutMs) {
          console.error(`⏱️ [ConnectionQueue] Timeout waiting for ${deviceId} to connect (state: ${device?.state || 'unknown'})`);
          resolve(false);
          return;
        }

        // Check again after interval
        setTimeout(checkState, checkInterval);
      };

      checkState();
    });
  }

  /**
   * Get current queue status
   */
  getStatus(): { queueLength: number; isProcessing: boolean; currentDevice: string | null } {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      currentDevice: this.currentDeviceId
    };
  }

  /**
   * Clear the queue (for cleanup)
   */
  clear(): void {
    console.log(`🧹 [ConnectionQueue] Clearing queue (${this.queue.length} items)`);

    // Reject all pending requests
    this.queue.forEach(request => {
      request.reject(new Error('Connection queue cleared'));
    });

    this.queue = [];
    this.isProcessing = false;
    this.currentDeviceId = null;

    if (this.stateCheckInterval) {
      clearInterval(this.stateCheckInterval);
      this.stateCheckInterval = null;
    }
  }
}
