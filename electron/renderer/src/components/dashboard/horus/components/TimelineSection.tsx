/**
 * TimelineSection - A section in the timeline with colored indicator dot
 * Creates the vertical timeline effect from the concept design.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface TimelineSectionProps {
  color: "coral" | "green" | "amber" | "blue" | "purple";
  title: ReactNode;
  children: ReactNode;
  rightContent?: ReactNode;
  leftIndicator?: ReactNode;
  isFirst?: boolean;
  isLast?: boolean;
  className?: string;
}

const colorConfig = {
  coral: {
    dot: "bg-tropx-vibrant",
    line: "bg-tropx-vibrant/30",
  },
  green: {
    dot: "bg-[var(--tropx-success-text)]",
    line: "bg-[var(--tropx-success-text)]/30",
  },
  amber: {
    dot: "bg-[var(--tropx-warning-text)]",
    line: "bg-[var(--tropx-warning-text)]/30",
  },
  blue: {
    dot: "bg-[var(--tropx-info-text)]",
    line: "bg-[var(--tropx-info-text)]/30",
  },
  purple: {
    dot: "bg-[var(--leg-purple-band)]",
    line: "bg-[var(--leg-purple-band)]/30",
  },
};

export function TimelineSection({
  color,
  title,
  children,
  rightContent,
  leftIndicator,
  isFirst,
  isLast,
  className,
}: TimelineSectionProps) {
  const { dot, line } = colorConfig[color];

  return (
    <div className={cn("relative flex gap-4", className)}>
      {/* Timeline indicator */}
      <div className="flex flex-col items-center pt-1.5">
        {/* Dot */}
        <div className={cn("size-2.5 rounded-full shrink-0 z-10", dot)} />
        {/* Line */}
        {!isLast && (
          <div className={cn("w-0.5 flex-1 mt-1.5 -mb-1.5", line)} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-6 min-w-0">
        <div className="flex items-start justify-between gap-4">
          {/* Left side: Optional indicator + main content */}
          <div className="flex gap-4 flex-1 min-w-0">
            {leftIndicator && (
              <div className="shrink-0">{leftIndicator}</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="mb-2">{title}</div>
              {children}
            </div>
          </div>

          {/* Right side: Optional content (chart, score, etc.) */}
          {rightContent && (
            <div className="shrink-0">{rightContent}</div>
          )}
        </div>
      </div>
    </div>
  );
}
