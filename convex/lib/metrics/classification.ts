/**
 * Movement Classification & Advanced Asymmetry (#38-41)
 * Based on biomechanical-metrics-spec-v1.2.md
 */

import type {
  MovementType,
  MovementClassification,
  TransitionEvent,
  RollingPhaseResult,
  PhaseCorrectedSignals,
  PhaseCorrectionSummary,
  AsymmetryEvent,
  AsymmetryDirection,
  AdvancedAsymmetryResult,
  RollingAsymmetryWindow,
  RollingAsymmetrySummary,
  RollingAsymmetryResult,
  PhaseAlignmentResult,
  PhaseAlignmentComputed,
} from "./types";
import {
  estimateCycleLength,
  generateGaussianKernel,
  convolveSignal,
  mean,
  stdDev,
} from "./helpers";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const PHASE_CHANGE_THRESHOLD = 30; // degrees
const DEFAULT_ASYMMETRY_THRESHOLD = 5; // degrees
const DEFAULT_KERNEL_SIZE = 100;
const MIN_EVENT_DURATION_MS = 50;

// ─────────────────────────────────────────────────────────────────
// Movement Classification (#38)
// ─────────────────────────────────────────────────────────────────

/** #38: movement_type - Classifies movement as bilateral, unilateral, etc. */
export function classifyMovementType(
  left: number[],
  right: number[],
  timeStep: number
): MovementClassification {
  const n = Math.min(left.length, right.length);

  if (n < 20) {
    return {
      type: "unknown",
      confidence: 0,
      correlationAtZero: 0,
      optimalLag: 0,
      optimalCorrelation: 0,
      estimatedCycleSamples: 0,
      phaseOffsetDegrees: 0,
    };
  }

  // Calculate means and stds
  let meanL = 0,
    meanR = 0;
  for (let i = 0; i < n; i++) {
    meanL += left[i];
    meanR += right[i];
  }
  meanL /= n;
  meanR /= n;

  let sumSqL = 0,
    sumSqR = 0;
  for (let i = 0; i < n; i++) {
    sumSqL += (left[i] - meanL) ** 2;
    sumSqR += (right[i] - meanR) ** 2;
  }
  const stdL = Math.sqrt(sumSqL / n);
  const stdR = Math.sqrt(sumSqR / n);

  // Check for single-leg (one signal flat)
  const cvL = stdL / Math.abs(meanL || 1);
  const cvR = stdR / Math.abs(meanR || 1);
  if (cvL < 0.05 || cvR < 0.05) {
    return {
      type: "single_leg",
      confidence: 90,
      correlationAtZero: 0,
      optimalLag: 0,
      optimalCorrelation: 0,
      estimatedCycleSamples: 0,
      phaseOffsetDegrees: 0,
    };
  }

  if (stdL < 1e-10 || stdR < 1e-10) {
    return {
      type: "unknown",
      confidence: 0,
      correlationAtZero: 0,
      optimalLag: 0,
      optimalCorrelation: 0,
      estimatedCycleSamples: 0,
      phaseOffsetDegrees: 0,
    };
  }

  // Estimate cycle length from autocorrelation
  const estimatedCycleSamples = estimateCycleLength(left, n);
  const maxLag = Math.min(Math.floor(n / 2), estimatedCycleSamples || 100);

  // Calculate cross-correlation at various lags
  let corrAtZero = 0;
  let bestCorr = -Infinity;
  let bestLag = 0;

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let sum = 0,
      count = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j >= 0 && j < n) {
        sum += (left[i] - meanL) * (right[j] - meanR);
        count++;
      }
    }
    const corr = count > 0 ? sum / (count * stdL * stdR) : 0;

    if (lag === 0) corrAtZero = corr;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Calculate phase offset in degrees
  const cycleSamples = estimatedCycleSamples || n;
  const phaseOffsetDegrees = Math.abs((bestLag * 360) / cycleSamples) % 360;

  // Classification logic
  let type: MovementType;
  let confidence: number;

  if (corrAtZero > 0.7) {
    // High correlation at zero lag = bilateral (squat, jump)
    type = "bilateral";
    confidence = Math.min(100, corrAtZero * 100);
  } else if (corrAtZero < -0.3 && phaseOffsetDegrees > 150 && phaseOffsetDegrees < 210) {
    // Negative correlation + ~180° phase = unilateral gait
    type = "unilateral";
    confidence = Math.min(100, Math.abs(corrAtZero) * 100 + 20);
  } else if (corrAtZero > 0.3 && corrAtZero <= 0.7) {
    // Moderate correlation = could be mixed
    type = "mixed";
    confidence = 50 + (corrAtZero - 0.3) * 50;
  } else {
    type = "unilateral";
    confidence = 60;
  }

  return {
    type,
    confidence,
    correlationAtZero: corrAtZero,
    optimalLag: bestLag,
    optimalCorrelation: bestCorr,
    estimatedCycleSamples: cycleSamples,
    phaseOffsetDegrees,
  };
}

