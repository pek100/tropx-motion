/**
 * SessionCard - Compact session card for carousel display.
 */

import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/utils";
import { Dumbbell, Footprints, Activity, Shuffle, HelpCircle } from "lucide-react";
import type { MovementType } from "./MetricsTable";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SessionData {
  sessionId: string;
  recordedAt: number;
  tags: string[];
  opiScore: number;
  opiGrade: string;
  movementType: MovementType;
  /** Full metrics for chart display */
  metrics?: Record<string, number | undefined>;
}

interface SessionCardProps {
  session: SessionData;
  isActive?: boolean;
  isLatest?: boolean;
  onClick?: () => void;
  className?: string;
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
}: SessionCardProps) {
  const config = MOVEMENT_CONFIG[session.movementType] || MOVEMENT_CONFIG.unknown;
  const Icon = config.icon;
  const title = session.tags[0] || "Untitled";
  const gradeColor = GRADE_COLORS[session.opiGrade] || "text-[var(--tropx-dark)]";

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full p-4 rounded-xl border-2 bg-[var(--tropx-card)] text-left",
        "transition-all duration-200",
        "group overflow-hidden",
        isActive
          ? "border-[var(--tropx-vibrant)] shadow-sm"
          : "border-[var(--tropx-border)] hover:border-[var(--tropx-vibrant)]/30 scale-[0.97] opacity-80 hover:opacity-100",
        className
      )}
    >
      {/* Background accent */}
      <div
        className={cn(
          "absolute -right-4 -top-4 size-20 rounded-full",
          "bg-[var(--tropx-vibrant)]/5",
          "group-hover:scale-110 transition-transform duration-500"
        )}
      />

      {/* Content */}
      <div className="relative flex flex-col h-full justify-between">
        {/* Header */}
        <div className="flex justify-between items-start">
          {isLatest ? (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--tropx-vibrant)] text-white">
              LATEST
            </span>
          ) : (
            <span className="text-[10px] font-semibold text-[var(--tropx-text-sub)] uppercase">
              {getDateLabel(session.recordedAt)}
            </span>
          )}
          <span className="text-[10px] text-[var(--tropx-text-sub)]">
            {formatTime(session.recordedAt)}
          </span>
        </div>

        {/* Exercise info */}
        <div className="mt-2 flex items-center gap-1.5">
          <Icon className="size-4 text-[var(--tropx-vibrant)]" />
          <h4 className="font-bold text-[var(--tropx-text-main)] leading-tight truncate">
            {title}
          </h4>
        </div>
        <p className="text-[10px] text-[var(--tropx-text-sub)]">{config.label}</p>

        {/* OPI + Grade */}
        <div className="mt-3 pt-3 border-t border-dashed border-[var(--tropx-border)] flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] text-[var(--tropx-text-sub)] uppercase">
              OPI
            </span>
            <span
              className={cn(
                "text-xl font-bold",
                isLatest ? "text-[var(--tropx-vibrant)]" : "text-[var(--tropx-text-main)]"
              )}
            >
              {Math.round(session.opiScore)}
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-[var(--tropx-text-sub)] uppercase">
              Grade
            </span>
            <span className={cn("text-lg font-bold", gradeColor)}>
              {session.opiGrade}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

export default SessionCard;
