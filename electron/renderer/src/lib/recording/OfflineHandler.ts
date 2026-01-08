/**
 * OfflineHandler - Manages offline upload queue and retry logic.
 *
 * Features:
 * - Detects connection state
 * - Queues failed uploads in memory
 * - Retries on reconnection
 * - Triggers toast notifications
 */

import { ConvexClient } from 'convex/browser';
import { RawDeviceSample } from '../../../../../motionProcessing/recording/types';
import { UploadService, UploadOptions, UploadResult } from './UploadService';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface QueuedUpload {
  id: string;
  samples: RawDeviceSample[];
  options: UploadOptions;
  createdAt: number;
  retryCount: number;
}

export interface OfflineHandlerOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  onConnectionChange?: (isConnected: boolean) => void;
  onUploadSuccess?: (result: UploadResult) => void;
  onUploadError?: (error: string) => void;
  onQueueChange?: (queueLength: number) => void;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;

// ─────────────────────────────────────────────────────────────────
// OfflineHandler
// ─────────────────────────────────────────────────────────────────

export class OfflineHandler {
  private uploadService: UploadService;
  private queue: QueuedUpload[] = [];
  private isConnected = true;
  private isProcessing = false;
  private options: Required<OfflineHandlerOptions>;
  private connectionCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    convexClient: ConvexClient,
    options: OfflineHandlerOptions = {}
  ) {
    this.uploadService = new UploadService(convexClient);
    this.options = {
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      onConnectionChange: options.onConnectionChange ?? (() => {}),
      onUploadSuccess: options.onUploadSuccess ?? (() => {}),
      onUploadError: options.onUploadError ?? (() => {}),
      onQueueChange: options.onQueueChange ?? (() => {}),
    };

    // Start connection monitoring
    this.startConnectionMonitoring();
  }

  /**
   * Check if currently connected to Convex.
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get current queue length.
   */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Upload a recording, queueing if offline.
   */
  async upload(
    samples: RawDeviceSample[],
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    if (!this.isConnected) {
      this.addToQueue(samples, options);
      return {
        success: false,
        error: 'No connection. Recording queued for upload.',
      };
    }

    try {
      const result = await this.uploadService.upload(samples, options);

      if (result.success) {
        this.options.onUploadSuccess(result);
      } else {
        // Upload failed - queue for retry
        this.addToQueue(samples, options);
        this.options.onUploadError(result.error ?? 'Upload failed');
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Connection error - queue for retry
      this.addToQueue(samples, options);
      this.setConnectionState(false);
      this.options.onUploadError(errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Add upload to queue.
   */
  private addToQueue(
    samples: RawDeviceSample[],
    options: UploadOptions
  ): void {
    const queuedUpload: QueuedUpload = {
      id: `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      samples,
      options,
      createdAt: Date.now(),
      retryCount: 0,
    };

    this.queue.push(queuedUpload);
    this.options.onQueueChange(this.queue.length);
  }

  /**
   * Process queued uploads.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !this.isConnected) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0 && this.isConnected) {
      const upload = this.queue[0];

      try {
        const result = await this.uploadService.upload(
          upload.samples,
          upload.options
        );

        if (result.success) {
          // Remove from queue
          this.queue.shift();
          this.options.onQueueChange(this.queue.length);
          this.options.onUploadSuccess(result);
        } else {
          // Increment retry count
          upload.retryCount++;

          if (upload.retryCount >= this.options.maxRetries) {
            // Max retries exceeded - remove from queue
            this.queue.shift();
            this.options.onQueueChange(this.queue.length);
            this.options.onUploadError(
              `Upload failed after ${this.options.maxRetries} retries`
            );
          } else {
            // Wait before next retry
            await this.delay(this.options.retryDelayMs);
          }
        }
      } catch (error) {
        // Connection error - stop processing
        this.setConnectionState(false);
        break;
      }
    }

    this.isProcessing = false;
  }

  /**
   * Start monitoring connection state.
   */
  private startConnectionMonitoring(): void {
    // Check connection every 5 seconds
    this.connectionCheckInterval = setInterval(() => {
      this.checkConnection();
    }, 5000);

    // Also listen to browser online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.setConnectionState(true));
      window.addEventListener('offline', () => this.setConnectionState(false));
    }
  }

  /**
   * Check connection to Convex.
   */
  private async checkConnection(): Promise<void> {
    // Simple check: if browser is online, assume connected
    // More sophisticated: ping Convex
    if (typeof navigator !== 'undefined') {
      const wasConnected = this.isConnected;
      const isNowConnected = navigator.onLine;

      if (isNowConnected !== wasConnected) {
        this.setConnectionState(isNowConnected);
      }
    }
  }

  /**
   * Set connection state and trigger callbacks.
   */
  private setConnectionState(connected: boolean): void {
    const wasConnected = this.isConnected;
    this.isConnected = connected;

    if (connected !== wasConnected) {
      this.options.onConnectionChange(connected);

      // If reconnected, process queue
      if (connected && this.queue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Delay helper.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', () =>
        this.setConnectionState(true)
      );
      window.removeEventListener('offline', () =>
        this.setConnectionState(false)
      );
    }
  }
}