// ─────────────────────────────────────────────────────────────────
// Rolling Phase Offset (#39)
// ─────────────────────────────────────────────────────────────────

/** #39: rolling_phase_offset - Windowed phase offset tracking. */
export function calculateRollingPhaseOffset(
  left: number[],
  right: number[],
  timeStep: number,
  windowSize: number = 100,
  stepSize: number = 10
): RollingPhaseResult {
  const n = Math.min(left.length, right.length);
  const phaseOffsetSeries: number[] = [];
  const correlationSeries: number[] = [];
  const windowCenters: number[] = [];
  const transitions: TransitionEvent[] = [];

  if (n < windowSize) {
    return {
      phaseOffsetSeries: [],
      correlationSeries: [],
      windowCenters: [],
      transitions: [],
      dominantPhaseOffset: 0,
    };
  }

  let prevClassification: MovementClassification | null = null;

  for (let start = 0; start <= n - windowSize; start += stepSize) {
    const end = start + windowSize;
    const windowLeft = left.slice(start, end);
    const windowRight = right.slice(start, end);
    const center = start + Math.floor(windowSize / 2);

    const classification = classifyMovementType(windowLeft, windowRight, timeStep);

    phaseOffsetSeries.push(classification.phaseOffsetDegrees);
    correlationSeries.push(classification.correlationAtZero);
    windowCenters.push(center);

    // Detect transitions
    if (prevClassification) {
      const phaseDiff = Math.abs(
        classification.phaseOffsetDegrees - prevClassification.phaseOffsetDegrees
      );
      const typeChanged = classification.type !== prevClassification.type;

      if (phaseDiff > PHASE_CHANGE_THRESHOLD || typeChanged) {
        transitions.push({
          index: center,
          timeMs: center * timeStep * 1000,
          fromPhase: prevClassification.phaseOffsetDegrees,
          toPhase: classification.phaseOffsetDegrees,
          fromType: prevClassification.type,
          toType: classification.type,
        });
      }
    }
    prevClassification = classification;
  }

  // Calculate dominant phase offset (mode via histogram)
  const phaseHistogram: Record<number, number> = {};
  for (const phase of phaseOffsetSeries) {
    const bucket = Math.round(phase / 10) * 10;
    phaseHistogram[bucket] = (phaseHistogram[bucket] || 0) + 1;
  }
  let dominantPhaseOffset = 0;
  let maxCount = 0;
  for (const bucketStr of Object.keys(phaseHistogram)) {
    const bucket = Number(bucketStr);
    const count = phaseHistogram[bucket];
    if (count > maxCount) {
      maxCount = count;
      dominantPhaseOffset = bucket;
    }
  }

  return {
    phaseOffsetSeries,
    correlationSeries,
    windowCenters,
    transitions,
    dominantPhaseOffset,
  };
}

// ─────────────────────────────────────────────────────────────────
// Optimal Phase Alignment (#41) - Laplacian of Gaussian (LoG) Method
// ─────────────────────────────────────────────────────────────────

/**
 * Generate a 1D Gaussian kernel with specified sigma.
 * Kernel size is automatically determined (6*sigma + 1 for 99.7% coverage).
 */
function generateGaussianKernelWithSigma(sigma: number): number[] {
  const size = Math.floor(6 * sigma) + 1;
  const kernel: number[] = new Array(size);
  const mid = Math.floor(size / 2);
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - mid;
    const val = Math.exp(-0.5 * (x / sigma) ** 2);
    kernel[i] = val;
    sum += val;
  }

  // Normalize
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  return kernel;
}

