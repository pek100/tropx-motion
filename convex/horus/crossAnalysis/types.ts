/**
 * Cross-Analysis Agent Type Definitions
 *
 * Types for the Cross-Analysis system that analyzes patterns across
 * a patient's historical sessions using vector search.
 */

import type { Id } from "../../_generated/dataModel";
import type { SessionMetrics } from "../types";

// ─────────────────────────────────────────────────────────────────
// Trend & Pattern Types
// ─────────────────────────────────────────────────────────────────

export type TrendDirection = "improving" | "stable" | "declining";
export type PatternType =
  | "consistent_weakness"
  | "improving_metric"
  | "declining_metric"
  | "plateau"
  | "asymmetry_persistent"
  | "asymmetry_resolving";
export type ConfidenceLevel = "high" | "moderate" | "low";
export type TrendMagnitude = "significant" | "moderate" | "slight";

// ─────────────────────────────────────────────────────────────────
// Input Types
// ─────────────────────────────────────────────────────────────────

export interface CrossAnalysisInput {
  sessionId: string;
  patientId: Id<"users">;
  currentMetrics: SessionMetrics;
}

// ─────────────────────────────────────────────────────────────────
// Context Types (Pre-computed for LLM)
// ─────────────────────────────────────────────────────────────────

/** Metric with deviation from baseline */
export interface NotableMetric {
  name: string;
  displayName: string;
  value: number;
  unit: string;
  deviationFromBaseline: number; // Percentage deviation
  deviationDirection: "above" | "below";
}

/** Current session summary for context */
export interface CurrentSessionContext {
  sessionId: string;
  date: number;
  tags: string[];
  opiScore: number;
  opiGrade?: string;
  metrics: Record<string, { value: number; displayName: string; unit: string }>;
}

/** Patient baseline for comparison */
export interface BaselineContext {
  tagGroup: string;
  sessionCount: number;
  metrics: Record<
    string,
    {
      median: number;
      std: number;
      trend: TrendDirection;
    }
  >;
}

/** Historical session summary (not raw values) */
export interface HistoricalSessionSummary {
  sessionId: string;
  date: number;
  tags: string[];
  opiScore: number;
  notableMetrics: NotableMetric[];
}

/** Pre-computed trend for context */
export interface TrendContext {
  metricName: string;
  displayName: string;
  direction: TrendDirection;
  slopePerSession: number;
  isClinicallyMeaningful: boolean;
}

/** Similar session from vector search */
export interface SimilarSession {
  sessionId: string;
  date: number;
  similarity: number; // 0-1
  tags: string[];
}

/** Speculative insight from the Analysis Agent to be evaluated */
export interface SpeculativeInsightInput {
  label: string;
  description: string;
}

/**
 * Full context passed to Cross-Analysis Agent.
 * Pre-computed to stay within token limits (~3K tokens).
 */
export interface CrossAnalysisContext {
  /** Current session being analyzed */
  currentSession: CurrentSessionContext;

  /** Patient baseline (median values for comparison) */
  baseline: BaselineContext;

  /** Recent history (summarized, not raw values) */
  recentHistory: HistoricalSessionSummary[];

  /** Pre-computed trends (last 5 sessions) */
  trends: TrendContext[];

  /** Similar sessions by vector distance */
  similarSessions: SimilarSession[];

  /** Speculative insights from Analysis Agent to evaluate against history */
  speculativeInsights?: SpeculativeInsightInput[];
}

// ─────────────────────────────────────────────────────────────────
// Output Types
// ─────────────────────────────────────────────────────────────────

/**
 * A trend insight identified by the Cross-Analysis Agent.
 */
export interface TrendInsight {
  id: string;
  metricName: string;
  displayName: string;
  direction: TrendDirection;
  magnitude: TrendMagnitude;
  narrative: string;
  currentValue: number;
  baselineValue: number;
  changePercent: number;
  clinicalRelevance: string;
}

/**
 * A recurring pattern detected across multiple sessions.
 */
export interface RecurringPattern {
  id: string;
  patternType: PatternType;
  title: string;
  description: string;
  affectedMetrics: string[];
  sessionIds: string[];
  confidence: number; // 0-1
  recommendation: string;
}

/**
 * Comparison of current session to patient's baseline.
 */
