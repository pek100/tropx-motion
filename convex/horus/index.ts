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
} from "./v2";

export {
  // Validation utilities
  validateSection,
  validateEnrichedSection,
  validateAnalysisOutput,
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
 * === v2 Pipeline (Recommended) ===
 *
 * 1. Trigger v2 analysis for a session:
 *    const result = await ctx.runAction(api.horus.v2.actions.analyzeSession, { sessionId });
 *
 * 2. Get v2 analysis results:
 *    const analysis = await ctx.runQuery(api.horus.v2.queries.getAnalysisV2, { sessionId });
 *
 * 3. Get enriched sections only:
 *    const sections = await ctx.runQuery(api.horus.v2.queries.getEnrichedSections, { sessionId });
 *
 * 4. Test v2 pipeline with mock data:
 *    const test = await ctx.runAction(api.horus.v2.actions.testPipeline, {});
 *
 * === v1 Pipeline (Legacy) ===
 *
 * 1. Trigger v1 analysis for a session:
 *    await ctx.runAction(api.horus.actions.analyzeSession, { sessionId });
 *
 * 2. Get v1 analysis results:
 *    const analysis = await ctx.runQuery(api.horus.queries.getAnalysis, { sessionId });
 *
 * 3. Get progress report:
 *    const progress = await ctx.runQuery(api.horus.queries.getProgressReport, { patientId });
 *
 * === Common ===
 *
 * - Retry failed analysis (v2):
 *   await ctx.runAction(api.horus.v2.actions.retryAnalysis, { sessionId });
 *
 * - Check system health:
 *   const health = await ctx.runAction(api.horus.actions.getSystemHealth, {});
 *
 * Environment Variables Required:
 * - VERTEX_AI_PROJECT_ID: Google Cloud project ID
 * - VERTEX_AI_LOCATION: GCP region (default: us-central1)
 * - GOOGLE_APPLICATION_CREDENTIALS_JSON: Service account JSON (or run on GCP)
 *
 * Note: v2 uses Gemini's built-in Google Search grounding - no external search API needed.
 */
