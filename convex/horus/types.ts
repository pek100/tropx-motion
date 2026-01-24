/**
 * Horus Type Definitions
 *
 * TypeScript interfaces for all agent inputs/outputs.
 * Follows the Horus architecture: Decomp → Research → Analysis → Validator → Progress
 */

import type { Id } from "../_generated/dataModel";
import type {
  MetricDomain,
  MetricDirection,
  QualityTier,
  SpecificLimb,
  Classification,
  BenchmarkCategory,
} from "./metrics";
import type { AnalysisVisualization } from "./visualization/types";

// ─────────────────────────────────────────────────────────────────
// Common Types
// ─────────────────────────────────────────────────────────────────

export type AgentName =
  | "decomposition"
  | "research"
  | "analysis"
  | "validator"
  | "progress";

export type PipelineStatus =
  | "pending"
  | "decomposition"
  | "research"
  | "analysis"
  | "validation"
  | "progress"
  | "complete"
  | "error";

// ─────────────────────────────────────────────────────────────────
// Metric Values (Input to Decomposition)
// ─────────────────────────────────────────────────────────────────

export interface PerLegMetricValues {
  overallMaxRom: number;
  averageRom: number;
  peakFlexion: number;
  peakExtension: number;
  peakAngularVelocity: number;
  explosivenessConcentric: number;
  explosivenessLoading: number;
  rmsJerk: number;
  romCoV: number;
}

export interface BilateralMetricValues {
  romAsymmetry: number;
  velocityAsymmetry: number;
  crossCorrelation: number;
  realAsymmetryAvg: number;
  netGlobalAsymmetry: number;
  phaseShift: number;
  temporalLag: number;
  maxFlexionTimingDiff: number;
}

export interface SessionMetrics {
  sessionId: string;
  leftLeg: PerLegMetricValues;
  rightLeg: PerLegMetricValues;
  bilateral: BilateralMetricValues;
  opiScore?: number;
  opiGrade?: string;
  movementType: "bilateral" | "unilateral";
  recordedAt: number;

  // Session context (optional - included only if data exists)
  title?: string;
  notes?: string;
  tags?: string[];
  activityProfile?: "power" | "endurance" | "rehabilitation" | "general";
  sets?: number;
  reps?: number;
}

// ─────────────────────────────────────────────────────────────────
// Decomposition Agent Types
// ─────────────────────────────────────────────────────────────────

export type PatternType =
  | "threshold_violation"
  | "asymmetry"
  | "cross_metric_correlation"
  | "temporal_pattern"
  | "quality_flag";

export type PatternSeverity = "high" | "moderate" | "low";

export interface DetectedPattern {
  /** Unique ID for this pattern */
  id: string;
  /** Type of pattern detected */
  type: PatternType;
  /** Which metric(s) are involved */
  metrics: string[];
  /** Severity level */
  severity: PatternSeverity;
  /** Factual description (no interpretation) */
  description: string;
  /** Raw values that triggered detection */
  values: Record<string, number>;
  /** Which limb(s) if applicable */
  limbs?: SpecificLimb[];
  /** Search terms for research agent */
  searchTerms: string[];
  /** Benchmark category based on thresholds */
  benchmarkCategory?: BenchmarkCategory;
}

export interface DecompositionInput {
  sessionId: string;
  metrics: SessionMetrics;
  /** Previous session for comparison (if available) */
  previousMetrics?: SessionMetrics;
}

