/**
 * BatchSynchronizer: Time-grid approach for multi-sensor alignment.
 *
 * INPUT: pushSample() buffers samples as they arrive (async, bursty BLE)
 * OUTPUT: Timer ticks at targetHz, consuming ONE match per joint per tick
 *
 * This decouples input buffering from output cadence for smooth, consistent Hz.
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

// Device IDs
const LEFT_THIGH = 0x11;
const LEFT_SHIN = 0x12;
const RIGHT_THIGH = 0x21;
const RIGHT_SHIN = 0x22;

// Map device ID to joint side
const DEVICE_TO_JOINT: Map<number, JointSide> = new Map([
    [LEFT_THIGH, JointSide.LEFT],
    [LEFT_SHIN, JointSide.LEFT],
    [RIGHT_THIGH, JointSide.RIGHT],
    [RIGHT_SHIN, JointSide.RIGHT],
]);

export class BatchSynchronizer {
    private static instance: BatchSynchronizer | null = null;

    // Per-sensor buffers
    private buffers: Map<number, SensorBuffer> = new Map();

    // Joint aligners (one per knee)
    private leftKneeAligner: JointAligner;
    private rightKneeAligner: JointAligner;

    // Subscribers
    private subscribers: Set<AlignedSampleCallback> = new Set();

    // Timer for time-grid output
    private tickTimer: NodeJS.Timeout | null = null;
    private tickIntervalMs: number = 10; // Default 100Hz
    private isRunning: boolean = false;

    // Stats
    private pushCount: number = 0;
    private emitCount: number = 0;
    private tickCount: number = 0;

    // Monotonic timestamp tracking (prevents backward time jumps)
    private lastEmittedTimestamp: number = 0;

    private constructor() {
        // Initialize buffers for each sensor
        this.buffers.set(LEFT_THIGH, new SensorBuffer(LEFT_THIGH));
        this.buffers.set(LEFT_SHIN, new SensorBuffer(LEFT_SHIN));
        this.buffers.set(RIGHT_THIGH, new SensorBuffer(RIGHT_THIGH));
        this.buffers.set(RIGHT_SHIN, new SensorBuffer(RIGHT_SHIN));

        // Initialize joint aligners
        this.leftKneeAligner = new JointAligner(JointSide.LEFT);
        this.rightKneeAligner = new JointAligner(JointSide.RIGHT);

        // Connect buffers to joint aligners
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
     * Timer tick: Inter-joint aligned output.
     * 1. Peek oldest timestamps from both joints
     * 2. Calculate global MAX timestamp for unified output
     * 3. Consume one match from each joint (each manages own cleanup)
     * 4. Emit at unified global timestamp
     *
     * NOTE: No global cleanup - each joint manages its own buffer cleanup
     * to avoid discarding samples from "behind" joints.
     */
    private tick(): void {
        this.tickCount++;

        // Check if any joint has data
        const leftHasData = this.leftKneeAligner.hasAnyData();
        const rightHasData = this.rightKneeAligner.hasAnyData();

        if (!leftHasData && !rightHasData) return;

        // Step 1: Peek oldest timestamps from both joints
        const leftTs = this.leftKneeAligner.peekOldestTimestamp();
        const rightTs = this.rightKneeAligner.peekOldestTimestamp();

        // Step 2: Calculate global MAX timestamp (for unified output)
        let globalMaxTs = 0;
        if (leftTs !== null) globalMaxTs = Math.max(globalMaxTs, leftTs);
        if (rightTs !== null) globalMaxTs = Math.max(globalMaxTs, rightTs);

        if (globalMaxTs === 0) return;

        // Step 2b: Ensure monotonic timestamps (prevent backward jumps)
        globalMaxTs = Math.max(globalMaxTs, this.lastEmittedTimestamp);

        // Step 3: Consume one match from each joint
        // Each joint's consumeOneMatch() handles its own cleanup
        const leftMatch = this.leftKneeAligner.consumeOneMatch();
        const rightMatch = this.rightKneeAligner.consumeOneMatch();

        // Step 4: Emit at unified global timestamp
        if (leftMatch || rightMatch) {
            this.lastEmittedTimestamp = globalMaxTs;
            this.emitCombinedMatch(leftMatch, rightMatch, globalMaxTs);
        }
    }

    /** Emit a combined AlignedSampleSet at unified global timestamp */
    private emitCombinedMatch(
        leftMatch: JointSamples | null,
        rightMatch: JointSamples | null,
        globalTimestamp: number
    ): void {
        const alignedSamples: AlignedSampleSet = {
            timestamp: globalTimestamp,
        };

        if (leftMatch) {
            alignedSamples.leftKnee = leftMatch;
        }
        if (rightMatch) {
            alignedSamples.rightKnee = rightMatch;
        }

        this.emitCount++;
        this.notifySubscribers(alignedSamples);
    }

    /**
     * Push a new sample from a sensor.
     * BUFFER ONLY - no immediate emit. Timer handles output.
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
        const leftHasData = this.leftKneeAligner.hasData();
        const rightHasData = this.rightKneeAligner.hasData();
        return (leftHasData && !rightHasData) || (!leftHasData && rightHasData);
    }

    /** Get active joint in single joint mode */
    getActiveJoint(): JointSide | null {
        const leftHasData = this.leftKneeAligner.hasData();
        const rightHasData = this.rightKneeAligner.hasData();

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
        this.lastEmittedTimestamp = 0;
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
            leftKneeAligned: this.leftKneeAligner.hasData(),
            rightKneeAligned: this.rightKneeAligner.hasData(),
            globalAligned: true,
            scanWindowPosition: 0,
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

    /** Get detailed debug info for all components */
    getFullDebugInfo(): object {
        return {
            stats: this.getDebugStats(),
            leftKnee: this.leftKneeAligner.getDebugInfo(),
            rightKnee: this.rightKneeAligner.getDebugInfo(),
            pushCount: this.pushCount,
            emitCount: this.emitCount,
            tickCount: this.tickCount,
            isRunning: this.isRunning,
            tickIntervalMs: this.tickIntervalMs,
        };
    }
}
