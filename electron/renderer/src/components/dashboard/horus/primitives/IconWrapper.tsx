/**
 * IconWrapper Primitive
 *
 * Standardized icon sizing across all Horus components.
 * Ensures consistent icon dimensions: sm=h-4, md=h-5, lg=h-6.
 */

import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type IconSize = "sm" | "md" | "lg";

interface IconWrapperProps {
  /** The Lucide icon component */
  icon: LucideIcon;
  /** Size variant */
  size?: IconSize;
  /** Color className (e.g., "text-[var(--tropx-success-text)]") */
  colorClassName?: string;
  /** Additional className */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Size Mapping
// ─────────────────────────────────────────────────────────────────

const sizeClasses: Record<IconSize, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function IconWrapper({
  icon: Icon,
  size = "md",
  colorClassName,
  className,
}: IconWrapperProps) {
  return (
    <Icon
      className={cn(
        sizeClasses[size],
        colorClassName,
        className
      )}
    />
  );
}

// ─────────────────────────────────────────────────────────────────
// Helper: Get size class string (for direct usage)
// ─────────────────────────────────────────────────────────────────

export function getIconSizeClass(size: IconSize = "md"): string {
  return sizeClasses[size];
}
