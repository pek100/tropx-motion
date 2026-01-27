/**
 * Horus v2 - Single Session Analysis
 *
 * Two-stage agentic pipeline:
 * 1. Analysis Agent: Expert clinical interpretation → N sections
 * 2. Research Agents: Parallel evidence enrichment per section
 *
 * @module horus/v2
 */

// ─────────────────────────────────────────────────────────────────
// Types
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
  TokenUsage,
  AgentResult,

  // Re-exported from v1
  SessionMetrics,
  PerLegMetricValues,
  BilateralMetricValues,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

export {
  safeJSONParse,
  extractJSON,
} from "./validation";

// ─────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────

export {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  ANALYSIS_RESPONSE_SCHEMA,
} from "./prompts/analysis";

export {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchUserPrompt,
  RESEARCH_RESPONSE_SCHEMA,
} from "./prompts/research";

// ─────────────────────────────────────────────────────────────────
// Search Utilities
// ─────────────────────────────────────────────────────────────────

export {
  getTierForUrl,
  filterHighQualityResults,
  getDiverseResults,
} from "./search/web";

// ─────────────────────────────────────────────────────────────────
// Shared Utilities
// ─────────────────────────────────────────────────────────────────

export { buildSessionMetrics } from "./utils";

// ─────────────────────────────────────────────────────────────────
// Cross-Analysis Types (re-exported for convenience)
// ─────────────────────────────────────────────────────────────────

export type {
  CrossAnalysisResult,
  CrossAnalysisOutput,
  MinimalCrossAnalysisOutput,
  TrendInsight,
  RecurringPattern,
  BaselineComparison,
  NotableSession,
  RefinedInsight,
  InsightIconHint,
} from "../crossAnalysis/types";

export { hasFullCrossAnalysis } from "../crossAnalysis/types";
