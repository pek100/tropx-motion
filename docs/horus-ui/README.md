# Horus UI Visualization System

## Overview

The Horus UI is a declarative visualization system where AI agents describe **what** to visualize (not actual values). The frontend then fills in values programmatically from real `SessionMetrics` data.

## Problem Statement

The original system had AI generating actual chart data values, which posed risks:
- **Hallucination**: AI could output incorrect values
- **Data Inconsistency**: Values might not match actual metrics
- **No Single Source of Truth**: Data scattered between AI output and database

## Solution: Declarative Visualization Blocks

AI outputs **visualization intent** using formula expressions:
```typescript
// AI outputs:
{
  type: "stat_card",
  title: "Velocity Breakthrough",
  metric: "leftLeg.peakAngularVelocity",
  comparison: {
    type: "baseline",
    formula: "((current - baseline) / baseline) * 100"
  }
}

// Frontend computes actual values from SessionMetrics
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Analysis Agent (LLM)                           │
│  Outputs VisualizationBlock[] with formulas/metric references        │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Expression Evaluator                             │
│  Parses formulas, resolves metric references against SessionMetrics  │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        Block Renderer                                 │
│  Routes block type → React component, passes computed values         │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Block Components                              │
│  ExecutiveSummary | StatCard | AlertCard | NextSteps | ChartBlock    │
└──────────────────────────────────────────────────────────────────────┘
```

## Block Types

### 1. ExecutiveSummary
Markdown text with support for highlighting and emphasis.

```typescript
interface ExecutiveSummaryBlock {
  type: "executive_summary";
  title: string;
  content: string; // Markdown
}
```

### 2. StatCard
Single metric display with optional comparison badge.

```typescript
interface StatCardBlock {
  type: "stat_card";
  title: string;
  metric: MetricExpression;  // e.g., "leftLeg.peakAngularVelocity"
  unit?: string;
  comparison?: {
    type: "baseline" | "previous" | "average" | "target";
    formula?: string;  // e.g., "((current - baseline) / baseline) * 100"
    label?: string;    // e.g., "vs Avg"
  };
  icon?: LucideIconName;
  variant?: "default" | "success" | "warning" | "danger";
}
```

### 3. AlertCard
Warning or notification with icon and description.

```typescript
interface AlertCardBlock {
  type: "alert_card";
  title: string;
  description: string;
  severity: "info" | "warning" | "error" | "success";
  icon?: LucideIconName;
  relatedMetrics?: MetricExpression[];
}
```

### 4. NextSteps
Collapsible list of action items.

```typescript
interface NextStepsBlock {
  type: "next_steps";
  title?: string;  // default: "Next Steps"
  items: Array<{
    text: string;
    priority?: "high" | "medium" | "low";
  }>;
  collapsible?: boolean;  // default: true
}
```

### 5. ComparisonCard
Side-by-side comparison of two values (left vs right, current vs baseline).

```typescript
interface ComparisonCardBlock {
  type: "comparison_card";
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftMetric: MetricExpression;
  rightMetric: MetricExpression;
  unit?: string;
  showDifference?: boolean;
  highlightBetter?: boolean;  // Highlights the better value based on metric direction
}
```

### 6. ProgressCard
Shows milestone achievement or progress indicator.

```typescript
interface ProgressCardBlock {
  type: "progress_card";
  title: string;
  description: string;
  metric: MetricExpression;
  target: number | MetricExpression;
  icon?: LucideIconName;
  celebrationLevel?: "major" | "minor";
}
```

### 7. MetricGrid
Grid of multiple metrics for dense information display.

```typescript
interface MetricGridBlock {
  type: "metric_grid";
  title?: string;
  columns?: 2 | 3 | 4;
  metrics: Array<{
    label: string;
    metric: MetricExpression;
    unit?: string;
    trend?: "show" | "hide";  // Show trend arrow
  }>;
}
```

### 8. QuoteCard
Highlights a specific finding or evidence citation.

```typescript
interface QuoteCardBlock {
  type: "quote_card";
  content: string;
  citation?: string;
  icon?: LucideIconName;
  variant?: "info" | "evidence" | "recommendation";
}
```

### 9. ChartBlock
Any Recharts visualization with declarative data specification.

```typescript
interface ChartBlockBlock {
  type: "chart";
  chartType: RechartsType;  // "line" | "bar" | "radar" | "area" | "pie" | "composed"
  title: string;
  dataSpec: ChartDataSpec;
  config?: ChartConfig;
}

interface ChartDataSpec {
  // For single-series charts
  series?: Array<{
    name: string;
    metric: MetricExpression;
    color?: string;
  }>;

  // For comparison charts
  comparisons?: Array<{
    label: string;
    leftMetric: MetricExpression;
    rightMetric: MetricExpression;
  }>;

  // For time-series (uses historical data)
  timeSeries?: {
    metrics: MetricExpression[];
    range?: "all" | "last_7" | "last_30";
  };

  // Reference lines
  references?: Array<{
    label: string;
    value: number | MetricExpression;
  }>;
}
```

## Metric Expressions

AI can reference metrics using dot notation:

```
leftLeg.peakFlexion
rightLeg.peakAngularVelocity
bilateral.romAsymmetry
opiScore
```

And write formulas using standard math:
```
leftLeg.peakFlexion - rightLeg.peakFlexion
((current - baseline) / baseline) * 100
abs(bilateral.romAsymmetry)
```

### Available Context Variables
- `current` - Current session value
- `previous` - Previous session value
- `baseline` - First session value (baseline)
- `average` - Average across all sessions
- `min` / `max` - Min/max across sessions

## Integration

### HorusPane Location
The HorusPane sits below the "Progress Over Time" chart in the Dashboard, integrated with the existing chart state (session selection).

### State Management
- `selectedPatientId` - From DashboardView
- `selectedSessionId` - From DashboardView (switches between Overall/Session modes)
- Analysis data from `api.horus.queries.getAnalysis`

### Mode Switching
- **Overall Analysis**: Longitudinal view, aggregate insights across sessions
- **Session Analysis**: Single session deep-dive (triggered when session selected)

## File Structure

```
convex/horus/visualization/
├── types.ts           # VisualizationBlock types
├── catalog.ts         # Recharts type catalog for AI
├── evaluator.ts       # Expression parser and evaluator

electron/renderer/src/components/dashboard/horus/
├── HorusPane.tsx      # Main container with tabs
├── BlockRenderer.tsx  # Routes type → component
├── blocks/
│   ├── ExecutiveSummary.tsx
│   ├── StatCard.tsx
│   ├── AlertCard.tsx
│   ├── NextSteps.tsx
│   └── ChartBlock.tsx
└── hooks/
    └── useVisualization.ts  # Data fetching and computation
```

## Related Documentation
- [Implementation Checklist](/docs/horus-ui/checklist.md)
- [Backend Horus System](/docs/horus/README.md)
