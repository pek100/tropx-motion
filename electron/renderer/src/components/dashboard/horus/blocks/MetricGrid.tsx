/**
 * MetricGrid Block
 *
 * Dense multi-metric display in grid layout.
 * Enhanced with per-item composable slots for classification badges.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ClassificationBadge,
  BenchmarkBadge,
  LimbBadge,
  getIconSizeClass,
  type Classification,
  type Benchmark,
  type Limb,
} from "../primitives";

interface MetricItem {
  label: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable" | null;
  // Per-item composable slots (optional)
  classification?: Classification;
  benchmark?: Benchmark;
  limb?: Limb;
}

interface MetricGridProps {
  title?: string;
  columns?: 2 | 3 | 4;
  metrics: MetricItem[];
  className?: string;
}

const columnStyles = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

const trendColors = {
  up: "text-[var(--tropx-success-text)]",
  down: "text-[var(--tropx-red)]",
  stable: "text-[var(--tropx-text-sub)]",
};

export function MetricGrid({
  title,
  columns = 2,
  metrics,
  className,
}: MetricGridProps) {
  const formatValue = (val: number | string) => {
    if (typeof val === "string") return val;
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(1);
  };

  return (
    <Card className={cn("py-2.5 bg-[var(--tropx-card)] border-[var(--tropx-border)]", className)}>
      {title && (
        <CardHeader className="pb-1.5 pt-0 px-3">
          <CardTitle className="text-sm font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn(!title && "pt-0", "pt-0 px-3")}>
        <div className={cn("grid gap-1.5", columnStyles[columns])}>
          {metrics.map((metric, index) => {
            const TrendIcon = metric.trend ? trendIcons[metric.trend] : null;
            const trendColor = metric.trend ? trendColors[metric.trend] : "";
            const hasSlots = metric.classification || metric.benchmark || metric.limb;

            // Color-code value based on benchmark
            const valueColorClass = metric.benchmark
              ? metric.benchmark === "optimal"
                ? "text-[var(--tropx-success-text)]"
                : metric.benchmark === "deficient"
                  ? "text-[var(--tropx-warning-text)]"
                  : "text-[var(--tropx-text-main)]"
              : "text-[var(--tropx-text-main)]";

            return (
              <div
                key={index}
                className={cn(
                  "p-1.5 rounded-md bg-[var(--tropx-muted)] text-center",
                  // Add subtle ring for classification
                  metric.classification === "strength" && "ring-1 ring-[var(--tropx-success-text)]/30",
                  metric.classification === "weakness" && "ring-1 ring-[var(--tropx-warning-text)]/30"
                )}
              >
                <div className="text-[10px] text-[var(--tropx-text-sub)] uppercase tracking-wide mb-0.5 truncate">
                  {metric.label}
                </div>
                <div className="flex items-center justify-center gap-0.5">
                  <span className={cn("text-sm font-bold", valueColorClass)}>
                    {formatValue(metric.value)}
                  </span>
                  {metric.unit && (
                    <span className="text-[10px] text-[var(--tropx-text-sub)]">{metric.unit}</span>
                  )}
                  {TrendIcon && (
                    <TrendIcon className={cn(getIconSizeClass("xs"), "ml-0.5", trendColor)} />
                  )}
                </div>
                {/* Per-item badges */}
                {hasSlots && (
                  <div className="flex flex-wrap items-center justify-center gap-0.5 mt-1">
                    {metric.limb && <LimbBadge limb={metric.limb} size="sm" />}
                    {metric.benchmark && <BenchmarkBadge benchmark={metric.benchmark} size="sm" showIcon={false} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
