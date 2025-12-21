/**
 * Main Metrics Computation Orchestrator
 * Ties together all metric calculations into a single pipeline.
 */

import type {
  FullAnalysisResult,
  ComputationContext,
  ComputationResult,
  PerLegMetrics,
  BilateralAnalysis,
  UnilateralAnalysis,
  MovementClassification,
  RollingPhaseResult,
  AdvancedAsymmetryResult,
  // RollingAsymmetryResult, // ❌ DISABLED
  PhaseAlignmentResult,
  JumpMetrics,
  ForcePowerMetrics,
  StiffnessMetrics,
  SmoothnessMetrics,
  TemporalCoordination,
  GaitCycleMetrics,
  ActivityProfile,
} from "./types";

import { quaternionArrayToAngles } from "./quaternionUtils";
import { calculatePerLegMetrics } from "./computedParams";
import { calculateBilateralAnalysis, calculateUnilateralAnalysis } from "./bilateral";
import {
  classifyMovementType,
  calculateRollingPhaseOffset,
  calculateAdvancedAsymmetry,
  // calculateRollingAdvancedAsymmetry, // ❌ DISABLED - conceptually flawed
  calculateOptimalPhaseAlignment,
} from "./classification";
import { calculateSmoothnessMetrics, calculateTemporalCoordination } from "./smoothness";
import {
  calculateJumpMetrics,
  calculateForcePowerMetrics,
  calculateStiffnessMetrics,
  calculateGaitCycleMetrics,
  deriveAngularAcceleration,
} from "./groundContact";
import { calculateOPI } from "./opi";

// ─────────────────────────────────────────────────────────────────
// Types for Chunk Data
// ─────────────────────────────────────────────────────────────────

export interface RecordingChunk {
  sessionId: string;
  chunkIndex: number;
  totalChunks: number;
  sampleRate: number;
  sampleCount: number;
  leftKneeQ: number[];
  rightKneeQ: number[];
  leftKneeInterpolated: number[];
  leftKneeMissing: number[];
  rightKneeInterpolated: number[];
  rightKneeMissing: number[];
}

// ─────────────────────────────────────────────────────────────────
// Data Extraction
// ─────────────────────────────────────────────────────────────────

/** Extract angles from recording chunks and combine into full session. */
export function extractAnglesFromChunks(chunks: RecordingChunk[]): {
  leftAngles: number[];
  rightAngles: number[];
  sampleRate: number;
  leftInterpolatedIndices: Set<number>;
  rightInterpolatedIndices: Set<number>;
  leftMissingIndices: Set<number>;
  rightMissingIndices: Set<number>;
} {
  // Sort chunks by index
  const sorted = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

  const leftAngles: number[] = [];
  const rightAngles: number[] = [];
  const leftInterpolatedIndices = new Set<number>();
  const rightInterpolatedIndices = new Set<number>();
  const leftMissingIndices = new Set<number>();
  const rightMissingIndices = new Set<number>();

  let sampleRate = 100; // default
  let globalOffset = 0;

  for (const chunk of sorted) {
    sampleRate = chunk.sampleRate;

    // Convert quaternions to angles
    const chunkLeftAngles = quaternionArrayToAngles(chunk.leftKneeQ, "y");
    const chunkRightAngles = quaternionArrayToAngles(chunk.rightKneeQ, "y");

    // Append angles
    leftAngles.push(...chunkLeftAngles);
    rightAngles.push(...chunkRightAngles);

    // Track interpolated/missing indices with global offset
    for (const idx of chunk.leftKneeInterpolated) {
      leftInterpolatedIndices.add(globalOffset + idx);
    }
    for (const idx of chunk.leftKneeMissing) {
      leftMissingIndices.add(globalOffset + idx);
    }
    for (const idx of chunk.rightKneeInterpolated) {
      rightInterpolatedIndices.add(globalOffset + idx);
    }
    for (const idx of chunk.rightKneeMissing) {
      rightMissingIndices.add(globalOffset + idx);
    }

    globalOffset += chunk.sampleCount;
  }

  return {
    leftAngles,
    rightAngles,
    sampleRate,
    leftInterpolatedIndices,
    rightInterpolatedIndices,
    leftMissingIndices,
    rightMissingIndices,
  };
}