/**
 * Convolve signal with kernel (same-size output with edge handling).
 */
function convolve1D(signal: number[], kernel: number[]): number[] {
  const n = signal.length;
  const k = kernel.length;
  const half = Math.floor(k / 2);
  const result: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    let sum = 0;
    let weightSum = 0;

    for (let j = 0; j < k; j++) {
      const idx = i + j - half;
      if (idx >= 0 && idx < n) {
        sum += signal[idx] * kernel[j];
        weightSum += kernel[j];
      }
    }

    result[i] = weightSum > 0 ? sum / weightSum : signal[i];
  }

  return result;
}

/**
 * Apply Laplacian (second derivative) using central differences.
 * Laplacian[i] = signal[i+1] - 2*signal[i] + signal[i-1]
 */
function applyLaplacian(signal: number[]): number[] {
  const n = signal.length;
  if (n < 3) return new Array(n).fill(0);

  const result: number[] = new Array(n);

  // Edge handling: extend with boundary values
  result[0] = signal[1] - 2 * signal[0] + signal[0]; // Use signal[0] for out-of-bounds
  result[n - 1] = signal[n - 1] - 2 * signal[n - 1] + signal[n - 2];

  for (let i = 1; i < n - 1; i++) {
    result[i] = signal[i + 1] - 2 * signal[i] + signal[i - 1];
  }

  return result;
}

/**
 * Apply Laplacian of Gaussian (LoG) to signal.
 * 1. Smooth with Gaussian (removes noise)
 * 2. Apply Laplacian (second derivative)
 * Zero-crossings of LoG = inflection points (max velocity moments)
 */
function applyLoG(signal: number[], sigma: number = 8): number[] {
  // Step 1: Gaussian smoothing
  const gaussianKernel = generateGaussianKernelWithSigma(sigma);
  const smoothed = convolve1D(signal, gaussianKernel);

  // Step 2: Laplacian (second derivative)
  const log = applyLaplacian(smoothed);

  return log;
}

/**
 * Find inflection points using Laplacian of Gaussian (LoG).
 * Inflection points are where the second derivative (LoG) crosses zero.
 * These correspond to moments of maximum velocity (fastest movement).
 */
function findInflectionPoints(signal: number[], sigma: number = 8, minDistance: number = 5): number[] {
  const n = signal.length;
  if (n < 10) return [];

  // Apply LoG
  const log = applyLoG(signal, sigma);

  const inflectionPoints: number[] = [];

  // Find zero-crossings of LoG
  for (let i = 1; i < n; i++) {
    // Check for sign change (zero crossing)
    if (log[i - 1] * log[i] < 0) {
      // Interpolate to find more precise crossing point
      const idx = Math.abs(log[i - 1]) < Math.abs(log[i]) ? i - 1 : i;

      // Enforce minimum distance between inflection points
      if (inflectionPoints.length === 0 ||
          idx - inflectionPoints[inflectionPoints.length - 1] >= minDistance) {
        inflectionPoints.push(idx);
      }
    }
  }

  return inflectionPoints;
}

/**
 * Calculate alignment score for a given lag by measuring how well
 * inflection points in left align with inflection points in right.
 * Lower score = better alignment.
 */
function calculateInflectionPointAlignmentScore(
  leftInflectionPoints: number[],
  rightInflectionPoints: number[],
  lag: number,
  maxMatchDistance: number
): { score: number; matchedCount: number } {
  if (leftInflectionPoints.length === 0 || rightInflectionPoints.length === 0) {
    return { score: Infinity, matchedCount: 0 };
  }

  let totalDistance = 0;
  let matchedCount = 0;

  // For each inflection point in left, find nearest in right (with lag applied)
  for (const leftIdx of leftInflectionPoints) {
    let minDist = Infinity;

    for (const rightIdx of rightInflectionPoints) {
      // Apply lag: if lag > 0, right is shifted forward, so we compare leftIdx to rightIdx - lag
      const alignedRightIdx = rightIdx - lag;
      const dist = Math.abs(leftIdx - alignedRightIdx);

      if (dist < minDist) {
        minDist = dist;
      }
    }

    // Only count as a match if within reasonable distance
    if (minDist <= maxMatchDistance) {
      totalDistance += minDist;
      matchedCount++;
    } else {
      // Penalize unmatched inflection points
      totalDistance += maxMatchDistance * 2;
    }
  }

  // Score favors more matches and smaller total distance
  const score = matchedCount > 0
    ? totalDistance / matchedCount - matchedCount * 0.1 // Bonus for more matches
    : Infinity;

  return { score, matchedCount };
}

