/**
 * Horus Visualization Block Types
 *
 * Declarative visualization system where AI specifies WHAT to visualize
 * and the frontend fills in actual values from SessionMetrics.
 */

import type { MetricDomain } from "../metrics";

// ─────────────────────────────────────────────────────────────────
// Core Expression Types
// ─────────────────────────────────────────────────────────────────

/**
 * Metric path expression using dot notation.
 * Examples:
 * - "leftLeg.peakFlexion"
 * - "rightLeg.peakAngularVelocity"
 * - "bilateral.romAsymmetry"
 * - "opiScore"
 */
export type MetricExpression = string;

/**
 * Formula expression for computed values.
 * Supports: +, -, *, /, %, abs(), min(), max(), round()
 * Context variables: current, previous, baseline, average, min, max
 * Examples:
 * - "((current - baseline) / baseline) * 100"
 * - "abs(leftLeg.peakFlexion - rightLeg.peakFlexion)"
 */
export type FormulaExpression = string;

// ─────────────────────────────────────────────────────────────────
// Recharts Types
// ─────────────────────────────────────────────────────────────────

export type RechartsType =
  | "line"
  | "bar"
  | "area"
  | "pie"
  | "radar"
  | "radialBar"
  | "scatter"
  | "composed"
  | "funnel"
  | "treemap";

// ─────────────────────────────────────────────────────────────────
// Lucide Icon Names (Curated Subset)
// ─────────────────────────────────────────────────────────────────

export type LucideIconName =
  // Status & Alerts
  | "AlertTriangle"
  | "AlertCircle"
  | "CheckCircle"
  | "XCircle"
  | "Info"
  | "Bell"
  | "ShieldAlert"
  | "ShieldCheck"
  // Trends & Progress
  | "TrendingUp"
  | "TrendingDown"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowRight"
  | "ArrowUpRight"
  | "ArrowDownRight"
  | "Minus"
  // Activity & Motion
  | "Activity"
  | "Zap"
  | "Flame"
  | "Timer"
  | "Clock"
  | "Gauge"
  | "BarChart2"
  | "LineChart"
  // Body & Health
  | "Heart"
  | "HeartPulse"
  | "Footprints"
  | "Move"
  | "Target"
  | "Crosshair"
  // Achievement & Milestones
  | "Trophy"
  | "Medal"
  | "Star"
  | "Award"
  | "Crown"
  | "PartyPopper"
  | "Sparkles"
  // Comparison & Balance
  | "Scale"
  | "GitCompare"
  | "ArrowLeftRight"
  | "Equal"
  | "Percent"
  // Analysis & Insights
  | "Eye"
  | "Lightbulb"
  | "Brain"
  | "Search"
  | "Microscope"
  | "FlaskConical"
  // Actions & Recommendations
  | "ListChecks"
  | "ClipboardList"
  | "Calendar"
  | "CalendarCheck"
  | "CircleCheck"
  | "Play"
  | "RefreshCw";

// ─────────────────────────────────────────────────────────────────
// Block Types
// ─────────────────────────────────────────────────────────────────

/**
 * Executive Summary - Markdown text block
 */
export interface ExecutiveSummaryBlock {
  type: "executive_summary";
  title: string;
  /** Markdown content with support for **bold**, *italic*, etc. */
  content: string;
}

/**
 * Stat Card - Single metric with optional comparison badge
 */
export interface StatCardBlock {
  type: "stat_card";
  title: string;
  /** Metric path to display */
  metric: MetricExpression;
  /** Unit to display (e.g., "°", "deg/s", "%") */
  unit?: string;
  /** Comparison configuration */
  comparison?: {
    /** Type of comparison */
    type: "baseline" | "previous" | "average" | "target";
    /** Custom formula for computing comparison value */
    formula?: FormulaExpression;
    /** Label to show (e.g., "vs Avg", "vs Baseline") */
    label?: string;
    /** Target value if type is "target" */
    targetValue?: number;
  };
  /** Icon to display */
  icon?: LucideIconName;
  /** Visual variant */
  variant?: "default" | "success" | "warning" | "danger";
}

/**
 * Alert Card - Warning or notification
 */
export interface AlertCardBlock {
  type: "alert_card";
  title: string;
  /** Description text */
  description: string;
  /** Severity level determines color */
  severity: "info" | "warning" | "error" | "success";
  /** Icon to display */
  icon?: LucideIconName;
  /** Related metrics for context */
  relatedMetrics?: MetricExpression[];
}

/**
 * Next Steps - Collapsible action list
 */
export interface NextStepsBlock {
  type: "next_steps";
  /** Title (default: "Next Steps") */
  title?: string;
  /** Action items */
  items: Array<{
    text: string;
    priority?: "high" | "medium" | "low";
  }>;
  /** Whether list is collapsible (default: true) */
  collapsible?: boolean;
  /** Whether collapsed by default */
  defaultCollapsed?: boolean;
}

/**
 * Comparison Card - Side-by-side value comparison
 */
export interface ComparisonCardBlock {
  type: "comparison_card";
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftMetric: MetricExpression;
  rightMetric: MetricExpression;
  /** Unit to display */
  unit?: string;
  /** Show the difference between values */
  showDifference?: boolean;
  /** Highlight the better value based on metric direction */
  highlightBetter?: boolean;
}

