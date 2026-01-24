/**
 * EvidenceTierBadge Primitive
 *
 * Badge indicating evidence quality tier (S/A/B/C/D).
 * Uses warm tones for high quality, cool tones for lower tiers.
 */

import { cn } from "@/lib/utils";
import { Award, FileCheck, BookOpen, FileText, File } from "lucide-react";

export type EvidenceTier = "S" | "A" | "B" | "C" | "D";

interface EvidenceTierBadgeProps {
  tier: EvidenceTier;
  showLabel?: boolean;
  showIcon?: boolean;
  size?: "sm" | "md";
  className?: string;
}

const tierConfig: Record<
  EvidenceTier,
  {
    label: string;
    description: string;
    icon: typeof Award;
  }
> = {
  S: {
    label: "Systematic Review",
    description: "Meta-analysis or systematic review",
    icon: Award,
  },
  A: {
    label: "RCT",
    description: "Randomized controlled trial",
    icon: FileCheck,
  },
  B: {
    label: "Peer-Reviewed",
    description: "Peer-reviewed research",
    icon: BookOpen,
  },
  C: {
    label: "Clinical",
    description: "Professional/clinical source",
    icon: FileText,
  },
  D: {
    label: "General",
    description: "General or educational source",
    icon: File,
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

export function EvidenceTierBadge({
  tier,
  showLabel = false,
  showIcon = true,
  size = "sm",
  className,
}: EvidenceTierBadgeProps) {
  const config = tierConfig[tier];
  const sizes = sizeStyles[size];
  const Icon = config.icon;

  const tierLower = tier.toLowerCase();

  return (
    <span
      className={cn(
        "inline-flex items-center font-semibold rounded-full",
        sizes.badge,
        (showIcon || showLabel) && sizes.gap,
        className
      )}
      style={{
        backgroundColor: `var(--evidence-tier-${tierLower}-bg)`,
        color: `var(--evidence-tier-${tierLower})`,
      }}
      title={config.description}
    >
      {showIcon && <Icon className={sizes.icon} aria-hidden="true" />}
      <span>{showLabel ? config.label : tier}</span>
      <span className="sr-only">Evidence quality: {config.label}</span>
    </span>
  );
}
