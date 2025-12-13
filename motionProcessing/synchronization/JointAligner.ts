/**
 * Intra-joint alignment: aligns thigh and shin sensor buffers.
 * Supports batch reuse and inline interpolation to time grid.
 */

import { SensorBuffer } from './SensorBuffer';
import { JointSamples, JointSide, Sample } from './types';
import { QuaternionService } from '../shared/QuaternionService';
import { Quaternion } from '../shared/types';

export class JointAligner {
    private thighBuffer: SensorBuffer | null = null;
    private shinBuffer: SensorBuffer | null = null;
    private readonly jointSide: JointSide;

    // Track last 2 samples PER SENSOR for interpolation (sensor-level, not joint-level)
    private prevThigh: Sample | null = null;
    private currThigh: Sample | null = null;
    private prevShin: Sample | null = null;
    private currShin: Sample | null = null;

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

    /** Check if we have data for interpolation */
    hasAnyData(): boolean {
        if (this.currThigh || this.currShin) return true;
        if (!this.thighBuffer || !this.shinBuffer) return false;
        return !this.thighBuffer.isEmpty() || !this.shinBuffer.isEmpty();
    }

    /** Get newest timestamp we have (for grid bounds checking) */
    getNewestTimestamp(): number | null {
        const thighTs = this.currThigh?.timestamp ?? 0;
        const shinTs = this.currShin?.timestamp ?? 0;
        const newest = Math.max(thighTs, shinTs);
        return newest > 0 ? newest : null;
    }

    /**
     * Consume next aligned sample from shear alignment.
     * Updates per-SENSOR prev/curr tracking for interpolation.
     */
    consumeOneMatch(): JointSamples | null {
        if (!this.thighBuffer || !this.shinBuffer) {
            // Return current state
            if (this.currThigh || this.currShin) {
                return { thigh: this.currThigh ?? undefined, shin: this.currShin ?? undefined };
            }
            return null;
        }

        const thighEmpty = this.thighBuffer.isEmpty();
        const shinEmpty = this.shinBuffer.isEmpty();

        // No new data - return current (reuse)
        if (thighEmpty && shinEmpty) {
            if (this.currThigh || this.currShin) {
                return { thigh: this.currThigh ?? undefined, shin: this.currShin ?? undefined };
            }
            return null;
        }

        let thighConsumed = false;
        let shinConsumed = false;

        // Both have data - match closest pair (intra-joint shear)
        if (!thighEmpty && !shinEmpty) {
            const thighSample = this.thighBuffer.getSampleAtIndex(0);
            if (thighSample) {
                const closestShinIndex = this.shinBuffer.findClosestIndex(thighSample.timestamp);
                const shinSample = this.shinBuffer.getSampleAtIndex(closestShinIndex);

                if (shinSample) {
                    // Shift thigh: curr -> prev, new -> curr
                    this.prevThigh = this.currThigh;
                    this.currThigh = { ...thighSample };
                    thighConsumed = true;

                    // Shift shin: curr -> prev, new -> curr
                    this.prevShin = this.currShin;
                    this.currShin = { ...shinSample };
                    shinConsumed = true;

                    this.thighBuffer.discardUpTo(1);
                    this.shinBuffer.removeAtIndex(closestShinIndex);
                }
            }
        }
        // Only thigh has data
        else if (!thighEmpty) {
            const thighSample = this.thighBuffer.getSampleAtIndex(0);
            if (thighSample) {
                this.prevThigh = this.currThigh;
                this.currThigh = { ...thighSample };
                thighConsumed = true;
                this.thighBuffer.discardUpTo(1);
            }
        }
        // Only shin has data
        else if (!shinEmpty) {
            const shinSample = this.shinBuffer.getSampleAtIndex(0);
            if (shinSample) {
                this.prevShin = this.currShin;
                this.currShin = { ...shinSample };
                shinConsumed = true;
                this.shinBuffer.discardUpTo(1);
            }
        }

        // Cleanup old data from buffers
        if (thighConsumed && this.prevThigh) {
            this.discardSamplesBeforeTimestamp(this.thighBuffer, this.prevThigh.timestamp);
        }
        if (shinConsumed && this.prevShin) {
            this.discardSamplesBeforeTimestamp(this.shinBuffer, this.prevShin.timestamp);
        }

        // Return current state
        if (this.currThigh || this.currShin) {
            return { thigh: this.currThigh ?? undefined, shin: this.currShin ?? undefined };
        }
        return null;
    }

