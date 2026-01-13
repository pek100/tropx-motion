/**
 * GridSnapService - Snaps raw samples to a uniform time grid.
 *
 * For each grid point, finds the bracketing samples (prev/curr) for each sensor.
 * Does NOT interpolate - just organizes data for InterpolationService.
 */

import { Quaternion } from '../shared/types';
import { RawDeviceSample } from './types';
import { SensorBuffer } from '../synchronization/SensorBuffer';

const DEVICE_ID = {
    LEFT_SHIN: 0x11,
    LEFT_THIGH: 0x12,
    RIGHT_SHIN: 0x21,
    RIGHT_THIGH: 0x22,
} as const;

/** Bracketing samples for interpolation */
export interface BracketingSamples {
    prev: { timestamp: number; quaternion: Quaternion } | null;
    curr: { timestamp: number; quaternion: Quaternion } | null;
}

/** Grid-aligned data for a single time point */
export interface GridPoint {
    t: number;
    leftThigh: BracketingSamples;
    leftShin: BracketingSamples;
    rightThigh: BracketingSamples;
    rightShin: BracketingSamples;
}

export interface GridSnapResult {
    gridPoints: GridPoint[];
    startTime: number;
    endTime: number;
}

/** Buffer references for live streaming (persistent buffers) */
export interface SensorBufferRefs {
    leftThigh: SensorBuffer;
    leftShin: SensorBuffer;
    rightThigh: SensorBuffer;
    rightShin: SensorBuffer;
}

interface SensorBuffers {
    leftThigh: SensorBuffer;
    leftShin: SensorBuffer;
    rightThigh: SensorBuffer;
    rightShin: SensorBuffer;
}

type BufferKey = keyof SensorBuffers;

export class GridSnapService {

    /**
     * Snaps raw samples to a uniform grid.
     * Returns bracketing samples for each sensor at each grid point.
     */
    static snap(raw: RawDeviceSample[], targetHz: number): GridSnapResult {
        if (raw.length === 0) {
            return { gridPoints: [], startTime: 0, endTime: 0 };
        }

        const buffers = this.loadIntoBuffers(raw);

        const startTime = this.getEarliestTimestamp(buffers);
        const endTime = this.getLatestTimestamp(buffers);

        if (startTime === null || endTime === null) {
            return { gridPoints: [], startTime: 0, endTime: 0 };
        }

        const intervalMs = 1000 / targetHz;
        const sampleCount = Math.ceil((endTime - startTime) / intervalMs) + 1;
        const gridPoints: GridPoint[] = [];

        // Track indices for efficient sequential access
        const indices: Record<BufferKey, number> = {
            leftThigh: 0,
            leftShin: 0,
            rightThigh: 0,
            rightShin: 0,
        };

        for (let i = 0; i < sampleCount; i++) {
            const t = startTime + i * intervalMs;
            if (t > endTime) break;

            gridPoints.push({
                t,
                leftThigh: this.findBrackets(buffers.leftThigh, t, indices, 'leftThigh'),
                leftShin: this.findBrackets(buffers.leftShin, t, indices, 'leftShin'),
                rightThigh: this.findBrackets(buffers.rightThigh, t, indices, 'rightThigh'),
                rightShin: this.findBrackets(buffers.rightShin, t, indices, 'rightShin'),
            });
        }

        return { gridPoints, startTime, endTime };
    }

    /**
     * Snap a single grid point from persistent buffers (for live streaming).
     * Uses binary search to find bracketing samples around targetTime.
     * Returns null if no sensor has sufficient data for interpolation.
     */
    static snapSinglePoint(buffers: SensorBufferRefs, targetTime: number): GridPoint | null {
        const leftThigh = this.findBracketsFromBuffer(buffers.leftThigh, targetTime);
        const leftShin = this.findBracketsFromBuffer(buffers.leftShin, targetTime);
        const rightThigh = this.findBracketsFromBuffer(buffers.rightThigh, targetTime);
        const rightShin = this.findBracketsFromBuffer(buffers.rightShin, targetTime);

        // Check if we have at least one complete joint (both thigh + shin with valid brackets)
        const leftComplete = this.hasBrackets(leftThigh) && this.hasBrackets(leftShin);
        const rightComplete = this.hasBrackets(rightThigh) && this.hasBrackets(rightShin);

        if (!leftComplete && !rightComplete) {
            return null;
        }

        return {
            t: targetTime,
            leftThigh,
            leftShin,
            rightThigh,
            rightShin,
        };
    }

    /**
     * Check if brackets have both prev and curr for valid interpolation.
     */
    private static hasBrackets(brackets: BracketingSamples): boolean {
        return brackets.prev !== null && brackets.curr !== null;
    }

