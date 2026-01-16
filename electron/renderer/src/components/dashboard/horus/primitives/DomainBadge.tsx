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
// Domain Colors (using CSS variables from globals.css)
// ─────────────────────────────────────────────────────────────────

const domainStyles: Record<
  MetricDomain,
  { color: string; bgColor: string; label: string; icon: typeof Maximize2 }
> = {
  range: {
    color: "var(--domain-range)",
    bgColor: "color-mix(in srgb, var(--domain-range) 10%, transparent)",
    label: "Range",
    icon: Maximize2,
  },
  symmetry: {
    color: "var(--domain-symmetry)",
    bgColor: "color-mix(in srgb, var(--domain-symmetry) 10%, transparent)",
    label: "Symmetry",
    icon: Scale,
  },
  power: {
    color: "var(--domain-power)",
    bgColor: "color-mix(in srgb, var(--domain-power) 10%, transparent)",
    label: "Power",
    icon: Zap,
  },
  control: {
    color: "var(--domain-control)",
    bgColor: "color-mix(in srgb, var(--domain-control) 10%, transparent)",
    label: "Control",
    icon: Target,
  },
  timing: {
    color: "var(--domain-timing)",
    bgColor: "color-mix(in srgb, var(--domain-timing) 10%, transparent)",
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
