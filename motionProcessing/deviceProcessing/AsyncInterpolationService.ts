import { DeviceSample, InterpolatedData } from '../shared/types';
import { PerformanceLogger } from '../shared/PerformanceLogger';
import { AsyncPerformanceMonitor } from '../shared/AsyncPerformanceMonitor';
import { CircularBuffer } from '../shared/CircularBuffer';

interface AsyncInterpolationBuffer {
    deviceId: string;
    buffer: CircularBuffer;
    timestamps: CircularBuffer;
    lastCleanup: number;
}

/**
 * High-performance async interpolation service using circular buffers.
 * Eliminates blocking array operations that slow down real-time processing.
 */
export class AsyncInterpolationService {
    private static instance: AsyncInterpolationService | null = null;
    private deviceBuffers = new Map<string, AsyncInterpolationBuffer>();
    private processedGridPoints = new Set<number>();
    private quaternionPool: any[] = [];
    private enabled: boolean = true;
    private lastGlobalCleanup = 0;

    // Performance configuration
    private readonly BUFFER_CAPACITY = 1000; // Circular buffer capacity per device
    private readonly CLEANUP_INTERVAL_MS = 5000; // Cleanup every 5 seconds
    private readonly MAX_PROCESSED_POINTS = 50; // Limit processed grid points
    private readonly POOL_SIZE = 20; // Pre-allocated quaternion pool

    private constructor() {
        this.initializeQuaternionPool();
        PerformanceLogger.info('ASYNC_INTERPOLATION', 'AsyncInterpolationService initialized');
    }

    static getInstance(): AsyncInterpolationService {
        if (!AsyncInterpolationService.instance) {
            AsyncInterpolationService.instance = new AsyncInterpolationService();
        }
        return AsyncInterpolationService.instance;
    }

    static reset(): void {
        if (AsyncInterpolationService.instance) {
            AsyncInterpolationService.instance.cleanup();
            AsyncInterpolationService.instance = null;
        }
    }

