import { JointAngleData, SessionContext, APIRecording, APIJoint, APIMeasurement } from '../shared/types';
import { JointStatisticsManager } from '../shared/JointStatisticsManager';
import { CircularBuffer } from '../shared/CircularBuffer';
import { Cache } from '../shared/cache';
import { v4 as uuidv4 } from 'uuid';
import { CACHE } from '../shared/constants';
import { roundToPrecision, getCurrentTimestamp, convertSensorTimeToUTC } from '../shared/utils';
import { PerformanceLogger } from '../shared/PerformanceLogger';
import { AsyncPerformanceMonitor } from '../shared/AsyncPerformanceMonitor';

interface AsyncJointBuffer {
    buffer: CircularBuffer;
    statsManager: JointStatisticsManager;
    startTime: number;
    lastUpdate: number;
}

interface PendingAngleData {
    angleData: JointAngleData;
    timestamp: number;
}

/**
 * High-performance async data parser with non-blocking joint angle accumulation.
 * Uses circular buffers and batch processing to eliminate inter-joint blocking.
 *
 * Key Features:
 * - O(1) data accumulation per joint
 * - Per-joint circular buffers prevent memory growth
 * - Batch processing eliminates blocking between joints
 * - Async processing maintains real-time performance
 */
export class AsyncDataParser {
    private static instance: AsyncDataParser | null = null;
    private recordingCache: Cache<APIRecording>;
    private recordingId: string | null = null;
    private jointBuffers = new Map<string, AsyncJointBuffer>();
    private jointIds = new Map<string, string>();
    private recordingStartTime: number = 0;
    private targetHz: number;

    // Async processing queues
    private pendingQueue: PendingAngleData[] = [];
    private processingTimer: NodeJS.Timeout | NodeJS.Immediate | null = null;
    private isProcessing: boolean = false;

    // Performance tracking
    private accumulationCount = 0;
    private batchProcessingCount = 0;
    private lastPerformanceLog = 0;

    // Configuration
    private readonly BATCH_INTERVAL_MS = 8; // ~120fps batch processing
    private readonly MAX_BATCH_SIZE = 50; // Process up to 50 samples per batch
    private readonly BUFFER_CAPACITY = 10000; // 10k samples per joint (~100 seconds at 100Hz)
    private readonly PERFORMANCE_LOG_INTERVAL = 5000; // Log every 5 seconds

    private constructor(targetHz: number) {
        this.recordingCache = new Cache<APIRecording>(CACHE.RECORDING_SIZE, CACHE.RECORDING_TTL_MS);
        this.targetHz = targetHz;
        // Initialize performance monitoring
        AsyncPerformanceMonitor.getInstance();
        PerformanceLogger.info('ASYNC_PARSER', 'AsyncDataParser initialized with non-blocking architecture');
    }

    /**
     * Returns singleton instance with specified target frequency
     */
    static getInstance(targetHz: number): AsyncDataParser {
        if (!AsyncDataParser.instance) {
            AsyncDataParser.instance = new AsyncDataParser(targetHz);
        }
        return AsyncDataParser.instance;
    }

    /**
     * Resets singleton instance and cleans up resources
     */
    static reset(): void {
        if (AsyncDataParser.instance) {
            AsyncDataParser.instance.cleanup();
            AsyncDataParser.instance = null;
        }
    }

    /**
     * Initialize new recording session
     */
    startNewRecording(): void {
        this.recordingId = uuidv4();
        this.recordingStartTime = getCurrentTimestamp();
        this.clearAllBuffers();
        PerformanceLogger.info('ASYNC_PARSER', `Started recording: ${this.recordingId}`);
    }

    /**
     * NON-BLOCKING angle data accumulation - O(1) operation
     * Immediately returns without blocking other joints
     */
    accumulateAngleData(angleData: JointAngleData): void {
        if (!this.recordingId) return;

        // Monitor this critical path for blocking behavior
        const monitor = AsyncPerformanceMonitor.getInstance();
        monitor.timeSyncOperation('ASYNC_PARSER', 'accumulate_enqueue', () => {
            // CRITICAL: Ultra-fast enqueue - no processing here!
            this.pendingQueue.push({
                angleData: { ...angleData }, // Defensive copy
                timestamp: Date.now()
            });

            this.accumulationCount++;

            // Schedule async batch processing if not already scheduled
            this.scheduleBatchProcessing();
        }, angleData.jointName);

        // Periodic performance logging
        this.logPerformanceMetrics();
    }

