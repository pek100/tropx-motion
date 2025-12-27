/**
 * LimbBadge Primitive
 *
 * Badge indicating Left Leg or Right Leg.
 * Uses leg-specific CSS variables for consistent theming.
 * Enforces explicit limb naming per Horus system requirements.
 */

import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type Limb = "Left Leg" | "Right Leg";

interface LimbBadgeProps {
  limb: Limb;
  /** Size variant */
  size?: "sm" | "md";
  /** Show as outline only (lighter) */
  variant?: "solid" | "outline";
  /** Additional className */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────

const limbStyles: Record<
  Limb,
  { solid: { bg: string; text: string }; outline: { border: string; text: string }; label: string }
> = {
  "Left Leg": {
    solid: {
      bg: "bg-[var(--leg-left-fill)]",
      text: "text-[var(--leg-left-band)]",
    },
    outline: {
      border: "border-[var(--leg-left-band)]",
      text: "text-[var(--leg-left-band)]",
    },
    label: "Left Leg",
  },
  "Right Leg": {
    solid: {
      bg: "bg-[var(--leg-right-fill)]",
      text: "text-[var(--leg-right-band)]",
    },
    outline: {
      border: "border-[var(--leg-right-band)]",
      text: "text-[var(--leg-right-band)]",
    },
    label: "Right Leg",
  },
};

const sizeStyles = {
  sm: "px-1.5 py-0.5 text-[10px]",
  md: "px-2 py-1 text-xs",
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function LimbBadge({
  limb,
  size = "sm",
  variant = "solid",
  className,
}: LimbBadgeProps) {
  const styles = limbStyles[limb];
  const variantStyles = styles[variant];

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium rounded-full whitespace-nowrap",
        sizeStyles[size],
        variant === "solid"
          ? cn(variantStyles.bg, variantStyles.text, "bg-opacity-30")
          : cn("bg-transparent border", variantStyles.border, variantStyles.text),
        className
      )}
    >
      {styles.label}
    </span>
  );
}
