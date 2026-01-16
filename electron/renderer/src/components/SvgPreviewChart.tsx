/**
 * SvgPreviewChart - Lightweight preview chart using pre-computed SVG paths.
 * Used for tooltips, load modal previews, session cards, etc.
 * No client-side computation - paths are pre-rendered server-side.
 */

import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** SVG paths for all 3 axes (normalized 0-100 coordinate space) */
export interface PreviewPaths {
  x: string;
  y: string;
  z: string;
}

interface SvgPreviewChartProps {
  leftPaths?: PreviewPaths | null;
  rightPaths?: PreviewPaths | null;
  axis?: "x" | "y" | "z";
  height?: number;
  isLoading?: boolean;
  className?: string;
  /** Show legend below chart */
  showLegend?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

// Use CSS variables for knee colors (single source of truth in globals.css)
const LEFT_KNEE_COLOR = "var(--leg-left-band)";
const RIGHT_KNEE_COLOR = "var(--leg-right-band)";

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function SvgPreviewChart({
  leftPaths,
  rightPaths,
  axis = "y",
  height = 48,
  isLoading = false,
  className,
  showLegend = false,
}: SvgPreviewChartProps) {
  const leftPath = leftPaths?.[axis];
  const rightPath = rightPaths?.[axis];

  // Calculate total height including legend and padding for consistency
  const legendHeight = showLegend ? 16 : 0; // ~16px for legend row
  const padding = 12; // p-1.5 = 6px * 2
  const totalHeight = height + legendHeight + padding;

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          "bg-[var(--tropx-muted)] rounded-lg border border-[var(--tropx-border)] overflow-hidden animate-pulse",
          className
        )}
        style={{ height: totalHeight }}
      >
        <div className="w-full h-full bg-gradient-to-r from-[var(--tropx-muted)] via-[var(--tropx-card)] to-[var(--tropx-muted)]" />
      </div>
    );
  }

  // No data state
  if (!leftPath && !rightPath) {
    return (
      <div
        className={cn(
          "bg-[var(--tropx-muted)] rounded-lg border border-[var(--tropx-border)] overflow-hidden flex items-center justify-center",
          className
        )}
        style={{ height: totalHeight }}
      >
        <span className="text-xs text-[var(--tropx-text-sub)]">No preview</span>
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-lg bg-[var(--tropx-muted)] p-1.5", className)}
      style={{ height: totalHeight }}
    >
      <svg
        width="100%"
        height={height}
        className="block"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {/* Grid line */}
        <line
          x1={0}
          y1={50}
          x2={100}
          y2={50}
          stroke="var(--tropx-border)"
          strokeWidth={1}
          strokeDasharray="4,4"
          vectorEffect="non-scaling-stroke"
        />

        {/* Left knee path */}
        {leftPath && (
          <path
            d={leftPath}
            fill="none"
            stroke={LEFT_KNEE_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Right knee path */}
        {rightPath && (
          <path
            d={rightPath}
            fill="none"
            stroke={RIGHT_KNEE_COLOR}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Legend */}
      {showLegend && (
        <div className="flex justify-center gap-3 mt-1 text-[9px] text-[var(--tropx-text-sub)]">
          <span className="flex items-center gap-1">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: LEFT_KNEE_COLOR }}
            />
            Left
          </span>
          <span className="flex items-center gap-1">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: RIGHT_KNEE_COLOR }}
            />
            Right
          </span>
        </div>
      )}
    </div>
  );
}

export default SvgPreviewChart;
