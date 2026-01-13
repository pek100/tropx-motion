/**
 * Per-sensor sample buffer with timestamp-based indexing.
 * Supports efficient closest-timestamp lookup via binary search.
 */

import { Quaternion } from '../shared/types';
import { Sample, SYNC_CONFIG } from './types';

export class SensorBuffer {
    private samples: Sample[] = [];
    private readonly deviceId: number;
    private readonly maxSize: number;

    /**
     * @param deviceId - Device ID for this buffer
     * @param maxSize - Maximum buffer size (default: SYNC_CONFIG.MAX_BUFFER_SIZE, use Infinity for batch mode)
     */
    constructor(deviceId: number, maxSize: number = SYNC_CONFIG.MAX_BUFFER_SIZE) {
        this.deviceId = deviceId;
        this.maxSize = maxSize;
    }

    /** Add a new sample to the buffer */
    addSample(timestamp: number, quaternion: Quaternion): void {
        const sample: Sample = { timestamp, quaternion };

        // Insert in timestamp order (usually at end, but handle out-of-order)
        if (this.samples.length === 0 || timestamp >= this.samples[this.samples.length - 1].timestamp) {
            this.samples.push(sample);
        } else {
            const insertIndex = this.findInsertionIndex(timestamp);
            this.samples.splice(insertIndex, 0, sample);
        }

        // Safety limit (skip if maxSize is Infinity for batch mode)
        if (this.maxSize !== Infinity && this.samples.length > this.maxSize) {
            this.samples.shift();
        }
    }

    /** Get sample at specific index */
    getSampleAtIndex(index: number): Sample | null {
        if (index < 0 || index >= this.samples.length) {
            return null;
        }
        return this.samples[index];
    }

    /** Get timestamp at specific index */
    getTimestampAtIndex(index: number): number | null {
        const sample = this.getSampleAtIndex(index);
        return sample ? sample.timestamp : null;
    }

    /** Get quaternion at specific index */
    getQuaternionAtIndex(index: number): Quaternion | null {
        const sample = this.getSampleAtIndex(index);
        return sample ? sample.quaternion : null;
    }

    /**
     * Find index of sample with closest timestamp to target.
     * Uses binary search for O(log n) performance.
     * Returns -1 if buffer is empty.
     */
    findClosestIndex(targetTimestamp: number): number {
        if (this.samples.length === 0) {
            return -1;
        }

        if (this.samples.length === 1) {
            return 0;
        }

        let left = 0;
        let right = this.samples.length - 1;

        // Binary search to find insertion point
        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.samples[mid].timestamp < targetTimestamp) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        // Check neighbors to find actual closest
        if (left > 0) {
            const diffLeft = Math.abs(this.samples[left - 1].timestamp - targetTimestamp);
            const diffRight = Math.abs(this.samples[left].timestamp - targetTimestamp);
            if (diffLeft < diffRight) {
                return left - 1;
            }
        }

        return left;
    }

    /**
     * Discard all samples before (and including) the given index.
     * Used to cleanup behind scan window.
     */
    discardBefore(index: number): void {
        if (index < 0) return;

        const discardCount = index + 1;
        if (discardCount >= this.samples.length) {
            this.samples = [];
        } else {
            this.samples.splice(0, discardCount);
        }
    }

    /**
     * Discard samples up to (but not including) the given index.
     * Keeps the sample at the given index.
     */
    discardUpTo(index: number): void {
        if (index <= 0) return;
        this.samples.splice(0, index);
    }

    /**
     * Remove sample at specific index.
     * Used when consuming a matched sample.
     */
    removeAtIndex(index: number): void {
        if (index < 0 || index >= this.samples.length) return;
        this.samples.splice(index, 1);
    }

    /** Get current buffer size */
    getSize(): number {
        return this.samples.length;
    }

    /** Alias for getSize() */
    size(): number {
        return this.samples.length;
    }

    /** Check if buffer is empty */
    isEmpty(): boolean {
        return this.samples.length === 0;
    }

    /**
     * Trim samples older than given timestamp.
     * Keeps samples at or after trimBefore.
     */
    trimBefore(trimBefore: number): void {
        while (this.samples.length > 0 && this.samples[0].timestamp < trimBefore) {
            this.samples.shift();
        }
    }

    /** Get oldest timestamp in buffer */
    getOldestTimestamp(): number | null {
        return this.samples.length > 0 ? this.samples[0].timestamp : null;
    }

    /** Get newest timestamp in buffer */
    getNewestTimestamp(): number | null {
        return this.samples.length > 0 ? this.samples[this.samples.length - 1].timestamp : null;
    }

    /** Get the device ID this buffer belongs to */
    getDeviceId(): number {
        return this.deviceId;
    }

    /** Clear all samples */
    clear(): void {
        this.samples = [];
    }

    /**
     * Ensure samples are sorted by timestamp.
     * Should be a no-op if addSample is working correctly,
     * but provides safety for BLE out-of-order edge cases.
     */
    ensureSorted(): void {
        this.samples.sort((a, b) => a.timestamp - b.timestamp);
    }

    /** Find insertion index for timestamp-ordered insert */
    private findInsertionIndex(timestamp: number): number {
        let left = 0;
        let right = this.samples.length;

        while (left < right) {
            const mid = Math.floor((left + right) / 2);
            if (this.samples[mid].timestamp < timestamp) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }

        return left;
    }

    /** Get debug statistics */
    getStats(): { deviceId: number; size: number; oldestTs: number | null; newestTs: number | null } {
        return {
            deviceId: this.deviceId,
            size: this.samples.length,
            oldestTs: this.getOldestTimestamp(),
            newestTs: this.getNewestTimestamp(),
        };
    }
}