export interface BaselineComparison {
  overallAssessment: string;
  comparedToBaseline: "above" | "at" | "below";
  significantDeviations: Array<{
    metricName: string;
    displayName: string;
    currentValue: number;
    baselineMedian: number;
    deviationPercent: number;
    direction: "above" | "below";
  }>;
}

/**
 * Notable session from history (similar, best, worst).
 */
export interface NotableSession {
  sessionId: string;
  date: number;
  tags: string[];
  opiScore: number;
  relation: "most_similar" | "best_performance" | "worst_performance";
  relevance: string;
}

/** Icon hint categories for refined insights */
export type InsightIconHint =
  | "leg"
  | "balance"
  | "speed"
  | "range"
  | "trend"
  | "warning"
  | "strength"
  | "timing"
  | "recovery";

/**
 * Refined speculative insight after cross-analysis evaluation.
 * Uses natural physiotherapy language, not technical parameter names.
 */
export interface RefinedInsight {
  /** Clear, descriptive title using physiotherapy terminology */
  title: string;
  /** 1-2 sentence key finding visible at a glance */
  summary: string;
  /** 2-4 sentences of additional context and historical evidence */
  details: string;
  /** Icon category that best represents this insight */
  iconHint: InsightIconHint;
}

/**
 * Full output from the Cross-Analysis Agent.
 */
export interface CrossAnalysisOutput {
  sessionId: string;
  patientId: Id<"users">;

  /** 2-5 meaningful trend insights */
  trendInsights: TrendInsight[];

  /** 0-3 recurring patterns across sessions */
  recurringPatterns: RecurringPattern[];

  /** Comparison to patient's personal baseline */
  baselineComparison: BaselineComparison;

  /** Notable sessions from history */
  notableSessions: NotableSession[];

  /** Refined speculative insights (evaluated against history) */
  refinedInsights: RefinedInsight[];

  /** 2-3 sentence summary of cross-analysis findings */
  summary: string;

  /** Confidence level based on data quality */
  analysisConfidence: ConfidenceLevel;

  /** Number of sessions analyzed */
  sessionsAnalyzed: number;

  /** Date range covered in days */
  dateRangeDays: number;

  /** When the analysis was performed */
  analyzedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Agent Result Type
// ─────────────────────────────────────────────────────────────────

export interface CrossAnalysisAgentResult {
  success: boolean;
  output?: CrossAnalysisOutput;
  error?: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: number;
  };
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────
// Minimal Output (Insufficient History)
// ─────────────────────────────────────────────────────────────────

/**
 * Minimal output when patient has insufficient history.
 */
export interface MinimalCrossAnalysisOutput {
  sessionId: string;
  patientId: Id<"users">;
  insufficientHistory: true;
  sessionsAvailable: number;
  sessionsRequired: number;
  message: string;
  analyzedAt: number;
}

export type CrossAnalysisResult = CrossAnalysisOutput | MinimalCrossAnalysisOutput;

/**
 * Type guard to check if cross-analysis has sufficient history.
 */
export function hasFullCrossAnalysis(
  result: CrossAnalysisResult
): result is CrossAnalysisOutput {
  return !("insufficientHistory" in result);
}

// ─────────────────────────────────────────────────────────────────
// Phase 6: Cluster Analysis Types
// ─────────────────────────────────────────────────────────────────

/** Data quality indicator based on session count */
export type DataQuality = "limited" | "moderate" | "good";

/** Overall pattern of cluster migration over time */
export type OverallPattern =
  | "consistent_improvement"
  | "improving"
  | "stable"
  | "declining"
  | "volatile"
  | "plateau";

/** Session with its 32-dim metrics vector */
export interface SessionVector {
  sessionId: string;
  recordedAt: number;
  vector: number[];
  tags: string[];
  notes?: string;
}

/**
 * Performance cluster - sessions grouped by 32-dim vector similarity.
 * Clusters emerge from density-based clustering (DBSCAN-like).
 */
export interface PerformanceCluster {
  clusterId: string;
  label: string; // "High Performance", "Average Performance", "Needs Improvement"

  /** Cluster centroid (average of member vectors) */
  centroid: number[]; // 32-dim

  /** Member sessions */
  sessionIds: string[];
  sessionCount: number;

  /** Quality score (average of normalized centroid dimensions) */
  qualityScore: number;

  /** Cluster tightness */
  intraClusterDistance?: number;
}

/**
 * Semantic context for a set of sessions.
 * Combines 768-dim embeddings, tags, notes, and AI findings.
 */
export interface SemanticContext {
  /** 768-dim centroid of analysis embeddings */
  semanticCentroid: number[];

