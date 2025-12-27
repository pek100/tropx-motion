/**
 * Horus Visualization Catalog
 *
 * Provides AI with knowledge of available chart types, metrics, and icons.
 * Used in prompts to guide AI output generation.
 */

import type { RechartsType, LucideIconName } from "./types";
import { METRIC_REGISTRY, PER_LEG_METRICS, BILATERAL_METRICS } from "../metrics";

// ─────────────────────────────────────────────────────────────────
// Recharts Type Descriptions
// ─────────────────────────────────────────────────────────────────

export interface ChartTypeInfo {
  type: RechartsType;
  name: string;
  description: string;
  bestFor: string[];
  requiresTimeSeries: boolean;
  supportsMultipleSeries: boolean;
  example: string;
}

export const RECHARTS_CATALOG: ChartTypeInfo[] = [
  {
    type: "line",
    name: "Line Chart",
    description: "Shows trends over time with connected data points",
    bestFor: [
      "Progress tracking over sessions",
      "Metric trends over time",
      "Comparing multiple metrics over time",
    ],
    requiresTimeSeries: true,
    supportsMultipleSeries: true,
    example: "Track ROM improvement across 7 sessions",
  },
  {
    type: "bar",
    name: "Bar Chart",
    description: "Compares discrete values across categories",
    bestFor: [
      "Left vs Right leg comparison",
      "Domain-level scores",
      "Session-to-session comparison",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: true,
    example: "Compare peak flexion between legs",
  },
  {
    type: "area",
    name: "Area Chart",
    description: "Like line chart but with filled area underneath",
    bestFor: [
      "Showing cumulative progress",
      "Visualizing metric ranges",
      "Emphasizing magnitude of change",
    ],
    requiresTimeSeries: true,
    supportsMultipleSeries: true,
    example: "Visualize velocity improvement area over time",
  },
  {
    type: "pie",
    name: "Pie Chart",
    description: "Shows proportions of a whole",
    bestFor: [
      "Distribution of deficits by domain",
      "Strength vs weakness breakdown",
      "Time allocation by movement type",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: false,
    example: "Show proportion of issues by body domain",
  },
  {
    type: "radar",
    name: "Radar/Spider Chart",
    description: "Multi-dimensional comparison on radial axes",
    bestFor: [
      "Overall performance profile",
      "Comparing multiple domains simultaneously",
      "Balance assessment across metrics",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: true,
    example: "Show performance across ROM, Power, Control, Symmetry domains",
  },
  {
    type: "radialBar",
    name: "Radial Bar Chart",
    description: "Circular progress indicators",
    bestFor: [
      "Single metric progress toward goal",
      "OPI score visualization",
      "Milestone completion percentage",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: false,
    example: "Show 75% progress toward ROM target",
  },
  {
    type: "scatter",
    name: "Scatter Plot",
    description: "Shows correlation between two variables",
    bestFor: [
      "Correlation analysis",
      "Identifying outliers",
      "Comparing two metrics relationship",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: true,
    example: "Plot velocity vs ROM to show correlation",
  },
  {
    type: "composed",
    name: "Composed Chart",
    description: "Combines multiple chart types (line + bar, etc.)",
    bestFor: [
      "Comparing actual vs target",
      "Showing metrics with reference lines",
      "Complex multi-variable visualization",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: true,
    example: "Bar for current values, line for baseline targets",
  },
  {
    type: "funnel",
    name: "Funnel Chart",
    description: "Shows progressive reduction through stages",
    bestFor: [
      "Recovery stage progression",
      "Session completion rates",
      "Milestone achievement flow",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: false,
    example: "Show recovery phase progression",
  },
  {
    type: "treemap",
    name: "Treemap",
    description: "Hierarchical data as nested rectangles",
    bestFor: [
      "Domain breakdown with sub-metrics",
      "Proportional importance visualization",
      "Hierarchical metric grouping",
    ],
    requiresTimeSeries: false,
    supportsMultipleSeries: false,
    example: "Show metric importance by domain hierarchy",
  },
];

/**
 * Get chart type info for AI prompt
 */
export function getChartTypeDescription(type: RechartsType): string {
  const info = RECHARTS_CATALOG.find((c) => c.type === type);
  if (!info) return `Unknown chart type: ${type}`;
  return `${info.name}: ${info.description}. Best for: ${info.bestFor.join(", ")}.`;
}

/**
 * Get all chart types as formatted text for AI prompt
 */
export function getChartCatalogForPrompt(): string {
  return RECHARTS_CATALOG.map(
    (c) =>
      `- "${c.type}" (${c.name}): ${c.description}
    Best for: ${c.bestFor.join("; ")}
    Supports multiple series: ${c.supportsMultipleSeries ? "Yes" : "No"}
    Requires time series data: ${c.requiresTimeSeries ? "Yes" : "No"}
    Example: ${c.example}`
  ).join("\n\n");
}

// ─────────────────────────────────────────────────────────────────
// Metric Path Catalog
// ─────────────────────────────────────────────────────────────────

export interface MetricPathInfo {
  path: string;
  displayName: string;
  scope: "perLeg" | "bilateral";
  domain: string;
  unit: string;
  direction: "higherBetter" | "lowerBetter";
  description: string;
}

/**
 * Generate all valid metric paths for AI
 */
export function getMetricPaths(): MetricPathInfo[] {
  const paths: MetricPathInfo[] = [];

  // Per-leg metrics have two paths
  for (const metricName of PER_LEG_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    paths.push({
      path: `leftLeg.${metricName}`,
      displayName: `Left Leg ${config.displayName}`,
      scope: "perLeg",
      domain: config.domain,
      unit: config.unit,
      direction: config.direction,
      description: `${config.displayName} for the left leg`,
    });
    paths.push({
      path: `rightLeg.${metricName}`,
      displayName: `Right Leg ${config.displayName}`,
      scope: "perLeg",
      domain: config.domain,
      unit: config.unit,
      direction: config.direction,
      description: `${config.displayName} for the right leg`,
    });
  }

  // Bilateral metrics have single path
  for (const metricName of BILATERAL_METRICS) {
    const config = METRIC_REGISTRY[metricName];
    paths.push({
      path: `bilateral.${metricName}`,
      displayName: config.displayName,
      scope: "bilateral",
      domain: config.domain,
      unit: config.unit,
      direction: config.direction,
      description: config.displayName,
    });
  }

  // Add OPI score
  paths.push({
    path: "opiScore",
    displayName: "Overall Performance Index",
    scope: "bilateral",
    domain: "composite",
    unit: "points",
    direction: "higherBetter",
    description: "Composite score from 0-100 representing overall movement quality",
  });

  return paths;
}

/**
 * Get metric paths formatted for AI prompt
 */
export function getMetricCatalogForPrompt(): string {
  const paths = getMetricPaths();

  const byScope = {
    leftLeg: paths.filter((p) => p.path.startsWith("leftLeg.")),
    rightLeg: paths.filter((p) => p.path.startsWith("rightLeg.")),
    bilateral: paths.filter((p) => p.path.startsWith("bilateral.")),
    other: paths.filter(
      (p) =>
        !p.path.startsWith("leftLeg.") &&
        !p.path.startsWith("rightLeg.") &&
        !p.path.startsWith("bilateral.")
    ),
  };

  return `
## Available Metric Expressions

### Left Leg Metrics (use with limb: "Left Leg")
${byScope.leftLeg.map((p) => `- \`${p.path}\` - ${p.displayName} (${p.unit}, ${p.direction})`).join("\n")}

### Right Leg Metrics (use with limb: "Right Leg")
${byScope.rightLeg.map((p) => `- \`${p.path}\` - ${p.displayName} (${p.unit}, ${p.direction})`).join("\n")}

### Bilateral Metrics
${byScope.bilateral.map((p) => `- \`${p.path}\` - ${p.displayName} (${p.unit}, ${p.direction})`).join("\n")}

### Other
${byScope.other.map((p) => `- \`${p.path}\` - ${p.displayName} (${p.unit}, ${p.direction})`).join("\n")}

## Context Variables (for formulas)
- \`current\` - Current session value of the metric
- \`previous\` - Previous session value
- \`baseline\` - First session value (baseline)
- \`average\` - Average across all sessions
- \`min\` / \`max\` - Min/max across all sessions

## Formula Examples
- \`((current - baseline) / baseline) * 100\` - Percentage change from baseline
- \`abs(leftLeg.peakFlexion - rightLeg.peakFlexion)\` - Absolute asymmetry
- \`(leftLeg.peakAngularVelocity + rightLeg.peakAngularVelocity) / 2\` - Average of both legs
`;
}

// ─────────────────────────────────────────────────────────────────
// Icon Catalog
// ─────────────────────────────────────────────────────────────────

export interface IconInfo {
  name: LucideIconName;
  category: string;
  useCase: string;
}

export const ICON_CATALOG: IconInfo[] = [
  // Status & Alerts
  { name: "AlertTriangle", category: "alerts", useCase: "Warnings, moderate severity issues" },
  { name: "AlertCircle", category: "alerts", useCase: "Important notices, attention needed" },
  { name: "CheckCircle", category: "alerts", useCase: "Success, completed, good status" },
  { name: "XCircle", category: "alerts", useCase: "Error, failed, critical issue" },
  { name: "Info", category: "alerts", useCase: "Informational messages" },
  { name: "Bell", category: "alerts", useCase: "Notifications, reminders" },
  { name: "ShieldAlert", category: "alerts", useCase: "Clinical warnings, safety concerns" },
  { name: "ShieldCheck", category: "alerts", useCase: "Safe, cleared, validated" },

  // Trends & Progress
  { name: "TrendingUp", category: "trends", useCase: "Improvement, positive trend" },
  { name: "TrendingDown", category: "trends", useCase: "Decline, negative trend" },
  { name: "ArrowUp", category: "trends", useCase: "Increase, higher" },
  { name: "ArrowDown", category: "trends", useCase: "Decrease, lower" },
  { name: "ArrowUpRight", category: "trends", useCase: "Growth, positive direction" },
  { name: "ArrowDownRight", category: "trends", useCase: "Decline, negative direction" },
  { name: "Minus", category: "trends", useCase: "Stable, no change" },

  // Activity & Motion
  { name: "Activity", category: "motion", useCase: "Movement, activity levels" },
  { name: "Zap", category: "motion", useCase: "Power, explosiveness, energy" },
  { name: "Flame", category: "motion", useCase: "Intensity, high performance" },
  { name: "Timer", category: "motion", useCase: "Timing, duration" },
  { name: "Clock", category: "motion", useCase: "Time-related metrics" },
  { name: "Gauge", category: "motion", useCase: "Performance level, intensity" },

  // Body & Health
  { name: "Heart", category: "health", useCase: "Overall health, wellbeing" },
  { name: "HeartPulse", category: "health", useCase: "Active health monitoring" },
  { name: "Footprints", category: "health", useCase: "Steps, walking, movement" },
  { name: "Move", category: "health", useCase: "Range of motion, flexibility" },
  { name: "Target", category: "health", useCase: "Goals, targets, objectives" },
  { name: "Crosshair", category: "health", useCase: "Precision, accuracy, focus" },

  // Achievement & Milestones
  { name: "Trophy", category: "achievement", useCase: "Major achievement, best performance" },
  { name: "Medal", category: "achievement", useCase: "Achievement, recognition" },
  { name: "Star", category: "achievement", useCase: "Excellence, standout performance" },
  { name: "Award", category: "achievement", useCase: "Recognition, accomplishment" },
  { name: "Crown", category: "achievement", useCase: "Best, top performer" },
  { name: "PartyPopper", category: "achievement", useCase: "Celebration, milestone reached" },
  { name: "Sparkles", category: "achievement", useCase: "Special, noteworthy" },

  // Comparison & Balance
  { name: "Scale", category: "comparison", useCase: "Balance, symmetry, equilibrium" },
  { name: "GitCompare", category: "comparison", useCase: "Comparison, difference" },
  { name: "ArrowLeftRight", category: "comparison", useCase: "Bilateral comparison, left vs right" },
  { name: "Equal", category: "comparison", useCase: "Equality, balance achieved" },
  { name: "Percent", category: "comparison", useCase: "Percentages, ratios" },

  // Analysis & Insights
  { name: "Eye", category: "analysis", useCase: "Observation, insight, attention" },
  { name: "Lightbulb", category: "analysis", useCase: "Insight, idea, recommendation" },
  { name: "Brain", category: "analysis", useCase: "Intelligence, analysis, thinking" },
  { name: "Search", category: "analysis", useCase: "Investigation, detailed look" },
  { name: "Microscope", category: "analysis", useCase: "Detailed analysis, precision" },
  { name: "FlaskConical", category: "analysis", useCase: "Research, evidence-based" },

  // Actions & Recommendations
  { name: "ListChecks", category: "actions", useCase: "Checklist, action items" },
  { name: "ClipboardList", category: "actions", useCase: "Tasks, to-do items" },
  { name: "Calendar", category: "actions", useCase: "Scheduling, planning" },
  { name: "CalendarCheck", category: "actions", useCase: "Completed session, scheduled" },
  { name: "CircleCheck", category: "actions", useCase: "Task complete, done" },
  { name: "Play", category: "actions", useCase: "Start, begin, action" },
  { name: "RefreshCw", category: "actions", useCase: "Retry, refresh, repeat" },
];

/**
 * Get icons formatted for AI prompt
 */
export function getIconCatalogForPrompt(): string {
  const byCategory = ICON_CATALOG.reduce(
    (acc, icon) => {
      if (!acc[icon.category]) acc[icon.category] = [];
      acc[icon.category].push(icon);
      return acc;
    },
    {} as Record<string, IconInfo[]>
  );

  return Object.entries(byCategory)
    .map(
      ([category, icons]) =>
        `### ${category.charAt(0).toUpperCase() + category.slice(1)} Icons
${icons.map((i) => `- \`${i.name}\`: ${i.useCase}`).join("\n")}`
    )
    .join("\n\n");
}

// ─────────────────────────────────────────────────────────────────
// Block Type Catalog
// ─────────────────────────────────────────────────────────────────

export function getBlockTypeCatalogForPrompt(): string {
  return `
## Visualization Block Types - REQUIRED FIELDS FOR EACH TYPE

### executive_summary (for overall narrative)
REQUIRED: type, title, content
EXAMPLE:
{
  "type": "executive_summary",
  "title": "Session Analysis",
  "content": "This session shows **excellent progress** in range of motion. Left Leg demonstrates improved flexion control while Right Leg maintains strong power output."
}

### stat_card (for key metrics)
⚠️ CRITICAL: metric field is MANDATORY - block will FAIL without it!
REQUIRED: type, title, metric (tag)
RECOMMENDED: icon, variant
EXAMPLE:
{
  "type": "stat_card",
  "title": "Performance Score",
  "metric": "<OPI_SCORE>",
  "icon": "Gauge",
  "variant": "success"
}

### alert_card (for warnings/notifications)
REQUIRED: type, title, description, severity
RECOMMENDED: icon, relatedMetrics
EXAMPLE:
{
  "type": "alert_card",
  "title": "Asymmetry Detected",
  "description": "Significant ROM asymmetry (15%) between legs requires attention. Left Leg shows reduced flexion compared to Right Leg.",
  "severity": "warning",
  "icon": "AlertTriangle",
  "relatedMetrics": ["bilateral.romAsymmetry", "leftLeg.peakFlexion", "rightLeg.peakFlexion"]
}

### comparison_card (for left vs right)
⚠️ CRITICAL: leftMetric and rightMetric are MANDATORY - block will FAIL without them!
REQUIRED: type, title, leftLabel, rightLabel, leftMetric (tag), rightMetric (tag)
RECOMMENDED: showDifference, highlightBetter

EXAMPLE:
{
  "type": "comparison_card",
  "title": "Peak Flexion Comparison",
  "leftLabel": "Left Leg",
  "rightLabel": "Right Leg",
  "leftMetric": "<LEFT_PEAK_FLEXION>",
  "rightMetric": "<RIGHT_PEAK_FLEXION>",
  "showDifference": true,
  "highlightBetter": true
}

### next_steps (for recommendations)
REQUIRED: type, title, items (each with text)
RECOMMENDED: priority for each item
EXAMPLE:
{
  "type": "next_steps",
  "title": "Recommended Actions",
  "items": [
    { "text": "Focus on Left Leg flexion exercises to improve ROM", "priority": "high" },
    { "text": "Continue current power training regimen", "priority": "medium" },
    { "text": "Monitor asymmetry in next 3 sessions", "priority": "medium" }
  ]
}

### progress_card (for milestones)
REQUIRED: type, title, description, metric (tag), target (number)
RECOMMENDED: icon, celebrationLevel
EXAMPLE:
{
  "type": "progress_card",
  "title": "ROM Goal Progress",
  "description": "Working toward 120° target",
  "metric": "<LEFT_PEAK_FLEXION>",
  "target": 120,
  "icon": "Target"
}

### metric_grid (for multiple metrics)
REQUIRED: type, title, metrics (array with label, metric tag)
RECOMMENDED: columns
EXAMPLE:
{
  "type": "metric_grid",
  "title": "Left Leg Overview",
  "columns": "3",
  "metrics": [
    { "label": "Peak ROM", "metric": "<LEFT_PEAK_FLEXION>" },
    { "label": "Velocity", "metric": "<LEFT_VELOCITY>" },
    { "label": "Power", "metric": "<LEFT_POWER>" }
  ]
}

### quote_card (for evidence citations)
REQUIRED: type, title, content
RECOMMENDED: citation, variant
EXAMPLE:
{
  "type": "quote_card",
  "title": "Clinical Evidence",
  "content": "ROM improvements of 10-15° are associated with meaningful functional gains in daily activities.",
  "citation": "Smith et al. (2023) Journal of Rehabilitation",
  "variant": "evidence"
}
`;
}

// ─────────────────────────────────────────────────────────────────
// Complete Catalog for AI Prompt
// ─────────────────────────────────────────────────────────────────

/**
 * Generate compact visualization catalog for AI system prompt.
 * Optimized for token efficiency - includes only essential info.
 */
export function getVisualizationCatalogForPrompt(): string {
  return `
# Visualization Blocks (Compact Reference)

## Block Types (unit is automatic from tag!)
- **executive_summary**: title, content (markdown), variant?
- **stat_card**: title, metric (tag), icon?, comparison?
- **alert_card**: title, description, severity (info|warning|error), icon?
- **comparison_card**: title, leftLabel, rightLabel, leftMetric (tag), rightMetric (tag)
- **next_steps**: title, items: [{text, priority?}]
- **progress_card**: title, description, metric (tag), target, icon?
- **metric_grid**: title, columns (2|3|4), metrics: [{label, metric (tag)}]

## Metric Tags (use these in metric fields)
- <OPI_SCORE> - Overall Performance Index (0-100)
- <LEFT_PEAK_FLEXION>, <RIGHT_PEAK_FLEXION> - Peak ROM (°)
- <LEFT_AVG_ROM>, <RIGHT_AVG_ROM> - Average ROM (°)
- <LEFT_VELOCITY>, <RIGHT_VELOCITY> - Peak Angular Velocity (°/s)
- <LEFT_POWER>, <RIGHT_POWER> - Explosiveness Concentric (°/s²)
- <ROM_ASYMMETRY>, <VELOCITY_ASYMMETRY> - Bilateral Asymmetry (%)

## Common Icons
TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Target, Zap, Activity, Scale

## Rules
1. Use metric paths NOT actual values
2. EXACTLY 4-5 blocks per mode
3. Start with executive_summary, end with next_steps
`;
}