export interface DecompositionOutput {
  sessionId: string;
  patterns: DetectedPattern[];
  /** Total number of patterns by type */
  patternCounts: Record<PatternType, number>;
  /** Timestamp of analysis */
  analyzedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Research Agent Types
// ─────────────────────────────────────────────────────────────────

export interface ResearchEvidence {
  /** Unique ID */
  id: string;
  /** Pattern ID this evidence relates to */
  patternId: string;
  /** Quality tier (S is best, D is worst) */
  tier: QualityTier;
  /** Source type */
  sourceType: "cache" | "web_search" | "embedded_knowledge";
  /** Citation text */
  citation: string;
  /** URL if available */
  url?: string;
  /** Key findings relevant to the pattern */
  findings: string[];
  /** Clinical relevance score 0-100 */
  relevanceScore: number;
  /** Embedding vector for caching */
  embedding?: number[];
}

export interface ResearchInput {
  sessionId: string;
  patterns: DetectedPattern[];
}

export interface ResearchOutput {
  sessionId: string;
  /** Evidence grouped by pattern ID */
  evidenceByPattern: Record<string, ResearchEvidence[]>;
  /** Patterns without sufficient evidence (tier D or below) */
  insufficientEvidence: string[];
  /** New cache entries to save */
  newCacheEntries: ResearchEvidence[];
  /** Timestamp of research */
  researchedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Analysis Agent Types
// ─────────────────────────────────────────────────────────────────

export type ChartType =
  | "radar"
  | "bar"
  | "line"
  | "asymmetry_bar"
  | "comparison";

export interface ChartDataPoint {
  label: string;
  value: number;
  /** For comparison charts */
  previousValue?: number;
  /** For radar charts: normalized 0-100 */
  normalizedValue?: number;
  /** Domain for coloring */
  domain?: MetricDomain;
}

export interface ChartConfig {
  type: ChartType;
  title: string;
  data: ChartDataPoint[];
  /** Reference lines or thresholds */
  references?: { label: string; value: number }[];
}

export interface Insight {
  /** Unique ID */
  id: string;
  /** Domain this insight belongs to */
  domain: MetricDomain;
  /** Force classification: only strength or weakness */
  classification: Classification;
  /** Title for display */
  title: string;
  /** Main insight text */
  content: string;
  /** Which limb(s) if applicable - MUST use "Left Leg" or "Right Leg" */
  limbs?: SpecificLimb[];
  /** Supporting evidence */
  evidence: string[];
  /** Related pattern IDs */
  patternIds: string[];
  /** Chart to display with this insight */
  chart?: ChartConfig;
  /** Clinical recommendations (optional) */
  recommendations?: string[];
  /** Percentile within normative data */
  percentile?: number;
}

export interface CorrelativeInsight {
  /** Unique ID */
  id: string;
  /** Primary insight ID */
  primaryInsightId: string;
  /** Related insight IDs */
  relatedInsightIds: string[];
  /** Explanation of the correlation */
  explanation: string;
  /** Clinical significance */
  significance: "high" | "moderate" | "low";
}

export interface NormativeBenchmark {
  metricName: string;
  displayName: string;
  domain: MetricDomain;
  /** Actual value */
  value: number;
  /** Percentile in normative population */
  percentile: number;
  /** Classification */
  category: BenchmarkCategory;
  /** Classification (strength/weakness) */
  classification: Classification;
  /** Which limb if per-leg metric */
  limb?: SpecificLimb;
}

export interface AnalysisInput {
  sessionId: string;
  patterns: DetectedPattern[];
  evidenceByPattern: Record<string, ResearchEvidence[]>;
  metrics: SessionMetrics;
}

export interface AnalysisOutput {
  sessionId: string;
  /** Primary insights (one per domain typically) */
  insights: Insight[];
  /** Correlative insights (minimum 2 required) */
  correlativeInsights: CorrelativeInsight[];
  /** Normative benchmarks for radar chart */
  benchmarks: NormativeBenchmark[];
  /** Overall summary */
  summary: string;
  /** Top 3 strengths */
  strengths: string[];
  /** Top 3 weaknesses */
  weaknesses: string[];
  /** Timestamp of analysis */
  analyzedAt: number;
  /** Visualization blocks for UI display */
  visualization?: AnalysisVisualization;
}

// ─────────────────────────────────────────────────────────────────
// Validator Agent Types
// ─────────────────────────────────────────────────────────────────

export type ValidationRuleType =
  | "metric_accuracy"
  | "hallucination"
  | "clinical_safety"
  | "internal_consistency";

export interface ValidationIssue {
  /** Rule that was violated */
  ruleType: ValidationRuleType;
  /** Severity */
  severity: "error" | "warning";
  /** Which insight(s) affected */
  insightIds: string[];
  /** Description of the issue */
  description: string;
  /** Suggested fix */
  suggestedFix: string;
}

export interface ValidatorInput {
  sessionId: string;
  analysis: AnalysisOutput;
  metrics: SessionMetrics;
  patterns: DetectedPattern[];
}

export interface ValidatorOutput {
  sessionId: string;
  /** Did validation pass? */
  passed: boolean;
  /** List of issues found */
  issues: ValidationIssue[];
  /** Number of errors (blocks save) */
  errorCount: number;
  /** Number of warnings (doesn't block) */
  warningCount: number;
  /** Revision number (max 3) */
  revisionNumber: number;
  /** Validated analysis (if passed) */
  validatedAnalysis?: AnalysisOutput;
  /** Timestamp of validation */
  validatedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Progress Agent Types
// ─────────────────────────────────────────────────────────────────

export type TrendDirection = "improving" | "stable" | "declining";

export interface MetricTrend {
  metricName: string;
  displayName: string;
  domain: MetricDomain;
  /** Direction of metric */
  direction: MetricDirection;
  /** Trend direction over time */
  trend: TrendDirection;
  /** Current value */
  currentValue: number;
  /** Previous value */
  previousValue: number;
  /** Baseline value (first session) */
  baselineValue: number;
  /** Percentage change from previous */
  changeFromPrevious: number;
  /** Percentage change from baseline */
  changeFromBaseline: number;
  /** Is change clinically meaningful (exceeds MCID)? */
  isClinicallyMeaningful: boolean;
  /** Which limb if per-leg */
  limb?: SpecificLimb;
  /** Historical values for chart */
  history: { date: number; value: number }[];
}

export interface Milestone {
  /** Unique ID */
  id: string;
  /** Type of milestone */
  type:
    | "threshold_achieved"
    | "mcid_improvement"
    | "streak"
    | "personal_best"
    | "asymmetry_resolved"
    // New milestone types for enhanced correlation tracking
    | "symmetry_restored"     // Asymmetry dropped below 5%
    | "limb_caught_up"        // Deficit limb matched the other
    | "cross_metric_gain";    // Multiple metrics improved together
  /** Title */
  title: string;
  /** Description */
  description: string;
  /** When achieved */
  achievedAt: number;
  /** Related metric(s) */
  metrics: string[];
  /** Celebration level */
  celebrationLevel: "major" | "minor";
  /** Which limb if applicable */
  limb?: SpecificLimb;
}

export interface Regression {
  /** Unique ID */
  id: string;
  /** Metric that regressed */
  metricName: string;
  /** How much it declined */
  declinePercentage: number;
  /** Is it clinically significant? */
  isClinicallySignificant: boolean;
  /** Possible reasons */
  possibleReasons: string[];
  /** Recommendations */
  recommendations: string[];
  /** Which limb if applicable */
  limb?: SpecificLimb;
}

export interface Projection {
  metricName: string;
  /** Projected value at target date */
  projectedValue: number;
  /** Target date timestamp */
  targetDate: number;
  /** Confidence in projection 0-100 */
  confidence: number;
  /** Assumptions made */
  assumptions: string[];
}

/**
 * Cross-metric correlation detected across sessions.
 * Identifies when multiple metrics are improving or declining together.
 */
export interface ProgressCorrelation {
  /** Unique ID */
  id: string;
  /** Type of correlation pattern */
  type: "co_improving" | "co_declining" | "inverse" | "compensatory";
  /** Metric names involved in the correlation */
  metrics: string[];
  /** Explanation of the relationship */
  explanation: string;
  /** Clinical significance level */
  significance: "high" | "moderate" | "low";
  /** Limb if consistent across correlation */
  limb?: SpecificLimb;
}

/**
 * Tracks asymmetry changes over time.
 * Identifies if bilateral imbalances are resolving or worsening.
 */
export interface AsymmetryTrend {
  /** Which metric's asymmetry is being tracked */
  metricName: string;
  /** Display name for UI */
  displayName: string;
  /** Current asymmetry percentage */
  currentAsymmetry: number;
  /** Previous session asymmetry */
  previousAsymmetry: number;
  /** Baseline asymmetry (first session) */
  baselineAsymmetry: number;
  /** Change in asymmetry from previous session */
  changeFromPrevious: number;
  /** Change in asymmetry from baseline */
  changeFromBaseline: number;
  /** Is asymmetry resolving (decreasing)? */
  isResolving: boolean;
  /** Which limb has the deficit (if any) */
  deficitLimb?: SpecificLimb;
  /** Is the deficit limb catching up? */
  isDeficitCatchingUp?: boolean;
}

export interface ProgressInput {
  sessionId: string;
  currentMetrics: SessionMetrics;
  /** Historical sessions (sorted oldest to newest) */
  historicalSessions: SessionMetrics[];
  /** Patient ID for context */
  patientId: Id<"users">;
}

export interface ProgressOutput {
  sessionId: string;
  patientId: Id<"users">;
  /** Trends for each tracked metric */
  trends: MetricTrend[];
  /** New milestones achieved */
  milestones: Milestone[];
  /** Any regressions detected */
  regressions: Regression[];
  /** Projections (if enough data) */
  projections: Projection[];
  /** Cross-metric correlations detected (e.g., velocity improved alongside ROM) */
  correlations?: ProgressCorrelation[];
  /** Asymmetry trends over time (e.g., left leg ROM gap closing) */
  asymmetryTrends?: AsymmetryTrend[];
  /** Overall progress summary */
  summary: string;
  /** Sessions analyzed count */
  sessionsAnalyzed: number;
  /** Date range covered */
  dateRange: { start: number; end: number };
  /** Timestamp of progress analysis */
  analyzedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Pipeline Types
// ─────────────────────────────────────────────────────────────────

export interface PipelineState {
  sessionId: string;
  status: PipelineStatus;
  currentAgent?: AgentName;
  /** Decomposition output (if complete) */
  decomposition?: DecompositionOutput;
  /** Research output (if complete) */
  research?: ResearchOutput;
  /** Analysis output (if complete) */
  analysis?: AnalysisOutput;
  /** Validator output (if complete) */
  validation?: ValidatorOutput;
  /** Error info if failed */
  error?: {
    agent: AgentName;
    message: string;
    retryable: boolean;
  };
  /** Revision count for validation loop */
  revisionCount: number;
  /** Timestamps */
  startedAt: number;
  completedAt?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface AgentExecutionResult<T> {
  success: boolean;
  output?: T;
  error?: string;
  tokenUsage: TokenUsage;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────
// Database Document Types (for Convex)
// ─────────────────────────────────────────────────────────────────

export interface HorusAnalysisDoc {
  sessionId: string;
  patientId?: Id<"users">;
  status: PipelineStatus;
  /** Stored outputs */
  decomposition?: DecompositionOutput;
  research?: ResearchOutput;
  analysis?: AnalysisOutput;
  validation?: ValidatorOutput;
  /** Token usage per agent */
  tokenUsage: Partial<Record<AgentName, TokenUsage>>;
  /** Total cost */
  totalCost: number;
  /** Timestamps */
  startedAt: number;
  completedAt?: number;
  /** Error info */
  error?: {
    agent: AgentName;
    message: string;
  };
}

export interface HorusResearchCacheDoc {
  /** Embedding vector for semantic search */
  embedding: number[];
  /** Search terms that led to this result */
  searchTerms: string[];
  /** Quality tier */
  tier: QualityTier;
  /** Citation text */
  citation: string;
  /** URL */
  url?: string;
  /** Key findings */
  findings: string[];
  /** Relevance score */
  relevanceScore: number;
  /** When cached */
  cachedAt: number;
  /** Hit count */
  hitCount: number;
}

export interface HorusProgressDoc {
  patientId: Id<"users">;
  /** Most recent progress analysis */
  latestProgress: ProgressOutput;
  /** Session IDs included */
  sessionIds: string[];
  /** When last updated */
  updatedAt: number;
}

export interface HorusPipelineStatusDoc {
  sessionId: string;
  status: PipelineStatus;
  currentAgent?: AgentName;
  revisionCount: number;
  startedAt: number;
  updatedAt: number;
  error?: {
    agent: AgentName;
    message: string;
    retryable: boolean;
  };
}
