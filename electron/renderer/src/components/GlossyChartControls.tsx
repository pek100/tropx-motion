"use client"

import React, { useCallback, useState } from "react"
import { Combine } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type Axis = "x" | "y" | "z";

export interface GlossyChartControlsProps {
  /** Current left knee angle value */
  leftValue?: number;
  /** Current right knee angle value */
  rightValue?: number;
  /** Whether left knee is visible */
  leftVisible: boolean;
  /** Whether right knee is visible */
  rightVisible: boolean;
  /** Toggle left knee visibility */
  onLeftToggle: () => void;
  /** Toggle right knee visibility */
  onRightToggle: () => void;
  /** Currently selected axis (single mode) */
  selectedAxis: Axis;
  /** Whether multi-axis mode is enabled */
  multiAxisMode: boolean;
  /** Selected axes in multi-mode */
  selectedAxes: Set<Axis>;
  /** Toggle an axis */
  onAxisToggle: (axis: Axis) => void;
  /** Toggle multi-axis mode */
  onMultiAxisToggle: () => void;
  /** Optional class name */
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const AXIS_COLORS = {
  x: { bg: "bg-fuchsia-500", text: "text-fuchsia-600", border: "border-fuchsia-500/50", hover: "hover:bg-fuchsia-500/20" },
  y: { bg: "bg-cyan-500", text: "text-cyan-600", border: "border-cyan-500/50", hover: "hover:bg-cyan-500/20" },
  z: { bg: "bg-violet-500", text: "text-violet-600", border: "border-violet-500/50", hover: "hover:bg-violet-500/20" },
} as const;

// ─────────────────────────────────────────────────────────────────
// Glossy Button Component
// ─────────────────────────────────────────────────────────────────

interface GlossyButtonProps {
  active: boolean;
  onClick: () => void;
  activeColor: string;
  children: React.ReactNode;
  className?: string;
  tooltip?: string;
}

function GlossyButton({ active, onClick, activeColor, children, className, tooltip }: GlossyButtonProps) {
  const button = (
    <button
      onClick={onClick}
      className={cn(
        // Base styles
        "px-3 py-1.5 rounded-full text-sm font-medium transition-all",
        "backdrop-blur-md flex items-center gap-1.5 cursor-pointer",
        "hover:scale-105 active:scale-95",
        "border shadow-lg",
        // Active/inactive styles
        active
          ? cn(activeColor, "text-white border-white/30 shadow-lg")
          : "bg-white/10 text-gray-600 dark:text-gray-300 border-white/20 hover:bg-white/20",
        className
      )}
    >
      {children}
    </button>
  );

  if (tooltip) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

// ─────────────────────────────────────────────────────────────────
// Glossy Icon Button Component (square)
// ─────────────────────────────────────────────────────────────────

interface GlossyIconButtonProps {
  active: boolean;
  onClick: () => void;
  activeColor: string;
  children: React.ReactNode;
  tooltip?: string;
}

function GlossyIconButton({ active, onClick, activeColor, children, tooltip }: GlossyIconButtonProps) {
  const button = (
    <button
      onClick={onClick}
      className={cn(
        // Base styles
        "size-8 rounded-full text-sm font-bold transition-all",
        "backdrop-blur-md flex items-center justify-center cursor-pointer",
        "hover:scale-105 active:scale-95",
        "border shadow-lg",
        // Active/inactive styles
        active
          ? cn(activeColor, "text-white border-white/30")
          : "bg-white/10 text-gray-600 dark:text-gray-300 border-white/20 hover:bg-white/20"
      )}
    >
      {children}
    </button>
  );

  if (tooltip) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function GlossyChartControls({
  leftValue,
  rightValue,
  leftVisible,
  rightVisible,
  onLeftToggle,
  onRightToggle,
  selectedAxis,
  multiAxisMode,
  selectedAxes,
  onAxisToggle,
  onMultiAxisToggle,
  className,
}: GlossyChartControlsProps) {
  // Format angle for display
  const formatAngle = (value: number | undefined) =>
    value !== undefined ? `${Math.round(value)}°` : "--°";

  const isAxisActive = (axis: Axis) =>
    multiAxisMode ? selectedAxes.has(axis) : selectedAxis === axis;

  return (
    <div className={cn("flex items-center justify-center gap-2 flex-wrap py-2", className)}>
      {/* Axis controls group */}
      <div className="flex items-center gap-1.5 p-1.5 rounded-full bg-black/5 dark:bg-white/5 backdrop-blur-sm">
        {/* Multi-axis toggle */}
        <GlossyIconButton
          active={multiAxisMode}
          onClick={onMultiAxisToggle}
          activeColor="bg-gradient-to-br from-purple-500 to-pink-500"
          tooltip={multiAxisMode ? "Single axis mode" : "Multi-axis mode"}
        >
          <Combine className="size-4" />
        </GlossyIconButton>

        {/* X axis */}
        <GlossyIconButton
          active={isAxisActive("x")}
          onClick={() => onAxisToggle("x")}
          activeColor="bg-gradient-to-br from-fuchsia-500 to-pink-500"
          tooltip="X-Axis (Roll)"
        >
          X
        </GlossyIconButton>

        {/* Y axis */}
        <GlossyIconButton
          active={isAxisActive("y")}
          onClick={() => onAxisToggle("y")}
          activeColor="bg-gradient-to-br from-cyan-500 to-blue-500"
          tooltip="Y-Axis (Pitch)"
        >
          Y
        </GlossyIconButton>

        {/* Z axis */}
        <GlossyIconButton
          active={isAxisActive("z")}
          onClick={() => onAxisToggle("z")}
          activeColor="bg-gradient-to-br from-violet-500 to-purple-500"
          tooltip="Z-Axis (Yaw)"
        >
          Z
        </GlossyIconButton>
      </div>

      {/* Knee toggles group */}
      <div className="flex items-center gap-2">
        {/* Left knee */}
        <GlossyButton
          active={leftVisible}
          onClick={onLeftToggle}
          activeColor="bg-gradient-to-br from-blue-500 to-blue-600"
          tooltip={leftVisible ? "Hide Left Knee" : "Show Left Knee"}
        >
          <span className="font-bold">L</span>
          <span className="font-mono text-xs opacity-90">{formatAngle(leftValue)}</span>
        </GlossyButton>

        {/* Right knee */}
        <GlossyButton
          active={rightVisible}
          onClick={onRightToggle}
          activeColor="bg-gradient-to-br from-red-500 to-red-600"
          tooltip={rightVisible ? "Hide Right Knee" : "Show Right Knee"}
        >
          <span className="font-bold">R</span>
          <span className="font-mono text-xs opacity-90">{formatAngle(rightValue)}</span>
        </GlossyButton>
      </div>
    </div>
  );
}

export default GlossyChartControls;