    /**
     * Get interpolated sample at exact grid timestamp.
     * SLERPs each SENSOR individually using its own prev/curr.
     */
    getInterpolatedAt(gridTimestamp: number): JointSamples | null {
        if (!this.currThigh && !this.currShin) return null;

        const result: JointSamples = {};

        // Interpolate THIGH sensor
        if (this.currThigh) {
            if (this.prevThigh) {
                const prevTs = this.prevThigh.timestamp;
                const currTs = this.currThigh.timestamp;
                const dt = currTs - prevTs;

                if (gridTimestamp <= prevTs) {
                    result.thigh = { timestamp: gridTimestamp, quaternion: this.prevThigh.quaternion };
                } else if (gridTimestamp >= currTs) {
                    result.thigh = { timestamp: gridTimestamp, quaternion: this.currThigh.quaternion };
                } else if (dt > 0) {
                    const t = (gridTimestamp - prevTs) / dt;
                    result.thigh = {
                        timestamp: gridTimestamp,
                        quaternion: QuaternionService.slerp(
                            this.prevThigh.quaternion,
                            this.currThigh.quaternion,
                            t
                        )
                    };
                } else {
                    result.thigh = { timestamp: gridTimestamp, quaternion: this.currThigh.quaternion };
                }
            } else {
                result.thigh = { timestamp: gridTimestamp, quaternion: this.currThigh.quaternion };
            }
        }

        // Interpolate SHIN sensor
        if (this.currShin) {
            if (this.prevShin) {
                const prevTs = this.prevShin.timestamp;
                const currTs = this.currShin.timestamp;
                const dt = currTs - prevTs;

                if (gridTimestamp <= prevTs) {
                    result.shin = { timestamp: gridTimestamp, quaternion: this.prevShin.quaternion };
                } else if (gridTimestamp >= currTs) {
                    result.shin = { timestamp: gridTimestamp, quaternion: this.currShin.quaternion };
                } else if (dt > 0) {
                    const t = (gridTimestamp - prevTs) / dt;
                    result.shin = {
                        timestamp: gridTimestamp,
                        quaternion: QuaternionService.slerp(
                            this.prevShin.quaternion,
                            this.currShin.quaternion,
                            t
                        )
                    };
                } else {
                    result.shin = { timestamp: gridTimestamp, quaternion: this.currShin.quaternion };
                }
            } else {
                result.shin = { timestamp: gridTimestamp, quaternion: this.currShin.quaternion };
            }
        }

        return (result.thigh || result.shin) ? result : null;
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
        this.prevThigh = null;
        this.currThigh = null;
        this.prevShin = null;
        this.currShin = null;
    }

    /** Get debug info */
    getDebugInfo(): {
        joint: JointSide;
        thighSize: number;
        shinSize: number;
        thighPrevTs: number;
        thighCurrTs: number;
        shinPrevTs: number;
        shinCurrTs: number;
    } {
        return {
            joint: this.jointSide,
            thighSize: this.thighBuffer?.getSize() ?? 0,
            shinSize: this.shinBuffer?.getSize() ?? 0,
            thighPrevTs: this.prevThigh?.timestamp ?? 0,
            thighCurrTs: this.currThigh?.timestamp ?? 0,
            shinPrevTs: this.prevShin?.timestamp ?? 0,
            shinCurrTs: this.currShin?.timestamp ?? 0,
        };
    }
}