    /**
     * Create final recording from all accumulated data
     */
    createFinalRecording(context: SessionContext): APIRecording | null {
        if (!this.recordingId || this.jointBuffers.size === 0) {
            PerformanceLogger.warn('ASYNC_PARSER', 'No recording data available for final recording');
            return null;
        }

        // Force process any remaining queued data
        this.flushPendingData();

        const finalTimestamp = getCurrentTimestamp();
        const { joints, measurements } = this.buildRecordingData(finalTimestamp);

        if (joints.length === 0) {
            PerformanceLogger.warn('ASYNC_PARSER', 'No joint data found for final recording');
            return null;
        }

        const recording = this.createRecordingObject(context, finalTimestamp, joints, measurements);
        this.cacheRecording(recording);

        PerformanceLogger.info('ASYNC_PARSER', `Final recording created with ${joints.length} joints`);
        return recording;
    }

    /**
     * Get current recording statistics
     */
    getRecordingStats(): { jointCount: number; pendingCount: number; totalSamples: number } {
        let totalSamples = 0;
        this.jointBuffers.forEach(buffer => {
            totalSamples += buffer.buffer.size();
        });

        return {
            jointCount: this.jointBuffers.size,
            pendingCount: this.pendingQueue.length,
            totalSamples
        };
    }

    /**
     * Get buffer utilization for monitoring
     */
    getBufferUtilization(): Map<string, number> {
        const utilization = new Map<string, number>();
        this.jointBuffers.forEach((buffer, jointName) => {
            utilization.set(jointName, buffer.buffer.getUtilization());
        });
        return utilization;
    }

    /**
     * Get current recording ID
     */
    getRecordingId(): string | null {
        return this.recordingId;
    }

    /**
     * Complete cleanup
     */
    cleanup(): void {
        // Stop async processing
        if (this.processingTimer) {
            try {
                clearTimeout(this.processingTimer as NodeJS.Timeout);
            } catch {
                try {
                    clearImmediate(this.processingTimer as NodeJS.Immediate);
                } catch {
                    // Fallback - timer will eventually clear itself
                }
            }
            this.processingTimer = null;
        }

        // Clear all data
        this.recordingCache.cleanup();
        this.recordingId = null;
        this.recordingStartTime = 0;
        this.clearAllBuffers();
        this.pendingQueue = [];
        this.isProcessing = false;

        PerformanceLogger.info('ASYNC_PARSER', 'AsyncDataParser cleanup completed');
    }

    /**
     * Schedule non-blocking batch processing
     */
    private scheduleBatchProcessing(): void {
        // Don't schedule if already processing or timer exists
        if (this.processingTimer || this.isProcessing) return;

        // Force immediate processing if queue is large
        if (this.pendingQueue.length >= this.MAX_BATCH_SIZE) {
            this.processingTimer = setImmediate(() => this.processBatch());
        } else {
            // Regular batched processing
            this.processingTimer = setTimeout(() => this.processBatch(), this.BATCH_INTERVAL_MS);
        }
    }

    /**
     * Process batch of pending angle data asynchronously
     */
    private processBatch(): void {
        this.processingTimer = null;

        if (this.pendingQueue.length === 0 || this.isProcessing) return;

        this.isProcessing = true;
        const monitor = AsyncPerformanceMonitor.getInstance();

        monitor.timeSyncOperation('ASYNC_PARSER', 'batch_processing', () => {
            try {
                // Extract batch to process
                const batchSize = Math.min(this.pendingQueue.length, this.MAX_BATCH_SIZE);
                const batch = this.pendingQueue.splice(0, batchSize);

                // Process all samples in batch
                for (const { angleData } of batch) {
                    // Monitor individual sample processing
                    monitor.timeSyncOperation('ASYNC_PARSER', 'sample_processing', () => {
                        this.processAngleDataSync(angleData);
                    }, angleData.jointName);
                }

                this.batchProcessingCount++;

                // Schedule next batch if more data pending
                if (this.pendingQueue.length > 0) {
                    this.scheduleBatchProcessing();
                }

            } catch (error) {
                PerformanceLogger.warn('ASYNC_PARSER', 'Batch processing error', error);
            } finally {
                this.isProcessing = false;
            }
        });
    }

    /**
     * Process single angle data synchronously (within batch)
     */
    private processAngleDataSync(angleData: JointAngleData): void {
        const jointId = this.getOrCreateJointId(angleData.jointName);
        const buffer = this.getOrCreateJointBuffer(angleData.jointName, angleData.timestamp);
        const roundedAngle = roundToPrecision(angleData.angle);

        // O(1) operations only!
        buffer.buffer.push(roundedAngle, angleData.timestamp);
        buffer.statsManager.updateStats(angleData.jointName, roundedAngle);
        buffer.lastUpdate = convertSensorTimeToUTC(angleData.timestamp, this.recordingStartTime);
    }