// ─────────────────────────────────────────────────────────────────
// Main Computation Pipeline
// ─────────────────────────────────────────────────────────────────

/** Compute all metrics for a recording session. */
export function computeAllMetrics(
  chunks: RecordingChunk[],
  sessionId: string,
  activityProfile: ActivityProfile = "general"
): ComputationResult {
  try {
    // Extract and combine all chunk data
    const {
      leftAngles,
      rightAngles,
      sampleRate,
      leftInterpolatedIndices,
      rightInterpolatedIndices,
      leftMissingIndices,
      rightMissingIndices,
    } = extractAnglesFromChunks(chunks);

    if (leftAngles.length === 0 || rightAngles.length === 0) {
      return {
        success: false,
        metrics: null,
        error: "No angle data available",
        computedAt: Date.now(),
      };
    }

    const timeStep = 1 / sampleRate;

    // Create computation context
    const ctx: ComputationContext = {
      sessionId,
      sampleRate,
      timeStep,
      leftAngles,
      rightAngles,
      leftInterpolatedIndices,
      rightInterpolatedIndices,
      leftMissingIndices,
      rightMissingIndices,
    };

    // Run pipeline
    const metrics = runAnalysisPipeline(ctx, activityProfile);

    return {
      success: true,
      metrics,
      error: null,
      computedAt: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      metrics: null,
      error: error instanceof Error ? error.message : "Unknown error",
      computedAt: Date.now(),
    };
  }
}

