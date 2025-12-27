/**
 * ClassificationBadge Primitive
 *
 * Badge indicating strength or weakness classification.
 * Color system: Green = strength, Amber = weakness (NOT red).
 * Red is reserved for critical/error states only.
 */

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type Classification = "strength" | "weakness";

interface ClassificationBadgeProps {
  classification: Classification;
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

const classificationStyles: Record<
  Classification,
  { bg: string; text: string; label: string; icon: typeof TrendingUp }
> = {
  strength: {
    bg: "bg-[var(--tropx-success-bg)]",
    text: "text-[var(--tropx-success-text)]",
    label: "Strength",
    icon: TrendingUp,
  },
  weakness: {
    bg: "bg-[var(--tropx-warning-bg)]",
    text: "text-[var(--tropx-warning-text)]",
    label: "Weakness",
    icon: TrendingDown,
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

export function ClassificationBadge({
  classification,
  showIcon = true,
  size = "sm",
  className,
}: ClassificationBadgeProps) {
  const styles = classificationStyles[classification];
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
