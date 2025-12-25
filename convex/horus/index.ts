/**
 * Horus - Multi-Agent Analysis System
 *
 * Central export for the Horus AI analysis pipeline.
 * Named after the Egyptian god of the sky and kingship, known for his all-seeing eye.
 *
 * Pipeline: Decomposition → Research → Analysis → Validator → Progress
 *
 * @module convex/horus
 */

// ─────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────

export type {
  // Common
  AgentName,
  PipelineStatus,
  TokenUsage,
  AgentExecutionResult,

  // Metrics
  SessionMetrics,
  PerLegMetricValues,
  BilateralMetricValues,

  // Decomposition
  DetectedPattern,
  PatternType,
  PatternSeverity,
  DecompositionInput,
  DecompositionOutput,

  // Research
  ResearchEvidence,
  ResearchInput,
  ResearchOutput,

  // Analysis
  Insight,
  CorrelativeInsight,
  NormativeBenchmark,
  ChartConfig,
  ChartType,
  AnalysisInput,
  AnalysisOutput,

  // Validator
  ValidationIssue,
  ValidationRuleType,
  ValidatorInput,
  ValidatorOutput,

  // Progress
  MetricTrend,
  Milestone,
  Regression,
  Projection,
  TrendDirection,
  ProgressInput,
  ProgressOutput,

  // Pipeline
  PipelineState,

  // Database
  HorusAnalysisDoc,
  HorusResearchCacheDoc,
  HorusProgressDoc,
  HorusPipelineStatusDoc,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Metrics
// ─────────────────────────────────────────────────────────────────

export {
  // Types
  type MetricConfig,
  type MetricDomain,
  type MetricDirection,
  type MetricScope,
  type SpecificLimb,
  type QualityTier,
  type BenchmarkCategory,
  type Classification,

  // Registry
  METRIC_REGISTRY,
  ALL_METRICS,
  PER_LEG_METRICS,
  BILATERAL_METRICS,
  METRICS_BY_DOMAIN,
  OPI_ACTIVE_METRICS,

  // Tier utilities
  QUALITY_TIER_VALUES,
  compareTiers,
  tierAtLeast,

  // Benchmark utilities
  getBenchmarkCategory,
  calculatePercentile,
  forceClassification,

  // Asymmetry utilities
  calculateAsymmetry,
  type AsymmetryResult,

  // UI constants
  DOMAIN_COLORS,
  LIMB_COLORS,

  // Clinical thresholds
  CLINICAL_THRESHOLDS,
  MCID,
} from "./metrics";

// ─────────────────────────────────────────────────────────────────
// Usage Information
// ─────────────────────────────────────────────────────────────────

/**
 * Horus API Usage Examples:
 *
 * 1. Trigger analysis for a session:
 *    await ctx.runAction(api.horus.actions.analyzeSession, { sessionId });
 *
 * 2. Get analysis results:
 *    const analysis = await ctx.runQuery(api.horus.queries.getAnalysis, { sessionId });
 *
 * 3. Get progress report:
 *    const progress = await ctx.runQuery(api.horus.queries.getProgressReport, { patientId });
 *
 * 4. Retry failed analysis:
 *    await ctx.runAction(api.horus.actions.retryAnalysis, { sessionId });
 *
 * 5. Check system health:
 *    const health = await ctx.runAction(api.horus.actions.getSystemHealth, {});
 *
 * Environment Variables Required:
 * - VERTEX_AI_PROJECT_ID: Google Cloud project ID
 * - VERTEX_AI_LOCATION: GCP region (default: us-central1)
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON: Service account JSON (or run on GCP)
 */
