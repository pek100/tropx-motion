/**
 * InterpolationService - Interpolates grid-aligned samples to exact grid times.
 *
 * Takes output from GridSnapService and:
 * 1. SLERPs each sensor's absolute quaternion to exact grid time
 * 2. Computes relative quaternions (thigh⁻¹ × shin)
 */

import { Quaternion } from '../shared/types';
import { QuaternionService } from '../shared/QuaternionService';
import { QuaternionSample } from './types';
import { GridSnapResult, BracketingSamples } from './GridSnapService';

/** Interpolated sample with angles converted from quaternions. */
export interface InterpolatedAngleSample {
    t: number;
    relative_s: number;
    left: number;
    right: number;
}

export class InterpolationService {

    // Reusable buffers for quaternion math
    private static readonly workingQuat1 = new Float32Array(4);
    private static readonly workingQuat2 = new Float32Array(4);
    private static readonly workingQuatRel = new Float32Array(4);

    /**
     * Interpolates grid-aligned samples to QuaternionSample[].
     * SLERPs absolute quaternions first, then computes relative.
     */
    static interpolate(gridData: GridSnapResult): QuaternionSample[] {
        const result: QuaternionSample[] = [];

        for (const point of gridData.gridPoints) {
            // SLERP each sensor to exact grid time
            const leftThighQ = this.slerpToTime(point.leftThigh, point.t);
            const leftShinQ = this.slerpToTime(point.leftShin, point.t);
            const rightThighQ = this.slerpToTime(point.rightThigh, point.t);
            const rightShinQ = this.slerpToTime(point.rightShin, point.t);

            // Compute relative quaternions (thigh⁻¹ × shin)
            const leftRelative = this.computeRelativeQuat(leftThighQ, leftShinQ);
            const rightRelative = this.computeRelativeQuat(rightThighQ, rightShinQ);

            result.push({
                t: point.t,
                lq: leftRelative,
                rq: rightRelative,
            });
        }

        return result;
    }

    /**
     * Converts aligned quaternion samples to angle samples.
     * Used by CSVExporter for CSV output.
     */
    static toAngleSamples(samples: QuaternionSample[]): InterpolatedAngleSample[] {
        if (samples.length === 0) return [];

        const startTime = samples[0].t;

        return samples.map(s => ({
            t: s.t,
            relative_s: Math.round((s.t - startTime) / 10) / 100,
            left: s.lq ? Math.round(QuaternionService.toEulerAngle(s.lq, 'y') * 10) / 10 : 0,
            right: s.rq ? Math.round(QuaternionService.toEulerAngle(s.rq, 'y') * 10) / 10 : 0
        }));
    }

    /**
     * SLERPs bracketing samples to exact timestamp.
     */
    private static slerpToTime(brackets: BracketingSamples, t: number): Quaternion | null {
        const { prev, curr } = brackets;

        // No data at all
        if (!prev && !curr) return null;

        // Only one boundary - extrapolate
        if (!prev) return curr!.quaternion;
        if (!curr) return prev.quaternion;

        // At or before prev - use prev
        if (t <= prev.timestamp) return prev.quaternion;

        // At or after curr - use curr
        if (t >= curr.timestamp) return curr.quaternion;

        // Between - SLERP
        const alpha = (t - prev.timestamp) / (curr.timestamp - prev.timestamp);
        return QuaternionService.slerp(prev.quaternion, curr.quaternion, alpha);
    }

    /**
     * Computes relative quaternion: thigh⁻¹ × shin
     */
    private static computeRelativeQuat(
        thighQ: Quaternion | null,
        shinQ: Quaternion | null
    ): Quaternion | null {
        if (!thighQ || !shinQ) return null;

        QuaternionService.writeToBuffer(thighQ, this.workingQuat1);
        QuaternionService.writeToBuffer(shinQ, this.workingQuat2);
        QuaternionService.getInverseQuaternion(this.workingQuat1, this.workingQuat1);
        QuaternionService.multiplyQuaternions(this.workingQuat1, this.workingQuat2, this.workingQuatRel);

        return QuaternionService.readFromBuffer(this.workingQuatRel);
    }
}
