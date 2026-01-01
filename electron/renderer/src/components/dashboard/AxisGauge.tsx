/**
 * AxisGauge - A radial gauge for selecting X, Y, Z Euler axes
 * with smooth dragging, snap-on-close behavior, and hue-shifting colors.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type EulerAxis = "x" | "y" | "z";

interface AxisGaugeProps {
  value: EulerAxis;
  onChange: (axis: EulerAxis) => void;
  className?: string;
  disabled?: boolean;
}

// Gauge configuration
const GAUGE_SIZE = 48; // px
const GAUGE_RADIUS = 18; // px (radius of the arc center)
const THUMB_SIZE = 12; // px
const ARC_START = -135; // degrees (where X is)
const ARC_END = -45; // degrees (where Z is)
const ARC_SPAN = ARC_END - ARC_START; // 90 degrees total

// Axis positions in degrees along the arc
const AXIS_POSITIONS: Record<EulerAxis, number> = {
  x: ARC_START,      // -135°
  y: (ARC_START + ARC_END) / 2, // -90° (middle)
  z: ARC_END,        // -45°
};

// Snap threshold in degrees
const SNAP_THRESHOLD = 20;

// Convert axis to normalized value (0-1)
function axisToValue(axis: EulerAxis): number {
  return axis === "x" ? 0 : axis === "y" ? 0.5 : 1;
}

// Convert normalized value to degrees
function valueToDegrees(value: number): number {
  return ARC_START + value * ARC_SPAN;
}

// Convert degrees to position on the arc
function degreesToPosition(degrees: number, radius: number): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: Math.cos(rad) * radius,
    y: Math.sin(rad) * radius,
  };
}

// Get hue based on value (0-1): X=200 (blue), Y=280 (purple), Z=340 (red/pink)
function getHue(value: number): number {
  // Interpolate from blue (200) through purple (280) to red-ish (340)
  return 200 + value * 140;
}

export function AxisGauge({
  value,
  onChange,
  className,
  disabled = false,
}: AxisGaugeProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(axisToValue(value));
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync drag value with prop when not dragging
  useEffect(() => {
    if (!isDragging) {
      setDragValue(axisToValue(value));
    }
  }, [value, isDragging]);

  // Convert mouse position to value (0-1)
  const getValueFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      if (!containerRef.current) return dragValue;

      const rect = containerRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      // Calculate angle from center
      const dx = clientX - centerX;
      const dy = clientY - centerY;
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);

      // Clamp to arc range
      if (angle < ARC_START) angle = ARC_START;
      if (angle > ARC_END) angle = ARC_END;

      // Convert to 0-1 value
      return (angle - ARC_START) / ARC_SPAN;
    },
    [dragValue]
  );

  // Check if value is close to an axis and return which one (or null)
  const getSnapAxis = useCallback((val: number): EulerAxis | null => {
    const degrees = valueToDegrees(val);

    for (const [axis, axisAngle] of Object.entries(AXIS_POSITIONS)) {
      if (Math.abs(degrees - axisAngle) < SNAP_THRESHOLD) {
        return axis as EulerAxis;
      }
    }
    return null;
  }, []);

  // Handle click on axis label - snap immediately
  const handleAxisClick = useCallback(
    (axis: EulerAxis, e: React.MouseEvent) => {
      e.stopPropagation();
      if (disabled) return;
      onChange(axis);
    },
    [onChange, disabled]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragging(true);

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      setDragValue(getValueFromEvent(clientX, clientY));
    },
    [disabled, getValueFromEvent]
  );

  // Handle drag move
  const handleDragMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDragging) return;

      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      setDragValue(getValueFromEvent(clientX, clientY));
    },
    [isDragging, getValueFromEvent]
  );

  // Handle drag end - snap if close to an axis
  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const snapAxis = getSnapAxis(dragValue);
    if (snapAxis) {
      onChange(snapAxis);
    } else {
      // Find closest axis
      const closest = dragValue < 0.25 ? "x" : dragValue > 0.75 ? "z" : "y";
      onChange(closest);
    }
  }, [isDragging, dragValue, getSnapAxis, onChange]);

  // Add global listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleDragMove);
      window.addEventListener("mouseup", handleDragEnd);
      window.addEventListener("touchmove", handleDragMove);
      window.addEventListener("touchend", handleDragEnd);
    }
    return () => {
      window.removeEventListener("mousemove", handleDragMove);
      window.removeEventListener("mouseup", handleDragEnd);
      window.removeEventListener("touchmove", handleDragMove);
      window.removeEventListener("touchend", handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  // Calculate positions
  const currentDegrees = valueToDegrees(dragValue);
  const thumbPos = degreesToPosition(currentDegrees, GAUGE_RADIUS);
  const currentHue = getHue(dragValue);

  // Axis label positions
  const axisLabels = (["x", "y", "z"] as const).map((axis) => ({
    axis,
    ...degreesToPosition(AXIS_POSITIONS[axis], GAUGE_RADIUS + 8),
  }));

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <div
          ref={containerRef}
          className={cn(
            "relative flex items-center justify-center select-none",
            "rounded-lg bg-[var(--tropx-muted)] border border-[var(--tropx-border)]",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
            className
          )}
          style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}
          onMouseDown={handleDragStart}
          onTouchStart={handleDragStart}
        >
          {/* Arc track */}
          <svg
            width={GAUGE_SIZE}
            height={GAUGE_SIZE}
            className="absolute inset-0"
            style={{ overflow: "visible" }}
          >
            <defs>
              <linearGradient id="arcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={`hsl(${getHue(0)}, 70%, 50%)`} />
                <stop offset="50%" stopColor={`hsl(${getHue(0.5)}, 70%, 50%)`} />
                <stop offset="100%" stopColor={`hsl(${getHue(1)}, 70%, 50%)`} />
              </linearGradient>
            </defs>
            {/* Background arc */}
            <path
              d={describeArc(GAUGE_SIZE / 2, GAUGE_SIZE / 2, GAUGE_RADIUS, ARC_START, ARC_END)}
              fill="none"
              stroke="var(--tropx-border)"
              strokeWidth={4}
              strokeLinecap="round"
            />
            {/* Colored arc up to current position */}
            <path
              d={describeArc(GAUGE_SIZE / 2, GAUGE_SIZE / 2, GAUGE_RADIUS, ARC_START, currentDegrees)}
              fill="none"
              stroke={`hsl(${currentHue}, 70%, 50%)`}
              strokeWidth={4}
              strokeLinecap="round"
            />
          </svg>

          {/* Axis labels */}
          {axisLabels.map(({ axis, x, y }) => (
            <button
              key={axis}
              onClick={(e) => handleAxisClick(axis, e)}
              disabled={disabled}
              className={cn(
                "absolute text-[9px] font-bold uppercase transition-all z-10",
                "hover:scale-110",
                value === axis && !isDragging
                  ? "text-[var(--tropx-text-main)]"
                  : "text-[var(--tropx-text-sub)]"
              )}
              style={{
                left: GAUGE_SIZE / 2 + x - 4,
                top: GAUGE_SIZE / 2 + y - 5,
              }}
            >
              {axis}
            </button>
          ))}

          {/* Thumb */}
          <div
            className={cn(
              "absolute rounded-full shadow-md transition-transform",
              isDragging ? "scale-125" : "scale-100"
            )}
            style={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              left: GAUGE_SIZE / 2 + thumbPos.x - THUMB_SIZE / 2,
              top: GAUGE_SIZE / 2 + thumbPos.y - THUMB_SIZE / 2,
              backgroundColor: `hsl(${currentHue}, 70%, 50%)`,
              transition: isDragging ? "transform 0.1s" : "all 0.15s ease-out",
            }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {value.toUpperCase()} Axis ({value === "x" ? "Roll" : value === "y" ? "Pitch" : "Yaw"})
      </TooltipContent>
    </Tooltip>
  );
}

// Helper to describe an SVG arc path
function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number
): string {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    "M", start.x, start.y,
    "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y,
  ].join(" ");
}

function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleInDegrees: number
): { x: number; y: number } {
  const rad = (angleInDegrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(rad),
    y: cy + radius * Math.sin(rad),
  };
}

export default AxisGauge;
