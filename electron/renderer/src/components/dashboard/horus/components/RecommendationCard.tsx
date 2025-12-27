/**
 * RecommendationCard - Card for recommended next steps
 * Two-column layout with icon, title, and description.
 * Uses TropX gradient patterns for beautiful backgrounds.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface RecommendationCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  color?: "coral" | "blue" | "green" | "amber" | "purple";
  className?: string;
}

const colorConfig = {
  coral: {
    gradient: "gradient-coral-card",
    icon: "text-tropx-vibrant",
    iconBg: "bg-tropx-vibrant/10",
    border: "border-tropx-vibrant/20",
  },
  blue: {
    gradient: "gradient-info-card",
    icon: "text-[var(--tropx-info-text)]",
    iconBg: "bg-[var(--tropx-info-text)]/10",
    border: "border-[var(--tropx-info-text)]/20",
  },
  green: {
    gradient: "gradient-green-card",
    icon: "text-[var(--tropx-success-text)]",
    iconBg: "bg-[var(--tropx-success-text)]/10",
    border: "border-[var(--tropx-success-text)]/20",
  },
  amber: {
    gradient: "gradient-amber-card",
    icon: "text-[var(--tropx-warning-text)]",
    iconBg: "bg-[var(--tropx-warning-text)]/10",
    border: "border-[var(--tropx-warning-text)]/20",
  },
  purple: {
    gradient: "gradient-purple-card",
    icon: "text-[var(--leg-purple-band)]",
    iconBg: "bg-[var(--leg-purple-band)]/10",
    border: "border-[var(--leg-purple-band)]/20",
  },
};

export function RecommendationCard({
  icon,
  title,
  description,
  color = "coral",
  className,
}: RecommendationCardProps) {
  const { gradient, icon: iconColor, iconBg, border } = colorConfig[color];

  return (
    <div
      className={cn(
        "flex gap-3 p-3 rounded-lg border",
        gradient,
        border,
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center size-8 rounded-full shrink-0",
          iconBg,
          iconColor
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-[var(--tropx-text-main)]">{title}</h4>
        <p className="text-xs text-[var(--tropx-text-sub)] mt-0.5">{description}</p>
      </div>
    </div>
  );
}
