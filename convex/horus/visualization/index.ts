/**
 * Horus Visualization Module
 *
 * Declarative visualization system for AI-generated analysis blocks.
 */

// ─────────────────────────────────────────────────────────────────
// Types
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
  ChartConfig,

  // Evaluated types
  EvaluatedValue,
  EvaluatedBlock,

  // Analysis extension
  AnalysisVisualization,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Catalog
// ─────────────────────────────────────────────────────────────────

export {
  // Recharts catalog
  RECHARTS_CATALOG,
  getChartTypeDescription,
  getChartCatalogForPrompt,

  // Metric catalog
  getMetricPaths,
  getMetricCatalogForPrompt,

  // Icon catalog
  ICON_CATALOG,
  getIconCatalogForPrompt,

  // Block catalog
  getBlockTypeCatalogForPrompt,

  // Complete catalog
  getVisualizationCatalogForPrompt,
} from "./catalog";

export type { ChartTypeInfo, MetricPathInfo, IconInfo } from "./catalog";

// ─────────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────────

export {
  // Metric resolution
  isValidMetricPath,
  resolveMetricValue,
  getMetricUnit,

  // Formula evaluation
  evaluateMetric,
  evaluateFormula,

  // Utilities
  formatValue,
  extractMetricPaths,
  validateFormula,
} from "./evaluator";

export type { EvaluationContext } from "./evaluator";
