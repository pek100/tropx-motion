/**
 * Smoothness & Temporal Coordination (#29-34)
 * Based on biomechanical-metrics-spec-v1.2.md
 */

import type {
  SmoothnessMetrics,
  ShockAbsorptionResult,
  ShockAbsorptionQuality,
  TemporalCoordination,
  GroundContact,
} from "./types";
import {
  calculateDerivative,
  performFFT,
  fftMagnitude,
  findRobustPeak,
  detectGroundContacts,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DEFAULT_CUTOFF_FREQ = 10; // Hz
const DEFAULT_AMP_THRESHOLD = 0.05;
const DEFAULT_ZERO_VELOCITY_THRESHOLD = 2; // degrees per second

// ─────────────────────────────────────────────────────────────────
// Smoothness Metrics (#29-31)
// ─────────────────────────────────────────────────────────────────

/**
 * #29: SPARC (Spectral Arc Length)
 * Frequency-domain smoothness metric.
 * Less negative = smoother, more negative = jerkier.
 */
export function calculateSPARC(
  velocity: number[],
  fs: number,
  fc: number = DEFAULT_CUTOFF_FREQ,
  ampThreshold: number = DEFAULT_AMP_THRESHOLD
): number {
  if (velocity.length < 4) return 0;

  // Compute FFT
  const fft = performFFT(velocity);
  const magnitude = fftMagnitude(fft);
  const N = velocity.length;

  // Frequency resolution
  const freqRes = fs / N;
  const halfN = Math.floor(N / 2);

  // Normalize spectrum
  let maxMag = 0;
  for (let i = 0; i < halfN; i++) {
    if (magnitude[i] > maxMag) maxMag = magnitude[i];
  }
  if (maxMag === 0) return 0;

  const normSpectrum: number[] = new Array(halfN);
  for (let i = 0; i < halfN; i++) {
    normSpectrum[i] = magnitude[i] / maxMag;
  }

  // Find cutoff index (fc or amplitude threshold)
  let cutoffIdx = halfN;
  for (let i = 0; i < halfN; i++) {
    const freq = i * freqRes;
    if (freq > fc) {
      cutoffIdx = i;
      break;
    }
  }

  // Also cut at amplitude threshold
  for (let i = 1; i < cutoffIdx; i++) {
    if (normSpectrum[i] < ampThreshold) {
      cutoffIdx = i;
      break;
    }
  }

  if (cutoffIdx < 2) return 0;

  // Calculate spectral arc length
  let arcLength = 0;
  const dw = 1 / (fc > 0 ? fc : 1);

  for (let i = 1; i < cutoffIdx; i++) {
    const dv = normSpectrum[i] - normSpectrum[i - 1];
    arcLength += Math.sqrt(dw * dw + dv * dv);
  }

  return -arcLength;
}

/**
 * #30: LDLJ (Log Dimensionless Jerk)
 * Time-domain smoothness metric.
 * Less negative = smoother, more negative = jerkier.
 */
export function calculateLDLJ(values: number[], timeStep: number): number {
  const velocity = calculateDerivative(values, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  const jerk = calculateDerivative(acceleration, timeStep);

  if (jerk.length === 0 || velocity.length === 0) return 0;

  const duration = jerk.length * timeStep;
  let peakVelocity = 0;
  for (const v of velocity) {
    const abs = Math.abs(v);
    if (abs > peakVelocity) peakVelocity = abs;
  }

  if (peakVelocity < 1e-10 || duration < 1e-10) return 0;

  // Integrate jerk squared (trapezoidal)
  let jerkSqIntegral = 0;
  for (const j of jerk) {
    jerkSqIntegral += j * j * timeStep;
  }

  // Dimensionless jerk
  const dimlessJerk = (duration ** 3 / peakVelocity ** 2) * jerkSqIntegral;

  return dimlessJerk > 0 ? -Math.log(dimlessJerk) : 0;
}

/**
 * #31: n_velocity_peaks
 * Number of peaks in velocity profile (fewer = smoother).
 */
export function calculateVelocityPeaks(values: number[], timeStep: number): number {
  const velocity = calculateDerivative(values, timeStep);
  if (velocity.length < 3) return 0;

  let maxVel = 0;
  for (const v of velocity) {
    const abs = Math.abs(v);
    if (abs > maxVel) maxVel = abs;
  }
  const threshold = maxVel * 0.1;

  let peakCount = 0;
  for (let i = 1; i < velocity.length - 1; i++) {
    const isLocalMax = velocity[i] > velocity[i - 1] && velocity[i] > velocity[i + 1];
    const isLocalMin = velocity[i] < velocity[i - 1] && velocity[i] < velocity[i + 1];
    const aboveThreshold = Math.abs(velocity[i]) > threshold;

    if ((isLocalMax || isLocalMin) && aboveThreshold) {
      peakCount++;
    }
  }

  return peakCount;
}

/** Calculate all smoothness metrics. */
export function calculateSmoothnessMetrics(
  values: number[],
  timeStep: number,
  sampleRate: number
): SmoothnessMetrics {
  const velocity = calculateDerivative(values, timeStep);

  return {
    sparc: calculateSPARC(velocity, sampleRate),
    ldlj: calculateLDLJ(values, timeStep),
    nVelocityPeaks: calculateVelocityPeaks(values, timeStep),
  };
}

// ─────────────────────────────────────────────────────────────────
// Temporal Coordination (#32-34)
// ─────────────────────────────────────────────────────────────────

/**
 * #32: max_flexion_timing_diff
 * Time difference between left and right peak flexion (ms).
 */
export function calculateMaxFlexionTimingDiff(
  leftValues: number[],
  rightValues: number[],
  timeStep: number
): number {
  if (leftValues.length === 0 || rightValues.length === 0) return 0;

  // Find robust peak value, then find its index
  const leftPeakVal = findRobustPeak(leftValues);
  const rightPeakVal = findRobustPeak(rightValues);

  // Find first occurrence of this peak value (with tolerance)
  let leftMaxIdx = -1;
  let rightMaxIdx = -1;

  for (let i = 0; i < leftValues.length; i++) {
    if (Math.abs(leftValues[i] - leftPeakVal) < 0.01) {
      leftMaxIdx = i;
      break;
    }
  }

  for (let i = 0; i < rightValues.length; i++) {
    if (Math.abs(rightValues[i] - rightPeakVal) < 0.01) {
      rightMaxIdx = i;
      break;
    }
  }

  if (leftMaxIdx === -1 || rightMaxIdx === -1) return 0;

  return Math.abs(leftMaxIdx - rightMaxIdx) * timeStep * 1000;
}

/**
 * #33: zero_velocity_phase_ms
 * Duration where angular velocity is near zero (sticking point).
 */
export function calculateZeroVelocityPhase(
  values: number[],
  timeStep: number,
  threshold: number = DEFAULT_ZERO_VELOCITY_THRESHOLD
): number {
  const velocity = calculateDerivative(values, timeStep);
  if (velocity.length === 0) return 0;

  let zeroPhaseCount = 0;
  for (const v of velocity) {
    if (Math.abs(v) < threshold) {
      zeroPhaseCount++;
    }
  }

  return zeroPhaseCount * timeStep * 1000;
}

/**
 * #34: shock_absorption_score
 * Quality of landing mechanics (double-dip pattern detection).
 * TODO: review needed - uses angular acceleration, not raw gyro
 */
export function calculateShockAbsorptionScore(
  kneeAngle: number[],
  accel: number[],
  timeStep: number
): ShockAbsorptionResult {
  const contacts = detectGroundContacts(accel, timeStep);

  if (contacts.length === 0) {
    return { score: 0, doubleDipDetected: false, patternQuality: "absent" };
  }

  let totalScore = 0;
  let doubleDipCount = 0;

  for (const contact of contacts) {
    // Analyze 50-100ms window post-impact
    const window50ms = Math.floor(0.05 / timeStep);
    const window100ms = Math.floor(0.1 / timeStep);
    const windowStart = contact.touchdownIndex;
    const windowEnd = Math.min(windowStart + window100ms, kneeAngle.length);

    if (windowEnd - windowStart < 5) continue;

    const windowData = kneeAngle.slice(windowStart, windowEnd);

    // Detect double-dip pattern
    const peaks: number[] = [];
    const troughs: number[] = [];

    for (let i = 1; i < windowData.length - 1; i++) {
      if (windowData[i] > windowData[i - 1] && windowData[i] > windowData[i + 1]) {
        peaks.push(i);
      }
      if (windowData[i] < windowData[i - 1] && windowData[i] < windowData[i + 1]) {
        troughs.push(i);
      }
    }

    // Double dip = at least 2 peaks and 1 trough
    const hasDoubleDip = peaks.length >= 2 && troughs.length >= 1;
    if (hasDoubleDip) doubleDipCount++;

    // Score based on pattern presence and timing
    const patternScore = hasDoubleDip ? 80 : 40;
    const timingScore = peaks.length > 0 && peaks[0] < window50ms ? 20 : 0;

    totalScore += patternScore + timingScore;
  }

  const avgScore = contacts.length > 0 ? totalScore / contacts.length : 0;
  const doubleDipRatio = contacts.length > 0 ? doubleDipCount / contacts.length : 0;

  let patternQuality: ShockAbsorptionQuality;
  if (doubleDipRatio > 0.8) patternQuality = "excellent";
  else if (doubleDipRatio > 0.5) patternQuality = "good";
  else if (doubleDipRatio > 0) patternQuality = "poor";
  else patternQuality = "absent";

  return { score: avgScore, doubleDipDetected: doubleDipCount > 0, patternQuality };
}

/** Calculate temporal coordination metrics. */
export function calculateTemporalCoordination(
  leftValues: number[],
  rightValues: number[],
  accel: number[],
  timeStep: number
): TemporalCoordination {
  return {
    maxFlexionTimingDiff: calculateMaxFlexionTimingDiff(leftValues, rightValues, timeStep),
    zeroVelocityPhaseMs: calculateZeroVelocityPhase(leftValues, timeStep),
    shockAbsorption: calculateShockAbsorptionScore(leftValues, accel, timeStep),
  };
}
