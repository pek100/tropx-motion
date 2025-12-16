/**
 * GapValidator - Detects and classifies gaps in quaternion sample streams.
 *
 * Gap Classification:
 * - Small gap (< 2×interval): Can be SLERP interpolated
 * - Large gap (≥ 2×interval): Data loss, should hold last value
 */

import { QuaternionSample } from '../../shared/QuaternionCodec';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export enum GapType {
  NONE = 'none',
  SMALL = 'small',      // < 2×interval, can interpolate
  LARGE = 'large',      // ≥ 2×interval, data loss
}

export interface Gap {
  afterIndex: number;   // Gap exists after this sample index
  startTime: number;    // Timestamp of sample before gap
  endTime: number;      // Timestamp of sample after gap
  duration: number;     // Gap duration in ms
  missingSamples: number; // Expected samples in this gap
  type: GapType;
}

export interface ValidationResult {
  isUniform: boolean;
  expectedInterval: number;
  actualSampleCount: number;
  expectedSampleCount: number;
  gaps: Gap[];
  smallGapCount: number;
  largeGapCount: number;
}

// ─────────────────────────────────────────────────────────────────
// Gap Detection
// ─────────────────────────────────────────────────────────────────

/**
 * Validate samples for uniform timing and detect gaps.
 * @param samples Raw quaternion samples (should be sorted by timestamp)
 * @param targetHz Expected sample rate
 * @returns Validation result with gap information
 */
export function validateSamples(
  samples: QuaternionSample[],
  targetHz: number
): ValidationResult {
  if (samples.length < 2) {
    return {
      isUniform: true,
      expectedInterval: 1000 / targetHz,
      actualSampleCount: samples.length,
      expectedSampleCount: samples.length,
      gaps: [],
      smallGapCount: 0,
      largeGapCount: 0,
    };
  }

  const expectedInterval = 1000 / targetHz;
  const gapThreshold = expectedInterval * 2;
  const toleranceMs = expectedInterval * 0.5; // 50% tolerance for jitter

  const gaps: Gap[] = [];
  let smallGapCount = 0;
  let largeGapCount = 0;

  for (let i = 0; i < samples.length - 1; i++) {
    const current = samples[i];
    const next = samples[i + 1];
    const dt = next.t - current.t;

    // Check if gap exceeds expected interval + tolerance
    if (dt > expectedInterval + toleranceMs) {
      const missingSamples = Math.round(dt / expectedInterval) - 1;
      const gapType = dt >= gapThreshold ? GapType.LARGE : GapType.SMALL;

      gaps.push({
        afterIndex: i,
        startTime: current.t,
        endTime: next.t,
        duration: dt,
        missingSamples,
        type: gapType,
      });

      if (gapType === GapType.SMALL) {
        smallGapCount++;
      } else {
        largeGapCount++;
      }
    }
  }

  // Calculate expected sample count
  const duration = samples[samples.length - 1].t - samples[0].t;
  const expectedSampleCount = Math.round(duration / expectedInterval) + 1;

  return {
    isUniform: gaps.length === 0,
    expectedInterval,
    actualSampleCount: samples.length,
    expectedSampleCount,
    gaps,
    smallGapCount,
    largeGapCount,
  };
}

/**
 * Calculate expected timestamps for a uniform sample stream.
 * @param startTime First sample timestamp
 * @param sampleCount Number of samples
 * @param sampleRate Samples per second
 * @returns Array of expected timestamps
 */
export function calculateExpectedTimestamps(
  startTime: number,
  sampleCount: number,
  sampleRate: number
): number[] {
  const interval = 1000 / sampleRate;
  const timestamps: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    timestamps.push(startTime + i * interval);
  }

  return timestamps;
}

/**
 * Generate uniform time grid from start to end.
 * @param startTime Grid start timestamp
 * @param endTime Grid end timestamp
 * @param sampleRate Samples per second
 * @returns Array of grid timestamps
 */
export function generateTimeGrid(
  startTime: number,
  endTime: number,
  sampleRate: number
): number[] {
  const interval = 1000 / sampleRate;
  const timestamps: number[] = [];

  for (let t = startTime; t <= endTime; t += interval) {
    timestamps.push(Math.round(t));
  }

  return timestamps;
}
