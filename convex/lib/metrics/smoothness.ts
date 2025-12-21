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
  // detectGroundContacts, // DISABLED - shock absorption needs accelerometer
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
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * Requires deceleration patterns from linear accelerometer to detect
 * impact absorption quality during landing. Angular acceleration from
 * knee angle derivatives cannot detect landing impacts reliably.
 *
 * TODO: Re-enable when accelerometer data is available from IMU sensors.
 */
export function calculateShockAbsorptionScore(
  _kneeAngle: number[],
  _accel: number[],
  _timeStep: number
): ShockAbsorptionResult {
  // DISABLED: Returns placeholder values - requires accelerometer data
  return {
    score: 0,
    doubleDipDetected: false,
    patternQuality: "absent",
  };
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