/**
 * Progress Card - Milestone or target progress
 */
export interface ProgressCardBlock {
  type: "progress_card";
  title: string;
  description: string;
  /** Current value metric */
  metric: MetricExpression;
  /** Target value (number or metric expression) */
  target: number | MetricExpression;
  /** Icon to display */
  icon?: LucideIconName;
  /** Celebration level for achieved milestones */
  celebrationLevel?: "major" | "minor";
}

/**
 * Metric Grid - Dense multi-metric display
 */
export interface MetricGridBlock {
  type: "metric_grid";
  /** Optional title */
  title?: string;
  /** Number of columns (default: 2) - can be string from LLM schema */
  columns?: 2 | 3 | 4 | "2" | "3" | "4";
  /** Metrics to display */
  metrics: Array<{
    label: string;
    metric: MetricExpression;
    unit?: string;
    /** Show trend arrow based on previous session */
    trend?: "show" | "hide";
  }>;
}

/**
 * Quote Card - Evidence or recommendation highlight
 */
export interface QuoteCardBlock {
  type: "quote_card";
  /** Quote content */
  content: string;
  /** Citation source */
  citation?: string;
  /** Icon to display */
  icon?: LucideIconName;
  /** Visual variant */
  variant?: "info" | "evidence" | "recommendation";
}

/**
 * Chart Block - Recharts visualization
 */
export interface ChartBlockBlock {
  type: "chart";
  /** Recharts chart type */
  chartType: RechartsType;
  /** Chart title */
  title: string;
  /** Data specification */
  dataSpec: ChartDataSpec;
  /** Chart configuration */
  config?: ChartConfig;
}

// ─────────────────────────────────────────────────────────────────
// Chart Data Specification
// ─────────────────────────────────────────────────────────────────

export interface ChartDataSpec {
  /**
   * For single-series or multi-series charts (bar, line, area)
   * AI specifies which metrics to plot
   */
  series?: Array<{
    name: string;
    metric: MetricExpression;
    color?: string;
    /** For which limb (if per-leg metric) */
    limb?: "Left Leg" | "Right Leg";
  }>;

  /**
   * For comparison/grouped charts
   * Compare two metrics side by side
   */
  comparisons?: Array<{
    label: string;
    leftMetric: MetricExpression;
    rightMetric: MetricExpression;
  }>;

  /**
   * For time-series charts (uses historical session data)
   */
  timeSeries?: {
    metrics: MetricExpression[];
    range?: "all" | "last_7" | "last_30";
    /** For per-leg metrics, which limb(s) */
    limbs?: Array<"Left Leg" | "Right Leg">;
  };

  /**
   * For radar/spider charts
   * Plot multiple metrics on radial axes
   */
  radarMetrics?: Array<{
    name: string;
    metric: MetricExpression;
    /** Optional: max value for normalization */
    maxValue?: number;
  }>;

  /**
   * For pie charts
   */
  pieSegments?: Array<{
    name: string;
    metric: MetricExpression;
    color?: string;
  }>;

  /**
   * Reference lines or thresholds
   */
  references?: Array<{
    label: string;
    value: number | MetricExpression;
    color?: string;
    /** Dashed or solid */
    dashed?: boolean;
  }>;
}

export interface ChartConfig {
  /** Chart height in pixels (default: 250) */
  height?: number;
  /** Show legend */
  showLegend?: boolean;
  /** Show tooltip */
  showTooltip?: boolean;
  /** Show grid */
  showGrid?: boolean;
  /** X-axis label */
  xAxisLabel?: string;
  /** Y-axis label */
  yAxisLabel?: string;
  /** Colors override */
  colors?: string[];
  /** Animation enabled */
  animate?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Union Type
// ─────────────────────────────────────────────────────────────────

/**
 * Union of all visualization block types.
 * AI outputs an array of these blocks, and the frontend renders them.
 */
export type VisualizationBlock =
  | ExecutiveSummaryBlock
  | StatCardBlock
  | AlertCardBlock
  | NextStepsBlock
  | ComparisonCardBlock
  | ProgressCardBlock
  | MetricGridBlock
  | QuoteCardBlock
  | ChartBlockBlock;

/**
 * Block type discriminator
 */
export type BlockType = VisualizationBlock["type"];

// ─────────────────────────────────────────────────────────────────
// Computed Values (Output from evaluator)
// ─────────────────────────────────────────────────────────────────

/**
 * Result of evaluating a metric expression
 */
export interface EvaluatedValue {
  /** The computed value */
  value: number;
  /** Formatted string representation */
  formatted: string;
  /** Was the evaluation successful? */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Evaluated block ready for rendering
 */
export interface EvaluatedBlock<T extends VisualizationBlock = VisualizationBlock> {
  /** Original block definition */
  block: T;
  /** Computed values for all metric expressions */
  values: Record<string, EvaluatedValue>;
  /** Any evaluation errors */
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────
// Analysis Output Extension
// ─────────────────────────────────────────────────────────────────

/**
 * Extended analysis output with visualization blocks.
 * This extends the existing AnalysisOutput type.
 */
export interface AnalysisVisualization {
  /** Blocks for "Overall Analysis" mode (longitudinal view) */
  overallBlocks: VisualizationBlock[];
  /** Blocks for "Session Analysis" mode (single session) */
  sessionBlocks: VisualizationBlock[];
}
