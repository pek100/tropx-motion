/**
 * BenchmarkBadge Primitive
 *
 * Badge indicating normative benchmark category.
 * Color system: Green = optimal, Gray = average, Amber = deficient.
 * Red is NOT used for deficient - only for critical severity when combined.
 */

import { cn } from "@/lib/utils";
import { Star, Minus, AlertTriangle } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type Benchmark = "optimal" | "average" | "deficient";

interface BenchmarkBadgeProps {
  benchmark: Benchmark;
  /** Show icon alongside text */
  showIcon?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional className */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const benchmarkStyles: Record<
  Benchmark,
  { bg: string; text: string; label: string; icon: typeof Star }
> = {
  optimal: {
    bg: "bg-[var(--tropx-success-bg)]",
    text: "text-[var(--tropx-success-text)]",
    label: "Optimal",
    icon: Star,
  },
  average: {
    bg: "bg-[var(--tropx-muted)]",
    text: "text-[var(--tropx-text-sub)]",
    label: "Average",
    icon: Minus,
  },
  deficient: {
    bg: "bg-[var(--tropx-warning-bg)]",
    text: "text-[var(--tropx-warning-text)]",
    label: "Deficient",
    icon: AlertTriangle,
  },
};

const sizeStyles = {
  sm: {
    badge: "px-1.5 py-0.5 text-[10px]",
    icon: "h-3 w-3",
    gap: "gap-1",
  },
  md: {
    badge: "px-2 py-1 text-xs",
    icon: "h-3.5 w-3.5",
    gap: "gap-1.5",
  },
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function BenchmarkBadge({
  benchmark,
  showIcon = true,
  size = "sm",
  className,
}: BenchmarkBadgeProps) {
  const styles = benchmarkStyles[benchmark];
  const sizes = sizeStyles[size];
  const Icon = styles.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        styles.bg,
        styles.text,
        sizes.badge,
        showIcon && sizes.gap,
        className
      )}
    >
      {showIcon && <Icon className={sizes.icon} />}
      <span>{styles.label}</span>
    </span>
  );
}
