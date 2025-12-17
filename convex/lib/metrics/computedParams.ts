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

/** #6: explosiveness_loading - Peak velocity during eccentric/loading phase. */
export function calculateExplosivenessLoading(values: number[], timeStep: number): number {
  if (values.length < 3) return 0;
  const velocity = calculateDerivative(values, timeStep);
  if (velocity.length === 0) return 0;

  const loadingVelocities: number[] = [];

  // velocity[i] corresponds to values[i+1] due to central difference
  for (let i = 0; i < velocity.length; i++) {
    const posIdx = i + 1;
    // Angle increasing = loading phase (for knee flexion)
    if (values[posIdx] > values[posIdx - 1]) {
      loadingVelocities.push(Math.abs(velocity[i]));
    }
  }

  return loadingVelocities.length > 0 ? findRobustPeak(loadingVelocities) : 0;
}

/** #7: explosiveness_concentric - Peak velocity during concentric phase. */
export function calculateExplosivenessConcentric(values: number[], timeStep: number): number {
  if (values.length < 3) return 0;
  const velocity = calculateDerivative(values, timeStep);
  if (velocity.length === 0) return 0;

  const concentricVelocities: number[] = [];

  for (let i = 0; i < velocity.length; i++) {
    const posIdx = i + 1;
    // Angle decreasing = concentric phase (for knee extension)
    if (values[posIdx] < values[posIdx - 1]) {
      concentricVelocities.push(Math.abs(velocity[i]));
    }
  }

  return concentricVelocities.length > 0 ? findRobustPeak(concentricVelocities) : 0;
}

/** #8: rms_jerk - Root mean square of jerk (smoothness indicator). */
export function calculateRMSJerk(values: number[], timeStep: number): number {
  const velocity = calculateDerivative(values, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  const jerk = calculateDerivative(acceleration, timeStep);

  if (jerk.length === 0) return 0;
  return rms(jerk);
}

/** #9: rom_cov_percentage - Coefficient of variation for ROM (consistency). */
export function calculateROMCoV(values: number[]): number {
  if (values.length < 3) return 0;

  // Find cycle peaks
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      peaks.push(values[i]);
    }
  }

  if (peaks.length < 2) return 0;

  const meanPeak = peaks.reduce((sum, p) => sum + p, 0) / peaks.length;
  if (Math.abs(meanPeak) < 1e-10) return 0;

  const variance = peaks.reduce((sum, p) => sum + (p - meanPeak) ** 2, 0) / peaks.length;
  const stdDevPeak = Math.sqrt(variance);

  return (stdDevPeak / Math.abs(meanPeak)) * 100;
}

/** #10: rom_symmetry_index - Bilateral ROM symmetry ratio (used in bilateral). */
export function calculateROMSymmetryIndex(leftROM: number, rightROM: number): number {
  const maxValue = Math.max(Math.abs(leftROM), Math.abs(rightROM));
  return maxValue > 0 ? (Math.abs(leftROM - rightROM) / maxValue) * 100 : 0;
}

/** #11: peak_resultant_acceleration - Maximum acceleration magnitude. */
export function calculatePeakResultantAcceleration(values: number[], timeStep: number): number {
  if (values.length < 3) return 0;
  const velocity = calculateDerivative(values, timeStep);
  const acceleration = calculateDerivative(velocity, timeStep);
  if (acceleration.length === 0) return 0;
  const absAccel = acceleration.map(Math.abs);
  return findRobustPeak(absAccel);
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
    romCoV: calculateROMCoV(values),
    peakResultantAcceleration: calculatePeakResultantAcceleration(values, timeStep),
  };
}
