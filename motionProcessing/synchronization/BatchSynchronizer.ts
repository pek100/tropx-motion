/**
 * BatchSynchronizer: Hierarchical shear alignment + time-grid interpolation.
 *
 * Two-stage processing:
 * 1. SHEAR ALIGNMENT: Aligns all 4 sensors to same scan line position
 * 2. TIME-GRID INTERPOLATION: SLERP to uniform Hz output (inline, no extra buffer)
 */

import { Quaternion } from '../shared/types';
import { SensorBuffer } from './SensorBuffer';
import { JointAligner } from './JointAligner';
import {
    AlignedSampleSet,
    AlignedSampleCallback,
    JointSide,
    JointSamples,
    SyncDebugStats,
} from './types';

// Device IDs (from ble-management/types.ts DeviceID enum)
// Upper nibble: joint (1=left, 2=right), Lower nibble: position (1=shin, 2=thigh)
const LEFT_SHIN = 0x11;   // Left joint, shin position
const LEFT_THIGH = 0x12;  // Left joint, thigh position
const RIGHT_SHIN = 0x21;  // Right joint, shin position
const RIGHT_THIGH = 0x22; // Right joint, thigh position

export class BatchSynchronizer {
    private static instance: BatchSynchronizer | null = null;

    // Per-sensor raw buffers (input stage)
    private buffers: Map<number, SensorBuffer> = new Map();

    // Joint aligners for shear alignment + inline interpolation
    private leftKneeAligner: JointAligner;
    private rightKneeAligner: JointAligner;

    // Subscribers
    private subscribers: Set<AlignedSampleCallback> = new Set();

    // Timer for time-grid output
    private tickTimer: NodeJS.Timeout | null = null;
    private tickIntervalMs: number = 10; // Default 100Hz
    private isRunning: boolean = false;

    // Time grid position (advances monotonically at fixed Hz)
    private gridPosition: number = 0;
    private gridInitialized: boolean = false;

    // Stats
    private pushCount: number = 0;
    private emitCount: number = 0;
    private tickCount: number = 0;

    private constructor() {
        // Initialize raw buffers for each sensor
        this.buffers.set(LEFT_THIGH, new SensorBuffer(LEFT_THIGH));
        this.buffers.set(LEFT_SHIN, new SensorBuffer(LEFT_SHIN));
        this.buffers.set(RIGHT_THIGH, new SensorBuffer(RIGHT_THIGH));
        this.buffers.set(RIGHT_SHIN, new SensorBuffer(RIGHT_SHIN));

        // Initialize joint aligners
        this.leftKneeAligner = new JointAligner(JointSide.LEFT);
        this.rightKneeAligner = new JointAligner(JointSide.RIGHT);

        // Connect raw buffers to joint aligners
        this.leftKneeAligner.setBuffers(
            this.buffers.get(LEFT_THIGH)!,
            this.buffers.get(LEFT_SHIN)!
        );
        this.rightKneeAligner.setBuffers(
            this.buffers.get(RIGHT_THIGH)!,
            this.buffers.get(RIGHT_SHIN)!
        );
    }

    /** Get singleton instance */
    static getInstance(): BatchSynchronizer {
        if (!BatchSynchronizer.instance) {
            BatchSynchronizer.instance = new BatchSynchronizer();
        }
        return BatchSynchronizer.instance;
    }

    /** Reset singleton (for testing or reinitialization) */
    static reset(): void {
        if (BatchSynchronizer.instance) {
            BatchSynchronizer.instance.cleanup();
            BatchSynchronizer.instance = null;
        }
    }

    /**
     * Start the time-grid output timer.
     * @param targetHz Output frequency (e.g., 100 for 100Hz)
     */
    start(targetHz: number): void {
        if (this.isRunning) {
            console.warn('[BatchSync] Already running, call stop() first');
            return;
        }

        this.tickIntervalMs = Math.floor(1000 / targetHz);
        this.isRunning = true;

        this.tickTimer = setInterval(() => {
            this.tick();
        }, this.tickIntervalMs);

        console.log(`[BatchSync] Started at ${targetHz}Hz (${this.tickIntervalMs}ms interval)`);
    }