/**
 * Compute first derivative (velocity) using simple differences.
 * derivative[i] = signal[i+1] - signal[i]
 */
function computeFirstDerivative(signal: number[]): number[] {
  const n = signal.length;
  if (n < 2) return [];

  const derivative: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    derivative[i] = signal[i + 1] - signal[i];
  }
  return derivative;
}

/**
 * Find local maxima indices in a signal.
 */
function findLocalMaximaIndices(signal: number[]): number[] {
  const maxima: number[] = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
      maxima.push(i);
    }
  }
  return maxima;
}

/**
 * Calculate phase alignment for a single segment using velocity overlap.
 */
function calculateSegmentPhaseAlignment(
  leftSegment: number[],
  rightSegment: number[],
  maxSearchSamples: number
): number {
  const n = Math.min(leftSegment.length, rightSegment.length);
  if (n < 10) return 0;

  const velLeft = computeFirstDerivative(leftSegment);
  const velRight = computeFirstDerivative(rightSegment);
  const velLen = Math.min(velLeft.length, velRight.length);

  if (velLen < 5) return 0;

  let bestAreaDiff = Infinity;
  let bestLag = 0;

  // Limit search to segment size
  const searchRange = Math.min(maxSearchSamples, Math.floor(velLen / 2));

  for (let lag = -searchRange; lag <= searchRange; lag++) {
    let areaDiff = 0;
    let count = 0;

    for (let i = 0; i < velLen; i++) {
      const j = i + lag;
      if (j >= 0 && j < velLen) {
        areaDiff += Math.abs(velLeft[i] - velRight[j]);
        count++;
      }
    }

    const normalizedArea = count > 0 ? areaDiff / count : Infinity;

    if (normalizedArea < bestAreaDiff) {
      bestAreaDiff = normalizedArea;
      bestLag = lag;
    }
  }

  return bestLag;
}


/**
 * #41: optimal_phase_alignment - Calculate optimal phase offset using velocity overlap.
 * Computes the first derivative (velocity) of both signals and finds the lag
 * that minimizes the area between the velocity curves.
 */
