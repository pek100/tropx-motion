/**
 * MetricsTable - Displays all calculated metrics with per-leg breakdown.
 * Shows Left Leg / Right Leg columns for per-leg metrics, combined value for bilateral metrics.
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
  /** Metric is relevant for bilateral movements */
  bilateral: boolean;
  /** Metric is relevant for unilateral movements */
  unilateral: boolean;
  /** Whether this metric has separate left/right leg values */
  perLeg: boolean;
  /** Source keys for per-leg metrics */
  leftKey?: string;
  rightKey?: string;
}

export interface PerLegMetrics {
  overallMaxROM?: number;
  averageROM?: number;
  peakFlexion?: number;
  peakExtension?: number;
  peakAngularVelocity?: number;
  explosivenessLoading?: number;
  explosivenessConcentric?: number;
  rmsJerk?: number;
}

export interface BilateralMetrics {
  romAsymmetry?: number;
  velocityAsymmetry?: number;
  crossCorrelation?: number;
  realAsymmetryAvg?: number;
  netGlobalAsymmetry?: number;
  phaseShift?: number;
  temporalLag?: number;
  maxFlexionTimingDiff?: number;
}

export interface SmoothnessMetrics {
  sparc?: number;
  ldlj?: number;
  nVelocityPeaks?: number;
}

export interface MetricsData {
  opiScore?: number;
  leftLeg?: PerLegMetrics;
  rightLeg?: PerLegMetrics;
  bilateral?: BilateralMetrics;
  smoothness?: SmoothnessMetrics;
}

export interface MetricValue {
  left?: number;
  right?: number;
  combined?: number;
  trend?: "up" | "down" | "stable";
  trendPercent?: number;
}

