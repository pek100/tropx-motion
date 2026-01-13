/**
 * GridSnapLiveService: Live synchronization using time-grid interpolation.
 *
 * Same approach as BatchSynchronizer but without shear alignment:
 * - Tick-based processing at target Hz
 * - Small queue per sensor, consume one sample per tick
 * - Per-sensor prev/curr tracking for interpolation
 * - Direct SLERP to grid position
 */

import { Quaternion } from '../shared/types';
import { QuaternionService } from '../shared/QuaternionService';
import {
    AlignedSampleSet,
    AlignedSampleCallback,
    JointSide,
    Sample,
    SyncDebugStats,
} from './types';

// Device IDs (from ble-management/types.ts DeviceID enum)
const LEFT_SHIN = 0x11;
const LEFT_THIGH = 0x12;
const RIGHT_SHIN = 0x21;
const RIGHT_THIGH = 0x22;

/**
 * Per-sensor state: queue for incoming samples + prev/curr for interpolation
 */
interface SensorState {
    queue: Sample[];      // Incoming samples waiting to be consumed
    prev: Sample | null;  // Previous sample (for interpolation)
    curr: Sample | null;  // Current sample (for interpolation)
}

export class GridSnapLiveService {
    private static instance: GridSnapLiveService | null = null;

    // Per-sensor state (queue + prev/curr)
    private sensorStates: Map<number, SensorState> = new Map();

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
        // Initialize sensor states with empty queues
        const deviceIds = [LEFT_THIGH, LEFT_SHIN, RIGHT_THIGH, RIGHT_SHIN];
        for (const deviceId of deviceIds) {
            this.sensorStates.set(deviceId, { queue: [], prev: null, curr: null });
        }
    }

    /** Get singleton instance */
    static getInstance(): GridSnapLiveService {
        if (!GridSnapLiveService.instance) {
            GridSnapLiveService.instance = new GridSnapLiveService();
        }
        return GridSnapLiveService.instance;
    }

    /** Reset singleton (for testing or reinitialization) */
    static reset(): void {
        if (GridSnapLiveService.instance) {
            GridSnapLiveService.instance.cleanup();
            GridSnapLiveService.instance = null;
        }
    }

    /**
     * Start the time-grid output timer.
     * @param targetHz Output frequency (e.g., 100 for 100Hz)
     */
    start(targetHz: number): void {
        if (this.isRunning) {
            console.warn('[GridSnapLive] Already running, call stop() first');
            return;
        }

        this.tickIntervalMs = Math.floor(1000 / targetHz);
        this.isRunning = true;

        this.tickTimer = setInterval(() => {
            this.tick();
        }, this.tickIntervalMs);

        console.log(`[GridSnapLive] Started at ${targetHz}Hz (${this.tickIntervalMs}ms interval)`);
    }

    /** Stop the timer and reset state */
    stop(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        this.isRunning = false;

        // Reset grid state
        this.gridPosition = 0;
        this.gridInitialized = false;

        // Clear sensor states
        for (const deviceId of this.sensorStates.keys()) {
            this.sensorStates.set(deviceId, { queue: [], prev: null, curr: null });
        }

        // Reset stats
        this.pushCount = 0;
        this.emitCount = 0;
        this.tickCount = 0;

        console.log('[GridSnapLive] Stopped and reset');
    }

    /** Check if running */
    isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Timer tick: Consume from queues, advance grid, emit interpolated sample.
     */
    private tick(): void {
        this.tickCount++;

        // Step 1: Consume one sample from each queue (like JointAligner.consumeOneMatch)
        this.consumeFromQueues();

        // Step 2: Get data boundary (MIN of curr timestamps from complete joints)
        const dataBoundary = this.getDataBoundary();
        if (dataBoundary === null) return; // No data yet

        // Initialize grid position from first data
        if (!this.gridInitialized) {
            this.gridPosition = dataBoundary;
            this.gridInitialized = true;
            return; // Wait for next tick
        }

        // Calculate next grid position
        const nextGridPosition = this.gridPosition + this.tickIntervalMs;

        // Only advance if we have data beyond the target
        if (nextGridPosition > dataBoundary) {
            return; // Wait for more data
        }

        this.gridPosition = nextGridPosition;

        // Step 3: Interpolate and emit
        this.interpolateAndEmit();
    }

    /**
     * Consume one sample from each sensor's queue.
     * Shifts: curr → prev, queue.shift() → curr
     */
    private consumeFromQueues(): void {
        for (const state of this.sensorStates.values()) {
            if (state.queue.length > 0) {
                state.prev = state.curr;
                state.curr = state.queue.shift()!;
            }
        }
    }

    /**
     * Get data boundary for grid advancement.
     * Uses MIN of curr timestamps from complete joints.
     */
    private getDataBoundary(): number | null {
        const leftThighTs = this.sensorStates.get(LEFT_THIGH)?.curr?.timestamp ?? null;
        const leftShinTs = this.sensorStates.get(LEFT_SHIN)?.curr?.timestamp ?? null;
        const rightThighTs = this.sensorStates.get(RIGHT_THIGH)?.curr?.timestamp ?? null;
        const rightShinTs = this.sensorStates.get(RIGHT_SHIN)?.curr?.timestamp ?? null;

        // Check which joints have complete data
        const leftComplete = leftThighTs !== null && leftShinTs !== null;
        const rightComplete = rightThighTs !== null && rightShinTs !== null;

        // Get per-joint boundary
        const leftBoundary = leftComplete ? Math.min(leftThighTs!, leftShinTs!) : null;
        const rightBoundary = rightComplete ? Math.min(rightThighTs!, rightShinTs!) : null;

        // Single joint mode
        if (leftBoundary && !rightBoundary) return leftBoundary;
        if (rightBoundary && !leftBoundary) return rightBoundary;

        // Both joints - use MIN
        if (leftBoundary && rightBoundary) {
            return Math.min(leftBoundary, rightBoundary);
        }

        return null;
    }

    /**
     * Interpolate all sensors to grid position and emit.
     */
    private interpolateAndEmit(): void {
        const alignedSamples: AlignedSampleSet = {
            timestamp: this.gridPosition,
        };

        // Interpolate left knee
        const leftThighInterp = this.interpolateSensor(LEFT_THIGH, this.gridPosition);
        const leftShinInterp = this.interpolateSensor(LEFT_SHIN, this.gridPosition);
        if (leftThighInterp && leftShinInterp) {
            alignedSamples.leftKnee = {
                thigh: leftThighInterp,
                shin: leftShinInterp,
            };
        }

        // Interpolate right knee
        const rightThighInterp = this.interpolateSensor(RIGHT_THIGH, this.gridPosition);
        const rightShinInterp = this.interpolateSensor(RIGHT_SHIN, this.gridPosition);
        if (rightThighInterp && rightShinInterp) {
            alignedSamples.rightKnee = {
                thigh: rightThighInterp,
                shin: rightShinInterp,
            };
        }

        // Emit if we have any joint data
        if (alignedSamples.leftKnee || alignedSamples.rightKnee) {
            this.emitCount++;
            this.notifySubscribers(alignedSamples);
        }
    }

    /**
     * Interpolate a single sensor to grid timestamp.
     * SLERPs between prev and curr.
     */
    private interpolateSensor(deviceId: number, gridTimestamp: number): Sample | null {
        const state = this.sensorStates.get(deviceId);
        if (!state?.curr) return null;

        // Have both prev and curr - can interpolate
        if (state.prev) {
            const prevTs = state.prev.timestamp;
            const currTs = state.curr.timestamp;
            const dt = currTs - prevTs;

            if (gridTimestamp <= prevTs) {
                return { timestamp: gridTimestamp, quaternion: state.prev.quaternion };
            } else if (gridTimestamp >= currTs) {
                return { timestamp: gridTimestamp, quaternion: state.curr.quaternion };
            } else if (dt > 0) {
                const t = (gridTimestamp - prevTs) / dt;
                return {
                    timestamp: gridTimestamp,
                    quaternion: QuaternionService.slerp(
                        state.prev.quaternion,
                        state.curr.quaternion,
                        t
                    )
                };
            } else {
                return { timestamp: gridTimestamp, quaternion: state.curr.quaternion };
            }
        }

        // Only have curr - use it directly
        return { timestamp: gridTimestamp, quaternion: state.curr.quaternion };
    }

    /**
     * Push a new sample from a sensor.
     * Adds to queue - consumed one per tick.
     */
    pushSample(deviceId: number, timestamp: number, quaternion: Quaternion): void {
        const state = this.sensorStates.get(deviceId);
        if (!state) {
            console.warn(`[GridSnapLive] Unknown device ID: 0x${deviceId.toString(16)}`);
            return;
        }

        // Add to queue (consumed one per tick)
        state.queue.push({ timestamp, quaternion });

        this.pushCount++;
    }

    /** Notify all subscribers */
    private notifySubscribers(samples: AlignedSampleSet): void {
        this.subscribers.forEach(callback => {
            try {
                callback(samples);
            } catch (error) {
                console.error('[GridSnapLive] Subscriber error:', error);
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
     */
    subscribe(callback: AlignedSampleCallback): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /** Check if only one joint has data */
    isSingleJointMode(): boolean {
        const leftHasData = this.hasJointData(LEFT_THIGH, LEFT_SHIN);
        const rightHasData = this.hasJointData(RIGHT_THIGH, RIGHT_SHIN);
        return (leftHasData && !rightHasData) || (!leftHasData && rightHasData);
    }

    /** Get active joint in single joint mode */
    getActiveJoint(): JointSide | null {
        const leftHasData = this.hasJointData(LEFT_THIGH, LEFT_SHIN);
        const rightHasData = this.hasJointData(RIGHT_THIGH, RIGHT_SHIN);

        if (leftHasData && !rightHasData) return JointSide.LEFT;
        if (!leftHasData && rightHasData) return JointSide.RIGHT;
        return null;
    }

    /** Check if a joint has data */
    private hasJointData(thighId: number, shinId: number): boolean {
        const thighState = this.sensorStates.get(thighId);
        const shinState = this.sensorStates.get(shinId);
        return !!thighState?.curr && !!shinState?.curr;
    }

    /** Cleanup all state */
    cleanup(): void {
        this.stop();
        for (const deviceId of this.sensorStates.keys()) {
            this.sensorStates.set(deviceId, { queue: [], prev: null, curr: null });
        }
        this.subscribers.clear();
        this.pushCount = 0;
        this.emitCount = 0;
        this.tickCount = 0;
        this.gridPosition = 0;
        this.gridInitialized = false;
    }

    /** Get debug statistics */
    getDebugStats(): SyncDebugStats {
        const bufferStats = Array.from(this.sensorStates.entries()).map(([deviceId, state]) => ({
            deviceId,
            size: state.queue.length + (state.prev ? 1 : 0) + (state.curr ? 1 : 0),
            oldestTimestamp: state.prev?.timestamp ?? state.curr?.timestamp ?? null,
            newestTimestamp: state.queue.length > 0
                ? state.queue[state.queue.length - 1].timestamp
                : state.curr?.timestamp ?? null,
        }));

        return {
            buffers: bufferStats,
            leftKneeAligned: this.hasJointData(LEFT_THIGH, LEFT_SHIN),
            rightKneeAligned: this.hasJointData(RIGHT_THIGH, RIGHT_SHIN),
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

    /** Get detailed debug info */
    getFullDebugInfo(): object {
        const sensorInfo: Record<string, { queueLen: number; prevTs: number; currTs: number }> = {};
        for (const [deviceId, state] of this.sensorStates.entries()) {
            sensorInfo[`0x${deviceId.toString(16)}`] = {
                queueLen: state.queue.length,
                prevTs: state.prev?.timestamp ?? 0,
                currTs: state.curr?.timestamp ?? 0,
            };
        }

        return {
            stats: this.getDebugStats(),
            sensors: sensorInfo,
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
