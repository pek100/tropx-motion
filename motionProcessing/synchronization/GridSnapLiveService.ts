/**
 * GridSnapLiveService: Live synchronization using the SAME flow as recording.
 *
 * Uses the exact same components as recording playback:
 * - SensorBuffer for per-sensor sample storage with binary search
 * - GridSnapService.snapSinglePoint() to find brackets
 * - InterpolationService.interpolateSinglePoint() for SLERP interpolation
 *
 * Only difference from recording: processes a sliding window of ~10 samples
 * instead of the entire recording batch.
 */

import { Quaternion } from '../shared/types';
import { SensorBuffer } from './SensorBuffer';
import { GridSnapService, SensorBufferRefs } from '../recording/GridSnapService';
import { InterpolationService } from '../recording/InterpolationService';
import {
    AlignedSampleSet,
    AlignedSampleCallback,
    JointSide,
    SyncDebugStats,
} from './types';

// Device IDs (from ble-management/types.ts DeviceID enum)
const LEFT_SHIN = 0x11;
const LEFT_THIGH = 0x12;
const RIGHT_SHIN = 0x21;
const RIGHT_THIGH = 0x22;

export class GridSnapLiveService {
    private static instance: GridSnapLiveService | null = null;

    // Per-sensor buffers (same as recording uses)
    private buffers: SensorBufferRefs;

    // Subscribers
    private subscribers: Set<AlignedSampleCallback> = new Set();

    // Timer for time-grid output
    private tickTimer: NodeJS.Timeout | null = null;
    private tickIntervalMs: number = 10; // Default 100Hz
    private isRunning: boolean = false;

    // Time grid position (advances monotonically at fixed Hz)
    private gridPosition: number = 0;
    private gridInitialized: boolean = false;

    // Minimum buffer depth before grid starts (samples per sensor)
    // Lower = less latency, higher = more jitter absorption
    private static readonly MIN_BUFFER_DEPTH = 3;

    // Stats
    private pushCount: number = 0;
    private emitCount: number = 0;
    private tickCount: number = 0;

