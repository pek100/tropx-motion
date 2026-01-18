/**
 * SessionCard - Compact session card for carousel display.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/utils";
import { Dumbbell, Footprints, Activity, Shuffle, HelpCircle, RefreshCw, Loader2, Pencil, Trash2, Filter } from "lucide-react";
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
  title?: string;
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
  /** Callback when edit button is clicked */
  onEdit?: () => void;
  /** Callback when delete button is clicked */
  onDelete?: () => void;
  /** Whether delete is in progress */
  isDeleting?: boolean;
  /** Whether this card matches the active tag filter */
  isMatchingFilter?: boolean;
  /** Callback to apply all tags from this session to the filter */
  onApplyAllTags?: () => void;
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
  onEdit,
  onDelete,
  isDeleting,
  isMatchingFilter,
  onApplyAllTags,
}: SessionCardProps) {
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const config = MOVEMENT_CONFIG[session.movementType] || MOVEMENT_CONFIG.unknown;
  const Icon = config.icon;
  const title = session.title || "Untitled";
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

  // Handle edit button click
  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  };

  // Handle delete button click
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  // Handle confirm delete
  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
    setShowDeleteConfirm(false);
  };

  // Handle cancel delete
  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full p-2 sm:p-4 rounded-lg sm:rounded-xl border-2 text-left",
        "transition-all duration-200",
        "group overflow-hidden",
        // Background: subtle gradient when matching filter, card bg otherwise
        isMatchingFilter
          ? "gradient-diagonal-subtle"
          : "bg-[var(--tropx-card)]",
        isActive
          ? "border-[var(--tropx-vibrant)] shadow-sm"
          : "border-[var(--tropx-border)] hover:border-[var(--tropx-vibrant)]/30 scale-[0.97] opacity-80 hover:opacity-100",
        className
      )}
    >
      {/* Filter badge and apply all tags button */}
      {isMatchingFilter && (
        <div
          className={cn(
            "absolute right-1 sm:right-2 bottom-[52px] sm:bottom-[72px] z-10",
            "flex items-center gap-0.5"
          )}
        >
          {/* Filter icon */}
          <div
            className={cn(
              "size-4 sm:size-5 rounded-full",
              "bg-[var(--tropx-vibrant)]/20 backdrop-blur-sm",
              "flex items-center justify-center"
            )}
          >
            <Filter className="size-2 sm:size-2.5 text-[var(--tropx-vibrant)]" fill="currentColor" />
          </div>
          {/* Apply all tags button - only on active card with multiple tags */}
          {isActive && session.tags.length > 1 && onApplyAllTags && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onApplyAllTags();
              }}
              className={cn(
                "h-4 sm:h-5 px-1.5 rounded",
                "bg-[var(--tropx-vibrant)]/10 border border-[var(--tropx-vibrant)]/40",
                "flex items-center justify-center gap-0.5",
                "hover:bg-[var(--tropx-vibrant)]/30 hover:border-[var(--tropx-vibrant)] active:scale-95",
                "transition-all duration-150"
              )}
              title="Apply all tags to filter"
            >
              <Filter className="size-2 sm:size-2.5 text-[var(--tropx-vibrant)]" />
              <span className="text-[8px] sm:text-[9px] font-bold text-[var(--tropx-vibrant)]">+{session.tags.length - 1}</span>
            </button>
          )}
        </div>
      )}

      {/* Background accent - hidden on mobile */}
      <div
        className={cn(
          "absolute -right-4 -top-4 size-16 sm:size-20 rounded-full",
          "bg-[var(--tropx-vibrant)]/5",
          "group-hover:scale-110 transition-transform duration-500",
          "hidden sm:block"
        )}
      />

      {/* Edit/Delete buttons - only visible when active */}
      {isActive && (onEdit || onDelete) && !showDeleteConfirm && !showRegenConfirm && (
        <div className="absolute top-1 right-1 sm:top-2 sm:right-2 flex items-center gap-0.5 z-10">
          {onEdit && (
            <div
              onClick={handleEditClick}
              className={cn(
                "size-5 sm:size-6 flex items-center justify-center rounded-full",
                "bg-[var(--tropx-card)]/90 backdrop-blur-sm border border-[var(--tropx-border)]",
                "text-[var(--tropx-shadow)] hover:text-[var(--tropx-vibrant)] hover:border-[var(--tropx-vibrant)]",
                "transition-colors cursor-pointer"
              )}
              title="Edit session"
            >
              <Pencil className="size-2.5 sm:size-3" />
            </div>
          )}
          {onDelete && (
            <div
              onClick={handleDeleteClick}
              className={cn(
                "size-5 sm:size-6 flex items-center justify-center rounded-full",
                "bg-[var(--tropx-card)]/90 backdrop-blur-sm border border-[var(--tropx-border)]",
                "text-[var(--tropx-shadow)] hover:text-red-500 hover:border-red-300 dark:hover:border-red-700",
                "transition-colors cursor-pointer",
                isDeleting && "pointer-events-none opacity-50"
              )}
              title="Delete session"
            >
              {isDeleting ? (
                <Loader2 className="size-2.5 sm:size-3 animate-spin" />
              ) : (
                <Trash2 className="size-2.5 sm:size-3" />
              )}
            </div>
          )}
        </div>
      )}

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
          {/* Time - positioned differently when active with buttons */}
          <span className={cn(
            "text-[8px] sm:text-[10px] text-[var(--tropx-text-sub)] hidden sm:inline",
            isActive && (onEdit || onDelete) && "absolute right-0 top-5"
          )}>
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
        <div className="sm:mt-3 sm:pt-3 sm:border-t sm:border-dashed border-[var(--tropx-shadow)]/30 dark:border-[var(--tropx-border)] flex items-center justify-between">
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

      </div>

      {/* Recompute confirmation overlay - full card */}
      {showRegenConfirm && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-3 sm:p-4 rounded-lg sm:rounded-xl bg-[var(--tropx-card)] z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] sm:text-xs text-[var(--tropx-text-main)] text-center mb-2 sm:mb-3">
            Recompute metrics?
          </p>
          <div className="flex gap-1.5 sm:gap-2 w-full max-w-[200px]">
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

      {/* Delete confirmation overlay - full card */}
      {showDeleteConfirm && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center p-3 sm:p-4 rounded-lg sm:rounded-xl bg-red-50 dark:bg-red-950 z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] sm:text-xs text-red-700 dark:text-red-400 text-center mb-2 sm:mb-3">
            Delete this session?
          </p>
          <div className="flex gap-1.5 sm:gap-2 w-full max-w-[200px]">
            <button
              onClick={handleCancelDelete}
              className="flex-1 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-[var(--tropx-text-main)] bg-white dark:bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-md sm:rounded-lg hover:bg-[var(--tropx-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="flex-1 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white bg-red-500 rounded-md sm:rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1 transition-colors"
            >
              {isDeleting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Trash2 className="size-3" />
              )}
              <span className="hidden sm:inline">Delete</span>
            </button>
          </div>
        </div>
      )}
    </button>
  );
}

export default SessionCard;