    /**
     * Find bracketing samples from a persistent buffer using binary search.
     * Returns prev (sample before or at t) and curr (sample after t).
     */
    private static findBracketsFromBuffer(buffer: SensorBuffer, t: number): BracketingSamples {
        if (buffer.isEmpty()) {
            return { prev: null, curr: null };
        }

        // Use binary search to find closest sample
        const closestIdx = buffer.findClosestIndex(t);
        if (closestIdx < 0) {
            return { prev: null, curr: null };
        }

        const closestTs = buffer.getTimestampAtIndex(closestIdx);
        if (closestTs === null) {
            return { prev: null, curr: null };
        }

        let prevIdx: number;
        let currIdx: number;

        if (closestTs <= t) {
            // Closest is at or before target - it's prev, next is curr
            prevIdx = closestIdx;
            currIdx = closestIdx + 1;
        } else {
            // Closest is after target - prev is one before
            prevIdx = closestIdx - 1;
            currIdx = closestIdx;
        }

        const prevSample = buffer.getSampleAtIndex(prevIdx);
        const currSample = buffer.getSampleAtIndex(currIdx);

        return {
            prev: prevSample ? { timestamp: prevSample.timestamp, quaternion: prevSample.quaternion } : null,
            curr: currSample ? { timestamp: currSample.timestamp, quaternion: currSample.quaternion } : null,
        };
    }

    private static loadIntoBuffers(raw: RawDeviceSample[]): SensorBuffers {
        const leftThigh = new SensorBuffer(DEVICE_ID.LEFT_THIGH, Infinity);
        const leftShin = new SensorBuffer(DEVICE_ID.LEFT_SHIN, Infinity);
        const rightThigh = new SensorBuffer(DEVICE_ID.RIGHT_THIGH, Infinity);
        const rightShin = new SensorBuffer(DEVICE_ID.RIGHT_SHIN, Infinity);

        for (const sample of raw) {
            switch (sample.deviceId) {
                case DEVICE_ID.LEFT_THIGH:
                    leftThigh.addSample(sample.timestamp, sample.quaternion);
                    break;
                case DEVICE_ID.LEFT_SHIN:
                    leftShin.addSample(sample.timestamp, sample.quaternion);
                    break;
                case DEVICE_ID.RIGHT_THIGH:
                    rightThigh.addSample(sample.timestamp, sample.quaternion);
                    break;
                case DEVICE_ID.RIGHT_SHIN:
                    rightShin.addSample(sample.timestamp, sample.quaternion);
                    break;
            }
        }

        return { leftThigh, leftShin, rightThigh, rightShin };
    }

    /**
     * Finds bracketing samples (prev <= t < curr) for interpolation.
     * Uses index tracking for O(n) total complexity across all grid points.
     */
    private static findBrackets(
        buffer: SensorBuffer,
        t: number,
        indices: Record<BufferKey, number>,
        key: BufferKey
    ): BracketingSamples {
        if (buffer.isEmpty()) {
            return { prev: null, curr: null };
        }

        // Advance index until we find bracket
        while (
            indices[key] < buffer.getSize() - 1 &&
            buffer.getTimestampAtIndex(indices[key] + 1)! <= t
        ) {
            indices[key]++;
        }

        const idx = indices[key];
        const prevSample = buffer.getSampleAtIndex(idx);
        const currSample = buffer.getSampleAtIndex(idx + 1);

        return {
            prev: prevSample ? { timestamp: prevSample.timestamp, quaternion: prevSample.quaternion } : null,
            curr: currSample ? { timestamp: currSample.timestamp, quaternion: currSample.quaternion } : null,
        };
    }

    private static getEarliestTimestamp(buffers: SensorBuffers): number | null {
        const timestamps = [
            buffers.leftThigh.getOldestTimestamp(),
            buffers.leftShin.getOldestTimestamp(),
            buffers.rightThigh.getOldestTimestamp(),
            buffers.rightShin.getOldestTimestamp(),
        ].filter((t): t is number => t !== null);

        return timestamps.length > 0 ? Math.min(...timestamps) : null;
    }

    private static getLatestTimestamp(buffers: SensorBuffers): number | null {
        const timestamps = [
            buffers.leftThigh.getNewestTimestamp(),
            buffers.leftShin.getNewestTimestamp(),
            buffers.rightThigh.getNewestTimestamp(),
            buffers.rightShin.getNewestTimestamp(),
        ].filter((t): t is number => t !== null);

        return timestamps.length > 0 ? Math.max(...timestamps) : null;
    }
}
