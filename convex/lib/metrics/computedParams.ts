/**
 * Per-leg computed parameters (#1-11)
 * Based on biomechanical-metrics-spec-v1.2.md
 */

import type { PerLegMetrics } from "./types";
import {
  calculateDerivative,
  findRobustPeak,
  findRobustMin,
  detectMovementCycles,
  applyMovingAverageFilter,
  rms,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────
// Individual Metric Functions
// ─────────────────────────────────────────────────────────────────

/** #1: overall_max_rom - Maximum range of motion achieved. */
export function calculateOverallMaxROM(values: number[]): number {
  if (values.length === 0) return 0;
  const robustMax = findRobustPeak(values);
  const robustMin = findRobustMin(values);
  return Math.abs(robustMax - robustMin);
}

/** #2: average_rom - Mean ROM across detected movement cycles. */
export function calculateAverageROM(values: number[], timeStep: number): number {
  if (values.length < 10) return 0;

  const filtered = applyMovingAverageFilter(values, 3);
  const cycles = detectMovementCycles(filtered, timeStep);

  if (cycles.length === 0) {
    // Fallback: use overall range
    return Math.abs(Math.max(...filtered) - Math.min(...filtered));
  }

  let totalROM = 0;
  for (const cycle of cycles) {
    const cycleValues = filtered.slice(cycle.startIndex, cycle.endIndex + 1);
    const cycleROM = Math.abs(Math.max(...cycleValues) - Math.min(...cycleValues));
    totalROM += cycleROM;
  }

  return totalROM / cycles.length;
}

/** #3: peak_flexion_rom - Maximum flexion angle achieved. */
export function calculatePeakFlexion(values: number[]): number {
  if (values.length === 0) return 0;
  return findRobustPeak(values);
}

/** #4: peak_extension_rom - Maximum extension angle achieved (minimum). */
export function calculatePeakExtension(values: number[]): number {
  if (values.length === 0) return 0;
  return findRobustMin(values);
}

/** #5: peak_angular_velocity - Highest rotational speed during movement. */
export function calculatePeakAngularVelocity(values: number[], timeStep: number): number {
  if (values.length < 3) return 0;
  const velocity = calculateDerivative(values, timeStep);
  if (velocity.length === 0) return 0;
  const absVelocity = velocity.map(Math.abs);
  return findRobustPeak(absVelocity);
}

/** #6: explosiveness_loading - Peak angular acceleration during eccentric/loading phase (°/s²). */
export function calculateExplosivenessLoading(values: number[], timeStep: number): number {
  if (values.length < 5) return 0;
  const velocity = calculateDerivative(values, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  if (acceleration.length === 0) return 0;

  const loadingAccelerations: number[] = [];

  // acceleration[i] corresponds roughly to values[i+2] due to two central differences
  for (let i = 0; i < acceleration.length; i++) {
    const posIdx = i + 2;
    if (posIdx < values.length - 1) {
      // Angle increasing = loading phase (for knee flexion)
      if (values[posIdx] > values[posIdx - 1]) {
        loadingAccelerations.push(Math.abs(acceleration[i]));
      }
    }
  }

  return loadingAccelerations.length > 0 ? findRobustPeak(loadingAccelerations) : 0;
}

/** #7: explosiveness_concentric - Peak angular acceleration during concentric phase (°/s²). */
export function calculateExplosivenessConcentric(values: number[], timeStep: number): number {
  if (values.length < 5) return 0;
  const velocity = calculateDerivative(values, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  if (acceleration.length === 0) return 0;

  const concentricAccelerations: number[] = [];

  // acceleration[i] corresponds roughly to values[i+2] due to two central differences
  for (let i = 0; i < acceleration.length; i++) {
    const posIdx = i + 2;
    if (posIdx < values.length - 1) {
      // Angle decreasing = concentric phase (for knee extension)
      if (values[posIdx] < values[posIdx - 1]) {
        concentricAccelerations.push(Math.abs(acceleration[i]));
      }
    }
  }

  return concentricAccelerations.length > 0 ? findRobustPeak(concentricAccelerations) : 0;
}

/** #8: rms_jerk - Root mean square of jerk (smoothness indicator). */
export function calculateRMSJerk(values: number[], timeStep: number): number {
  const velocity = calculateDerivative(values, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  const jerk = calculateDerivative(acceleration, timeStep);

  if (jerk.length === 0) return 0;
  return rms(jerk);
}

/** #9: rom_cov_percentage - Coefficient of variation for ROM across cycles (consistency). */
export function calculateROMCoV(values: number[], timeStep: number = 0.01): number {
  if (values.length < 10) return 0;

  // Find cycle peaks and troughs to calculate ROM per cycle
  const peaks: { index: number; value: number }[] = [];
  const troughs: { index: number; value: number }[] = [];

  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      peaks.push({ index: i, value: values[i] });
    }
    if (values[i] < values[i - 1] && values[i] < values[i + 1]) {
      troughs.push({ index: i, value: values[i] });
    }
  }

  if (peaks.length < 2 || troughs.length < 1) return 0;

  // Calculate ROM for each cycle (peak to next trough, or trough to next peak)
  const romValues: number[] = [];

  for (let i = 0; i < peaks.length - 1; i++) {
    const peakIdx = peaks[i].index;
    const nextPeakIdx = peaks[i + 1].index;

    // Find the trough between these two peaks
    const troughBetween = troughs.find(t => t.index > peakIdx && t.index < nextPeakIdx);
    if (troughBetween) {
      const cycleROM = Math.abs(peaks[i].value - troughBetween.value);
      if (cycleROM > 5) { // Minimum 5° to be considered a valid cycle
        romValues.push(cycleROM);
      }
    }
  }

  if (romValues.length < 2) return 0;

  const meanROM = romValues.reduce((sum, r) => sum + r, 0) / romValues.length;
  if (Math.abs(meanROM) < 1e-10) return 0;

  const variance = romValues.reduce((sum, r) => sum + (r - meanROM) ** 2, 0) / romValues.length;
  const stdDevROM = Math.sqrt(variance);

  return (stdDevROM / meanROM) * 100;
}

/** #10: rom_symmetry_index - Bilateral ROM symmetry ratio (used in bilateral). */
export function calculateROMSymmetryIndex(leftROM: number, rightROM: number): number {
  const maxValue = Math.max(Math.abs(leftROM), Math.abs(rightROM));
  return maxValue > 0 ? (Math.abs(leftROM - rightROM) / maxValue) * 100 : 0;
}

/**
 * #11: peak_resultant_acceleration - Maximum acceleration magnitude.
 *
 * ❌ DISABLED - NEEDS ACCELEROMETER DATA
 * This metric requires linear acceleration √(ax² + ay² + az²) from an
 * accelerometer. Angular acceleration from knee angle derivatives is
 * not equivalent and produces meaningless values.
 *
 * TODO: Re-enable when accelerometer data is available from IMU sensors.
 */
export function calculatePeakResultantAcceleration(_values: number[], _timeStep: number): number {
  // DISABLED: Returns 0 - requires accelerometer data
  return 0;
}

// ─────────────────────────────────────────────────────────────────
// Aggregate Function
// ─────────────────────────────────────────────────────────────────

/** Calculate all per-leg metrics for a single leg. */
export function calculatePerLegMetrics(
  values: number[],
  timeStep: number
): PerLegMetrics {
  return {
    overallMaxROM: calculateOverallMaxROM(values),
    averageROM: calculateAverageROM(values, timeStep),
    peakFlexion: calculatePeakFlexion(values),
    peakExtension: calculatePeakExtension(values),
    peakAngularVelocity: calculatePeakAngularVelocity(values, timeStep),
    explosivenessLoading: calculateExplosivenessLoading(values, timeStep),
    explosivenessConcentric: calculateExplosivenessConcentric(values, timeStep),
    rmsJerk: calculateRMSJerk(values, timeStep),
    romCoV: calculateROMCoV(values, timeStep),
    peakResultantAcceleration: calculatePeakResultantAcceleration(values, timeStep),
  };
}