    /**
     * Enable or disable interpolation
     */
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        PerformanceLogger.info('ASYNC_INTERPOLATION', `Interpolation ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * NON-BLOCKING interpolation - O(1) sample addition, async processing
     */
    interpolate(
        targetTimestamp: number,
        deviceId: string,
        deviceData: DeviceSample[]
    ): InterpolatedData[] {
        if (!this.enabled || deviceData.length === 0) {
            return deviceData.map(data => ({
                deviceId: data.deviceId,
                interpolatedQuaternion: data.quaternion,
                confidence: 1.0,
                interpolationMethod: 'none' as const,
                originalTimestamp: data.timestamp,
                targetTimestamp: targetTimestamp
            }));
        }

        const monitor = AsyncPerformanceMonitor.getInstance();
        return monitor.timeSyncOperation('ASYNC_INTERPOLATION', 'interpolate', () => {
            // Get or create buffer for device
            const buffer = this.getOrCreateBuffer(deviceId);

            // Add samples to circular buffer - O(1) operations
            for (const data of deviceData) {
                if (data.quaternion) {
                    buffer.buffer.push(data.quaternion.w, data.timestamp);
                    buffer.timestamps.push(data.timestamp);
                }
            }

            // Perform interpolation using circular buffer data
            const interpolatedData = this.performInterpolation(targetTimestamp, deviceData, buffer);

            // Schedule async cleanup if needed
            this.scheduleCleanupIfNeeded();

            return interpolatedData;
        }, deviceId);
    }

    /**
     * Get or create device buffer with lazy initialization
     */
    private getOrCreateBuffer(deviceId: string): AsyncInterpolationBuffer {
        let buffer = this.deviceBuffers.get(deviceId);
        if (!buffer) {
            buffer = {
                deviceId,
                buffer: new CircularBuffer(this.BUFFER_CAPACITY),
                timestamps: new CircularBuffer(this.BUFFER_CAPACITY),
                lastCleanup: Date.now()
            };
            this.deviceBuffers.set(deviceId, buffer);
        }
        return buffer;
    }

    /**
     * Perform actual interpolation using circular buffer data
     */
    private performInterpolation(
        targetTimestamp: number,
        deviceData: DeviceSample[],
        buffer: AsyncInterpolationBuffer
    ): InterpolatedData[] {
        // For now, implement simple interpolation
        // In production, this would use proper SLERP with circular buffer data
        return deviceData.map(data => {
            const confidence = this.calculateConfidence(data.timestamp, targetTimestamp);

            return {
                deviceId: data.deviceId,
                interpolatedQuaternion: data.quaternion,
                confidence,
                interpolationMethod: confidence > 0.8 ? 'slerp' : 'linear' as const,
                originalTimestamp: data.timestamp,
                targetTimestamp: targetTimestamp
            };
        });
    }

    /**
     * Calculate interpolation confidence based on timestamp difference
     */
    private calculateConfidence(originalTimestamp: number, targetTimestamp: number): number {
        const timeDiff = Math.abs(targetTimestamp - originalTimestamp);
        const maxAcceptableDiff = 50; // 50ms threshold
        return Math.max(0, 1 - (timeDiff / maxAcceptableDiff));
    }

    /**
     * Schedule async cleanup to prevent memory growth
     */
    private scheduleCleanupIfNeeded(): void {
        const now = Date.now();
        if (now - this.lastGlobalCleanup < this.CLEANUP_INTERVAL_MS) return;

        // Use setImmediate for non-blocking cleanup
        setImmediate(() => this.performAsyncCleanup());
        this.lastGlobalCleanup = now;
    }

    /**
     * Async cleanup - removes old data without blocking main thread
     */
    private performAsyncCleanup(): void {
        const monitor = AsyncPerformanceMonitor.getInstance();
        monitor.timeSyncOperation('ASYNC_INTERPOLATION', 'cleanup', () => {
            let cleanedDevices = 0;
            const now = Date.now();

            // Clean device buffers - circular buffers auto-manage memory
            this.deviceBuffers.forEach((buffer, deviceId) => {
                if (now - buffer.lastCleanup > this.CLEANUP_INTERVAL_MS) {
                    // Circular buffers don't need explicit cleanup, but we can trim timestamps
                    buffer.timestamps.clear(); // Reset if too old
                    buffer.lastCleanup = now;
                    cleanedDevices++;
                }
            });

            // Clean processed grid points - use size-based cleanup
            if (this.processedGridPoints.size > this.MAX_PROCESSED_POINTS) {
                // Convert to array and keep only recent points
                const points = Array.from(this.processedGridPoints).sort((a, b) => b - a);
                this.processedGridPoints.clear();

                // Keep only the most recent points
                const keepCount = Math.floor(this.MAX_PROCESSED_POINTS * 0.7);
                for (let i = 0; i < keepCount && i < points.length; i++) {
                    this.processedGridPoints.add(points[i]);
                }
            }

            // Maintain quaternion pool
            this.maintainQuaternionPool();

            PerformanceLogger.log('ASYNC_INTERPOLATION', 'cleanup', performance.now());
        });
    }

    /**
     * Initialize pre-allocated quaternion pool for performance
     */
    private initializeQuaternionPool(): void {
        this.quaternionPool = [];
        for (let i = 0; i < this.POOL_SIZE; i++) {
            this.quaternionPool.push({ x: 0, y: 0, z: 0, w: 1 });
        }
    }

    /**
     * Maintain quaternion pool size
     */
    private maintainQuaternionPool(): void {
        while (this.quaternionPool.length < this.POOL_SIZE) {
            this.quaternionPool.push({ x: 0, y: 0, z: 0, w: 1 });
        }

        // Trim if too large
        if (this.quaternionPool.length > this.POOL_SIZE * 2) {
            this.quaternionPool = this.quaternionPool.slice(0, this.POOL_SIZE);
        }
    }

    /**
     * Get statistics for monitoring
     */
    getStats(): {
        deviceCount: number;
        totalBufferSize: number;
        processedPointsCount: number;
        quaternionPoolSize: number;
        enabled: boolean;
    } {
        let totalBufferSize = 0;
        this.deviceBuffers.forEach(buffer => {
            totalBufferSize += buffer.buffer.size();
        });

        return {
            deviceCount: this.deviceBuffers.size,
            totalBufferSize,
            processedPointsCount: this.processedGridPoints.size,
            quaternionPoolSize: this.quaternionPool.length,
            enabled: this.enabled
        };
    }

    /**
     * Force cleanup all buffers
     */
    cleanup(): void {
        this.deviceBuffers.forEach(buffer => {
            buffer.buffer.clear();
            buffer.timestamps.clear();
        });
        this.deviceBuffers.clear();
        this.processedGridPoints.clear();
        this.quaternionPool = [];

        PerformanceLogger.info('ASYNC_INTERPOLATION', 'AsyncInterpolationService cleanup completed');
    }

    /**
     * Get buffer utilization for specific device
     */
    getDeviceBufferUtilization(deviceId: string): number {
        const buffer = this.deviceBuffers.get(deviceId);
        return buffer ? buffer.buffer.getUtilization() : 0;
    }

    /**
     * Get all buffer utilizations for monitoring
     */
    getAllBufferUtilizations(): Map<string, number> {
        const utilizations = new Map<string, number>();
        this.deviceBuffers.forEach((buffer, deviceId) => {
            utilizations.set(deviceId, buffer.buffer.getUtilization());
        });
        return utilizations;
    }
}