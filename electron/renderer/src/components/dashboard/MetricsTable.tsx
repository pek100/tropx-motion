/**
 * MetricsTable - Selectable metrics table for dashboard.
 * Selected rows are displayed in the chart above.
 */

import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MetricDomain = "opi" | "range" | "symmetry" | "power" | "control" | "timing";

export type MovementType = "bilateral" | "unilateral" | "single_leg" | "mixed" | "unknown";

export interface MetricDefinition {
  id: string;
  name: string;
  domain: MetricDomain;
  unit: string;
  format: (value: number) => string;
  direction: "higher_better" | "lower_better" | "optimal_range";
  /** Metric is relevant for bilateral movements (squats, jumps) */
  bilateral: boolean;
  /** Metric is relevant for unilateral movements (walking, running) */
  unilateral: boolean;
  /** Whether this metric is included in the OPI score calculation */
  inOPI: boolean;
}

export interface MetricValue {
  latest: number | undefined;
  average: number | undefined;
  trend: "up" | "down" | "stable" | undefined;
  trendPercent: number | undefined;
}

export interface MetricsTableProps {
  metricsData: Record<string, MetricValue>;
  selectedMetrics: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  /** Filter metrics by movement type. If undefined, shows all metrics. */
  movementType?: MovementType;
  /** Show irrelevant metrics (dimmed) instead of hiding them */
  showIrrelevant?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Metric Definitions
// ─────────────────────────────────────────────────────────────────

const formatPercent = (v: number) => `${v.toFixed(1)}%`;
const formatDecimal = (v: number) => v.toFixed(2);
const formatInt = (v: number) => Math.round(v).toString();
const formatDegrees = (v: number) => `${v.toFixed(1)}`;
const formatDegPerSec = (v: number) => `${Math.round(v)}`;
const formatMs = (v: number) => `${Math.round(v)}`;

/**
 * METRIC_DEFINITIONS - Sorted by understandability (easiest first)
 *
 * TIER 1: Very Easy - Physical meaning immediately clear
 * TIER 2: Easy - Simple comparison concepts
 * TIER 3: Moderate - Requires brief explanation
 * TIER 4: Technical - Needs biomechanics background
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════
  // TIER 1: VERY EASY - Physical meaning immediately clear
  // ═══════════════════════════════════════════════════════════════════

  // OPI Score (always first)
  { id: "opiScore", name: "Performance Score", domain: "opi", unit: "/100", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true, inOPI: true },

  // Range of Motion - most intuitive metrics
  { id: "avgMaxROM", name: "Range of Motion", domain: "range", unit: "°", format: formatDegrees, direction: "higher_better", bilateral: true, unilateral: true, inOPI: false },
  { id: "avgPeakFlexion", name: "Peak Flexion", domain: "range", unit: "°", format: formatDegrees, direction: "higher_better", bilateral: true, unilateral: true, inOPI: false },
  { id: "avgPeakExtension", name: "Peak Extension", domain: "range", unit: "°", format: formatDegrees, direction: "lower_better", bilateral: true, unilateral: true, inOPI: false },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 2: EASY - Simple comparison concepts
  // ═══════════════════════════════════════════════════════════════════

  // Symmetry - easy to understand as "balance between legs"
  { id: "romAsymmetry", name: "ROM Difference", domain: "symmetry", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false, inOPI: true },
  { id: "realAsymmetryAvg", name: "Movement Imbalance", domain: "symmetry", unit: "°", format: formatDegrees, direction: "lower_better", bilateral: true, unilateral: true, inOPI: true },
  { id: "romCoV", name: "Consistency", domain: "control", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: true, inOPI: true },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 3: MODERATE - Requires brief explanation
  // ═══════════════════════════════════════════════════════════════════

  // Speed and Power
  { id: "peakAngularVelocity", name: "Peak Speed", domain: "power", unit: "°/s", format: formatDegPerSec, direction: "higher_better", bilateral: true, unilateral: true, inOPI: true },
  { id: "explosivenessConcentric", name: "Explosiveness", domain: "power", unit: "°/s²", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true, inOPI: true },
  { id: "explosivenessLoading", name: "Loading Power", domain: "power", unit: "°/s²", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true, inOPI: false },

  // Symmetry (more detailed)
  { id: "velocityAsymmetry", name: "Speed Difference", domain: "symmetry", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false, inOPI: true },
  { id: "crossCorrelation", name: "Movement Similarity", domain: "symmetry", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: false, inOPI: true },
  { id: "netGlobalAsymmetry", name: "Overall Asymmetry", domain: "symmetry", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false, inOPI: false },

  // Timing
  { id: "maxFlexionTimingDiff", name: "Timing Difference", domain: "timing", unit: "ms", format: formatMs, direction: "lower_better", bilateral: true, unilateral: false, inOPI: false },

  // ═══════════════════════════════════════════════════════════════════
  // TIER 4: TECHNICAL - Needs biomechanics background
  // ═══════════════════════════════════════════════════════════════════

  // Smoothness metrics
  { id: "sparc", name: "SPARC (Smoothness)", domain: "control", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true, inOPI: true },
  { id: "ldlj", name: "LDLJ (Smoothness)", domain: "control", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true, inOPI: true },
  { id: "nVelocityPeaks", name: "Velocity Peaks", domain: "control", unit: "", format: formatInt, direction: "lower_better", bilateral: true, unilateral: true, inOPI: true },
  { id: "rmsJerk", name: "Jerkiness", domain: "control", unit: "°/s³", format: formatInt, direction: "lower_better", bilateral: true, unilateral: true, inOPI: true },

  // Phase/Timing (technical)
  { id: "phaseShift", name: "Phase Shift", domain: "timing", unit: "°", format: formatDegrees, direction: "lower_better", bilateral: true, unilateral: false, inOPI: false },
  { id: "temporalLag", name: "Temporal Lag", domain: "timing", unit: "ms", format: formatMs, direction: "lower_better", bilateral: true, unilateral: false, inOPI: false },
  { id: "zeroVelocityPhaseMs", name: "Pause Duration", domain: "timing", unit: "ms", format: formatMs, direction: "lower_better", bilateral: true, unilateral: true, inOPI: false },
];

const DOMAIN_COLORS: Record<MetricDomain, string> = {
  opi: "var(--tropx-vibrant)",
  range: "var(--domain-range)",      // emerald - most intuitive
  symmetry: "var(--domain-symmetry)", // violet
  power: "var(--domain-power)",       // orange
  control: "var(--domain-control)",   // cyan
  timing: "var(--domain-timing)",     // pink
};

const DOMAIN_LABELS: Record<MetricDomain, string> = {
  opi: "Score",
  range: "Range",
  symmetry: "Balance",
  power: "Power",
  control: "Control",
  timing: "Timing",
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

/** Check if a metric is relevant for the given movement type */
function isMetricRelevant(metric: MetricDefinition, movementType?: MovementType): boolean {
  if (!movementType || movementType === "unknown" || movementType === "mixed") {
    return true; // Show all metrics if unknown/mixed
  }
  if (movementType === "bilateral") {
    return metric.bilateral;
  }
  if (movementType === "unilateral" || movementType === "single_leg") {
    return metric.unilateral;
  }
  return true;
}

export function MetricsTable({
  metricsData,
  selectedMetrics,
  onSelectionChange,
  movementType,
  showIrrelevant = true,
  className,
}: MetricsTableProps) {
  // Group metrics by domain for visual separation
  const groupedMetrics = useMemo(() => {
    const groups: Record<MetricDomain, MetricDefinition[]> = {
      opi: [],
      range: [],
      symmetry: [],
      power: [],
      control: [],
      timing: [],
    };
    for (const metric of METRIC_DEFINITIONS) {
      groups[metric.domain].push(metric);
    }
    return groups;
  }, []);

  const handleToggle = (metricId: string) => {
    // OPI is always selected (can't deselect)
    if (metricId === "opiScore") return;

    const newSelected = new Set(selectedMetrics);
    if (newSelected.has(metricId)) {
      newSelected.delete(metricId);
    } else {
      newSelected.add(metricId);
    }
    onSelectionChange(newSelected);
  };

  const handleSelectAll = (domain: MetricDomain, checked: boolean) => {
    if (domain === "opi") return;

    const domainMetrics = groupedMetrics[domain].map((m) => m.id);
    const newSelected = new Set(selectedMetrics);

    for (const id of domainMetrics) {
      if (checked) {
        newSelected.add(id);
      } else {
        newSelected.delete(id);
      }
    }
    onSelectionChange(newSelected);
  };

  const handleToggleStar = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation();
    // Star functionality not implemented for metrics table
  };

