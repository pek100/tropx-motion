import { Quaternion } from '../shared/types';
import { QuaternionService } from '../shared/QuaternionService';
import { QuaternionSample } from './RecordingBuffer';

/** Interpolated sample with angles converted from quaternions. */
export interface InterpolatedAngleSample {
    t: number;          // timestamp (ms)
    relative_s: number; // relative time in seconds
    left: number;       // left knee angle (degrees)
    right: number;      // right knee angle (degrees)
}

/**
 * Interpolates quaternion samples to uniform time intervals using SLERP.
 */
export class InterpolationService {

    /**
     * Interpolates samples to uniform rate using SLERP for quaternions.
     * @param samples Raw quaternion samples with non-uniform timestamps
     * @param targetHz Target sample rate (e.g., 100 for 100Hz)
     * @returns Uniformly-spaced angle samples
     */
    static slerpToUniformRate(samples: QuaternionSample[], targetHz: number): InterpolatedAngleSample[] {
        if (samples.length < 2) {
            return samples.map((s, idx) => ({
                t: s.t,
                relative_s: 0,
                left: s.lq ? QuaternionService.toEulerAngle(s.lq, 'y') : 0,
                right: s.rq ? QuaternionService.toEulerAngle(s.rq, 'y') : 0
            }));
        }

        const intervalMs = 1000 / targetHz;
        const startTime = samples[0].t;
        const endTime = samples[samples.length - 1].t;

        const result: InterpolatedAngleSample[] = [];
        let sampleIndex = 0;

        for (let t = startTime; t <= endTime; t += intervalMs) {
            // Advance to find surrounding samples
            while (sampleIndex < samples.length - 1 && samples[sampleIndex + 1].t <= t) {
                sampleIndex++;
            }

            const s1 = samples[sampleIndex];
            const s2 = samples[sampleIndex + 1] || s1;

            // Calculate interpolation ratio
            const dt = s2.t - s1.t;
            const ratio = dt > 0 ? (t - s1.t) / dt : 0;

            // SLERP quaternions then convert to angles
            const leftAngle = InterpolationService.interpolateJoint(s1.lq, s2.lq, ratio);
            const rightAngle = InterpolationService.interpolateJoint(s1.rq, s2.rq, ratio);

            result.push({
                t: Math.round(t),
                relative_s: Math.round((t - startTime) / 10) / 100, // 2 decimal places
                left: Math.round(leftAngle * 10) / 10,
                right: Math.round(rightAngle * 10) / 10
            });
        }

        return result;
    }

    /**
     * Converts raw quaternion samples to angle samples without interpolation.
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
     * Interpolates a single joint's quaternion and returns angle.
     */
    private static interpolateJoint(q1: Quaternion | null, q2: Quaternion | null, ratio: number): number {
        // Handle null cases
        if (!q1 && !q2) return 0;
        if (!q1) return QuaternionService.toEulerAngle(q2!, 'y');
        if (!q2) return QuaternionService.toEulerAngle(q1, 'y');

        // SLERP and convert to angle
        const interpolated = QuaternionService.slerp(q1, q2, ratio);
        return QuaternionService.toEulerAngle(interpolated, 'y');
    }
}