    /** Stop the time-grid output timer */
    stop(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        this.isRunning = false;
        console.log('[BatchSync] Stopped');
    }

    /** Check if timer is running */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Timer tick: Three-stage hierarchical processing.
     * 1. INTRA-JOINT shear: Align thigh↔shin within each joint
     * 2. INTER-JOINT shear: Align left↔right joints to same scan line
     * 3. GRID interpolation: SLERP all 4 sensors to exact grid position
     */
    private tick(): void {
        this.tickCount++;

        // Stage 1: INTRA-JOINT shear (thigh↔shin per joint)
        this.leftKneeAligner.consumeOneMatch();
        this.rightKneeAligner.consumeOneMatch();

        // Stage 2: INTER-JOINT shear (compute aligned scan line)
        const scanLineTs = this.computeInterJointScanLine();
        if (scanLineTs === null) return;  // No data yet

        // Stage 3: Grid interpolation (all 4 sensors to grid)
        this.interpolateAndEmit(scanLineTs);
    }

    /**
     * Stage 2: Compute inter-joint scan line timestamp.
     * Aligns left and right joints to the same temporal position.
     * Uses MIN of joint timestamps to avoid extrapolation.
     */
    private computeInterJointScanLine(): number | null {
        const leftTs = this.leftKneeAligner.getNewestTimestamp();
        const rightTs = this.rightKneeAligner.getNewestTimestamp();

        // No data from either joint
        if (!leftTs && !rightTs) return null;

        // Single joint mode - use that joint's timestamp
        if (!leftTs) return rightTs;
        if (!rightTs) return leftTs;

        // Both joints have data - align to MIN (don't extrapolate beyond available data)
        return Math.min(leftTs, rightTs);
    }

    /**
     * Stage 3: Advance time grid and emit interpolated samples.
     * @param scanLineTs - Inter-joint aligned timestamp (from Stage 2)
     */
    private interpolateAndEmit(scanLineTs: number): void {
        // Initialize grid position from first scan line
        if (!this.gridInitialized) {
            this.gridPosition = scanLineTs;
            this.gridInitialized = true;
            return;  // Wait for next tick to have bracketing data
        }

        // Calculate next grid position
        const nextGridPosition = this.gridPosition + this.tickIntervalMs;

        // Only advance if scan line has enough data
        if (nextGridPosition > scanLineTs) {
            return;  // Wait for more data
        }

        this.gridPosition = nextGridPosition;

        // Interpolate all 4 sensors to grid position
        const leftInterp = this.leftKneeAligner.getInterpolatedAt(this.gridPosition);
        const rightInterp = this.rightKneeAligner.getInterpolatedAt(this.gridPosition);

        // Build aligned sample set
        const alignedSamples: AlignedSampleSet = {
            timestamp: this.gridPosition,
        };

        if (leftInterp && leftInterp.thigh && leftInterp.shin) {
            alignedSamples.leftKnee = leftInterp;
        }

        if (rightInterp && rightInterp.thigh && rightInterp.shin) {
            alignedSamples.rightKnee = rightInterp;
        }

        // Emit if we have any joint data
        if (alignedSamples.leftKnee || alignedSamples.rightKnee) {
            this.emitCount++;
            this.notifySubscribers(alignedSamples);
        }
    }

    /**
     * Push a new sample from a sensor.
     * Goes to raw buffer for shear alignment.
     */
    pushSample(deviceId: number, timestamp: number, quaternion: Quaternion): void {
        const buffer = this.buffers.get(deviceId);
        if (!buffer) {
            console.warn(`[BatchSync] Unknown device ID: 0x${deviceId.toString(16)}`);
            return;
        }

        buffer.addSample(timestamp, quaternion);
        this.pushCount++;
    }