  const renderTrend = (trend: MetricValue["trend"], trendPercent: number | undefined, direction: MetricDefinition["direction"]) => {
    if (!trend || trend === "stable") {
      return <Minus className="size-4 text-gray-400" />;
    }

    const isGood =
      (direction === "higher_better" && trend === "up") ||
      (direction === "lower_better" && trend === "down");

    const Icon = trend === "up" ? TrendingUp : TrendingDown;
    const color = isGood ? "text-green-500" : "text-red-500";

    return (
      <div className={cn("flex items-center gap-1", color)}>
        <Icon className="size-4" />
        {trendPercent !== undefined && (
          <span className="text-xs">{Math.abs(trendPercent).toFixed(0)}%</span>
        )}
      </div>
    );
  };

  const renderMetricRow = (metric: MetricDefinition) => {
    const data = metricsData[metric.id];
    const isSelected = selectedMetrics.has(metric.id);
    const isOpi = metric.id === "opiScore";
    const isRelevant = isMetricRelevant(metric, movementType);

    // Skip irrelevant metrics if not showing them
    if (!isRelevant && !showIrrelevant) {
      return null;
    }

    return (
      <TableRow
        key={metric.id}
        data-state={isSelected ? "selected" : undefined}
        className={cn(
          "cursor-pointer transition-colors",
          isOpi && "bg-[var(--tropx-hover)]/50",
          isSelected && !isOpi && "bg-blue-50",
          !isRelevant && "opacity-40"
        )}
        onClick={() => handleToggle(metric.id)}
        title={!isRelevant ? `Not typically relevant for ${movementType} movements` : undefined}
      >
        <TableCell className="w-10">
          <Checkbox
            checked={isSelected}
            disabled={isOpi}
            onCheckedChange={() => handleToggle(metric.id)}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(isOpi && "opacity-50")}
          />
        </TableCell>
        <TableCell className="w-24">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
            style={{
              backgroundColor: `${DOMAIN_COLORS[metric.domain]}20`,
              color: DOMAIN_COLORS[metric.domain],
            }}
          >
            {DOMAIN_LABELS[metric.domain]}
          </span>
        </TableCell>
        <TableCell className={cn("font-medium", isRelevant ? "text-[var(--tropx-dark)]" : "text-gray-400")}>
          {metric.name}
          {!isRelevant && (
            <span className="ml-2 text-xs text-gray-400 font-normal">(N/A)</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono">
          {data?.latest !== undefined ? (
            <span className={isRelevant ? "text-[var(--tropx-dark)]" : "text-gray-400"}>
              {metric.format(data.latest)}
              {metric.unit && <span className="text-[var(--tropx-shadow)] ml-1">{metric.unit}</span>}
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </TableCell>
        <TableCell className="text-right font-mono">
          {data?.average !== undefined ? (
            <span className={isRelevant ? "text-[var(--tropx-shadow)]" : "text-gray-400"}>
              {metric.format(data.average)}
            </span>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </TableCell>
        <TableCell className="w-20">
          {data ? renderTrend(data.trend, data.trendPercent, metric.direction) : null}
        </TableCell>
      </TableRow>
    );
  };

  // Use metrics in their defined order (sorted by understandability)
  const allMetrics = METRIC_DEFINITIONS;

  return (
    <div className={cn("rounded-xl border border-gray-200 overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="w-10"></TableHead>
            <TableHead className="w-24">Domain</TableHead>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Latest</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="w-20">Trend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allMetrics.map((metric) => renderMetricRow(metric))}
        </TableBody>
      </Table>
    </div>
  );
}

export default MetricsTable;
