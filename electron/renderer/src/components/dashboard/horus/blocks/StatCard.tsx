/**
 * StatCard Block
 *
 * Single metric display with optional comparison badge.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LucideIconName } from "../types";

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  comparison?: {
    value: number;
    label?: string;
    type?: "baseline" | "previous" | "average" | "target";
  };
  icon?: LucideIconName;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

const variantStyles = {
  default: {
    card: "bg-[var(--tropx-card)] border-[var(--tropx-border)]",
    icon: "text-[var(--tropx-text-sub)]",
    badgePositive: "bg-[var(--tropx-success-bg)] text-[var(--tropx-success-text)]",
    badgeNegative: "bg-[var(--tropx-warning-bg)] text-[var(--tropx-warning-text)]",
  },
  success: {
    card: "gradient-green-card border-none",
    icon: "text-[var(--tropx-success-text)]",
    badgePositive: "bg-white/50 dark:bg-black/20 text-[var(--tropx-success-text)]",
    badgeNegative: "bg-white/50 dark:bg-black/20 text-[var(--tropx-warning-text)]",
  },
  warning: {
    card: "gradient-amber-card border-none",
    icon: "text-[var(--tropx-warning-text)]",
    badgePositive: "bg-white/50 dark:bg-black/20 text-[var(--tropx-success-text)]",
    badgeNegative: "bg-white/50 dark:bg-black/20 text-[var(--tropx-warning-text)]",
  },
  danger: {
    card: "gradient-red-card border-none",
    icon: "text-[var(--tropx-red)]",
    badgePositive: "bg-white/50 dark:bg-black/20 text-[var(--tropx-success-text)]",
    badgeNegative: "bg-white/50 dark:bg-black/20 text-[var(--tropx-red)]",
  },
};

export function StatCard({
  title,
  value,
  unit,
  comparison,
  icon,
  variant = "default",
  className,
}: StatCardProps) {
  const styles = variantStyles[variant];

  // Get icon component
  const IconComponent = icon ? (Icons[icon] as LucideIcon) : null;

  // Format comparison value
  const comparisonValue =
    comparison?.value !== undefined
      ? comparison.value >= 0
        ? `+${comparison.value.toFixed(1)}%`
        : `${comparison.value.toFixed(1)}%`
      : null;

  const isPositive = comparison?.value !== undefined && comparison.value >= 0;

  return (
    <Card className={cn("py-3", styles.card, className)}>
      <CardContent className="px-4 py-0">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {IconComponent && (
                <IconComponent className={cn("h-4 w-4", styles.icon)} />
              )}
              <span className="text-sm font-medium text-[var(--tropx-text-sub)]">{title}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tracking-tight text-[var(--tropx-text-main)]">{value}</span>
              {unit && <span className="text-sm text-[var(--tropx-text-sub)]">{unit}</span>}
            </div>
          </div>
          {comparisonValue && (
            <Badge
              className={cn(
                "ml-2 font-medium border-none",
                isPositive ? styles.badgePositive : styles.badgeNegative
              )}
            >
              {comparisonValue}
              {comparison?.label && (
                <span className="ml-1 opacity-75">{comparison.label}</span>
              )}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