export function calculateOptimalPhaseAlignment(
  left: number[],
  right: number[],
  timeStep: number,
  maxSearchSamples: number = 50
): PhaseAlignmentComputed {
  const n = Math.min(left.length, right.length);

  if (n < 20) {
    return {
      optimalOffsetSamples: 0,
      optimalOffsetMs: 0,
      optimalOffsetDegrees: 0,
      alignedCorrelation: 0,
      unalignedCorrelation: 0,
      correlationImprovement: 0,
      alignedRight: [...right],
    };
  }

  // Compute first derivatives (velocity) of both signals
  const velLeft = computeFirstDerivative(left.slice(0, n));
  const velRight = computeFirstDerivative(right.slice(0, n));
  const velLen = Math.min(velLeft.length, velRight.length);

  // Find best lag by minimizing area between velocity curves
  let bestAreaDiff = Infinity;
  let areaAtZero = 0;
  let bestLag = 0;

  for (let lag = -maxSearchSamples; lag <= maxSearchSamples; lag++) {
    let areaDiff = 0;
    let count = 0;

    for (let i = 0; i < velLen; i++) {
      const j = i + lag;
      if (j >= 0 && j < velLen) {
        areaDiff += Math.abs(velLeft[i] - velRight[j]);
        count++;
      }
    }

    // Normalize by count to make comparable across different lags
    const normalizedArea = count > 0 ? areaDiff / count : Infinity;

    if (lag === 0) areaAtZero = normalizedArea;

    if (normalizedArea < bestAreaDiff) {
      bestAreaDiff = normalizedArea;
      bestLag = lag;
    }
  }

  // Create aligned right signal
  const alignedRight: number[] = new Array(right.length);
  for (let i = 0; i < right.length; i++) {
    const srcIdx = i + bestLag;
    if (srcIdx >= 0 && srcIdx < right.length) {
      alignedRight[i] = right[srcIdx];
    } else if (srcIdx < 0) {
      alignedRight[i] = right[0];
    } else {
      alignedRight[i] = right[right.length - 1];
    }
  }

  // Calculate correlation on original signals for reporting
  let origMeanL = 0, origMeanR = 0;
  for (let i = 0; i < n; i++) {
    origMeanL += left[i];
    origMeanR += right[i];
  }
  origMeanL /= n;
  origMeanR /= n;

  let origSumSqL = 0, origSumSqR = 0;
  for (let i = 0; i < n; i++) {
    origSumSqL += (left[i] - origMeanL) ** 2;
    origSumSqR += (right[i] - origMeanR) ** 2;
  }
  const origStdL = Math.sqrt(origSumSqL / n);
  const origStdR = Math.sqrt(origSumSqR / n);

  // Correlation at zero lag (original signals)
  let corrAtZero = 0;
  if (origStdL > 1e-10 && origStdR > 1e-10) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += (left[i] - origMeanL) * (right[i] - origMeanR);
    }
    corrAtZero = sum / (n * origStdL * origStdR);
  }

  // Correlation at best lag (original signals)
  let corrAtBest = 0;
  if (origStdL > 1e-10 && origStdR > 1e-10) {
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      const j = i + bestLag;
      if (j >= 0 && j < n) {
        sum += (left[i] - origMeanL) * (right[j] - origMeanR);
        count++;
      }
    }
    corrAtBest = count > 0 ? sum / (count * origStdL * origStdR) : 0;
  }

  // Estimate cycle length for degree conversion
  const cycleSamples = estimateCycleLength(left, n);
  const optimalOffsetDegrees = Math.abs((bestLag * 360) / cycleSamples) % 360;

  // Calculate improvement based on area reduction (positive = better alignment)
  const improvement = areaAtZero > 0 ? (areaAtZero - bestAreaDiff) / areaAtZero : 0;

  return {
    optimalOffsetSamples: bestLag,
    optimalOffsetMs: bestLag * timeStep * 1000,
    optimalOffsetDegrees,
    alignedCorrelation: corrAtBest,
    unalignedCorrelation: corrAtZero,
    correlationImprovement: improvement,
    alignedRight,
  };
}

// ─────────────────────────────────────────────────────────────────
// Phase Correction
// ─────────────────────────────────────────────────────────────────

/** Apply phase correction to align signals for unilateral movements. */
export function applyPhaseCorrection(
  left: number[],
  right: number[],
  timeStep: number,
  forceCorrection: boolean = false
): PhaseCorrectedSignals {
  const n = Math.min(left.length, right.length);

  // Classify movement
  const classification = classifyMovementType(left, right, timeStep);

  // Determine if phase correction is needed
  const requiresCorrection =
    forceCorrection ||
    classification.type === "unilateral" ||
    classification.type === "mixed" ||
    classification.correlationAtZero < 0.5;

  if (!requiresCorrection) {
    return {
      left: left.slice(0, n),
      right: right.slice(0, n),
      appliedShiftSamples: 0,
      appliedShiftMs: 0,
      movementType: classification.type,
      requiresCorrection: false,
    };
  }

  // Find optimal alignment
  const alignment = calculateOptimalPhaseAlignment(left, right, timeStep);

  return {
    left: left.slice(0, n),
    right: alignment.alignedRight.slice(0, n),
    appliedShiftSamples: alignment.optimalOffsetSamples,
    appliedShiftMs: alignment.optimalOffsetMs,
    movementType: classification.type,
    requiresCorrection: true,
  };
}

// ─────────────────────────────────────────────────────────────────
// Advanced Asymmetry (#40)
// ─────────────────────────────────────────────────────────────────

