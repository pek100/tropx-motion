/**
 * Biomechanical Metrics Library
 * Entry point for all metrics computation.
 */

// Types
export type {
  Quaternion,
  MovementCycle,
  GroundContact,
  CrossCorrelationResult,
  FFTResult,
  PerLegMetrics,
  AsymmetryIndices,
  TemporalAsymmetry,
  BilateralAnalysis,
  UnilateralMetrics,
  UnilateralAnalysis,
  JumpMetrics,
  ForcePowerMetrics,
  StiffnessMetrics,
  SmoothnessMetrics,
  ShockAbsorptionQuality,
  ShockAbsorptionResult,
  TemporalCoordination,
  GaitCycleMetrics,
  MovementType,
  MovementClassification,
  TransitionEvent,
  RollingPhaseResult,
  PhaseCorrectedSignals,
  PhaseCorrectionSummary,
  AsymmetryDirection,
  AsymmetryEvent,
  AdvancedAsymmetryResult,
  AdvancedAsymmetryComputed,
  RollingAsymmetryWindow,
  RollingAsymmetrySummary,
  RollingAsymmetryResult,
  PhaseAlignmentResult,
  PhaseAlignmentComputed,
  FullAnalysisResult,
  ComputationContext,
  ComputationResult,
  MetricStatus,
  // OPI types
  ActivityProfile,
  OPIDomain,
  MetricDirection,
  OPIGrade,
  MetricConfig,
  DomainScoreContributor,
  DomainScore,
  OPIConfidenceInterval,
  OPIResult,
} from "./types";

// Main computation
export {
  computeAllMetrics,
  extractAnglesFromChunks,
  type RecordingChunk,
} from "./compute";

// Re-export individual modules for direct access
export * from "./helpers";
export * from "./quaternionUtils";
export * from "./computedParams";
export * from "./bilateral";
export * from "./classification";
export * from "./smoothness";
export * from "./groundContact";
export * from "./opi";
