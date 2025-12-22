/**
 * SessionCard - Compact session card for carousel display.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/utils";
import { Dumbbell, Footprints, Activity, Shuffle, HelpCircle, RefreshCw, Loader2 } from "lucide-react";
import type { MovementType } from "./MetricsTable";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** SVG paths for all 3 axes (normalized 0-100 coordinate space) */
export interface PreviewPaths {
  x: string;
  y: string;
  z: string;
}

export interface SessionData {
  sessionId: string;
  recordedAt: number;
  tags: string[];
  opiScore: number;
  opiGrade: string;
  movementType: MovementType;
  /** Full metrics for chart display */
  metrics?: Record<string, number | undefined>;
  /** Preview SVG paths for mini chart (all 3 axes) */
  previewLeftPaths?: PreviewPaths | null;
  previewRightPaths?: PreviewPaths | null;
}

interface SessionCardProps {
  session: SessionData;
  isActive?: boolean;
  isLatest?: boolean;
  onClick?: () => void;
  className?: string;
  /** Callback to trigger metrics recomputation */
  onRecomputeMetrics?: () => void;
  /** Whether recomputation is in progress */
  isRecomputing?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Movement Config
// ─────────────────────────────────────────────────────────────────

const MOVEMENT_CONFIG: Record<
  MovementType,
  { label: string; icon: typeof Activity }
> = {
  bilateral: { label: "Bilateral", icon: Dumbbell },
  unilateral: { label: "Unilateral", icon: Footprints },
  single_leg: { label: "Single Leg", icon: Activity },
  mixed: { label: "Mixed", icon: Shuffle },
  unknown: { label: "Unknown", icon: HelpCircle },
};

const GRADE_COLORS: Record<string, string> = {
  A: "text-[var(--tropx-green)]",
  B: "text-blue-500",
  C: "text-yellow-500",
  D: "text-orange-500",
  F: "text-[var(--tropx-red)]",
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Format relative date label (Today, Yesterday, or date) */
function getDateLabel(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return formatDate(timestamp);
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function SessionCard({
  session,
  isActive,
  isLatest,
  onClick,
  className,
  onRecomputeMetrics,
  isRecomputing,
}: SessionCardProps) {
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  const config = MOVEMENT_CONFIG[session.movementType] || MOVEMENT_CONFIG.unknown;
  const Icon = config.icon;
  const title = session.tags[0] || "Untitled";
  const gradeColor = GRADE_COLORS[session.opiGrade] || "text-[var(--tropx-dark)]";

  // Handle recompute button click (stop propagation to prevent card selection)
  const handleRecomputeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRegenConfirm(true);
  };

  // Handle confirm recompute
  const handleConfirmRecompute = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRecomputeMetrics?.();
    setShowRegenConfirm(false);
  };

  // Handle cancel
  const handleCancelRecompute = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowRegenConfirm(false);
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full p-2 sm:p-4 rounded-lg sm:rounded-xl border-2 bg-[var(--tropx-card)] text-left",
        "transition-all duration-200",
        "group overflow-hidden",
        isActive
          ? "border-[var(--tropx-vibrant)] shadow-sm"
          : "border-[var(--tropx-border)] hover:border-[var(--tropx-vibrant)]/30 scale-[0.97] opacity-80 hover:opacity-100",
        className
      )}
    >
      {/* Background accent - hidden on mobile */}
      <div
        className={cn(
          "absolute -right-4 -top-4 size-16 sm:size-20 rounded-full",
          "bg-[var(--tropx-vibrant)]/5",
          "group-hover:scale-110 transition-transform duration-500",
          "hidden sm:block"
        )}
      />

      {/* Content */}
      <div className="relative flex flex-col h-full justify-between gap-1 sm:gap-0">
        {/* Header - compact on mobile */}
        <div className="flex justify-between items-start">
          {isLatest ? (
            <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold bg-[var(--tropx-vibrant)] text-white">
              NEW
            </span>
          ) : (
            <span className="text-[8px] sm:text-[10px] font-semibold text-[var(--tropx-text-sub)] uppercase truncate">
              {getDateLabel(session.recordedAt)}
            </span>
          )}
          <span className="text-[8px] sm:text-[10px] text-[var(--tropx-text-sub)] hidden sm:inline">
            {formatTime(session.recordedAt)}
          </span>
        </div>

        {/* Exercise info - compact on mobile */}
        <div className="sm:mt-2 flex items-center gap-1 sm:gap-1.5">
          <Icon className="size-3 sm:size-4 text-[var(--tropx-vibrant)] flex-shrink-0" />
          <h4 className="font-bold text-[10px] sm:text-sm text-[var(--tropx-text-main)] leading-tight truncate">
            {title}
          </h4>
        </div>
        <p className="text-[8px] sm:text-[10px] text-[var(--tropx-text-sub)] hidden sm:block">{config.label}</p>

        {/* OPI + Grade - inline on mobile, stacked on desktop */}
        <div className="sm:mt-3 sm:pt-3 sm:border-t sm:border-dashed sm:border-[var(--tropx-border)] flex items-center justify-between">
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Recompute button - only visible on active card */}
            {isActive && onRecomputeMetrics && !showRegenConfirm && (
              <div
                onClick={handleRecomputeClick}
                className={cn(
                  "size-5 sm:size-6 flex items-center justify-center rounded-full",
                  "bg-[var(--tropx-muted)] border border-[var(--tropx-border)]",
                  "text-[var(--tropx-shadow)] hover:text-[var(--tropx-vibrant)] hover:border-[var(--tropx-vibrant)]",
                  "transition-colors",
                  isRecomputing && "pointer-events-none"
                )}
                title="Recompute metrics"
              >
                {isRecomputing ? (
                  <Loader2 className="size-2.5 sm:size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-2.5 sm:size-3" />
                )}
              </div>
            )}
            <div className="flex items-center sm:flex-col gap-1 sm:gap-0">
              <span className="text-[8px] sm:text-[10px] text-[var(--tropx-text-sub)] uppercase hidden sm:inline">
                OPI
              </span>
              <span
                className={cn(
                  "text-sm sm:text-xl font-bold",
                  isLatest ? "text-[var(--tropx-vibrant)]" : "text-[var(--tropx-text-main)]"
                )}
              >
                {Math.round(session.opiScore)}
              </span>
            </div>
          </div>
          <div className="flex items-center sm:flex-col sm:items-end gap-0.5 sm:gap-0">
            <span className={cn("text-sm sm:text-lg font-bold", gradeColor)}>
              {session.opiGrade}
            </span>
          </div>
        </div>

        {/* Recompute confirmation overlay */}
        {showRegenConfirm && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center p-2 sm:p-3 rounded-lg sm:rounded-xl bg-[var(--tropx-card)] z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] sm:text-xs text-[var(--tropx-text-main)] text-center mb-2 sm:mb-3">
              Recompute metrics?
            </p>
            <div className="flex gap-1.5 sm:gap-2 w-full">
              <button
                onClick={handleCancelRecompute}
                className="flex-1 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-[var(--tropx-text-main)] bg-[var(--tropx-muted)] border border-[var(--tropx-border)] rounded-md sm:rounded-lg hover:bg-[var(--tropx-hover)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRecompute}
                disabled={isRecomputing}
                className="flex-1 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white bg-[var(--tropx-vibrant)] rounded-md sm:rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1 transition-colors"
              >
                {isRecomputing ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                <span className="hidden sm:inline">Confirm</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

export default SessionCard;
