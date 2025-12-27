/**
 * DomainBadge Primitive
 *
 * Badge indicating metric domain (range, symmetry, power, control, timing).
 * Uses domain-specific colors consistent with chart theming.
 */

import { cn } from "@/lib/utils";
import { Maximize2, Scale, Zap, Target, Clock } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type MetricDomain = "range" | "symmetry" | "power" | "control" | "timing";

interface DomainBadgeProps {
  domain: MetricDomain;
  /** Show icon alongside text */
  showIcon?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional className */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Domain Colors (matching convex/horus/metrics.ts DOMAIN_COLORS)
// ─────────────────────────────────────────────────────────────────

const domainStyles: Record<
  MetricDomain,
  { color: string; bgColor: string; label: string; icon: typeof Maximize2 }
> = {
  range: {
    color: "#10B981", // Emerald
    bgColor: "rgba(16, 185, 129, 0.1)",
    label: "Range",
    icon: Maximize2,
  },
  symmetry: {
    color: "#8B5CF6", // Violet
    bgColor: "rgba(139, 92, 246, 0.1)",
    label: "Symmetry",
    icon: Scale,
  },
  power: {
    color: "#F97316", // Orange
    bgColor: "rgba(249, 115, 22, 0.1)",
    label: "Power",
    icon: Zap,
  },
  control: {
    color: "#06B6D4", // Cyan
    bgColor: "rgba(6, 182, 212, 0.1)",
    label: "Control",
    icon: Target,
  },
  timing: {
    color: "#EC4899", // Pink
    bgColor: "rgba(236, 72, 153, 0.1)",
    label: "Timing",
    icon: Clock,
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

export function DomainBadge({
  domain,
  showIcon = true,
  size = "sm",
  className,
}: DomainBadgeProps) {
  const styles = domainStyles[domain];
  const sizes = sizeStyles[size];
  const Icon = styles.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full",
        sizes.badge,
        showIcon && sizes.gap,
        className
      )}
      style={{
        backgroundColor: styles.bgColor,
        color: styles.color,
      }}
    >
      {showIcon && <Icon className={sizes.icon} />}
      <span>{styles.label}</span>
    </span>
  );
}
