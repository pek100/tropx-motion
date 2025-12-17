/**
 * Biomechanical Metrics Type Definitions
 * Based on biomechanical-metrics-spec-v1.2.md
 */

// ─────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface MovementCycle {
  startIndex: number;
  endIndex: number;
  duration: number;
}

export interface GroundContact {
  touchdownIndex: number;
  takeoffIndex: number;
  contactTimeMs: number;
  flightTimeMs: number;
  impactMagnitude: number;
}

export interface CrossCorrelationResult {
  correlation: number;
  lag: number;
}

export interface FFTResult {
  real: number[];
  imag: number[];
}

// ─────────────────────────────────────────────────────────────────
// Per-Leg Metrics (#1-11)
// ─────────────────────────────────────────────────────────────────

export interface PerLegMetrics {
  overallMaxROM: number;
  averageROM: number;
  peakFlexion: number;
  peakExtension: number;
  peakAngularVelocity: number;
  explosivenessLoading: number;
  explosivenessConcentric: number;
  rmsJerk: number;
  romCoV: number;
  peakResultantAcceleration: number;
}

// ─────────────────────────────────────────────────────────────────
// Bilateral Analysis (#12-16)
// ─────────────────────────────────────────────────────────────────

export interface AsymmetryIndices {
  overallMaxROM: number;
  averageROM: number;
  peakAngularVelocity: number;
  rmsJerk: number;
  explosivenessLoading: number;
  explosivenessConcentric: number;
}

export interface TemporalAsymmetry {
  phaseShift: number;
  crossCorrelation: number;
  temporalLag: number;
}

export interface BilateralAnalysis {
  asymmetryIndices: AsymmetryIndices;
  netGlobalAsymmetry: number;
  temporalAsymmetry: TemporalAsymmetry;
}

// ─────────────────────────────────────────────────────────────────
// Unilateral Analysis (#17-19)
// ─────────────────────────────────────────────────────────────────

export interface UnilateralMetrics {
  flexorExtensorRatio: number;
  eccentricConcentricRatio: number;
}

export interface UnilateralAnalysis {
  left: UnilateralMetrics;
  right: UnilateralMetrics;
  bilateralRatioDiff: number;
}

// ─────────────────────────────────────────────────────────────────
// Ground Contact & Jump (#20-23)
// ─────────────────────────────────────────────────────────────────

export interface JumpMetrics {
  groundContactTimeMs: number;
  flightTimeMs: number;
  jumpHeightCm: number;
  rsi: number;
}

// ─────────────────────────────────────────────────────────────────
// Force/Power (#24-26)
// ─────────────────────────────────────────────────────────────────

export interface ForcePowerMetrics {
  eRFD: number;
  peakNormalizedForce: number;
  impulseEstimate: number;
}

// ─────────────────────────────────────────────────────────────────
// Stiffness (#27-28)
// ─────────────────────────────────────────────────────────────────

export interface StiffnessMetrics {
  legStiffness: number;
  verticalStiffness: number;
}

// ─────────────────────────────────────────────────────────────────
// Smoothness (#29-31)
// ─────────────────────────────────────────────────────────────────

export interface SmoothnessMetrics {
  sparc: number;
  ldlj: number;
  nVelocityPeaks: number;
}

// ─────────────────────────────────────────────────────────────────
// Temporal Coordination (#32-34)
// ─────────────────────────────────────────────────────────────────

export type ShockAbsorptionQuality = "excellent" | "good" | "poor" | "absent";

export interface ShockAbsorptionResult {
  score: number;
  doubleDipDetected: boolean;
  patternQuality: ShockAbsorptionQuality;
}

export interface TemporalCoordination {
  maxFlexionTimingDiff: number;
  zeroVelocityPhaseMs: number;
  shockAbsorption: ShockAbsorptionResult;
}

// ─────────────────────────────────────────────────────────────────
// Gait Cycle (#35-37)
// ─────────────────────────────────────────────────────────────────

export interface GaitCycleMetrics {
  stancePhasePct: number;
  swingPhasePct: number;
  dutyFactor: number;
  strideTimeMs: number;
}

// ─────────────────────────────────────────────────────────────────
// Movement Classification (#38-39)
// ─────────────────────────────────────────────────────────────────

export type MovementType =
  | "bilateral"
  | "unilateral"
  | "single_leg"
  | "mixed"
  | "unknown";

export interface MovementClassification {
  type: MovementType;
  confidence: number;
  correlationAtZero: number;
  optimalLag: number;
  optimalCorrelation: number;
  estimatedCycleSamples: number;
  phaseOffsetDegrees: number;
}

export interface TransitionEvent {
  index: number;
  timeMs: number;
  fromPhase: number;
  toPhase: number;
  fromType: MovementType;
  toType: MovementType;
}

export interface RollingPhaseResult {
  phaseOffsetSeries: number[];
  correlationSeries: number[];
  windowCenters: number[];
  transitions: TransitionEvent[];
  dominantPhaseOffset: number;
}

// ─────────────────────────────────────────────────────────────────
// Advanced Asymmetry (#40-41)
// ─────────────────────────────────────────────────────────────────

/** Full phase correction result (for computation). */
export interface PhaseCorrectedSignals {
  left: number[];
  right: number[];
  appliedShiftSamples: number;
  appliedShiftMs: number;
  movementType: MovementType;
  requiresCorrection: boolean;
}

/** Schema-compatible phase correction (without large arrays). */
export interface PhaseCorrectionSummary {
  appliedShiftSamples: number;
  appliedShiftMs: number;
  movementType: MovementType;
  requiresCorrection: boolean;
}

