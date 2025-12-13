/**
 * Buffer for aligned sensor quaternions with time-grid interpolation.
 * Receives shear-aligned samples and provides SLERP interpolation to exact grid positions.
 */

import { Quaternion } from '../shared/types';
import { QuaternionService } from '../shared/QuaternionService';
import { Sample } from './types';

/** Interpolated quaternion at exact grid position */
export interface InterpolatedSample {
    timestamp: number;
    quaternion: Quaternion;
    interpolated: boolean;  // true if SLERP'd, false if exact match
}

/**
 * Per-sensor buffer that supports SLERP interpolation to arbitrary timestamps.
 * Keeps recent samples for interpolation lookups.
 */
export class SensorInterpolationBuffer {
    private samples: Sample[] = [];
    private readonly maxSamples: number = 10;  // Keep last N samples for interpolation

    /** Add an aligned sample to the buffer */
    push(timestamp: number, quaternion: Quaternion): void {
        this.samples.push({ timestamp, quaternion });

        // Keep buffer bounded
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
    }

    /**
     * Get interpolated quaternion at exact target timestamp.
     * Uses SLERP between bracketing samples.
     */
    getInterpolatedAt(targetTimestamp: number): InterpolatedSample | null {
        if (this.samples.length === 0) return null;

        // Single sample - return as-is
        if (this.samples.length === 1) {
            return {
                timestamp: targetTimestamp,
                quaternion: this.samples[0].quaternion,
                interpolated: false
            };
        }

        // Find bracketing samples
        let beforeIdx = -1;
        let afterIdx = -1;

        for (let i = 0; i < this.samples.length; i++) {
            if (this.samples[i].timestamp <= targetTimestamp) {
                beforeIdx = i;
            }
            if (this.samples[i].timestamp >= targetTimestamp && afterIdx === -1) {
                afterIdx = i;
            }
        }

        // Target is before all samples - use first sample
        if (beforeIdx === -1) {
            return {
                timestamp: targetTimestamp,
                quaternion: this.samples[0].quaternion,
                interpolated: false
            };
        }

        // Target is after all samples - use last sample
        if (afterIdx === -1) {
            return {
                timestamp: targetTimestamp,
                quaternion: this.samples[this.samples.length - 1].quaternion,
                interpolated: false
            };
        }

        // Exact match
        if (beforeIdx === afterIdx) {
            return {
                timestamp: targetTimestamp,
                quaternion: this.samples[beforeIdx].quaternion,
                interpolated: false
            };
        }

        // SLERP between bracketing samples
        const before = this.samples[beforeIdx];
        const after = this.samples[afterIdx];

        const dt = after.timestamp - before.timestamp;
        const t = dt > 0 ? (targetTimestamp - before.timestamp) / dt : 0;

        const interpolated = QuaternionService.slerp(before.quaternion, after.quaternion, t);

        return {
            timestamp: targetTimestamp,
            quaternion: interpolated,
            interpolated: true
        };
    }

    /** Check if buffer has samples */
    hasData(): boolean {
        return this.samples.length > 0;
    }

    /** Get newest timestamp in buffer */
    getNewestTimestamp(): number | null {
        if (this.samples.length === 0) return null;
        return this.samples[this.samples.length - 1].timestamp;
    }

    /** Get oldest timestamp in buffer */
    getOldestTimestamp(): number | null {
        if (this.samples.length === 0) return null;
        return this.samples[0].timestamp;
    }

    /** Cleanup samples older than given timestamp */
    cleanupBefore(timestamp: number): void {
        // Keep at least 2 samples for interpolation
        while (this.samples.length > 2 && this.samples[0].timestamp < timestamp) {
            this.samples.shift();
        }
    }

    /** Clear all samples */
    clear(): void {
        this.samples = [];
    }

    /** Get buffer size */
    getSize(): number {
        return this.samples.length;
    }
}

/**
 * Manages interpolation buffers for all 4 sensors.
 * Provides unified interface for time-grid interpolation.
 */
export class InterpolationBuffer {
    private buffers: Map<number, SensorInterpolationBuffer> = new Map();