  /** Tags with frequency (from recordingSessions.tags) */
  tags: Array<{ tag: string; frequency: number }>;

  /** Note excerpts (from recordingSessions.notes) */
  noteExcerpts: string[];

  /** Key findings from previous AI analyses */
  keyFindings: string[];

  /** Summary excerpts from previous analyses */
  summaryExcerpts: string[];
}

/**
 * Percentile band within a cluster.
 * Percentiles represent SIMILARITY to cluster centroid (typicality), not performance.
 * - p90 = most similar to centroid = typical/regular sessions
 * - p10 = least similar to centroid = outliers/unusual sessions
 */
export interface ClusterPercentileBand {
  percentile: "p10" | "p50" | "p90";
  similarityToCluster: "outlier" | "median" | "typical";

  /** Sessions in this band */
  sessionIds: string[];
  sessionCount: number;

  /** Median metric values for sessions in this band */
  medianMetrics: Record<
    string,
    { value: number; displayName: string; unit: string }
  >;

  /** Semantic context for sessions in this band */
  semantics: SemanticContext;
}

/**
 * Cluster with full semantic correlation.
 * Main output structure per performance cluster.
 */
export interface ClusterWithSemantics {
  clusterId: string;
  label: string;
  centroid: number[]; // 32-dim

  /** Percentile bands by similarity to centroid */
  bands: {
    p90: ClusterPercentileBand; // Most typical sessions
    p50: ClusterPercentileBand; // Median typicality
    p10: ClusterPercentileBand; // Outliers within this cluster
  };

  /** Semantic distance between typical (p90) and outlier (p10) sessions */
  typicalVsOutlierSemanticDistance: number;

  /** Features that distinguish typical from outlier sessions */
  distinguishingFeatures: Array<{
    feature: string;
    typicalFrequency: number;
    outlierFrequency: number;
  }>;
}

/**
 * Distribution of sessions across clusters for a time period.
 */
export interface ClusterDistribution {
  clusterId: string;
  sessionCount: number;
  percentage: number;
  sessionIds: string[];
}

/**
 * Cluster migration between time periods.
 */
export interface ClusterMigration {
  fromCluster: string;
  toCluster: string;
  sessionCount: number;
  direction: "improved" | "declined" | "lateral";
}

/**
 * Cluster membership for a specific time period (monthly bucket).
 */
export interface ClusterMembershipOverTime {
  period: string; // "2024-01", "2024-02", etc.
  startDate: number;
  endDate: number;

  /** Distribution across clusters */
  distribution: Record<string, ClusterDistribution>;

  /** Migration from previous period */
  migrations?: ClusterMigration[];
}

/**
 * Trend for a single cluster's membership over time.
 */
export interface ClusterMembershipTrend {
  clusterId: string;
  label: string;
  membershipTrend: TrendDirection;
  slopePerPeriod: number; // % change per month
  rSquared: number;
}

/**
 * Overall cluster trends - how membership changes over time.
 * Tracks whether patient is spending more time in "good" clusters.
 */
export interface ClusterTrends {
  /** Per-cluster membership trends */
  clusterTrends: Record<string, ClusterMembershipTrend>;

  /** Overall trajectory pattern */
  overallPattern: OverallPattern;

  /** Percentage of time in each performance tier */
  timeInHighPerformance: number;
  timeInMediumPerformance: number;
  timeInLowPerformance: number;
}

/**
 * Full cluster analysis context for the Cross-Analysis Agent.
 */
export interface ClusterAnalysisContext {
  /** All clusters with semantic correlation */
  clusters: ClusterWithSemantics[];

  /** Which cluster the current session falls into */
  currentSessionCluster?: {
    clusterId: string;
    label: string;
    similarity: number;
  };

  /** Cluster membership over time (monthly buckets) */
  membershipHistory: ClusterMembershipOverTime[];

  /** Cluster migration trends */
  trends: ClusterTrends;

  /** Data quality indicator */
  dataQuality: DataQuality;

  /** Total sessions analyzed */
  totalSessions: number;
}

/**
 * Extended CrossAnalysisContext with cluster analysis.
 */
export interface CrossAnalysisContextWithClusters extends CrossAnalysisContext {
  /** Cluster analysis (Phase 6) */
  clusterAnalysis?: ClusterAnalysisContext;
}
