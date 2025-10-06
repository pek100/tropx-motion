import { IMUData, Quaternion, DeviceData } from '../shared/types';
import {INTERPOLATION} from '../shared/constants';
import {lerp, QuaternionService} from "../shared/QuaternionService";
import { PerformanceLogger } from '../shared/PerformanceLogger';

interface TimestampedSample {
    quaternion: Quaternion;
    timestamp: number;
}

interface DeviceBuffer {
    samples: TimestampedSample[];
}

/**
 * Temporal interpolation service for synchronizing IMU data across multiple devices.
 * Creates uniform temporal grid and performs quaternion interpolation to ensure
 * consistent sampling rates across all devices.
 */
export class InterpolationService {
    private readonly targetInterval: number;
    private readonly gridOrigin: number;
    private deviceBuffers = new Map<string, DeviceBuffer>();
    private processedGridPoints = new Set<number>();
    private quaternionPool: Quaternion[] = [];
    private poolIndex = 0;
    private subscribers = new Set<(data: DeviceData[]) => void>();
    private sampleCounter = 0;

    // Async notification throttling
    private pendingNotifications = 0;
    private readonly MAX_PENDING_NOTIFICATIONS = 3;
    private lastNotifyTime = 0;
    private readonly MIN_NOTIFY_INTERVAL = 16; // 60fps cap

    constructor(targetHz: number) {
        this.targetInterval = 1000 / targetHz;
        const now = performance.now();
        // Align grid to next interval boundary for consistent timing
        this.gridOrigin = Math.ceil(now / this.targetInterval) * this.targetInterval;
        this.initializeQuaternionPool();
    }

    /**
     * Processes incoming IMU sample and triggers interpolation at grid points.
     * Returns empty array as actual output is delivered via subscription.
     */
    processSample(deviceId: string, imuData: IMUData, externalTimestamp?: number): DeviceData[] {
        if (!deviceId || !imuData?.quaternion) {
            return [];
        }

        const rawTimestamp = externalTimestamp || imuData.timestamp || performance.now();
        const sample = this.createTimestampedSample(imuData.quaternion, rawTimestamp);

        this.addSampleToBuffer(deviceId, sample);
        this.processGridPoint(this.snapToGrid(rawTimestamp));

        return [];
    }