    // Device IDs
    private static readonly LEFT_THIGH = 0x11;
    private static readonly LEFT_SHIN = 0x12;
    private static readonly RIGHT_THIGH = 0x21;
    private static readonly RIGHT_SHIN = 0x22;

    constructor() {
        // Initialize buffer for each sensor
        this.buffers.set(InterpolationBuffer.LEFT_THIGH, new SensorInterpolationBuffer());
        this.buffers.set(InterpolationBuffer.LEFT_SHIN, new SensorInterpolationBuffer());
        this.buffers.set(InterpolationBuffer.RIGHT_THIGH, new SensorInterpolationBuffer());
        this.buffers.set(InterpolationBuffer.RIGHT_SHIN, new SensorInterpolationBuffer());
    }

    /** Push aligned sample for a sensor */
    pushSample(deviceId: number, timestamp: number, quaternion: Quaternion): void {
        const buffer = this.buffers.get(deviceId);
        if (buffer) {
            buffer.push(timestamp, quaternion);
        }
    }

    /** Get interpolated quaternion for a sensor at target timestamp */
    getInterpolatedAt(deviceId: number, targetTimestamp: number): InterpolatedSample | null {
        const buffer = this.buffers.get(deviceId);
        if (!buffer) return null;
        return buffer.getInterpolatedAt(targetTimestamp);
    }

    /** Get interpolated samples for a joint (thigh + shin) */
    getJointInterpolated(
        joint: 'left' | 'right',
        targetTimestamp: number
    ): { thigh: InterpolatedSample | null; shin: InterpolatedSample | null } {
        const thighId = joint === 'left' ? InterpolationBuffer.LEFT_THIGH : InterpolationBuffer.RIGHT_THIGH;
        const shinId = joint === 'left' ? InterpolationBuffer.LEFT_SHIN : InterpolationBuffer.RIGHT_SHIN;

        return {
            thigh: this.getInterpolatedAt(thighId, targetTimestamp),
            shin: this.getInterpolatedAt(shinId, targetTimestamp)
        };
    }

    /** Check if joint has data for interpolation */
    jointHasData(joint: 'left' | 'right'): boolean {
        const thighId = joint === 'left' ? InterpolationBuffer.LEFT_THIGH : InterpolationBuffer.RIGHT_THIGH;
        const shinId = joint === 'left' ? InterpolationBuffer.LEFT_SHIN : InterpolationBuffer.RIGHT_SHIN;

        const thighBuffer = this.buffers.get(thighId);
        const shinBuffer = this.buffers.get(shinId);

        return (thighBuffer?.hasData() ?? false) && (shinBuffer?.hasData() ?? false);
    }

    /** Get newest timestamp across all sensors */
    getNewestTimestamp(): number | null {
        let newest: number | null = null;
        for (const buffer of this.buffers.values()) {
            const ts = buffer.getNewestTimestamp();
            if (ts !== null && (newest === null || ts > newest)) {
                newest = ts;
            }
        }
        return newest;
    }

    /** Cleanup old samples from all buffers */
    cleanupBefore(timestamp: number): void {
        for (const buffer of this.buffers.values()) {
            buffer.cleanupBefore(timestamp);
        }
    }

    /** Clear all buffers */
    clear(): void {
        for (const buffer of this.buffers.values()) {
            buffer.clear();
        }
    }

    /** Get debug info */
    getDebugInfo(): Record<string, { size: number; oldest: number | null; newest: number | null }> {
        const info: Record<string, { size: number; oldest: number | null; newest: number | null }> = {};

        const names: Record<number, string> = {
            [InterpolationBuffer.LEFT_THIGH]: 'leftThigh',
            [InterpolationBuffer.LEFT_SHIN]: 'leftShin',
            [InterpolationBuffer.RIGHT_THIGH]: 'rightThigh',
            [InterpolationBuffer.RIGHT_SHIN]: 'rightShin'
        };

        for (const [deviceId, buffer] of this.buffers) {
            info[names[deviceId]] = {
                size: buffer.getSize(),
                oldest: buffer.getOldestTimestamp(),
                newest: buffer.getNewestTimestamp()
            };
        }

        return info;
    }
}
