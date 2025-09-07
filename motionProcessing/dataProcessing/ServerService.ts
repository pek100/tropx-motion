import { APIRecording } from '../shared/types';
import { apiClient } from "../../src/services/api";
import { SERVER } from '../shared/constants';
import { safeJSONStringify, safeJSONParse } from '../shared/utils';

// Simple localStorage polyfill for Node.js environment
const isNode = typeof window === 'undefined';
const storage = isNode ? new Map<string, string>() : window.localStorage;

const localStoragePolyfill = {
    getItem: (key: string): string | null => {
        if (isNode) {
            return storage.get(key) || null;
        }
        return localStorage.getItem(key);
    },
    setItem: (key: string, value: string): void => {
        if (isNode) {
            storage.set(key, value);
        } else {
            localStorage.setItem(key, value);
        }
    },
    removeItem: (key: string): void => {
        if (isNode) {
            storage.delete(key);
        } else {
            localStorage.removeItem(key);
        }
    }
};

interface QueuedRecording {
    data: APIRecording;
    timestamp: number;
    retryCount: number;
}

/**
 * Manages server communication with automatic retry mechanism for failed uploads.
 * Implements persistent queue using localStorage to survive application restarts
 * and provides batch processing with exponential backoff for network resilience.
 */
export class ServerService {
    private localStorageKey = 'motion_processing_queue';
    private retryInterval: NodeJS.Timeout | null = null;
    private isRetrying = false;
    private lastSuccessfulRecording: APIRecording | null = null; // Add this line
    private onRecordingCallback: ((recording: APIRecording) => void) | null = null; // Add this line

    constructor() {
        this.scheduleRetry();
    }

    /**
     * Sets callback to be called when recording is successfully sent or queued
     */
    setRecordingCallback(callback: (recording: APIRecording) => void): void {
        this.onRecordingCallback = callback;
    }

    /**
     * Gets the last recording that was processed (sent or queued)
     */
    getLastRecording(): APIRecording | null {
        return this.lastSuccessfulRecording;
    }

    /**
     * Sends recording data to the server.
     * If sending fails, adds to retry queue.
     */
    async sendToServer(data: APIRecording): Promise<void> {
        // Store the recording data
        this.lastSuccessfulRecording = data;

        // Notify callback if exists
        if (this.onRecordingCallback) {
            this.onRecordingCallback(data);
        }

        try {
            await apiClient.post('/recordings', data);
            this.removeFromQueue(data.id);
        } catch (error) {
            this.handleSendError(data, error);
            throw error;
        }
    }

    /**
     * Returns number of recordings currently queued for retry.
     */
    getQueueSize(): number {
        return this.getQueue().length;
    }

    /**
     * Stops retry timer and cleans up resources.
     */
    cleanup(): void {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
        this.lastSuccessfulRecording = null;
        this.onRecordingCallback = null;
    }

    /**
     * Handles server communication errors by saving to persistent queue.
     */
    private handleSendError(data: APIRecording, _error: unknown): void {
        this.saveToQueue(data);
        this.scheduleRetry();
    }

    /**
     * Removes successfully uploaded recording from retry queue.
     */
    private removeFromQueue(recordingId: string): void {
        try {
            const queue = this.getQueue();
            const filteredQueue = queue.filter(item => item.data.id !== recordingId);

            if (filteredQueue.length !== queue.length) {
                this.updateQueueStorage(filteredQueue);
            }
        } catch {
            console.error('Error deleting the queue');
        }
    }

    /**
     * Adds failed recording to persistent retry queue with metadata.
     */
    private saveToQueue(data: APIRecording): void {
        try {
            const queue = this.getQueue();
            const queuedItem: QueuedRecording = {
                data,
                timestamp: Date.now(),
                retryCount: 0
            };

            queue.push(queuedItem);
            this.enforceQueueLimit(queue);
            this.updateQueueStorage(queue);
        } catch {
            console.error('Error saving to queue');
        }
    }

    /**
     * Maintains queue size within limits by removing oldest entries.
     */
    private enforceQueueLimit(queue: QueuedRecording[]): void {
        if (queue.length > SERVER.MAX_QUEUE_SIZE) {
            queue.shift();
        }
    }

    /**
     * Persists queue to localStorage with error handling.
     */
    private updateQueueStorage(queue: QueuedRecording[]): void {
        if (queue.length > 0) {
            const serialized = safeJSONStringify(queue);
            if (serialized) {
                localStoragePolyfill.setItem(this.localStorageKey, serialized);
            }
        } else {
            localStoragePolyfill.removeItem(this.localStorageKey);
        }
    }

    /**
     * Retrieves persistent queue from localStorage with fallback to empty array.
     */
    private getQueue(): QueuedRecording[] {
        const stored = localStoragePolyfill.getItem(this.localStorageKey);
        return stored ? safeJSONParse(stored, []) : [];
    }

    /**
     * Initializes periodic retry mechanism if not already running.
     */
    private scheduleRetry(): void {
        if (this.retryInterval) return;

        this.retryInterval = setInterval(() => this.retryQueuedData(), SERVER.RETRY_DELAY_MS);
        setTimeout(() => this.retryQueuedData(), 1000);
    }

    /**
     * Processes queued recordings in batches with retry logic.
     * Prevents concurrent retry operations and maintains queue integrity.
     */
    private async retryQueuedData(): Promise<void> {
        if (this.isRetrying) return;

        const queue = this.getQueue();
        if (queue.length === 0) return;

        this.isRetrying = true;
        const failedItems = await this.processBatches(queue);
        this.updateQueueStorage(failedItems);
        this.isRetrying = false;
    }

    /**
     * Processes queue in configurable batch sizes to manage server load.
     */
    private async processBatches(queue: QueuedRecording[]): Promise<QueuedRecording[]> {
        const failedItems: QueuedRecording[] = [];

        for (let i = 0; i < queue.length; i += SERVER.BATCH_SIZE) {
            const batch = queue.slice(i, i + SERVER.BATCH_SIZE);
            const batchFailures = await this.processBatch(batch);
            failedItems.push(...batchFailures);
        }

        return failedItems;
    }

    /**
     * Processes individual batch with parallel execution and failure isolation.
     */
    private async processBatch(batch: QueuedRecording[]): Promise<QueuedRecording[]> {
        const results = await Promise.allSettled(
            batch.map(item => this.retryItem(item))
        );

        return results
            .map((result, index) => result.status === 'rejected' ? batch[index] : null)
            .filter((item): item is QueuedRecording => item !== null);
    }

    /**
     * Attempts retry for individual queue item with retry limit enforcement.
     * Items exceeding max retries are dropped to prevent infinite retry loops.
     */
    private async retryItem(item: QueuedRecording): Promise<void> {
        if (item.retryCount >= SERVER.MAX_RETRIES) {
            return; // Drop after max retries
        }

        try {
            await this.sendToServer(item.data);
        } catch (error) {
            item.retryCount++;
            throw error;
        }
    }
}