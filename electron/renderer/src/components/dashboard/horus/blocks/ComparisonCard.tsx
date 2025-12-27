/**
 * ComparisonCard Block
 *
 * Side-by-side value comparison (e.g., left vs right leg).
 * Uses TropX theme tokens and leg colors for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeftRight, TrendingUp, Minus } from "lucide-react";

interface ComparisonCardProps {
  title: string;
  leftLabel: string;
  rightLabel: string;
  leftValue: number;
  rightValue: number;
  unit?: string;
  showDifference?: boolean;
  highlightBetter?: boolean;
  /** Direction: higherBetter or lowerBetter - affects which side is highlighted */
  direction?: "higherBetter" | "lowerBetter";
  className?: string;
}

export function ComparisonCard({
  title,
  leftLabel,
  rightLabel,
  leftValue,
  rightValue,
  unit = "",
  showDifference = true,
  highlightBetter = true,
  direction = "higherBetter",
  className,
}: ComparisonCardProps) {
  const difference = Math.abs(leftValue - rightValue);
  const percentDiff =
    leftValue + rightValue > 0
      ? ((2 * difference) / (leftValue + rightValue)) * 100
      : 0;

  // Determine which side is better
  const leftIsBetter =
    direction === "higherBetter" ? leftValue > rightValue : leftValue < rightValue;
  const rightIsBetter =
    direction === "higherBetter" ? rightValue > leftValue : rightValue < leftValue;
  const isEqual = leftValue === rightValue;

  // Format values
  const formatValue = (val: number) => {
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(1);
  };

  return (
    <Card className={cn("py-4 bg-[var(--tropx-card)] border-[var(--tropx-border)]", className)}>
      <CardHeader className="pb-2 pt-0">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-[var(--tropx-text-sub)]" />
          <CardTitle className="text-base font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
          {/* Left side - uses left leg color */}
          <div
            className={cn(
              "text-center p-3 rounded-lg transition-colors",
              "bg-[var(--leg-left-fill)]/10",
              highlightBetter && leftIsBetter && "ring-2 ring-[var(--leg-left-band)]/50"
            )}
          >
            <div className="text-xs text-[var(--tropx-text-sub)] uppercase tracking-wide mb-1">
              {leftLabel}
            </div>
            <div className="text-2xl font-bold text-[var(--tropx-text-main)]">
              {formatValue(leftValue)}
              <span className="text-sm font-normal text-[var(--tropx-text-sub)] ml-0.5">
                {unit}
              </span>
            </div>
            {highlightBetter && leftIsBetter && !isEqual && (
              <TrendingUp className="h-4 w-4 text-[var(--tropx-success-text)] mx-auto mt-1" />
            )}
          </div>

          {/* Center divider */}
          <div className="text-[var(--tropx-text-sub)] text-sm">vs</div>

          {/* Right side - uses right leg color */}
          <div
            className={cn(
              "text-center p-3 rounded-lg transition-colors",
              "bg-[var(--leg-right-fill)]/10",
              highlightBetter && rightIsBetter && "ring-2 ring-[var(--leg-right-band)]/50"
            )}
          >
            <div className="text-xs text-[var(--tropx-text-sub)] uppercase tracking-wide mb-1">
              {rightLabel}
            </div>
            <div className="text-2xl font-bold text-[var(--tropx-text-main)]">
              {formatValue(rightValue)}
              <span className="text-sm font-normal text-[var(--tropx-text-sub)] ml-0.5">
                {unit}
              </span>
            </div>
            {highlightBetter && rightIsBetter && !isEqual && (
              <TrendingUp className="h-4 w-4 text-[var(--tropx-success-text)] mx-auto mt-1" />
            )}
          </div>
        </div>

        {/* Difference display */}
        {showDifference && (
          <div className="mt-3 pt-3 border-t border-[var(--tropx-border)] flex items-center justify-center gap-2 text-sm text-[var(--tropx-text-sub)]">
            {isEqual ? (
              <>
                <Minus className="h-4 w-4" />
                <span>Equal</span>
              </>
            ) : (
              <>
                <span>Difference:</span>
                <span className="font-medium text-[var(--tropx-text-main)]">
                  {formatValue(difference)}
                  {unit}
                </span>
                <span className="text-[var(--tropx-text-sub)]">({percentDiff.toFixed(1)}%)</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