    /**
     * Force process all pending data synchronously
     */
    private flushPendingData(): void {
        if (this.pendingQueue.length === 0) return;

        const start = performance.now();
        const batch = this.pendingQueue.splice(0);

        for (const { angleData } of batch) {
            this.processAngleDataSync(angleData);
        }

        const duration = performance.now() - start;
        PerformanceLogger.info('ASYNC_PARSER', `Flushed ${batch.length} pending samples in ${duration.toFixed(2)}ms`);
    }

    /**
     * Get or create joint ID with lazy initialization
     */
    private getOrCreateJointId(jointName: string): string {
        let jointId = this.jointIds.get(jointName);
        if (!jointId) {
            jointId = uuidv4();
            this.jointIds.set(jointName, jointId);
        }
        return jointId;
    }

    /**
     * Get or create joint buffer with lazy initialization
     */
    private getOrCreateJointBuffer(jointName: string, timestamp: number): AsyncJointBuffer {
        let buffer = this.jointBuffers.get(jointName);
        if (!buffer) {
            buffer = {
                buffer: new CircularBuffer(this.BUFFER_CAPACITY),
                statsManager: new JointStatisticsManager(this.targetHz),
                startTime: convertSensorTimeToUTC(timestamp, this.recordingStartTime),
                lastUpdate: convertSensorTimeToUTC(timestamp, this.recordingStartTime)
            };
            this.jointBuffers.set(jointName, buffer);
        }
        return buffer;
    }

    /**
     * Build final recording data from all joint buffers
     */
    private buildRecordingData(finalTimestamp: number): { joints: APIJoint[], measurements: APIMeasurement[] } {
        const joints: APIJoint[] = [];
        const measurements: APIMeasurement[] = [];

        this.jointIds.forEach((jointId, jointName) => {
            const buffer = this.jointBuffers.get(jointName);
            if (!buffer || buffer.buffer.size() === 0) return;

            const joint = this.createJointData(jointName, jointId, finalTimestamp, buffer);
            const measurement = this.createMeasurementData(jointId, buffer);

            if (joint && measurement) {
                joints.push(joint);
                measurements.push(measurement);
            }
        });

        return { joints, measurements };
    }

    /**
     * Create API joint object from buffer data
     */
    private createJointData(
        jointName: string,
        jointId: string,
        finalTimestamp: number,
        buffer: AsyncJointBuffer
    ): APIJoint | null {
        const currentAngle = buffer.buffer.getLatest();
        if (currentAngle === null) return null;

        return buffer.statsManager.getAPIJoint(jointName, currentAngle, finalTimestamp, jointId);
    }

    /**
     * Create API measurement object from buffer data
     */
    private createMeasurementData(jointId: string, buffer: AsyncJointBuffer): APIMeasurement | null {
        const values = buffer.buffer.getValues();
        if (values.length === 0) return null;

        return {
            joint_id: jointId,
            start_time: new Date(buffer.startTime).toISOString(),
            values: values
        };
    }

    /**
     * Create complete API recording object
     */
    private createRecordingObject(
        context: SessionContext,
        finalTimestamp: number,
        joints: APIJoint[],
        measurements: APIMeasurement[]
    ): APIRecording {
        return {
            id: this.recordingId!,
            session_instance_id: context.sessionId,
            exercise_instance_id: context.exerciseId,
            set: context.setNumber,
            timestamp: new Date(this.recordingStartTime).toISOString(),
            duration: Math.round((finalTimestamp - this.recordingStartTime) / 1000),
            reps_completed: 0,
            joints_arr: joints,
            measurement_sequences: measurements
        };
    }

    /**
     * Cache completed recording
     */
    private cacheRecording(recording: APIRecording): void {
        this.recordingCache.set(`${this.recordingId}-final`, recording);
    }

    /**
     * Clear all buffers and reset state
     */
    private clearAllBuffers(): void {
        this.jointBuffers.clear();
        this.jointIds.clear();
        this.pendingQueue = [];
        this.accumulationCount = 0;
        this.batchProcessingCount = 0;
    }

    /**
     * Log performance metrics periodically
     */
    private logPerformanceMetrics(): void {
        const now = Date.now();
        if (now - this.lastPerformanceLog < this.PERFORMANCE_LOG_INTERVAL) return;

        this.lastPerformanceLog = now;
        const stats = this.getRecordingStats();

        PerformanceLogger.info('ASYNC_PARSER',
            `Performance: ${this.accumulationCount} accumulations, ${this.batchProcessingCount} batches, ` +
            `${stats.jointCount} joints, ${stats.pendingCount} pending, ${stats.totalSamples} total samples`
        );
    }
}