/** #40: advanced_asymmetry - Separates placement offset from true movement asymmetry. */
export function calculateAdvancedAsymmetry(
  left: number[],
  right: number[],
  timeStep: number,
  kernelSize: number = DEFAULT_KERNEL_SIZE,
  asymmetryThreshold: number = DEFAULT_ASYMMETRY_THRESHOLD,
  autoPhaseCorrect: boolean = true
): AdvancedAsymmetryResult {
  // Apply phase correction if needed
  const phaseCorrection = autoPhaseCorrect
    ? applyPhaseCorrection(left, right, timeStep)
    : {
        left: left.slice(0, Math.min(left.length, right.length)),
        right: right.slice(0, Math.min(left.length, right.length)),
        appliedShiftSamples: 0,
        appliedShiftMs: 0,
        movementType: "unknown" as MovementType,
        requiresCorrection: false,
      };

  const L = phaseCorrection.left;
  const R = phaseCorrection.right;
  const n = L.length;

  if (n < kernelSize) {
    return {
      phaseCorrection: {
        appliedShiftSamples: phaseCorrection.appliedShiftSamples,
        appliedShiftMs: phaseCorrection.appliedShiftMs,
        movementType: phaseCorrection.movementType,
        requiresCorrection: phaseCorrection.requiresCorrection,
      },
      asymmetryEvents: [],
      avgBaselineOffset: 0,
      avgRealAsymmetry: 0,
      maxRealAsymmetry: 0,
      totalAsymmetryDurationMs: 0,
      asymmetryPercentage: 0,
      baselineStability: 0,
      signalToNoiseRatio: 0,
    };
  }

  // Calculate raw difference
  const rawDiff: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    rawDiff[i] = L[i] - R[i];
  }

  // Extract baseline using Gaussian convolution
  const kernel = generateGaussianKernel(kernelSize);
  const baselineOffset = convolveSignal(rawDiff, kernel);

  // Real asymmetry = raw diff - baseline
  const realAsymmetry: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    realAsymmetry[i] = rawDiff[i] - baselineOffset[i];
  }

  // Detect asymmetry events
  const asymmetryEvents: AsymmetryEvent[] = [];
  let inEvent = false;
  let eventStart = 0;
  let eventPeak = 0;
  let eventSum = 0;
  let eventCount = 0;
  let eventDirection: AsymmetryDirection = "left_dominant";

  for (let i = 0; i < n; i++) {
    const absAsym = Math.abs(realAsymmetry[i]);

    if (absAsym > asymmetryThreshold) {
      if (!inEvent) {
        inEvent = true;
        eventStart = i;
        eventPeak = absAsym;
        eventSum = absAsym;
        eventCount = 1;
        eventDirection = realAsymmetry[i] > 0 ? "left_dominant" : "right_dominant";
      } else {
        eventPeak = Math.max(eventPeak, absAsym);
        eventSum += absAsym;
        eventCount++;
      }
    } else if (inEvent) {
      const durationMs = (i - 1 - eventStart) * timeStep * 1000;
      if (durationMs > MIN_EVENT_DURATION_MS) {
        asymmetryEvents.push({
          startIndex: eventStart,
          endIndex: i - 1,
          startTimeMs: eventStart * timeStep * 1000,
          endTimeMs: (i - 1) * timeStep * 1000,
          durationMs,
          peakAsymmetry: eventPeak,
          avgAsymmetry: eventSum / eventCount,
          direction: eventDirection,
          area: eventSum * timeStep,
        });
      }
      inEvent = false;
    }
  }

  // Handle event at end
  if (inEvent && eventCount > 0) {
    const durationMs = (n - 1 - eventStart) * timeStep * 1000;
    if (durationMs > MIN_EVENT_DURATION_MS) {
      asymmetryEvents.push({
        startIndex: eventStart,
        endIndex: n - 1,
        startTimeMs: eventStart * timeStep * 1000,
        endTimeMs: (n - 1) * timeStep * 1000,
        durationMs,
        peakAsymmetry: eventPeak,
        avgAsymmetry: eventSum / eventCount,
        direction: eventDirection,
        area: eventSum * timeStep,
      });
    }
  }

  // Calculate summary statistics
  let avgBaselineOffset = 0;
  let avgRealAsymmetry = 0;
  for (let i = 0; i < n; i++) {
    avgBaselineOffset += Math.abs(baselineOffset[i]);
    avgRealAsymmetry += Math.abs(realAsymmetry[i]);
  }
  avgBaselineOffset /= n;
  avgRealAsymmetry /= n;

  const maxRealAsymmetry = Math.max(...realAsymmetry.map(Math.abs));

  const totalAsymmetryDurationMs = asymmetryEvents.reduce((sum, e) => sum + e.durationMs, 0);
  const totalDurationMs = n * timeStep * 1000;
  const asymmetryPercentage =
    totalDurationMs > 0 ? (totalAsymmetryDurationMs / totalDurationMs) * 100 : 0;

  // Baseline stability
  let baselineChangeSum = 0;
  for (let i = 1; i < n; i++) {
    baselineChangeSum += Math.abs(baselineOffset[i] - baselineOffset[i - 1]);
  }
  const baselineStability = baselineChangeSum / (n - 1);

  // Signal to noise ratio
  const quietPeriods = realAsymmetry.filter((a) => Math.abs(a) < asymmetryThreshold);
  const noiseFloor =
    quietPeriods.length > 10
      ? Math.sqrt(quietPeriods.reduce((s, v) => s + v * v, 0) / quietPeriods.length)
      : 1;
  const signalToNoiseRatio = noiseFloor > 0 ? maxRealAsymmetry / noiseFloor : 0;

  return {
    phaseCorrection: {
      appliedShiftSamples: phaseCorrection.appliedShiftSamples,
      appliedShiftMs: phaseCorrection.appliedShiftMs,
      movementType: phaseCorrection.movementType,
      requiresCorrection: phaseCorrection.requiresCorrection,
    },
    asymmetryEvents,
    avgBaselineOffset,
    avgRealAsymmetry,
    maxRealAsymmetry,
    totalAsymmetryDurationMs,
    asymmetryPercentage,
    baselineStability,
    signalToNoiseRatio,
  };
}

