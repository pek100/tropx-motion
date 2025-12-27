/**
 * ProgressCard Block
 *
 * Milestone or target progress indicator.
 * Uses TropX theme tokens for consistent styling.
 */

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import * as Icons from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LucideIconName } from "../types";

interface ProgressCardProps {
  title: string;
  description: string;
  current: number;
  target: number;
  unit?: string;
  icon?: LucideIconName;
  celebrationLevel?: "major" | "minor";
  className?: string;
}

export function ProgressCard({
  title,
  description,
  current,
  target,
  unit = "",
  icon,
  celebrationLevel,
  className,
}: ProgressCardProps) {
  const percentage = target > 0 ? Math.min((current / target) * 100, 100) : 0;
  const isComplete = percentage >= 100;

  // Get icon component
  const iconName = icon || (isComplete ? "Trophy" : "Target");
  const IconComponent = Icons[iconName as keyof typeof Icons] as LucideIcon;

  // Celebration animation class
  const celebrationClass =
    isComplete && celebrationLevel === "major"
      ? "animate-pulse"
      : isComplete && celebrationLevel === "minor"
        ? ""
        : "";

  return (
    <Card
      className={cn(
        "py-4",
        isComplete ? "gradient-green-card border-none" : "bg-[var(--tropx-card)] border-[var(--tropx-border)]",
        className
      )}
    >
      <CardContent className="px-4 py-0">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className={cn(
              "flex-shrink-0 p-2 rounded-lg",
              isComplete
                ? "bg-white/50 dark:bg-black/20 text-[var(--tropx-success-text)]"
                : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)]",
              celebrationClass
            )}
          >
            <IconComponent className="h-5 w-5" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-sm font-semibold text-[var(--tropx-text-main)]">{title}</h4>
              <span
                className={cn(
                  "text-sm font-medium",
                  isComplete ? "text-[var(--tropx-success-text)]" : "text-[var(--tropx-text-sub)]"
                )}
              >
                {percentage.toFixed(0)}%
              </span>
            </div>

            <p className="text-xs text-[var(--tropx-text-sub)] mb-2">{description}</p>

            {/* Progress bar */}
            <Progress
              value={percentage}
              className={cn(
                "h-2",
                isComplete && "[&>div]:bg-[var(--tropx-success-text)]"
              )}
            />

            {/* Values */}
            <div className="flex justify-between mt-1 text-xs text-[var(--tropx-text-sub)]">
              <span>
                Current: {current}
                {unit}
              </span>
              <span>
                Target: {target}
                {unit}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
