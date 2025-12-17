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

export type MetricDomain = "opi" | "symmetry" | "power" | "control" | "stability";

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
const formatDegPerSec = (v: number) => `${Math.round(v)}`;

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // OPI (always first, special styling) - applies to all movement types
  { id: "opiScore", name: "OPI Score", domain: "opi", unit: "", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true },

  // Symmetry - most only relevant for bilateral (except real asymmetry)
  { id: "romAsymmetry", name: "ROM Asymmetry", domain: "symmetry", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false },
  { id: "velocityAsymmetry", name: "Velocity Asymmetry", domain: "symmetry", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false },
  { id: "crossCorrelation", name: "Cross Correlation", domain: "symmetry", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: false },
  { id: "realAsymmetryAvg", name: "Real Asymmetry", domain: "symmetry", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: true },

  // Power - all apply to both movement types
  { id: "rsi", name: "RSI", domain: "power", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true },
  { id: "jumpHeightCm", name: "Jump Height", domain: "power", unit: "cm", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true },
  { id: "peakAngularVelocity", name: "Peak Ang. Velocity", domain: "power", unit: "°/s", format: formatDegPerSec, direction: "higher_better", bilateral: true, unilateral: true },
  { id: "explosivenessConcentric", name: "Explosiveness", domain: "power", unit: "°/s²", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true },

  // Control - all apply to both movement types
  { id: "sparc", name: "SPARC", domain: "control", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true },
  { id: "ldlj", name: "LDLJ", domain: "control", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true },
  { id: "nVelocityPeaks", name: "Velocity Peaks", domain: "control", unit: "", format: formatInt, direction: "lower_better", bilateral: true, unilateral: true },
  { id: "rmsJerk", name: "RMS Jerk", domain: "control", unit: "°/s³", format: formatInt, direction: "lower_better", bilateral: true, unilateral: true },

  // Stability - all apply to both movement types
  { id: "romCoV", name: "ROM CoV", domain: "stability", unit: "%", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: true },
  { id: "groundContactTimeMs", name: "Ground Contact", domain: "stability", unit: "ms", format: formatInt, direction: "optimal_range", bilateral: true, unilateral: true },
];

const DOMAIN_COLORS: Record<MetricDomain, string> = {
  opi: "var(--tropx-vibrant)",
  symmetry: "#8b5cf6", // violet
  power: "#f97316",    // orange
  control: "#06b6d4",  // cyan
  stability: "#22c55e", // green
};

const DOMAIN_LABELS: Record<MetricDomain, string> = {
  opi: "OPI",
  symmetry: "Symmetry",
  power: "Power",
  control: "Control",
  stability: "Stability",
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
      symmetry: [],
      power: [],
      control: [],
      stability: [],
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

  // Flatten all metrics in domain order
  const allMetrics = [
    ...groupedMetrics.opi,
    ...groupedMetrics.symmetry,
    ...groupedMetrics.power,
    ...groupedMetrics.control,
    ...groupedMetrics.stability,
  ];

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