    private constructor() {
        // Initialize sensor buffers (same as recording uses)
        // Use smaller maxSize for live streaming vs recording
        const maxSize = 100; // ~1 second of data at 100Hz
        this.buffers = {
            leftThigh: new SensorBuffer(LEFT_THIGH, maxSize),
            leftShin: new SensorBuffer(LEFT_SHIN, maxSize),
            rightThigh: new SensorBuffer(RIGHT_THIGH, maxSize),
            rightShin: new SensorBuffer(RIGHT_SHIN, maxSize),
        };
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

        // Clear buffers
        this.buffers.leftThigh.clear();
        this.buffers.leftShin.clear();
        this.buffers.rightThigh.clear();
        this.buffers.rightShin.clear();

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
     * Timer tick: Uses SAME flow as recording.
     * Processes ALL available grid positions to minimize latency.
     */
    private tick(): void {
        this.tickCount++;

        // Wait for minimum buffer depth before starting
        if (!this.gridInitialized && !this.hasMinimumBufferDepth()) {
            return;
        }

        // Get data boundary from newest samples (MIN across all active sensors)
        let dataBoundary = this.getDataBoundary();
        if (dataBoundary === null) return;

        // Initialize grid on first data
        // Start close to newest data (with small margin) for low latency
        if (!this.gridInitialized) {
            // Start 2 samples behind the data boundary for interpolation margin
            const startPosition = dataBoundary - (this.tickIntervalMs * 2);
            this.gridPosition = Math.floor(startPosition / this.tickIntervalMs) * this.tickIntervalMs;
            this.gridInitialized = true;
            console.log(`[GridSnapLive] Grid initialized at ${this.gridPosition}ms (boundary: ${dataBoundary}ms)`);
            return;
        }

        // Process ALL available grid positions (drain to minimize latency)
        const maxIterations = 20; // Safety limit
        let iterations = 0;

        while (iterations < maxIterations) {
            iterations++;

            // Refresh data boundary (might have new samples)
            dataBoundary = this.getDataBoundary();
            if (dataBoundary === null) break;

            // Check if we can advance (need one sample ahead for interpolation)
            const nextGridPosition = this.gridPosition + this.tickIntervalMs;
            if (nextGridPosition >= dataBoundary) {
                break; // Caught up with data - wait for more samples
            }

            this.gridPosition = nextGridPosition;

            // Use SAME flow as recording:
            // 1. GridSnapService.snapSinglePoint() to find brackets
            const gridPoint = GridSnapService.snapSinglePoint(this.buffers, this.gridPosition);

            if (!gridPoint) {
                // No valid brackets - skip this position
                continue;
            }

            // 2. InterpolationService.interpolateSinglePoint() for SLERP
            const interpolated = InterpolationService.interpolateSinglePoint(gridPoint);

            // 3. Convert to AlignedSampleSet format
            const alignedSamples: AlignedSampleSet = {
                timestamp: this.gridPosition,
            };

            if (interpolated.leftThigh && interpolated.leftShin) {
                alignedSamples.leftKnee = {
                    thigh: { timestamp: this.gridPosition, quaternion: interpolated.leftThigh },
                    shin: { timestamp: this.gridPosition, quaternion: interpolated.leftShin },
                };
            }

            if (interpolated.rightThigh && interpolated.rightShin) {
                alignedSamples.rightKnee = {
                    thigh: { timestamp: this.gridPosition, quaternion: interpolated.rightThigh },
                    shin: { timestamp: this.gridPosition, quaternion: interpolated.rightShin },
                };
            }

            // Emit if we have any joint data
            if (alignedSamples.leftKnee || alignedSamples.rightKnee) {
                this.emitCount++;
                this.notifySubscribers(alignedSamples);
            }
        }

        // Trim old samples periodically (every 10 ticks to reduce overhead)
        if (this.tickCount % 10 === 0) {
            this.trimOldSamples();
        }
    }

    /**
     * Check if all active sensors have minimum buffer depth.
     */
    private hasMinimumBufferDepth(): boolean {
        const leftThighSize = this.buffers.leftThigh.size();
        const leftShinSize = this.buffers.leftShin.size();
        const rightThighSize = this.buffers.rightThigh.size();
        const rightShinSize = this.buffers.rightShin.size();

        const leftActive = leftThighSize > 0 || leftShinSize > 0;
        const rightActive = rightThighSize > 0 || rightShinSize > 0;

        if (!leftActive && !rightActive) return false;

        if (leftActive) {
            if (leftThighSize < GridSnapLiveService.MIN_BUFFER_DEPTH ||
                leftShinSize < GridSnapLiveService.MIN_BUFFER_DEPTH) {
                return false;
            }
        }

        if (rightActive) {
            if (rightThighSize < GridSnapLiveService.MIN_BUFFER_DEPTH ||
                rightShinSize < GridSnapLiveService.MIN_BUFFER_DEPTH) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get data boundary (MIN of newest timestamps across active sensors).
     */
    private getDataBoundary(): number | null {
        const boundaries: number[] = [];

        const ltNewest = this.buffers.leftThigh.getNewestTimestamp();
        const lsNewest = this.buffers.leftShin.getNewestTimestamp();
        const rtNewest = this.buffers.rightThigh.getNewestTimestamp();
        const rsNewest = this.buffers.rightShin.getNewestTimestamp();

        if (ltNewest !== null) boundaries.push(ltNewest);
        if (lsNewest !== null) boundaries.push(lsNewest);
        if (rtNewest !== null) boundaries.push(rtNewest);
        if (rsNewest !== null) boundaries.push(rsNewest);

        if (boundaries.length === 0) return null;
        return Math.min(...boundaries);
    }

    /**
     * Get oldest boundary (MAX of oldest timestamps - safe start point).
     */
    private getOldestBoundary(): number | null {
        const oldest: number[] = [];

        const ltOldest = this.buffers.leftThigh.getOldestTimestamp();
        const lsOldest = this.buffers.leftShin.getOldestTimestamp();
        const rtOldest = this.buffers.rightThigh.getOldestTimestamp();
        const rsOldest = this.buffers.rightShin.getOldestTimestamp();

        if (ltOldest !== null) oldest.push(ltOldest);
        if (lsOldest !== null) oldest.push(lsOldest);
        if (rtOldest !== null) oldest.push(rtOldest);
        if (rsOldest !== null) oldest.push(rsOldest);

        if (oldest.length === 0) return null;
        return Math.max(...oldest);
    }

    /**
     * Trim samples older than grid position to bound memory.
     */
    private trimOldSamples(): void {
        const trimBefore = this.gridPosition - this.tickIntervalMs * 5; // Keep 5 samples margin
        this.buffers.leftThigh.trimBefore(trimBefore);
        this.buffers.leftShin.trimBefore(trimBefore);
        this.buffers.rightThigh.trimBefore(trimBefore);
        this.buffers.rightShin.trimBefore(trimBefore);
    }

    /**
     * Push a new sample from a sensor.
     */
    pushSample(deviceId: number, timestamp: number, quaternion: Quaternion): void {
        switch (deviceId) {
            case LEFT_THIGH:
                this.buffers.leftThigh.addSample(timestamp, quaternion);
                break;
            case LEFT_SHIN:
                this.buffers.leftShin.addSample(timestamp, quaternion);
                break;
            case RIGHT_THIGH:
                this.buffers.rightThigh.addSample(timestamp, quaternion);
                break;
            case RIGHT_SHIN:
                this.buffers.rightShin.addSample(timestamp, quaternion);
                break;
            default:
                console.warn(`[GridSnapLive] Unknown device ID: 0x${deviceId.toString(16)}`);
                return;
        }
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
        const leftHasData = this.buffers.leftThigh.size() > 0 && this.buffers.leftShin.size() > 0;
        const rightHasData = this.buffers.rightThigh.size() > 0 && this.buffers.rightShin.size() > 0;
        return (leftHasData && !rightHasData) || (!leftHasData && rightHasData);
    }

    /** Get active joint in single joint mode */
    getActiveJoint(): JointSide | null {
        const leftHasData = this.buffers.leftThigh.size() > 0 && this.buffers.leftShin.size() > 0;
        const rightHasData = this.buffers.rightThigh.size() > 0 && this.buffers.rightShin.size() > 0;

        if (leftHasData && !rightHasData) return JointSide.LEFT;
        if (!leftHasData && rightHasData) return JointSide.RIGHT;
        return null;
    }

    /** Cleanup all state */
    cleanup(): void {
        this.stop();
        this.subscribers.clear();
    }

    /** Get debug statistics */
    getDebugStats(): SyncDebugStats {
        const bufferStats = [
            { deviceId: LEFT_THIGH, size: this.buffers.leftThigh.size(), oldestTimestamp: this.buffers.leftThigh.getOldestTimestamp(), newestTimestamp: this.buffers.leftThigh.getNewestTimestamp() },
            { deviceId: LEFT_SHIN, size: this.buffers.leftShin.size(), oldestTimestamp: this.buffers.leftShin.getOldestTimestamp(), newestTimestamp: this.buffers.leftShin.getNewestTimestamp() },
            { deviceId: RIGHT_THIGH, size: this.buffers.rightThigh.size(), oldestTimestamp: this.buffers.rightThigh.getOldestTimestamp(), newestTimestamp: this.buffers.rightThigh.getNewestTimestamp() },
            { deviceId: RIGHT_SHIN, size: this.buffers.rightShin.size(), oldestTimestamp: this.buffers.rightShin.getOldestTimestamp(), newestTimestamp: this.buffers.rightShin.getNewestTimestamp() },
        ];

        return {
            buffers: bufferStats,
            leftKneeAligned: this.buffers.leftThigh.size() > 0 && this.buffers.leftShin.size() > 0,
            rightKneeAligned: this.buffers.rightThigh.size() > 0 && this.buffers.rightShin.size() > 0,
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
        return {
            stats: this.getDebugStats(),
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
