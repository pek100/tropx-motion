/**
 * ComparisonCard Block
 *
 * Side-by-side value comparison (e.g., left vs right leg).
 * Enhanced with composable slots for rich AI-generated findings.
 * Uses TropX theme tokens and leg colors for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ExpandableDetails,
  ClassificationBadge,
  DomainBadge,
  getIconSizeClass,
  type DetailsSlot,
  type Classification,
  type Limb,
  type MetricDomain,
} from "../primitives";

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

  // Composable Slots (optional)
  id?: string;
  classification?: Classification;
  /** Explicit deficit limb override (otherwise auto-calculated) */
  deficitLimb?: Limb;
  domain?: MetricDomain;
  details?: DetailsSlot;
  expandable?: boolean;
  defaultExpanded?: boolean;
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
  // Composable slots
  id,
  classification,
  deficitLimb,
  domain,
  details,
  expandable = true,
  defaultExpanded = false,
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

  // Auto-calculate deficit limb if not provided (limb with worse value)
  const calculatedDeficitLimb: Limb | undefined = isEqual
    ? undefined
    : leftIsBetter
      ? "Right Leg"
      : "Left Leg";
  const resolvedDeficitLimb = deficitLimb ?? calculatedDeficitLimb;

  // Determine if asymmetry is significant (>5%) or critical (>15%)
  const isSignificantAsymmetry = percentDiff > 5;
  const isCriticalAsymmetry = percentDiff > 15;

  // Format values
  const formatValue = (val: number) => {
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(1);
  };

  // Check if any badges are present
  const hasBadges = classification || domain;

  return (
    <Card className={cn("py-4 bg-[var(--tropx-card)] border-[var(--tropx-border)]", className)} data-finding-id={id}>
      <CardHeader className="pb-2 pt-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className={cn(getIconSizeClass("sm"), "text-[var(--tropx-text-sub)]")} />
            <CardTitle className="text-base font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
          </div>
          {/* Asymmetry badge inline */}
          {!isEqual && isSignificantAsymmetry && (
            <Badge
              className={cn(
                "font-medium border-none",
                isCriticalAsymmetry
                  ? "bg-[var(--tropx-warning-bg)] text-[var(--tropx-warning-text)]"
                  : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]"
              )}
            >
              {percentDiff.toFixed(1)}% asymmetry
            </Badge>
          )}
        </div>
        {/* Composable badge slots */}
        {hasBadges && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {classification && <ClassificationBadge classification={classification} />}
            {domain && <DomainBadge domain={domain} />}
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
          {/* Left side - uses left leg color, amber ring for deficit */}
          <div
            className={cn(
              "text-center p-3 rounded-lg transition-colors",
              "bg-[var(--leg-left-fill)]/10",
              highlightBetter && leftIsBetter && "ring-2 ring-[var(--leg-left-band)]/50",
              // Amber ring for deficit limb (not red)
              resolvedDeficitLimb === "Left Leg" && isSignificantAsymmetry && "ring-2 ring-[var(--tropx-warning-text)]/50"
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
              <TrendingUp className={cn(getIconSizeClass("sm"), "text-[var(--tropx-success-text)] mx-auto mt-1")} />
            )}
            {resolvedDeficitLimb === "Left Leg" && isSignificantAsymmetry && (
              <TrendingDown className={cn(getIconSizeClass("sm"), "text-[var(--tropx-warning-text)] mx-auto mt-1")} />
            )}
          </div>

          {/* Center divider */}
          <div className="text-[var(--tropx-text-sub)] text-sm">vs</div>

          {/* Right side - uses right leg color, amber ring for deficit */}
          <div
            className={cn(
              "text-center p-3 rounded-lg transition-colors",
              "bg-[var(--leg-right-fill)]/10",
              highlightBetter && rightIsBetter && "ring-2 ring-[var(--leg-right-band)]/50",
              // Amber ring for deficit limb (not red)
              resolvedDeficitLimb === "Right Leg" && isSignificantAsymmetry && "ring-2 ring-[var(--tropx-warning-text)]/50"
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
              <TrendingUp className={cn(getIconSizeClass("sm"), "text-[var(--tropx-success-text)] mx-auto mt-1")} />
            )}
            {resolvedDeficitLimb === "Right Leg" && isSignificantAsymmetry && (
              <TrendingDown className={cn(getIconSizeClass("sm"), "text-[var(--tropx-warning-text)] mx-auto mt-1")} />
            )}
          </div>
        </div>

        {/* Difference display */}
        {showDifference && (
          <div className="mt-3 pt-3 border-t border-[var(--tropx-border)] flex items-center justify-center gap-2 text-sm text-[var(--tropx-text-sub)]">
            {isEqual ? (
              <>
                <Minus className={getIconSizeClass("sm")} />
                <span>Equal</span>
              </>
            ) : (
              <>
                <span>Difference:</span>
                <span className="font-medium text-[var(--tropx-text-main)]">
                  {formatValue(difference)}
                  {unit}
                </span>
                {resolvedDeficitLimb && (
                  <span className="text-[var(--tropx-warning-text)]">({resolvedDeficitLimb} deficit)</span>
                )}
              </>
            )}
          </div>
        )}

        {/* Expandable details slot */}
        {expandable && details && (
          <ExpandableDetails
            details={details}
            defaultExpanded={defaultExpanded}
            hoverPreview={true}
          />
        )}
      </CardContent>
    </Card>
  );
}
