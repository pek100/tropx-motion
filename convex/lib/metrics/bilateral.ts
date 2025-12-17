/**
 * Bilateral & Unilateral Analysis (#12-19)
 * Based on biomechanical-metrics-spec-v1.2.md
 */

import type {
  PerLegMetrics,
  AsymmetryIndices,
  TemporalAsymmetry,
  BilateralAnalysis,
  UnilateralMetrics,
  UnilateralAnalysis,
} from "./types";
import {
  calculateBilateralAsymmetry,
  calculateCrossCorrelation,
  estimateCycleLength,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────
// Asymmetry Constants
// ─────────────────────────────────────────────────────────────────

// Net global asymmetry weights (sum = 1.0)
const ASYMMETRY_WEIGHTS = {
  overallMaxROM: 0.20,
  averageROM: 0.15,
  peakAngularVelocity: 0.20,
  rmsJerk: 0.175,
  explosivenessLoading: 0.15,
  explosivenessConcentric: 0.125,
} as const;

// ─────────────────────────────────────────────────────────────────
// Bilateral Analysis (#12-16)
// ─────────────────────────────────────────────────────────────────

/** #12: asymmetry - Standard bilateral asymmetry index for a single metric. */
export function calculateAsymmetry(leftValue: number, rightValue: number): number {
  return calculateBilateralAsymmetry(leftValue, rightValue);
}

/** Calculate asymmetry indices for all per-leg metrics. */
export function calculateAsymmetryIndices(
  left: PerLegMetrics,
  right: PerLegMetrics
): AsymmetryIndices {
  return {
    overallMaxROM: calculateAsymmetry(left.overallMaxROM, right.overallMaxROM),
    averageROM: calculateAsymmetry(left.averageROM, right.averageROM),
    peakAngularVelocity: calculateAsymmetry(left.peakAngularVelocity, right.peakAngularVelocity),
    rmsJerk: calculateAsymmetry(left.rmsJerk, right.rmsJerk),
    explosivenessLoading: calculateAsymmetry(left.explosivenessLoading, right.explosivenessLoading),
    explosivenessConcentric: calculateAsymmetry(left.explosivenessConcentric, right.explosivenessConcentric),
  };
}

/** #13: net_global_asymmetry - Weighted composite asymmetry across all parameters. */
export function calculateNetGlobalAsymmetry(
  left: PerLegMetrics,
  right: PerLegMetrics
): number {
  const asymmetries = {
    overallMaxROM: calculateAsymmetry(left.overallMaxROM, right.overallMaxROM),
    averageROM: calculateAsymmetry(left.averageROM, right.averageROM),
    peakAngularVelocity: calculateAsymmetry(left.peakAngularVelocity, right.peakAngularVelocity),
    rmsJerk: calculateAsymmetry(left.rmsJerk, right.rmsJerk),
    explosivenessLoading: calculateAsymmetry(left.explosivenessLoading, right.explosivenessLoading),
    explosivenessConcentric: calculateAsymmetry(left.explosivenessConcentric, right.explosivenessConcentric),
  };

  let weightedSum = 0;
  for (const key of Object.keys(ASYMMETRY_WEIGHTS) as Array<keyof typeof ASYMMETRY_WEIGHTS>) {
    weightedSum += asymmetries[key] * ASYMMETRY_WEIGHTS[key];
  }

  return weightedSum;
}

/** #14: phase_shift - Angular phase difference between limbs (degrees). */
export function calculatePhaseShift(
  leftValues: number[],
  rightValues: number[],
  _timeStep: number
): number {
  const { lag } = calculateCrossCorrelation(leftValues, rightValues);
  const n = Math.min(leftValues.length, rightValues.length);
  // Convert lag to phase angle (assuming one cycle = 360°)
  return Math.abs((lag * 360) / n);
}

/** #15: cross_correlation - Maximum normalized correlation between left and right. */
export function getCrossCorrelationValue(left: number[], right: number[]): number {
  const { correlation } = calculateCrossCorrelation(left, right);
  return correlation;
}

/** #16: temporal_lag - Time delay between limbs in milliseconds. */
export function calculateTemporalLag(
  leftValues: number[],
  rightValues: number[],
  timeStep: number
): number {
  const { lag } = calculateCrossCorrelation(leftValues, rightValues);
  return Math.abs(lag) * timeStep * 1000;
}

/** Calculate temporal asymmetry metrics. */
export function calculateTemporalAsymmetry(
  leftValues: number[],
  rightValues: number[],
  timeStep: number
): TemporalAsymmetry {
  return {
    phaseShift: calculatePhaseShift(leftValues, rightValues, timeStep),
    crossCorrelation: getCrossCorrelationValue(leftValues, rightValues),
    temporalLag: calculateTemporalLag(leftValues, rightValues, timeStep),
  };
}

/** Calculate complete bilateral analysis. */
export function calculateBilateralAnalysis(
  leftMetrics: PerLegMetrics,
  rightMetrics: PerLegMetrics,
  leftValues: number[],
  rightValues: number[],
  timeStep: number
): BilateralAnalysis {
  return {
    asymmetryIndices: calculateAsymmetryIndices(leftMetrics, rightMetrics),
    netGlobalAsymmetry: calculateNetGlobalAsymmetry(leftMetrics, rightMetrics),
    temporalAsymmetry: calculateTemporalAsymmetry(leftValues, rightValues, timeStep),
  };
}

// ─────────────────────────────────────────────────────────────────
// Unilateral Analysis (#17-19)
// ─────────────────────────────────────────────────────────────────

/** #17: flexor_extensor_ratio - Ratio of flexion to extension capability. */
export function calculateFlexorExtensorRatio(peakFlexion: number, peakExtension: number): number {
  const absExtension = Math.abs(peakExtension);
  const absFlexion = Math.abs(peakFlexion);
  return absExtension > 0 ? (absFlexion / absExtension) * 100 : 0;
}

/** #18: eccentric_concentric_ratio - Ratio of loading to concentric explosiveness. */
export function calculateEccentricConcentricRatio(
  explosivenessLoading: number,
  explosivenessConcentric: number
): number {
  return explosivenessConcentric > 0
    ? (explosivenessLoading / explosivenessConcentric) * 100
    : 0;
}

/** #19: bilateral_ratio_difference - Difference in unilateral ratios between limbs. */
export function calculateBilateralRatioDifference(leftRatio: number, rightRatio: number): number {
  return Math.abs(leftRatio - rightRatio);
}

/** Calculate unilateral metrics for a single leg. */
export function calculateUnilateralMetrics(metrics: PerLegMetrics): UnilateralMetrics {
  return {
    flexorExtensorRatio: calculateFlexorExtensorRatio(
      metrics.peakFlexion,
      metrics.peakExtension
    ),
    eccentricConcentricRatio: calculateEccentricConcentricRatio(
      metrics.explosivenessLoading,
      metrics.explosivenessConcentric
    ),
  };
}

/** Calculate complete unilateral analysis for both legs. */
export function calculateUnilateralAnalysis(
  leftMetrics: PerLegMetrics,
  rightMetrics: PerLegMetrics
): UnilateralAnalysis {
  const left = calculateUnilateralMetrics(leftMetrics);
  const right = calculateUnilateralMetrics(rightMetrics);

  return {
    left,
    right,
    bilateralRatioDiff: calculateBilateralRatioDifference(
      left.flexorExtensorRatio,
      right.flexorExtensorRatio
    ),
  };
}