    /** Notify all subscribers of new aligned data */
    private notifySubscribers(samples: AlignedSampleSet): void {
        this.subscribers.forEach(callback => {
            try {
                callback(samples);
            } catch (error) {
                console.error('[BatchSync] Subscriber error:', error);
            }
        });
    }

    /**
     * Push sample using device ID as number or hex string.
     */
    pushSampleFromDevice(deviceIdInput: number | string, timestamp: number, quaternion: Quaternion): void {
        let deviceId: number;

        if (typeof deviceIdInput === 'string') {
            deviceId = deviceIdInput.startsWith('0x')
                ? parseInt(deviceIdInput, 16)
                : parseInt(deviceIdInput, 10);
        } else {
            deviceId = deviceIdInput;
        }

        this.pushSample(deviceId, timestamp, quaternion);
    }

    /**
     * Subscribe to aligned sample output.
     * Returns unsubscribe function.
     */
    subscribe(callback: AlignedSampleCallback): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /** Check if only one joint has data */
    isSingleJointMode(): boolean {
        const leftHasData = this.leftKneeAligner.hasAnyData();
        const rightHasData = this.rightKneeAligner.hasAnyData();
        return (leftHasData && !rightHasData) || (!leftHasData && rightHasData);
    }

    /** Get active joint in single joint mode */
    getActiveJoint(): JointSide | null {
        const leftHasData = this.leftKneeAligner.hasAnyData();
        const rightHasData = this.rightKneeAligner.hasAnyData();

        if (leftHasData && !rightHasData) return JointSide.LEFT;
        if (!leftHasData && rightHasData) return JointSide.RIGHT;
        return null;
    }

    /** Get buffer for specific device (for debugging) */
    getBuffer(deviceId: number): SensorBuffer | undefined {
        return this.buffers.get(deviceId);
    }

    /** Cleanup all state */
    cleanup(): void {
        this.stop();
        this.buffers.forEach(buffer => buffer.clear());
        this.leftKneeAligner.reset();
        this.rightKneeAligner.reset();
        this.subscribers.clear();
        this.pushCount = 0;
        this.emitCount = 0;
        this.tickCount = 0;
        this.gridPosition = 0;
        this.gridInitialized = false;
    }

    /** Get debug statistics */
    getDebugStats(): SyncDebugStats {
        const bufferStats = Array.from(this.buffers.entries()).map(([deviceId, buffer]) => ({
            deviceId,
            size: buffer.getSize(),
            oldestTimestamp: buffer.getOldestTimestamp(),
            newestTimestamp: buffer.getNewestTimestamp(),
        }));

        return {
            buffers: bufferStats,
            leftKneeAligned: this.leftKneeAligner.hasAnyData(),
            rightKneeAligned: this.rightKneeAligner.hasAnyData(),
            globalAligned: true,
            scanWindowPosition: this.gridPosition,
            outputCount: this.emitCount,
        };
    }

    /** Get push count */
    getPushCount(): number {
        return this.pushCount;
    }

    /** Get emit count */
    getEmitCount(): number {
        return this.emitCount;
    }

    /** Get tick count */
    getTickCount(): number {
        return this.tickCount;
    }

    /** Get current grid position */
    getGridPosition(): number {
        return this.gridPosition;
    }

    /** Get detailed debug info for all components */
    getFullDebugInfo(): object {
        return {
            stats: this.getDebugStats(),
            leftKnee: this.leftKneeAligner.getDebugInfo(),
            rightKnee: this.rightKneeAligner.getDebugInfo(),
            pushCount: this.pushCount,
            emitCount: this.emitCount,
            tickCount: this.tickCount,
            gridPosition: this.gridPosition,
            gridInitialized: this.gridInitialized,
            isRunning: this.isRunning,
            tickIntervalMs: this.tickIntervalMs,
        };
    }
}