// ─────────────────────────────────────────────────────────────────
// Rolling Advanced Asymmetry (#40b)
// ─────────────────────────────────────────────────────────────────

/** #40b: rolling_advanced_asymmetry - Windowed asymmetry analysis. */
export function calculateRollingAdvancedAsymmetry(
  left: number[],
  right: number[],
  timeStep: number,
  windowSize: number = 100,
  stepSize: number = 20,
  kernelSize: number = 50
): RollingAsymmetryResult {
  const n = Math.min(left.length, right.length);
  const windows: RollingAsymmetryWindow[] = [];

  let timeInBilateral = 0;
  let timeInUnilateral = 0;
  let prevType: MovementType | null = null;
  let transitionCount = 0;

  for (let start = 0; start <= n - windowSize; start += stepSize) {
    const end = start + windowSize;
    const center = start + Math.floor(windowSize / 2);

    const windowL = left.slice(start, end);
    const windowR = right.slice(start, end);

    const result = calculateAdvancedAsymmetry(
      windowL,
      windowR,
      timeStep,
      kernelSize,
      DEFAULT_ASYMMETRY_THRESHOLD,
      true
    );

    const window: RollingAsymmetryWindow = {
      windowCenter: center,
      windowCenterMs: center * timeStep * 1000,
      movementType: result.phaseCorrection.movementType,
      phaseOffsetApplied: result.phaseCorrection.appliedShiftSamples,
      avgAsymmetry: result.avgRealAsymmetry,
      maxAsymmetry: result.maxRealAsymmetry,
      baselineOffset: result.avgBaselineOffset,
    };
    windows.push(window);

    // Track time in each movement type
    const windowDurationMs = windowSize * timeStep * 1000;
    if (window.movementType === "bilateral") {
      timeInBilateral += windowDurationMs;
    } else if (window.movementType === "unilateral") {
      timeInUnilateral += windowDurationMs;
    }

    // Detect transitions
    if (prevType !== null && prevType !== window.movementType) {
      transitionCount++;
    }
    prevType = window.movementType;
  }

  // Overall summary
  const overallSummary: RollingAsymmetrySummary = {
    avgAsymmetry:
      windows.length > 0
        ? windows.reduce((s, w) => s + w.avgAsymmetry, 0) / windows.length
        : 0,
    maxAsymmetry:
      windows.length > 0 ? Math.max(...windows.map((w) => w.maxAsymmetry)) : 0,
    timeInBilateral,
    timeInUnilateral,
    transitionCount,
  };

  return {
    windows,
    overallSummary,
  };
}
