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
// Optimal Phase Alignment (#41)
// ─────────────────────────────────────────────────────────────────

/** #41: optimal_phase_alignment - Calculate optimal phase offset for signal alignment. */
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

  if (stdL < 1e-10 || stdR < 1e-10) {
    return {
      optimalOffsetSamples: 0,
      optimalOffsetMs: 0,
      optimalOffsetDegrees: 0,
      alignedCorrelation: 1,
      unalignedCorrelation: 1,
      correlationImprovement: 0,
      alignedRight: [...right],
    };
  }

  // Find optimal lag
  let bestCorr = -Infinity;
  let bestLag = 0;
  let corrAtZero = 0;

  for (let lag = -maxSearchSamples; lag <= maxSearchSamples; lag++) {
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

  // Estimate cycle length for degree conversion
  const cycleSamples = estimateCycleLength(left, n);
  const optimalOffsetDegrees = Math.abs((bestLag * 360) / cycleSamples) % 360;

  return {
    optimalOffsetSamples: bestLag,
    optimalOffsetMs: bestLag * timeStep * 1000,
    optimalOffsetDegrees,
    alignedCorrelation: bestCorr,
    unalignedCorrelation: corrAtZero,
    correlationImprovement: bestCorr - corrAtZero,
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
