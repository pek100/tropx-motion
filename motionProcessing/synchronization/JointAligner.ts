/**
 * Intra-joint alignment: aligns thigh and shin sensor buffers.
 * Supports batch reuse: same batch can be used multiple times until new data arrives.
 * Cleanup only occurs when advancing to next batch.
 */

import { SensorBuffer } from './SensorBuffer';
import { JointSamples, JointSide, Sample } from './types';

export class JointAligner {
    private thighBuffer: SensorBuffer | null = null;
    private shinBuffer: SensorBuffer | null = null;
    private readonly jointSide: JointSide;

    // Last consumed sample for reuse (when no new data)
    private lastConsumedSample: JointSamples | null = null;
    private lastConsumedTimestamp: number = 0;

    constructor(jointSide: JointSide) {
        this.jointSide = jointSide;
    }

    /** Configure the thigh and shin buffers for this joint */
    setBuffers(thighBuffer: SensorBuffer, shinBuffer: SensorBuffer): void {
        this.thighBuffer = thighBuffer;
        this.shinBuffer = shinBuffer;
    }

    /** Get the joint side (left or right) */
    getJointSide(): JointSide {
        return this.jointSide;
    }

    /** Check if both buffers are configured */
    hasBuffers(): boolean {
        return this.thighBuffer !== null && this.shinBuffer !== null;
    }

    /** Check if both buffers have data */
    hasData(): boolean {
        if (!this.thighBuffer || !this.shinBuffer) return false;
        return !this.thighBuffer.isEmpty() && !this.shinBuffer.isEmpty();
    }

    /** Check if either buffer has data OR we have a reusable sample */
    hasAnyData(): boolean {
        if (this.lastConsumedSample) return true;
        if (!this.thighBuffer || !this.shinBuffer) return false;
        return !this.thighBuffer.isEmpty() || !this.shinBuffer.isEmpty();
    }

    /**
     * Peek at the oldest timestamp that would be consumed.
     * Returns MAX timestamp from the next matchable pair without consuming.
     * If no new data, returns lastConsumedTimestamp (for reuse).
     */
    peekOldestTimestamp(): number | null {
        if (!this.thighBuffer || !this.shinBuffer) return null;

        const thighEmpty = this.thighBuffer.isEmpty();
        const shinEmpty = this.shinBuffer.isEmpty();

        // No new data - return last consumed for reuse
        if (thighEmpty && shinEmpty) {
            return this.lastConsumedTimestamp > 0 ? this.lastConsumedTimestamp : null;
        }

        // Both have data - peek at matched pair timestamps
        if (!thighEmpty && !shinEmpty) {
            const thighSample = this.thighBuffer.getSampleAtIndex(0);
            if (!thighSample) return this.lastConsumedTimestamp || null;

            const closestShinIndex = this.shinBuffer.findClosestIndex(thighSample.timestamp);
            const shinSample = this.shinBuffer.getSampleAtIndex(closestShinIndex);

            if (shinSample) {
                return Math.max(thighSample.timestamp, shinSample.timestamp);
            }
            return thighSample.timestamp;
        }

        // Only thigh
        if (!thighEmpty) {
            return this.thighBuffer.getOldestTimestamp();
        }

        // Only shin
        return this.shinBuffer.getOldestTimestamp();
    }

    /**
     * Get current sample: either consume NEW data or REUSE last consumed.
     * - If new data available: consume it, cleanup previous, update lastConsumed
     * - If no new data: return lastConsumedSample (reuse)
     */
    consumeOneMatch(): JointSamples | null {
        if (!this.thighBuffer || !this.shinBuffer) return this.lastConsumedSample;

        const thighEmpty = this.thighBuffer.isEmpty();
        const shinEmpty = this.shinBuffer.isEmpty();

        // No new data - REUSE last consumed sample
        if (thighEmpty && shinEmpty) {
            return this.lastConsumedSample;
        }

        // We have new data - consume it
        const pair: JointSamples = {};
        let newTimestamp = 0;

        // Both have data - match closest pair
        if (!thighEmpty && !shinEmpty) {
            const thighSample = this.thighBuffer.getSampleAtIndex(0);
            if (thighSample) {
                const closestShinIndex = this.shinBuffer.findClosestIndex(thighSample.timestamp);
                const shinSample = this.shinBuffer.getSampleAtIndex(closestShinIndex);

                if (shinSample) {
                    pair.thigh = { ...thighSample };
                    pair.shin = { ...shinSample };
                    newTimestamp = Math.max(thighSample.timestamp, shinSample.timestamp);

                    // Remove consumed samples from buffers
                    this.thighBuffer.discardUpTo(1);
                    this.shinBuffer.removeAtIndex(closestShinIndex);
                }
            }
        }
        // Only thigh has data
        else if (!thighEmpty) {
            const thighSample = this.thighBuffer.getSampleAtIndex(0);
            if (thighSample) {
                pair.thigh = { ...thighSample };
                // Keep shin from last consumed if available
                if (this.lastConsumedSample?.shin) {
                    pair.shin = this.lastConsumedSample.shin;
                }
                newTimestamp = thighSample.timestamp;
                this.thighBuffer.discardUpTo(1);
            }
        }
        // Only shin has data
        else if (!shinEmpty) {
            const shinSample = this.shinBuffer.getSampleAtIndex(0);
            if (shinSample) {
                pair.shin = { ...shinSample };
                // Keep thigh from last consumed if available
                if (this.lastConsumedSample?.thigh) {
                    pair.thigh = this.lastConsumedSample.thigh;
                }
                newTimestamp = shinSample.timestamp;
                this.shinBuffer.discardUpTo(1);
            }
        }

        // If we got new data, update tracking and cleanup old
        if (pair.thigh || pair.shin) {
            // Cleanup samples older than the PREVIOUS consumed timestamp
            // (deferred cleanup - only when we advance)
            if (this.lastConsumedTimestamp > 0) {
                this.cleanupBeforeTimestamp(this.lastConsumedTimestamp);
            }

            // Update last consumed
            this.lastConsumedSample = pair;
            this.lastConsumedTimestamp = newTimestamp;

            return pair;
        }

        return this.lastConsumedSample;
    }

    /** Cleanup all samples before the given timestamp */
    cleanupBeforeTimestamp(timestamp: number): void {
        if (this.thighBuffer) {
            this.discardSamplesBeforeTimestamp(this.thighBuffer, timestamp);
        }
        if (this.shinBuffer) {
            this.discardSamplesBeforeTimestamp(this.shinBuffer, timestamp);
        }
    }

    /** Helper to discard samples older than a timestamp */
    private discardSamplesBeforeTimestamp(buffer: SensorBuffer, timestamp: number): void {
        let discardCount = 0;
        for (let i = 0; i < buffer.getSize(); i++) {
            const ts = buffer.getTimestampAtIndex(i);
            if (ts !== null && ts < timestamp) {
                discardCount++;
            } else {
                break;
            }
        }
        if (discardCount > 0) {
            buffer.discardUpTo(discardCount);
        }
    }

    /** Clear state */
    reset(): void {
        this.lastConsumedSample = null;
        this.lastConsumedTimestamp = 0;
    }

    /** Get debug info */
    getDebugInfo(): { joint: JointSide; thighSize: number; shinSize: number; lastTs: number } {
        return {
            joint: this.jointSide,
            thighSize: this.thighBuffer?.getSize() ?? 0,
            shinSize: this.shinBuffer?.getSize() ?? 0,
            lastTs: this.lastConsumedTimestamp,
        };
    }
}
