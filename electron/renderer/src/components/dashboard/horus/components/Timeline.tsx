/**
 * Timeline Component
 *
 * Beautiful vertical timeline based on Origin UI pattern.
 * Adapted for TropX theme tokens.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Timeline Context
// ─────────────────────────────────────────────────────────────────

interface TimelineContextValue {
  activeStep: number;
}

const TimelineContext = React.createContext<TimelineContextValue>({
  activeStep: 0,
});

// ─────────────────────────────────────────────────────────────────
// Timeline Root
// ─────────────────────────────────────────────────────────────────

interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  children: React.ReactNode;
  defaultValue?: number;
}

export function Timeline({
  children,
  defaultValue = 1,
  className,
  ...props
}: TimelineProps) {
  return (
    <TimelineContext.Provider value={{ activeStep: defaultValue }}>
      <ol
        className={cn("flex flex-col", className)}
        {...props}
      >
        {children}
      </ol>
    </TimelineContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Item
// ─────────────────────────────────────────────────────────────────

interface TimelineItemProps extends React.HTMLAttributes<HTMLLIElement> {
  children: React.ReactNode;
  step: number;
  status?: "completed" | "active" | "upcoming" | "warning" | "error";
}

export function TimelineItem({
  children,
  step,
  status,
  className,
  ...props
}: TimelineItemProps) {
  const { activeStep } = React.useContext(TimelineContext);

  // Determine status based on step if not explicitly provided
  const computedStatus = status ?? (
    step < activeStep ? "completed" :
    step === activeStep ? "active" : "upcoming"
  );

  return (
    <li
      data-step={step}
      data-status={computedStatus}
      className={cn(
        "group/timeline-item relative pl-8",
        className
      )}
      {...props}
    >
      {children}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Header
// ─────────────────────────────────────────────────────────────────

interface TimelineHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function TimelineHeader({ children, className, ...props }: TimelineHeaderProps) {
  return (
    <div className={cn("flex items-center gap-2 min-h-6", className)} {...props}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Separator (the connecting line)
// ─────────────────────────────────────────────────────────────────

interface TimelineSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {}

export function TimelineSeparator({ className, ...props }: TimelineSeparatorProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // Position: centered under indicator, runs to bottom
        "absolute left-[11px] top-6 bottom-0 w-0.5",
        // Default color
        "bg-[var(--tropx-border)]",
        // Status-based colors
        "group-data-[status=completed]/timeline-item:bg-[var(--tropx-success-text)]/40",
        "group-data-[status=active]/timeline-item:bg-tropx-vibrant/40",
        "group-data-[status=warning]/timeline-item:bg-[var(--tropx-warning-text)]/40",
        "group-data-[status=error]/timeline-item:bg-destructive/40",
        // Hide on last item
        "last:group-[]/timeline-item:hidden",
        "group-last/timeline-item:hidden",
        className
      )}
      {...props}
    />
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Indicator (the dot/icon container)
// ─────────────────────────────────────────────────────────────────

interface TimelineIndicatorProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function TimelineIndicator({ children, className, ...props }: TimelineIndicatorProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        // Position at left edge of padding, vertically at top
        "absolute left-0 top-0 flex items-center justify-center",
        "size-6 rounded-full border-2",
        // Default state
        "border-[var(--tropx-border)] bg-[var(--tropx-card)] text-[var(--tropx-text-sub)]",
        // Completed state
        "group-data-[status=completed]/timeline-item:border-[var(--tropx-success-text)] group-data-[status=completed]/timeline-item:bg-[var(--tropx-success-text)]/10 group-data-[status=completed]/timeline-item:text-[var(--tropx-success-text)]",
        // Active state
        "group-data-[status=active]/timeline-item:border-tropx-vibrant group-data-[status=active]/timeline-item:bg-tropx-vibrant/10 group-data-[status=active]/timeline-item:text-tropx-vibrant",
        // Warning state
        "group-data-[status=warning]/timeline-item:border-[var(--tropx-warning-text)] group-data-[status=warning]/timeline-item:bg-[var(--tropx-warning-text)]/10 group-data-[status=warning]/timeline-item:text-[var(--tropx-warning-text)]",
        // Error state
        "group-data-[status=error]/timeline-item:border-destructive group-data-[status=error]/timeline-item:bg-destructive/10 group-data-[status=error]/timeline-item:text-destructive",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Title
// ─────────────────────────────────────────────────────────────────

interface TimelineTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  children: React.ReactNode;
}

export function TimelineTitle({ children, className, ...props }: TimelineTitleProps) {
  return (
    <h3
      className={cn("text-sm font-semibold text-[var(--tropx-text-main)]", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Content
// ─────────────────────────────────────────────────────────────────

interface TimelineContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function TimelineContent({ children, className, ...props }: TimelineContentProps) {
  return (
    <div className={cn("mt-1.5 pb-6 text-sm text-[var(--tropx-text-sub)]", className)} {...props}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timeline Date
// ─────────────────────────────────────────────────────────────────

interface TimelineDateProps extends React.HTMLAttributes<HTMLTimeElement> {
  children: React.ReactNode;
}

export function TimelineDate({ children, className, ...props }: TimelineDateProps) {
  return (
    <time
      className={cn("block text-xs text-[var(--tropx-text-sub)] mt-1.5", className)}
      {...props}
    >
      {children}
    </time>
  );
}

// ─────────────────────────────────────────────────────────────────
// Re-export old names for backward compatibility during transition
// ─────────────────────────────────────────────────────────────────

export const TimelineTime = TimelineDate;
export const TimelineDescription = TimelineContent;
