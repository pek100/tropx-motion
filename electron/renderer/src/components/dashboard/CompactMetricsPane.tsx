/**
 * CompactMetricsPane - Elegant compact view of session metrics.
 * Shows key metrics with generous spacing and clean visual hierarchy.
 * Designed to complement the ChartPane.
 */

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Expand,
  ChevronRight,
  Check,
  X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MetricsTableModal } from "./MetricsTableModal";
import type { MetricRow, MetricDomain } from "./columns";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface CompactMetricsPaneProps {
  data: MetricRow[];
  sessionTitle?: string;
  selectedMetrics?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
  borderless?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DOMAIN_CONFIG: Record<MetricDomain, { label: string; color: string }> = {
  opi: { label: "Score", color: "var(--tropx-vibrant)" },
  range: { label: "Range", color: "#10b981" },
  symmetry: { label: "Balance", color: "#8b5cf6" },
  power: { label: "Power", color: "#f97316" },
  control: { label: "Control", color: "#06b6d4" },
  timing: { label: "Timing", color: "#ec4899" },
};

// Priority metrics to show in compact view
const PRIORITY_METRICS = [
  "opiScore",
  "avgMaxROM",
  "peakAngularVelocity",
  "romAsymmetry",
  "realAsymmetryAvg",
  "romCoV",
  "explosivenessConcentric",
];

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function OPIScoreCard({ score }: { score: number }) {
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const gradeColor = score >= 70 ? "var(--tropx-success-text)" : score >= 55 ? "var(--tropx-warning-text)" : "var(--tropx-error-text)";

  return (
    <div className="p-4 gradient-coral-card rounded-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-[var(--tropx-text-sub)] font-medium">
            Performance
          </p>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-3xl font-bold text-[var(--tropx-vibrant)]">
              {Math.round(score)}
            </span>
            <span className="text-sm text-[var(--tropx-text-sub)]">/100</span>
          </div>
        </div>
        <div
          className="size-12 rounded-full flex items-center justify-center text-xl font-bold"
          style={{
            backgroundColor: `color-mix(in srgb, ${gradeColor} 15%, transparent)`,
            color: gradeColor,
          }}
        >
          {grade}
        </div>
      </div>
    </div>
  );
}

function MetricRowItem({
  row,
  isSelected,
  onToggle,
}: {
  row: MetricRow;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const config = DOMAIN_CONFIG[row.domain];
  const { trend, trendPercent, direction } = row;

  const isGoodTrend =
    trend &&
    ((direction === "higher_better" && trend === "up") ||
      (direction === "lower_better" && trend === "down"));
  const isBadTrend =
    trend &&
    ((direction === "higher_better" && trend === "down") ||
      (direction === "lower_better" && trend === "up"));

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full px-4 py-3 flex items-center gap-3 text-left transition-all group",
        "hover:bg-[var(--tropx-muted)]/50 active:scale-[0.99]",
        isSelected && "bg-[var(--tropx-vibrant)]/8"
      )}
    >
      {/* Selection indicator / Domain dot */}
      <div
        className={cn(
          "size-5 rounded-md shrink-0 flex items-center justify-center transition-all",
          isSelected
            ? "bg-[var(--tropx-vibrant)] text-white"
            : "border-2 border-[var(--tropx-border)] group-hover:border-[var(--tropx-vibrant)]/50"
        )}
        style={!isSelected ? { borderColor: `color-mix(in srgb, ${config.color} 30%, transparent)` } : undefined}
      >
        {isSelected ? (
          <Check className="size-3" strokeWidth={3} />
        ) : (
          <div
            className="size-2 rounded-full opacity-60"
            style={{ backgroundColor: config.color }}
          />
        )}
      </div>

      {/* Metric info */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-sm truncate transition-colors",
            isSelected ? "text-[var(--tropx-text-main)] font-medium" : "text-[var(--tropx-text-sub)]"
          )}
        >
          {row.name}
        </p>
      </div>

      {/* Value and trend */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="font-mono text-sm font-medium text-[var(--tropx-text-main)]">
          {row.format(row.value!)}
        </span>
        {trend && trend !== "stable" && (
          <div
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium",
              isGoodTrend && "text-[var(--tropx-success-text)]",
              isBadTrend && "text-[var(--tropx-error-text)]"
            )}
          >
            {trend === "up" ? (
              <TrendingUp className="size-3.5" />
            ) : (
              <TrendingDown className="size-3.5" />
            )}
            {trendPercent !== undefined && (
              <span>{Math.abs(trendPercent).toFixed(0)}%</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function CompactMetricsPane({
  data,
  sessionTitle,
  selectedMetrics,
  onSelectionChange,
  borderless,
  className,
}: CompactMetricsPaneProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Sort metrics by priority, then show all
  const sortedMetrics = useMemo(() => {
    // Get priority metrics first
    const prioritized = PRIORITY_METRICS
      .map((id) => data.find((m) => m.id === id))
      .filter((m): m is MetricRow => m !== undefined && m.value !== undefined);

    // Get remaining metrics
    const remaining = data
      .filter((m) => !PRIORITY_METRICS.includes(m.id) && m.value !== undefined);

    return [...prioritized, ...remaining];
  }, [data]);

  const opiScore = data.find((m) => m.id === "opiScore")?.value;

  // Count selected metrics (excluding opiScore which is always shown)
  const selectedCount = selectedMetrics ? selectedMetrics.size - (selectedMetrics.has("opiScore") ? 1 : 0) : 0;

  const handleToggle = (metricId: string) => {
    if (!onSelectionChange) return;
    const newSelected = new Set(selectedMetrics);
    if (newSelected.has(metricId)) {
      newSelected.delete(metricId);
    } else {
      newSelected.add(metricId);
    }
    onSelectionChange(newSelected);
  };

  const handleClearSelection = () => {
    if (!onSelectionChange) return;
    // Keep only opiScore selected
    onSelectionChange(new Set(["opiScore"]));
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-col bg-[var(--tropx-card)] h-full overflow-hidden",
          borderless
            ? "rounded-none border-0 shadow-none sm:rounded-xl sm:border sm:border-[var(--tropx-border)] sm:shadow-sm"
            : "rounded-xl border border-[var(--tropx-border)] shadow-sm",
          className
        )}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--tropx-border)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-[var(--tropx-text-main)]">
              Metrics
            </h3>
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={handleClearSelection}
                className="group flex items-center gap-1 px-1.5 h-5 text-[10px] font-medium rounded-full bg-[var(--tropx-vibrant)] text-white hover:bg-[var(--tropx-error-text)] transition-colors"
                title="Clear selection"
              >
                <span>{selectedCount}</span>
                <X className="size-3 opacity-70 group-hover:opacity-100" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)]",
              "hover:bg-[var(--tropx-muted)]"
            )}
            title="Expand to full view"
          >
            <Expand className="size-4" />
          </button>
        </div>

        {/* OPI Score */}
        {opiScore !== undefined && (
          <div className="p-4 border-b border-[var(--tropx-border)] shrink-0">
            <OPIScoreCard score={opiScore} />
          </div>
        )}

        {/* Metrics List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="py-1">
            {sortedMetrics
              .filter((m) => m.id !== "opiScore")
              .map((row) => (
                <MetricRowItem
                  key={row.id}
                  row={row}
                  isSelected={selectedMetrics?.has(row.id) ?? false}
                  onToggle={() => handleToggle(row.id)}
                />
              ))}
          </div>
        </ScrollArea>

        {/* Footer */}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className={cn(
            "px-4 py-3 border-t border-[var(--tropx-border)] shrink-0",
            "flex items-center justify-between",
            "text-sm text-[var(--tropx-text-sub)]",
            "hover:bg-[var(--tropx-muted)]/50 hover:text-[var(--tropx-vibrant)]",
            "transition-colors"
          )}
        >
          <span>View all {data.length} metrics</span>
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Full Table Modal */}
      <MetricsTableModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        data={data}
        sessionTitle={sessionTitle}
        selectedMetrics={selectedMetrics}
        onSelectionChange={onSelectionChange}
      />
    </>
  );
}

export default CompactMetricsPane;