export interface MetricsTableProps {
  metricsData: MetricsData | null;
  selectedMetrics: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  movementType?: MovementType;
  showIrrelevant?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Metric Definitions
// ─────────────────────────────────────────────────────────────────

const formatPercent = (v: number) => `${v.toFixed(1)}%`;
const formatDecimal = (v: number) => v.toFixed(2);
const formatInt = (v: number) => Math.round(v).toString();
const formatDegrees = (v: number) => `${v.toFixed(1)}°`;
const formatDegPerSec = (v: number) => `${Math.round(v)}°/s`;
const formatMs = (v: number) => `${Math.round(v)}ms`;

/**
 * METRIC_DEFINITIONS - All calculated metrics organized by domain
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════
  // OPI Score
  // ═══════════════════════════════════════════════════════════════════
  { id: "opiScore", name: "Performance Score", domain: "opi", unit: "/100", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true, perLeg: false },

  // ═══════════════════════════════════════════════════════════════════
  // RANGE OF MOTION - Per-leg metrics
  // ═══════════════════════════════════════════════════════════════════
  { id: "overallMaxROM", name: "Max Range of Motion", domain: "range", unit: "", format: formatDegrees, direction: "higher_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "overallMaxROM", rightKey: "overallMaxROM" },
  { id: "averageROM", name: "Average ROM", domain: "range", unit: "", format: formatDegrees, direction: "higher_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "averageROM", rightKey: "averageROM" },
  { id: "peakFlexion", name: "Peak Flexion", domain: "range", unit: "", format: formatDegrees, direction: "higher_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "peakFlexion", rightKey: "peakFlexion" },
  { id: "peakExtension", name: "Peak Extension", domain: "range", unit: "", format: formatDegrees, direction: "lower_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "peakExtension", rightKey: "peakExtension" },

  // ═══════════════════════════════════════════════════════════════════
  // POWER - Per-leg metrics
  // ═══════════════════════════════════════════════════════════════════
  { id: "peakAngularVelocity", name: "Peak Speed", domain: "power", unit: "", format: formatDegPerSec, direction: "higher_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "peakAngularVelocity", rightKey: "peakAngularVelocity" },
  { id: "explosivenessConcentric", name: "Explosiveness", domain: "power", unit: "°/s²", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "explosivenessConcentric", rightKey: "explosivenessConcentric" },
  { id: "explosivenessLoading", name: "Loading Power", domain: "power", unit: "°/s²", format: formatInt, direction: "higher_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "explosivenessLoading", rightKey: "explosivenessLoading" },

  // ═══════════════════════════════════════════════════════════════════
  // SYMMETRY - Bilateral comparison metrics
  // ═══════════════════════════════════════════════════════════════════
  { id: "romAsymmetry", name: "ROM Asymmetry", domain: "symmetry", unit: "", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false, perLeg: false },
  { id: "velocityAsymmetry", name: "Speed Asymmetry", domain: "symmetry", unit: "", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false, perLeg: false },
  { id: "crossCorrelation", name: "Movement Sync", domain: "symmetry", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: false, perLeg: false },
  { id: "realAsymmetryAvg", name: "True Asymmetry", domain: "symmetry", unit: "", format: formatDegrees, direction: "lower_better", bilateral: true, unilateral: true, perLeg: false },
  { id: "netGlobalAsymmetry", name: "Global Asymmetry", domain: "symmetry", unit: "", format: formatPercent, direction: "lower_better", bilateral: true, unilateral: false, perLeg: false },

  // ═══════════════════════════════════════════════════════════════════
  // TIMING - Bilateral comparison metrics
  // ═══════════════════════════════════════════════════════════════════
  { id: "phaseShift", name: "Phase Shift", domain: "timing", unit: "", format: formatDegrees, direction: "lower_better", bilateral: true, unilateral: false, perLeg: false },
  { id: "temporalLag", name: "Temporal Lag", domain: "timing", unit: "", format: formatMs, direction: "lower_better", bilateral: true, unilateral: false, perLeg: false },
  { id: "maxFlexionTimingDiff", name: "Peak Timing Diff", domain: "timing", unit: "", format: formatMs, direction: "lower_better", bilateral: true, unilateral: false, perLeg: false },

  // ═══════════════════════════════════════════════════════════════════
  // CONTROL - Smoothness metrics (session-wide)
  // ═══════════════════════════════════════════════════════════════════
  { id: "sparc", name: "SPARC Smoothness", domain: "control", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true, perLeg: false },
  { id: "ldlj", name: "LDLJ Smoothness", domain: "control", unit: "", format: formatDecimal, direction: "higher_better", bilateral: true, unilateral: true, perLeg: false },
  { id: "nVelocityPeaks", name: "Velocity Peaks", domain: "control", unit: "", format: formatInt, direction: "lower_better", bilateral: true, unilateral: true, perLeg: false },
  { id: "rmsJerk", name: "Jerkiness", domain: "control", unit: "°/s³", format: formatInt, direction: "lower_better", bilateral: true, unilateral: true, perLeg: true, leftKey: "rmsJerk", rightKey: "rmsJerk" },
];

const DOMAIN_COLORS: Record<MetricDomain, string> = {
  opi: "var(--tropx-vibrant)",
  range: "var(--domain-range)",
  symmetry: "var(--domain-symmetry)",
  power: "var(--domain-power)",
  control: "var(--domain-control)",
  timing: "var(--domain-timing)",
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
// Helpers
// ─────────────────────────────────────────────────────────────────

function isMetricRelevant(metric: MetricDefinition, movementType?: MovementType): boolean {
  if (!movementType || movementType === "unknown" || movementType === "mixed") {
    return true;
  }
  if (movementType === "bilateral") {
    return metric.bilateral;
  }
  if (movementType === "unilateral" || movementType === "single_leg") {
    return metric.unilateral;
  }
  return true;
}

function getMetricValue(
  metric: MetricDefinition,
  data: MetricsData | null
): MetricValue {
  if (!data) return {};

  // OPI Score
  if (metric.id === "opiScore") {
    return { combined: data.opiScore };
  }

  // Per-leg metrics
  if (metric.perLeg && metric.leftKey && metric.rightKey) {
    const left = data.leftLeg?.[metric.leftKey as keyof PerLegMetrics];
    const right = data.rightLeg?.[metric.rightKey as keyof PerLegMetrics];
    return { left, right };
  }

  // Bilateral metrics
  if (metric.domain === "symmetry" || metric.domain === "timing") {
    const value = data.bilateral?.[metric.id as keyof BilateralMetrics];
    return { combined: value };
  }

  // Smoothness metrics
  if (metric.domain === "control" && !metric.perLeg) {
    const value = data.smoothness?.[metric.id as keyof SmoothnessMetrics];
    return { combined: value };
  }

  return {};
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function MetricsTable({
  metricsData,
  selectedMetrics,
  onSelectionChange,
  movementType,
  showIrrelevant = true,
  className,
}: MetricsTableProps) {
  const handleToggle = (metricId: string) => {
    if (metricId === "opiScore") return;

    const newSelected = new Set(selectedMetrics);
    if (newSelected.has(metricId)) {
      newSelected.delete(metricId);
    } else {
      newSelected.add(metricId);
    }
    onSelectionChange(newSelected);
  };

  const renderValue = (value: number | undefined, metric: MetricDefinition, isRelevant: boolean) => {
    if (value === undefined || value === null || isNaN(value)) {
      return <span className="text-gray-300">—</span>;
    }
    return (
      <span className={isRelevant ? "text-[var(--tropx-dark)]" : "text-gray-400"}>
        {metric.format(value)}
      </span>
    );
  };

  const renderMetricRow = (metric: MetricDefinition) => {
    const values = getMetricValue(metric, metricsData);
    const isSelected = selectedMetrics.has(metric.id);
    const isOpi = metric.id === "opiScore";
    const isRelevant = isMetricRelevant(metric, movementType);

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
          isSelected && !isOpi && "bg-blue-50/50",
          !isRelevant && "opacity-40"
        )}
        onClick={() => handleToggle(metric.id)}
        title={!isRelevant ? `Not typically relevant for ${movementType} movements` : undefined}
      >
        {/* Checkbox */}
        <TableCell className="w-10">
          <Checkbox
            checked={isSelected}
            disabled={isOpi}
            onCheckedChange={() => handleToggle(metric.id)}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(isOpi && "opacity-50")}
          />
        </TableCell>

        {/* Domain Badge */}
        <TableCell className="w-20">
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

        {/* Metric Name */}
        <TableCell className={cn("font-medium", isRelevant ? "text-[var(--tropx-dark)]" : "text-gray-400")}>
          {metric.name}
          {metric.unit && <span className="text-[var(--tropx-shadow)] ml-1 text-xs font-normal">{metric.unit}</span>}
        </TableCell>

        {/* Left Leg Value */}
        <TableCell className="text-right font-mono w-24">
          {metric.perLeg ? (
            renderValue(values.left, metric, isRelevant)
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </TableCell>

        {/* Right Leg Value */}
        <TableCell className="text-right font-mono w-24">
          {metric.perLeg ? (
            renderValue(values.right, metric, isRelevant)
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </TableCell>

        {/* Combined/Bilateral Value */}
        <TableCell className="text-right font-mono w-24">
          {!metric.perLeg ? (
            renderValue(values.combined, metric, isRelevant)
          ) : (
            // Show average for per-leg metrics
            values.left !== undefined && values.right !== undefined ? (
              <span className={cn("text-xs", isRelevant ? "text-[var(--tropx-shadow)]" : "text-gray-400")}>
                avg: {metric.format((values.left + values.right) / 2)}
              </span>
            ) : (
              <span className="text-gray-300">—</span>
            )
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div className={cn("rounded-xl border border-gray-200 overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="w-10"></TableHead>
            <TableHead className="w-20">Domain</TableHead>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right w-24">Left</TableHead>
            <TableHead className="text-right w-24">Right</TableHead>
            <TableHead className="text-right w-24">Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {METRIC_DEFINITIONS.map((metric) => renderMetricRow(metric))}
        </TableBody>
      </Table>
    </div>
  );
}

export default MetricsTable;
