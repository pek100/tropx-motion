/**
 * DetectedExerciseCard - Displays detected movement type and relevant metrics info.
 */

import { cn } from "@/lib/utils";
import { Activity, Footprints, Dumbbell, HelpCircle, Shuffle } from "lucide-react";
import type { MovementType } from "./MetricsTable";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface DetectedExerciseCardProps {
  movementType: MovementType;
  confidence?: number;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Movement Type Configurations
// ─────────────────────────────────────────────────────────────────

const MOVEMENT_CONFIG: Record<MovementType, {
  label: string;
  description: string;
  examples: string;
  icon: typeof Activity;
  color: string;
  bgColor: string;
}> = {
  bilateral: {
    label: "Bilateral",
    description: "Both legs move together in sync",
    examples: "Squats, Jumps, Box Jumps",
    icon: Dumbbell,
    color: "text-violet-600",
    bgColor: "bg-violet-100",
  },
  unilateral: {
    label: "Unilateral",
    description: "Legs move alternately (anti-phase)",
    examples: "Walking, Running, Lunges",
    icon: Footprints,
    color: "text-emerald-600",
    bgColor: "bg-emerald-100",
  },
  single_leg: {
    label: "Single Leg",
    description: "One leg active, other stationary",
    examples: "Single-leg hops, Balance exercises",
    icon: Activity,
    color: "text-amber-600",
    bgColor: "bg-amber-100",
  },
  mixed: {
    label: "Mixed",
    description: "Movement pattern varies throughout",
    examples: "Complex drills, Sport-specific",
    icon: Shuffle,
    color: "text-blue-600",
    bgColor: "bg-blue-100",
  },
  unknown: {
    label: "Unknown",
    description: "Movement type not detected - try recomputing metrics",
    examples: "Older recordings may need metric recomputation",
    icon: HelpCircle,
    color: "text-gray-500",
    bgColor: "bg-gray-100",
  },
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function DetectedExerciseCard({
  movementType,
  confidence,
  className,
}: DetectedExerciseCardProps) {
  const config = MOVEMENT_CONFIG[movementType] || MOVEMENT_CONFIG.unknown;
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-4 p-4 rounded-xl border border-gray-200 bg-white",
        className
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex items-center justify-center size-12 rounded-xl",
          config.bgColor
        )}
      >
        <Icon className={cn("size-6", config.color)} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-[var(--tropx-dark)]">
            {config.label} Movement
          </h4>
          {confidence !== undefined && confidence > 0 && (
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium",
                confidence >= 80
                  ? "bg-green-100 text-green-700"
                  : confidence >= 60
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-gray-100 text-gray-600"
              )}
            >
              {Math.round(confidence)}% confidence
            </span>
          )}
        </div>
        <p className="text-sm text-[var(--tropx-shadow)]">
          {config.description}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          Examples: {config.examples}
        </p>
      </div>

      {/* Metrics Info Badge */}
      <div className="text-right">
        <p className="text-xs text-[var(--tropx-shadow)]">Relevant metrics</p>
        <p className="text-sm font-medium text-[var(--tropx-dark)]">
          {movementType === "bilateral" && "15 metrics"}
          {movementType === "unilateral" && "12 metrics"}
          {movementType === "single_leg" && "12 metrics"}
          {movementType === "mixed" && "15 metrics"}
          {movementType === "unknown" && "15 metrics"}
        </p>
      </div>
    </div>
  );
}

export default DetectedExerciseCard;
