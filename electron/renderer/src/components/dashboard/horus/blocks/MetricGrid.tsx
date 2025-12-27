/**
 * MetricGrid Block
 *
 * Dense multi-metric display in grid layout.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface MetricItem {
  label: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable" | null;
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
    <Card className={cn("py-4 bg-[var(--tropx-card)] border-[var(--tropx-border)]", className)}>
      {title && (
        <CardHeader className="pb-2 pt-0">
          <CardTitle className="text-base font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className={cn(!title && "pt-0", "pt-0")}>
        <div className={cn("grid gap-3", columnStyles[columns])}>
          {metrics.map((metric, index) => {
            const TrendIcon = metric.trend ? trendIcons[metric.trend] : null;
            const trendColor = metric.trend ? trendColors[metric.trend] : "";

            return (
              <div
                key={index}
                className="p-2 rounded-lg bg-[var(--tropx-muted)] text-center"
              >
                <div className="text-xs text-[var(--tropx-text-sub)] uppercase tracking-wide mb-0.5 truncate">
                  {metric.label}
                </div>
                <div className="flex items-center justify-center gap-1">
                  <span className="text-lg font-bold text-[var(--tropx-text-main)]">
                    {formatValue(metric.value)}
                  </span>
                  {metric.unit && (
                    <span className="text-xs text-[var(--tropx-text-sub)]">{metric.unit}</span>
                  )}
                  {TrendIcon && (
                    <TrendIcon className={cn("h-3 w-3 ml-1", trendColor)} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
