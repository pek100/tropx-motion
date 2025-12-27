/**
 * MiniBarChart - Small inline bar chart
 * Used for showing set-by-set data in a compact format.
 */

import { cn } from "@/lib/utils";

interface BarData {
  name: string;
  value: number;
  highlight?: boolean;
}

interface MiniBarChartProps {
  data: BarData[];
  title?: string;
  highlightValue?: string;
  className?: string;
}

export function MiniBarChart({
  data,
  title,
  highlightValue,
  className,
}: MiniBarChartProps) {
  const maxValue = Math.max(...data.map((d) => d.value));
  const highlightedItem = data.find((d) => d.highlight);

  return (
    <div className={cn("flex flex-col items-end", className)}>
      {/* Header with highlight value */}
      {highlightValue && (
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg font-bold text-tropx-vibrant">{highlightValue}</span>
          {title && (
            <span className="text-[10px] text-[var(--tropx-text-sub)] uppercase tracking-wide">
              {title}
            </span>
          )}
        </div>
      )}

      {/* Bars */}
      <div className="flex items-end gap-1.5 h-16">
        {data.map((item, index) => {
          const height = (item.value / maxValue) * 100;
          const isHighlighted = item.highlight;

          return (
            <div key={index} className="flex flex-col items-center gap-1">
              <div
                className={cn(
                  "w-8 rounded-t transition-all",
                  isHighlighted
                    ? "bg-tropx-vibrant"
                    : "bg-[var(--tropx-muted)]"
                )}
                style={{ height: `${height}%`, minHeight: 4 }}
              />
              <span className="text-[9px] text-[var(--tropx-text-sub)]">{item.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