export type AsymmetryDirection = "left_dominant" | "right_dominant";

export interface AsymmetryEvent {
  startIndex: number;
  endIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  peakAsymmetry: number;
  avgAsymmetry: number;
  direction: AsymmetryDirection;
  area: number;
}

/** Schema-compatible advanced asymmetry result (without large arrays). */
export interface AdvancedAsymmetryResult {
  phaseCorrection: PhaseCorrectionSummary;
  asymmetryEvents: AsymmetryEvent[];
  avgBaselineOffset: number;
  avgRealAsymmetry: number;
  maxRealAsymmetry: number;
  totalAsymmetryDurationMs: number;
  asymmetryPercentage: number;
  baselineStability: number;
  signalToNoiseRatio: number;
}

/** Full computation result with arrays (not stored in schema). */
export interface AdvancedAsymmetryComputed extends AdvancedAsymmetryResult {
  baselineOffset: number[];
  realAsymmetry: number[];
  correctedLeft: number[];
  correctedRight: number[];
}

export interface RollingAsymmetryWindow {
  windowCenter: number;
  windowCenterMs: number;
  movementType: MovementType;
  phaseOffsetApplied: number;
  avgAsymmetry: number;
  maxAsymmetry: number;
  baselineOffset: number;
}

export interface RollingAsymmetrySummary {
  avgAsymmetry: number;
  maxAsymmetry: number;
  timeInBilateral: number;
  timeInUnilateral: number;
  transitionCount: number;
}

/** Schema-compatible rolling asymmetry result (without large time series). */
export interface RollingAsymmetryResult {
  windows: RollingAsymmetryWindow[];
  overallSummary: RollingAsymmetrySummary;
}

/** Schema-compatible phase alignment result (without large arrays). */
export interface PhaseAlignmentResult {
  optimalOffsetSamples: number;
  optimalOffsetMs: number;
  optimalOffsetDegrees: number;
  alignedCorrelation: number;
  unalignedCorrelation: number;
  correlationImprovement: number;
}

/** Full computation result with aligned array. */
export interface PhaseAlignmentComputed extends PhaseAlignmentResult {
  alignedRight: number[];
}

// ─────────────────────────────────────────────────────────────────
// Full Analysis Result
// ─────────────────────────────────────────────────────────────────

export interface FullAnalysisResult {
  // Per-leg metrics
  leftLeg: PerLegMetrics;
  rightLeg: PerLegMetrics;

  // Bilateral analysis
  bilateralAnalysis: BilateralAnalysis;
  unilateralAnalysis: UnilateralAnalysis;

  // Activity-specific (angular acceleration derived - review needed)
  jumpMetrics: JumpMetrics;
  forcePowerMetrics: ForcePowerMetrics;
  stiffnessMetrics: StiffnessMetrics;
  gaitCycleMetrics: GaitCycleMetrics;

  // Smoothness & temporal
  smoothnessMetrics: SmoothnessMetrics;
  temporalCoordination: TemporalCoordination;

  // Movement classification
  movementClassification: MovementClassification;
  rollingPhase: RollingPhaseResult;

  // Advanced asymmetry
  advancedAsymmetry: AdvancedAsymmetryResult;
  rollingAsymmetry: RollingAsymmetryResult;
  phaseAlignment: PhaseAlignmentResult;

  // Overall Performance Index
  opiResult: OPIResult;
}

// ─────────────────────────────────────────────────────────────────
// Computation Context
// ─────────────────────────────────────────────────────────────────

export interface ComputationContext {
  sessionId: string;
  sampleRate: number;
  timeStep: number;
  leftAngles: number[];
  rightAngles: number[];
  leftInterpolatedIndices: Set<number>;
  rightInterpolatedIndices: Set<number>;
  leftMissingIndices: Set<number>;
  rightMissingIndices: Set<number>;
}

export interface ComputationResult {
  success: boolean;
  metrics: FullAnalysisResult | null;
  error: string | null;
  computedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Schema Types (for Convex validators)
// ─────────────────────────────────────────────────────────────────

export type MetricStatus = "pending" | "computing" | "complete" | "failed";

// ─────────────────────────────────────────────────────────────────
// OPI Types (Overall Performance Index)
// ─────────────────────────────────────────────────────────────────

export type ActivityProfile = "power" | "endurance" | "rehabilitation" | "general";

export type OPIDomain = "symmetry" | "power" | "control" | "stability";

export type MetricDirection = "higher_better" | "lower_better" | "optimal_range";

export type OPIGrade = "A" | "B" | "C" | "D" | "F";

export interface MetricConfig {
  name: string;
  domain: OPIDomain;
  direction: MetricDirection;
  goodThreshold: number;
  poorThreshold: number;
  optimalMin?: number;
  optimalMax?: number;
  weight: number;
  icc: number;
  citation: string;
  bilateral: boolean;
  unilateral: boolean;
}

export interface DomainScoreContributor {
  name: string;
  raw: number;
  normalized: number;
  weight: number;
  citation: string;
}

export interface DomainScore {
  domain: OPIDomain;
  score: number;
  confidence: number;
  sem: number;
  contributors: DomainScoreContributor[];
}

export interface OPIConfidenceInterval {
  lower: number;
  upper: number;
}

export interface OPIResult {
  overallScore: number;
  grade: OPIGrade;
  confidenceInterval: OPIConfidenceInterval;
  sem: number;
  mdc95: number;
  domainScores: DomainScore[];
  strengths: string[];
  weaknesses: string[];
  clinicalFlags: string[];
  movementType: "bilateral" | "unilateral";
  activityProfile: ActivityProfile;
  dataCompleteness: number;
  methodologyCitations: string[];
}
