import { QuaternionService } from '../shared/QuaternionService';
import { QuaternionSample } from './types';

/** Interpolated sample with angles converted from quaternions. */
export interface InterpolatedAngleSample {
    t: number;          // timestamp (ms)
    relative_s: number; // relative time in seconds
    left: number;       // left knee angle (degrees)
    right: number;      // right knee angle (degrees)
}

/**
 * Converts quaternion samples to angle samples for CSV export.
 */
export class InterpolationService {

    /**
     * Converts aligned quaternion samples to angle samples.
     * Called after AlignmentService.process() which handles interpolation.
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
}
