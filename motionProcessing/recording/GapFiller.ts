/**
 * GapFiller - Fills gaps in quaternion sample streams.
 *
 * Gap Filling Strategy:
 * - Small gaps (< 2×interval): SLERP interpolation
 * - Large gaps (≥ 2×interval): Hold last known value
 */

import {
  Quaternion,
  QuaternionSample,
  UniformSample,
  SampleFlag,
  slerp,
} from '../../shared/QuaternionCodec';
import { validateSamples, GapType, generateTimeGrid } from './GapValidator';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ResampleOptions {
  targetHz?: number;
}

export interface ResampleResult {
  samples: UniformSample[];
  stats: {
    inputCount: number;
    outputCount: number;
    interpolatedCount: number;
    missingCount: number;
    smallGapsFound: number;
    largeGapsFound: number;
  };
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DEFAULT_SAMPLE_RATE = 100;

// ─────────────────────────────────────────────────────────────────
// Gap Filling
// ─────────────────────────────────────────────────────────────────

/**
 * Find the sample before and after a given timestamp.
 */
function findBracketingSamples(
  samples: QuaternionSample[],
  targetTime: number,
  startIdx: number = 0
): { before: QuaternionSample | null; after: QuaternionSample | null; beforeIdx: number } {
  let beforeIdx = startIdx;

  // Advance to find the right position
  while (beforeIdx < samples.length - 1 && samples[beforeIdx + 1].t <= targetTime) {
    beforeIdx++;
  }

  const before = samples[beforeIdx] ?? null;
  const after = samples[beforeIdx + 1] ?? null;

  return { before, after, beforeIdx };
}

/**
 * Interpolate a single joint's quaternion between two samples.
 */
function interpolateJoint(
  before: Quaternion | null,
  after: Quaternion | null,
  ratio: number
): Quaternion | null {
  if (!before && !after) return null;
  if (!before) return after;
  if (!after) return before;
  return slerp(before, after, ratio);
}

/**
 * Resample raw quaternion samples to uniform time intervals.
 * Fills gaps using SLERP for small gaps and hold-last for large gaps.
 */
export function resample(
  rawSamples: QuaternionSample[],
  options: ResampleOptions = {}
): ResampleResult {
  const targetHz = options.targetHz ?? DEFAULT_SAMPLE_RATE;

  // Handle edge cases
  if (rawSamples.length === 0) {
    return {
      samples: [],
      stats: {
        inputCount: 0,
        outputCount: 0,
        interpolatedCount: 0,
        missingCount: 0,
        smallGapsFound: 0,
        largeGapsFound: 0,
      },
    };
  }

  if (rawSamples.length === 1) {
    const s = rawSamples[0];
    return {
      samples: [{
        t: s.t,
        lq: s.lq,
        rq: s.rq,
        leftFlag: SampleFlag.REAL,
        rightFlag: SampleFlag.REAL,
      }],
      stats: {
        inputCount: 1,
        outputCount: 1,
        interpolatedCount: 0,
        missingCount: 0,
        smallGapsFound: 0,
        largeGapsFound: 0,
      },
    };
  }

  // Sort by timestamp
  const sorted = [...rawSamples].sort((a, b) => a.t - b.t);

  // Validate and detect gaps
  const validation = validateSamples(sorted, targetHz);

  // Generate uniform time grid
  const startTime = sorted[0].t;
  const endTime = sorted[sorted.length - 1].t;
  const timeGrid = generateTimeGrid(startTime, endTime, targetHz);

  const intervalMs = 1000 / targetHz;
  const gapThreshold = intervalMs * 2;

  const uniformSamples: UniformSample[] = [];
  let searchIdx = 0;
  let interpolatedCount = 0;
  let missingCount = 0;

  // Track last known quaternions for hold-last
  let lastLeftQ: Quaternion | null = null;
  let lastRightQ: Quaternion | null = null;

  for (const targetTime of timeGrid) {
    const { before, after, beforeIdx } = findBracketingSamples(sorted, targetTime, searchIdx);
    searchIdx = beforeIdx;

    // Determine if we have an exact match (within tolerance)
    const tolerance = intervalMs * 0.3;
    const isExactMatch = before && Math.abs(before.t - targetTime) < tolerance;

    if (isExactMatch && before) {
      // Exact match - use as is
      lastLeftQ = before.lq ?? lastLeftQ;
      lastRightQ = before.rq ?? lastRightQ;

      uniformSamples.push({
        t: targetTime,
        lq: before.lq,
        rq: before.rq,
        leftFlag: SampleFlag.REAL,
        rightFlag: SampleFlag.REAL,
      });
    } else if (before && after) {
      // Between two samples - check gap size
      const gapDuration = after.t - before.t;

      if (gapDuration >= gapThreshold) {
        // Large gap - hold last value
        missingCount++;
        uniformSamples.push({
          t: targetTime,
          lq: lastLeftQ,
          rq: lastRightQ,
          leftFlag: before.lq ? SampleFlag.MISSING : SampleFlag.REAL,
          rightFlag: before.rq ? SampleFlag.MISSING : SampleFlag.REAL,
        });
      } else {
        // Small gap - SLERP interpolate
        const ratio = (targetTime - before.t) / gapDuration;
        const lq = interpolateJoint(before.lq, after.lq, ratio);
        const rq = interpolateJoint(before.rq, after.rq, ratio);

        lastLeftQ = lq ?? lastLeftQ;
        lastRightQ = rq ?? lastRightQ;

        interpolatedCount++;
        uniformSamples.push({
          t: targetTime,
          lq,
          rq,
          leftFlag: before.lq || after.lq ? SampleFlag.INTERPOLATED : SampleFlag.REAL,
          rightFlag: before.rq || after.rq ? SampleFlag.INTERPOLATED : SampleFlag.REAL,
        });
      }
    } else if (before) {
      // After last sample - hold last
      lastLeftQ = before.lq ?? lastLeftQ;
      lastRightQ = before.rq ?? lastRightQ;

      uniformSamples.push({
        t: targetTime,
        lq: lastLeftQ,
        rq: lastRightQ,
        leftFlag: SampleFlag.MISSING,
        rightFlag: SampleFlag.MISSING,
      });
      missingCount++;
    } else {
      // Before first sample - should not happen with proper grid
      uniformSamples.push({
        t: targetTime,
        lq: null,
        rq: null,
        leftFlag: SampleFlag.MISSING,
        rightFlag: SampleFlag.MISSING,
      });
      missingCount++;
    }
  }

  return {
    samples: uniformSamples,
    stats: {
      inputCount: rawSamples.length,
      outputCount: uniformSamples.length,
      interpolatedCount,
      missingCount,
      smallGapsFound: validation.smallGapCount,
      largeGapsFound: validation.largeGapCount,
    },
  };
}
