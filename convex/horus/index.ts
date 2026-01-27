/**
 * Horus - AI Analysis System
 *
 * Central export for the Horus AI analysis pipeline.
 * Named after the Egyptian god of the sky and kingship, known for his all-seeing eye.
 *
 * v2 Pipeline: Analysis Agent → Parallel Research Agents
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
// Visualization (Block System)
// ─────────────────────────────────────────────────────────────────

export type {
  // Core types
  MetricExpression,
  FormulaExpression,
  RechartsType,
  LucideIconName,

  // Block types
  VisualizationBlock,
  BlockType,
  ExecutiveSummaryBlock,
  StatCardBlock,
  AlertCardBlock,
  NextStepsBlock,
  ComparisonCardBlock,
  ProgressCardBlock,
  MetricGridBlock,
  QuoteCardBlock,
  ChartBlockBlock,

  // Chart types
  ChartDataSpec,
  ChartConfig as VisChartConfig,

  // Evaluated types
  EvaluatedValue,
  EvaluatedBlock,

  // Analysis extension
  AnalysisVisualization,
} from "./visualization";

export {
  // Catalog functions
  RECHARTS_CATALOG,
  getVisualizationCatalogForPrompt,
  getMetricPaths,

  // Evaluator functions
  isValidMetricPath,
  resolveMetricValue,
  evaluateMetric,
  evaluateFormula,
  formatValue,
  validateFormula,
} from "./visualization";

export type { EvaluationContext } from "./visualization";

// ─────────────────────────────────────────────────────────────────
// Usage Information
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// v2 Pipeline (New Two-Stage Architecture)
// ─────────────────────────────────────────────────────────────────

export type {
  // Core section types
  Section,
  EnrichedSection,
  QAReasoning,
  MetricContribution,

  // Research types
  Citation,
  QualityLink,
  UserExplanation,
  EvidenceStrength,
  EvidenceTier,
  CacheEntry,

  // Agent outputs
  AnalysisAgentOutput,
  ResearchAgentOutput,

  // Pipeline types
  V2PipelineOutput,
  V2PipelineState,
  V2PipelineStatus,
  V2AgentName,

  // Cross-Analysis types
  CrossAnalysisResult,
  CrossAnalysisOutput,
  MinimalCrossAnalysisOutput,
  TrendInsight,
  RecurringPattern,
  BaselineComparison,
  NotableSession,
} from "./v2";

export { hasFullCrossAnalysis } from "./v2";

export {
  // JSON utilities
  safeJSONParse,
  extractJSON,

  // Search utilities
  getTierForUrl,
  filterHighQualityResults,
  getDiverseResults,
} from "./v2";

// ─────────────────────────────────────────────────────────────────
// Usage Information
// ─────────────────────────────────────────────────────────────────

/**
 * Horus API Usage Examples:
 *
 * === Analysis Pipeline ===
 *
 * 1. Trigger analysis for a session:
 *    const result = await ctx.runAction(api.horus.v2.actions.analyzeSession, { sessionId });
 *
 * 2. Get analysis results:
 *    const analysis = await ctx.runQuery(api.horus.v2.queries.getAnalysisV2, { sessionId });
 *
 * 3. Get enriched sections only:
 *    const sections = await ctx.runQuery(api.horus.v2.queries.getEnrichedSections, { sessionId });
 *
 * 4. Retry failed analysis:
 *    await ctx.runAction(api.horus.actions.retryAnalysis, { sessionId });
 *
 * 5. Get progress report:
 *    const progress = await ctx.runQuery(api.horus.queries.getProgressReport, { patientId });
 *
 * 6. Check system health:
 *    const health = await ctx.runAction(api.horus.actions.getSystemHealth, {});
 *
 * Environment Variables Required:
 * - VERTEX_AI_PROJECT_ID: Google Cloud project ID
 * - VERTEX_AI_LOCATION: GCP region (default: us-central1)
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON: Service account JSON (or run on GCP)
 *
 * Note: Uses Gemini's built-in Google Search grounding - no external search API needed.
 */