    /**
     * Subscribes to interpolated data output, returns unsubscribe function.
     */
    subscribe(callback: (data: DeviceData[]) => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Removes device buffer when device disconnects.
     * CRITICAL: Prevents stale data from affecting interpolation after disconnect.
     */
    removeDevice(deviceId: string): void {
        const buffer = this.deviceBuffers.get(deviceId);
        if (buffer) {
            console.log(`🧹 [INTERPOLATION] Removing device ${deviceId} buffer (had ${buffer.samples.length} samples)`);
            buffer.samples.length = 0; // Clear array explicitly
            this.deviceBuffers.delete(deviceId);
        }
    }

    /**
     * Performs complete cleanup of buffers and subscriptions.
     * Enhanced with thorough memory cleanup to prevent leaks.
     */
    cleanup(): void {
        // Clear all device buffers explicitly
        this.deviceBuffers.forEach(buffer => {
            buffer.samples.length = 0; // Clear arrays explicitly
        });
        this.deviceBuffers.clear();

        this.processedGridPoints.clear();
        this.subscribers.clear();

        // Reset counters and pool
        this.sampleCounter = 0;
        this.poolIndex = 0;

        console.log('🧹 InterpolationService cleanup completed');
    }

    /**
     * Periodic cleanup method to prevent memory accumulation during long sessions.
     * Should be called periodically from external performance monitoring.
     */
    performPeriodicCleanup(): void {
        let totalBufferSize = 0;
        let cleanedDevices = 0;

        // Calculate current memory usage
        this.deviceBuffers.forEach((buffer, deviceId) => {
            totalBufferSize += buffer.samples.length;

            // Aggressive cleanup for overly large buffers
            if (buffer.samples.length > INTERPOLATION.BUFFER_SIZE * 0.8) {
                const targetSize = Math.floor(INTERPOLATION.BUFFER_SIZE * 0.5); // Cut to half
                const removeCount = buffer.samples.length - targetSize;
                buffer.samples.splice(0, removeCount);
                cleanedDevices++;
            }
        });

        // Clean old processed grid points more frequently
        if (this.processedGridPoints.size > 50) {
            const sortedPoints = Array.from(this.processedGridPoints).sort((a, b) => a - b);
            const keepCount = 25; // Keep only recent 25 points
            const toRemove = sortedPoints.slice(0, sortedPoints.length - keepCount);
            toRemove.forEach(point => this.processedGridPoints.delete(point));
        }

        // DISABLED: Cleanup logging is noisy and unnecessary
        // if (cleanedDevices > 0) {
        //     console.log(`🧹 Periodic cleanup: cleaned ${cleanedDevices} device buffers, total samples: ${totalBufferSize}`);
        // }
    }

    /**
     * Pre-allocates quaternion objects to reduce garbage collection pressure.
     */
    private initializeQuaternionPool(): void {
        for (let i = 0; i < INTERPOLATION.QUATERNION_POOL_SIZE; i++) {
            this.quaternionPool.push(QuaternionService.createIdentity());
        }
    }

    /**
     * Acquires reusable quaternion from pool with round-robin allocation.
     */
    private acquireQuaternion(): Quaternion {
        const result = this.quaternionPool[this.poolIndex];
        this.poolIndex = (this.poolIndex + 1) % INTERPOLATION.QUATERNION_POOL_SIZE;

        result.w = 1;
        result.x = 0;
        result.y = 0;
        result.z = 0;

        return result;
    }

    /**
     * Creates timestamped sample with normalized quaternion.
     */
    private createTimestampedSample(quaternion: Quaternion, timestamp: number): TimestampedSample {
        return {
            quaternion: QuaternionService.normalize(quaternion),
            timestamp
        };
    }

    /**
     * Snaps arbitrary timestamp to nearest grid point for temporal alignment.
     */
    private snapToGrid(timestamp: number): number {
        const gridOffset = timestamp - this.gridOrigin;
        const gridIndex = Math.round(gridOffset / this.targetInterval);
        return this.gridOrigin + gridIndex * this.targetInterval;
    }


    /**
     * Performs spherical linear interpolation (SLERP) between quaternions.
     * Includes correction factor for near-parallel quaternions to improve stability.
     */
    private interpolateQuaternions(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
        const clampedT = Math.max(0, Math.min(1, t));
        let dot = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;

        // Choose shortest path by negating one quaternion if needed
        const signFactor = dot < 0 ? -1 : 1;
        const effectiveDot = Math.abs(dot);

        // Apply correction for near-parallel quaternions
        const correction = dot > INTERPOLATION.DOT_PRODUCT_THRESHOLD ?
            1.0 :
            1.0 - INTERPOLATION.CORRECTION_FACTOR * (1 - effectiveDot);

        const adjustedT = clampedT * correction;

        // Use pooled object for performance
        const result = this.acquireQuaternion();
        result.w = lerp(q1.w, q2.w * signFactor, adjustedT);
        result.x = lerp(q1.x, q2.x * signFactor, adjustedT);
        result.y = lerp(q1.y, q2.y * signFactor, adjustedT);
        result.z = lerp(q1.z, q2.z * signFactor, adjustedT);

        return QuaternionService.normalize(result);
    }
    /**
     * Adds sample to device buffer with timestamp-based insertion for chronological ordering.
     */
    private addSampleToBuffer(deviceId: string, sample: TimestampedSample): void {
        const buffer = this.getOrCreateBuffer(deviceId);
        const insertIndex = this.findInsertionIndex(buffer.samples, sample.timestamp);

        if (insertIndex === -1) {
            buffer.samples.push(sample);
        } else {
            buffer.samples.splice(insertIndex, 0, sample);
        }

        this.enforceBufferLimit(buffer);
    }

    /**
     * Retrieves existing buffer or creates new one for device.
     */
    private getOrCreateBuffer(deviceId: string): DeviceBuffer {
        let buffer = this.deviceBuffers.get(deviceId);
        if (!buffer) {
            buffer = { samples: [] };
            this.deviceBuffers.set(deviceId, buffer);
        }
        return buffer;
    }

    /**
     * Finds correct insertion index to maintain chronological order in buffer.
     */
    private findInsertionIndex(samples: TimestampedSample[], timestamp: number): number {
        return samples.findIndex(s => s.timestamp > timestamp);
    }

    /**
     * Maintains buffer size within memory limits by removing oldest samples.
     * Enhanced with aggressive cleanup to prevent memory accumulation.
     */
    private enforceBufferLimit(buffer: DeviceBuffer): void {
        if (buffer.samples.length > INTERPOLATION.BUFFER_SIZE) {
            // Remove multiple samples at once to prevent frequent memory operations
            const excessCount = buffer.samples.length - INTERPOLATION.BUFFER_SIZE;
            const removeCount = Math.max(1, Math.floor(excessCount * 1.2)); // Remove 20% extra for buffer
            buffer.samples.splice(0, removeCount);
        }
    }

    /**
     * Interpolates quaternion value at specific grid timestamp using surrounding samples.
     */
    private interpolateAtGridPoint(deviceId: string, gridTimestamp: number): Quaternion | null {
        const buffer = this.deviceBuffers.get(deviceId);
        if (!buffer || buffer.samples.length === 0) return null;

        const samples = buffer.samples;
        if (samples.length === 1) return samples[0].quaternion;

        const { beforeSample, afterSample } = this.findBoundingSamples(samples, gridTimestamp);

        if (!beforeSample && afterSample) return afterSample.quaternion;
        if (beforeSample && !afterSample) return beforeSample.quaternion;
        if (!beforeSample || !afterSample) return null;

        return this.interpolateBetweenSamples(beforeSample, afterSample, gridTimestamp);
    }

    /**
     * Finds samples that bound the target timestamp for interpolation.
     */
    private findBoundingSamples(samples: TimestampedSample[], gridTimestamp: number) {
        let beforeSample: TimestampedSample | null = null;
        let afterSample: TimestampedSample | null = null;

        for (const sample of samples) {
            if (sample.timestamp <= gridTimestamp) {
                beforeSample = sample;
            } else {
                afterSample = sample;
                break;
            }
        }

        return { beforeSample, afterSample };
    }

    /**
     * Performs temporal interpolation between two bounding samples.
     */
    private interpolateBetweenSamples(
        beforeSample: TimestampedSample,
        afterSample: TimestampedSample,
        gridTimestamp: number
    ): Quaternion {
        if (Math.abs(beforeSample.timestamp - gridTimestamp) < INTERPOLATION.EPSILON) {
            return beforeSample.quaternion;
        }

        const timeDelta = afterSample.timestamp - beforeSample.timestamp;
        if (timeDelta < INTERPOLATION.EPSILON) {
            return beforeSample.quaternion;
        }

        const t = (gridTimestamp - beforeSample.timestamp) / timeDelta;
        return this.interpolateQuaternions(beforeSample.quaternion, afterSample.quaternion, t);
    }

    /**
     * Processes grid point by interpolating all devices and notifying subscribers.
     * Prevents duplicate processing of same grid points.
     */
    private processGridPoint(gridTimestamp: number): void {
        if (this.processedGridPoints.has(gridTimestamp)) return;

        const outputData = this.createOutputData(gridTimestamp);
        this.markGridPointProcessed(gridTimestamp);

        if (outputData.length > 0) {
            this.notifySubscribers(outputData);
        }
    }

    /**
     * Creates interpolated output data for all devices at specified grid point.
     */
    private createOutputData(gridTimestamp: number): DeviceData[] {
        const outputData: DeviceData[] = [];

        for (const [deviceId] of this.deviceBuffers) {
            const interpolatedQuaternion = this.interpolateAtGridPoint(deviceId, gridTimestamp);
            if (interpolatedQuaternion) {
                outputData.push({
                    deviceId,
                    quaternion: interpolatedQuaternion,
                    timestamp: gridTimestamp,
                    interpolated: true,
                    connectionState: 'streaming'
                });
            }
        }

        return outputData;
    }

    /**
     * Marks grid point as processed and performs cleanup to prevent memory growth.
     */
    private markGridPointProcessed(gridTimestamp: number): void {
        this.processedGridPoints.add(gridTimestamp);

        // More aggressive cleanup during high-throughput
        this.sampleCounter++;
        if (this.sampleCounter % 50 === 0) { // Clean every 50 samples instead of only when full
            this.performAggressiveCleanup();
        } else {
            this.cleanupProcessedPoints();
        }
    }

    /**
     * Maintains processed points history within memory limits.
     */
    private cleanupProcessedPoints(): void {
        if (this.processedGridPoints.size > INTERPOLATION.MAX_PROCESSED_HISTORY) {
            const sortedPoints = Array.from(this.processedGridPoints).sort((a, b) => a - b);
            const toRemove = sortedPoints.slice(0, sortedPoints.length - INTERPOLATION.MAX_PROCESSED_HISTORY);
            toRemove.forEach(point => this.processedGridPoints.delete(point));
        }
    }

    /**
     * Performs aggressive cleanup during high-throughput scenarios.
     */
    private performAggressiveCleanup(): void {
        // Clean processed points more aggressively
        if (this.processedGridPoints.size > 25) {
            const sortedPoints = Array.from(this.processedGridPoints).sort((a, b) => a - b);
            const toRemove = sortedPoints.slice(0, sortedPoints.length - 15); // Keep only 15 recent points
            toRemove.forEach(point => this.processedGridPoints.delete(point));
        }

        // Clean device buffers that are too large
        this.deviceBuffers.forEach((buffer, deviceId) => {
            if (buffer.samples.length > INTERPOLATION.BUFFER_SIZE * 0.7) {
                const targetSize = Math.floor(INTERPOLATION.BUFFER_SIZE * 0.4);
                const removeCount = buffer.samples.length - targetSize;
                buffer.samples.splice(0, removeCount); // Remove oldest samples
            }
        });

        // Reset quaternion pool if it's too large
        if (this.quaternionPool.length > 200) {
            this.quaternionPool.length = 50;
            this.poolIndex = 0;
        }
    }

    /**
     * Safely notifies all subscribers of new interpolated data with throttling.
     */
    private notifySubscribers(data: DeviceData[]): void {
        const now = performance.now();

        // Throttle notifications to prevent overwhelming subscribers
        if (now - this.lastNotifyTime < this.MIN_NOTIFY_INTERVAL) {
            return;
        }

        // Apply backpressure if too many notifications are pending
        if (this.pendingNotifications >= this.MAX_PENDING_NOTIFICATIONS) {
            return;
        }

        this.lastNotifyTime = now;
        this.pendingNotifications++;

        // Use microtask to prevent blocking interpolation pipeline
        queueMicrotask(() => {
            this.pendingNotifications--;
            this.subscribers.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    PerformanceLogger.warn('INTERP', 'Subscriber callback error', error);
                }
            });
        });
    }
}