/** Run the full analysis pipeline. */
function runAnalysisPipeline(
  ctx: ComputationContext,
  activityProfile: ActivityProfile
): FullAnalysisResult {
  const { leftAngles, rightAngles, timeStep, sampleRate } = ctx;

  // Step 1: Movement Classification
  const movementClassification = classifyMovementType(leftAngles, rightAngles, timeStep);

  // Step 2: Rolling Phase Analysis
  const rollingPhase = calculateRollingPhaseOffset(leftAngles, rightAngles, timeStep);

  // Step 3: Phase Alignment (global)
  const phaseAlignmentFull = calculateOptimalPhaseAlignment(leftAngles, rightAngles, timeStep);
  const phaseAlignment: PhaseAlignmentResult = {
    optimalOffsetSamples: phaseAlignmentFull.optimalOffsetSamples,
    optimalOffsetMs: phaseAlignmentFull.optimalOffsetMs,
    optimalOffsetDegrees: phaseAlignmentFull.optimalOffsetDegrees,
    alignedCorrelation: phaseAlignmentFull.alignedCorrelation,
    unalignedCorrelation: phaseAlignmentFull.unalignedCorrelation,
    correlationImprovement: phaseAlignmentFull.correlationImprovement,
  };

  // Step 4: Advanced Asymmetry
  const advancedAsymmetry = calculateAdvancedAsymmetry(
    leftAngles,
    rightAngles,
    timeStep
  );

  // Step 5: Rolling Advanced Asymmetry
  // ❌ DISABLED - Rolling phase correction is conceptually flawed:
  //   - Each window gets different phase shift, creating discontinuities
  //   - Masks real asymmetry (consistent timing differences are meaningful)
  //   - Redundant with Gaussian baseline extraction in advancedAsymmetry
  // TODO: Remove entirely or redesign if per-window analysis is needed
  // const rollingAsymmetry = calculateRollingAdvancedAsymmetry(
  //   leftAngles,
  //   rightAngles,
  //   timeStep
  // );

  // Step 6: Per-leg Metrics
  const leftLeg = calculatePerLegMetrics(leftAngles, timeStep);
  const rightLeg = calculatePerLegMetrics(rightAngles, timeStep);

  // Step 7: Bilateral Analysis
  const bilateralAnalysis = calculateBilateralAnalysis(
    leftLeg,
    rightLeg,
    leftAngles,
    rightAngles,
    timeStep
  );

  // Step 8: Unilateral Analysis
  const unilateralAnalysis = calculateUnilateralAnalysis(leftLeg, rightLeg);

  // Step 9: Smoothness Metrics (average both legs for balanced assessment)
  const leftSmoothness = calculateSmoothnessMetrics(leftAngles, timeStep, sampleRate);
  const rightSmoothness = calculateSmoothnessMetrics(rightAngles, timeStep, sampleRate);
  const smoothnessMetrics: SmoothnessMetrics = {
    sparc: (leftSmoothness.sparc + rightSmoothness.sparc) / 2,
    ldlj: (leftSmoothness.ldlj + rightSmoothness.ldlj) / 2,
    nVelocityPeaks: Math.round((leftSmoothness.nVelocityPeaks + rightSmoothness.nVelocityPeaks) / 2),
  };

  // Step 10: Derive angular acceleration for jump/gait metrics
  // TODO: review needed - using angular acceleration, not raw gyro
  const leftAccel = deriveAngularAcceleration(leftAngles, timeStep);

  // Step 11: Temporal Coordination
  const temporalCoordination = calculateTemporalCoordination(
    leftAngles,
    rightAngles,
    leftAccel,
    timeStep
  );

  // Step 12: Jump Metrics (from angular acceleration)
  const jumpMetrics = calculateJumpMetrics(leftAccel, timeStep);

  // Step 13: Force/Power Metrics
  const forcePowerMetrics = calculateForcePowerMetrics(leftAccel, timeStep);

  // Step 14: Stiffness Metrics
  const stiffnessMetrics = calculateStiffnessMetrics(
    jumpMetrics.flightTimeMs,
    jumpMetrics.groundContactTimeMs
  );

  // Step 15: Gait Cycle Metrics
  const gaitCycleMetrics = calculateGaitCycleMetrics(leftAccel, timeStep);

  // Step 16: Calculate OPI (Overall Performance Index)
  // Build partial result for OPI calculation
  const partialResult = {
    leftLeg,
    rightLeg,
    bilateralAnalysis,
    unilateralAnalysis,
    jumpMetrics,
    forcePowerMetrics,
    stiffnessMetrics,
    smoothnessMetrics,
    temporalCoordination,
    gaitCycleMetrics,
    movementClassification,
    rollingPhase,
    advancedAsymmetry,
    // rollingAsymmetry, // ❌ DISABLED - see Step 5 comment
    phaseAlignment,
  };

  const opiResult = calculateOPI(
    partialResult as FullAnalysisResult,
    activityProfile
  );

  return {
    ...partialResult,
    opiResult,
  };
}

// ─────────────────────────────────────────────────────────────────
// Export Index
// ─────────────────────────────────────────────────────────────────

export { quaternionArrayToAngles } from "./quaternionUtils";
export { calculatePerLegMetrics } from "./computedParams";
export { calculateBilateralAnalysis, calculateUnilateralAnalysis } from "./bilateral";
export {
  classifyMovementType,
  calculateRollingPhaseOffset,
  calculateAdvancedAsymmetry,
  // calculateRollingAdvancedAsymmetry, // ❌ DISABLED - conceptually flawed
  calculateOptimalPhaseAlignment,
  recalculateWithCustomPhaseOffset,
} from "./classification";
export { calculateSmoothnessMetrics, calculateTemporalCoordination } from "./smoothness";
export {
  calculateJumpMetrics,
  calculateForcePowerMetrics,
  calculateStiffnessMetrics,
  calculateGaitCycleMetrics,
  deriveAngularAcceleration,
} from "./groundContact";
