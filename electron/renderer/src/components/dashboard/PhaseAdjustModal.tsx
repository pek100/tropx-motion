/**
 * PhaseAdjustModal - Modal for manual phase offset adjustment.
 * Shows the chart without asymmetry overlays for precise alignment tuning.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { cn } from "@/lib/utils";
import { RotateCcw, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  PackedChunkData,
  unpackToAngles,
} from "../../../../../shared/QuaternionCodec";
import type { PhaseAlignmentData } from "./ChartPane";
import { useChartGradients } from "@/hooks/useChartGradients";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface PhaseAdjustModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packedData: PackedChunkData | null;
  /** Currently applied phase offset (may differ from default if manually adjusted) */
  currentOffsetMs: number;
  /** Default (calculated) phase alignment data - used for reset and display */
  defaultPhaseAlignment: PhaseAlignmentData | null;
  sampleRate?: number;
  onApply: (newOffsetMs: number) => void;
}

interface ChartDataPoint {
  time: number;
  timeLabel: string;
  left: number | null;
  right: number | null;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

// Use CSS variables for knee colors (single source of truth in globals.css)
const LEFT_KNEE_COLOR = "var(--chart-left)";   // coral
const RIGHT_KNEE_COLOR = "var(--chart-right)"; // blue
const TARGET_POINTS = 300; // More points for detail in modal

// ─────────────────────────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────────────────────────

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
}) {
  if (!active || !payload?.length) return null;

  const timeLabel = (payload[0] as any)?.payload?.timeLabel;

  return (
    <div className="px-3 py-2 rounded-lg shadow-lg border border-[var(--tropx-border)] bg-[var(--tropx-card)] text-xs">
      <p className="text-[var(--tropx-text-sub)] mb-1">{timeLabel}</p>
      <div className="space-y-1">
        {payload.map((item) => (
          <div key={item.dataKey} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[var(--tropx-text-main)]">
              {item.dataKey === "left" ? "Left" : "Right"}:{" "}
              <strong>{item.value.toFixed(1)}°</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function PhaseAdjustModal({
  open,
  onOpenChange,
  packedData,
  currentOffsetMs,
  defaultPhaseAlignment,
  sampleRate,
  onApply,
}: PhaseAdjustModalProps) {
  // Get chart gradient values from CSS variables
  const chartGradients = useChartGradients();

  // Slider offset value in ms (starts at current offset)
  const [sliderOffsetMs, setSliderOffsetMs] = useState(currentOffsetMs);

  // Reset to current offset when modal opens
  useEffect(() => {
    if (open) {
      setSliderOffsetMs(currentOffsetMs);
    }
  }, [open, currentOffsetMs]);

  // Calculate the default optimal offset for display/reset
  const defaultOptimalMs = defaultPhaseAlignment?.optimalOffsetMs ?? 0;

  // Compute effective sample rate for shift calculations
  const effectiveSampleRate = useMemo(() => {
    if (!packedData || packedData.sampleCount === 0) return 100;
    const durationMs = packedData.endTime - packedData.startTime;
    const angleSamples = unpackToAngles(packedData, "y");
    return durationMs > 0
      ? (angleSamples.length / durationMs) * 1000
      : (sampleRate ?? packedData.sampleRate);
  }, [packedData, sampleRate]);

  // Pre-compute base data
  const { baseData, step } = useMemo(() => {
    if (!packedData || packedData.sampleCount === 0) {
      return { baseData: { samples: [] as { left: number; right: number }[], durationMs: 0 }, step: 1 };
    }

    const angleSamples = unpackToAngles(packedData, "y");
    if (angleSamples.length === 0) {
      return { baseData: { samples: [], durationMs: 0 }, step: 1 };
    }

    const durationMs = packedData.endTime - packedData.startTime;
    const step = Math.max(1, Math.floor(angleSamples.length / TARGET_POINTS));

    return {
      baseData: { samples: angleSamples, durationMs },
      step,
    };
  }, [packedData]);

  // Apply shift to create chart data based on slider value
  const chartData = useMemo<ChartDataPoint[]>(() => {
    const { samples, durationMs } = baseData;
    if (samples.length === 0) return [];

    // Convert slider offset to sample shift
    const shiftSamples = Math.round((sliderOffsetMs / 1000) * effectiveSampleRate);
    const halfShift = Math.round(shiftSamples / 2);
    const points: ChartDataPoint[] = [];

    for (let i = 0; i < samples.length; i += step) {
      const progress = i / samples.length;
      const timeMs = progress * durationMs;

      const leftIndex = i - halfShift;
      const rightIndex = i + halfShift;

      points.push({
        time: timeMs,
        timeLabel: formatTimeMs(timeMs),
        left: (leftIndex >= 0 && leftIndex < samples.length)
          ? samples[leftIndex].left
          : null,
        right: (rightIndex >= 0 && rightIndex < samples.length)
          ? samples[rightIndex].right
          : null,
      });
    }

    return points;
  }, [baseData, step, sliderOffsetMs, effectiveSampleRate]);

  // Calculate Y-axis domain
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-45, 90];

    const allValues = chartData
      .flatMap((p) => [p.left, p.right])
      .filter((v): v is number => v !== null);
    if (allValues.length === 0) return [-45, 90];

    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1;

    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  // Handle apply
  const handleApply = useCallback(() => {
    onApply(sliderOffsetMs);
    onOpenChange(false);
  }, [sliderOffsetMs, onApply, onOpenChange]);

  // Handle reset to default optimal
  const handleResetToDefault = useCallback(() => {
    setSliderOffsetMs(defaultOptimalMs);
  }, [defaultOptimalMs]);

  // Slider range: allow adjustment from 0 to 2x the default optimal (or at least ±500ms)
  const sliderMax = Math.max(500, defaultOptimalMs * 2);
  const sliderMin = -sliderMax;

  if (!packedData) return null;

  const handleClose = () => onOpenChange(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Blur overlay with fade animation */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 modal-blur-overlay cursor-default",
            "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
            "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
          )}
          style={{
            willChange: "opacity",
            transform: "translateZ(0)",
          }}
          onClick={handleClose}
        />

        {/* Modal content with bubble animation */}
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[51] m-auto",
            "w-[90vw] h-[85vh] flex flex-col",
            "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
            "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
            "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
            "pointer-events-auto"
          )}
          onPointerDownOutside={handleClose}
          onInteractOutside={handleClose}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-[var(--tropx-border)] flex-shrink-0 flex items-center justify-between">
            <DialogPrimitive.Title className="text-lg font-bold text-[var(--tropx-text-main)]">
              Adjust Phase Alignment
            </DialogPrimitive.Title>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1.5 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
            >
              <X className="size-4 text-[var(--tropx-shadow)]" />
              <span className="sr-only">Close</span>
            </button>
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData as any}
                margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
              >
                <defs>
                  {/* Main knee gradients - opacity from CSS variables */}
                  <linearGradient id="modalLeftGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={LEFT_KNEE_COLOR} stopOpacity={chartGradients.gradientStart} />
                    <stop offset="95%" stopColor={LEFT_KNEE_COLOR} stopOpacity={chartGradients.gradientEnd} />
                  </linearGradient>
                  <linearGradient id="modalRightGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={chartGradients.gradientStart} />
                    <stop offset="95%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={chartGradients.gradientEnd} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-700" />

                <XAxis
                  dataKey="time"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(ms) => formatTimeMs(ms)}
                  className="text-gray-400 dark:text-gray-500"
                  tick={{ fill: "currentColor" }}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />

                <YAxis
                  domain={yDomain}
                  reversed
                  className="text-gray-400 dark:text-gray-500"
                  tick={{ fill: "currentColor" }}
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  tickFormatter={(v) => `${v}°`}
                />

                <ReferenceLine y={0} className="stroke-gray-300 dark:stroke-zinc-600" strokeWidth={1} />

                <Tooltip content={<CustomTooltip />} />

                <Legend
                  verticalAlign="top"
                  height={36}
                  formatter={(value) => (
                    <span className="text-xs text-[var(--tropx-text-main)]">
                      {value === "left" ? "Left Knee" : "Right Knee"}
                    </span>
                  )}
                />

                <Area
                  type="monotone"
                  dataKey="left"
                  name="left"
                  stroke={LEFT_KNEE_COLOR}
                  strokeWidth={2}
                  fill="url(#modalLeftGradient)"
                  activeDot={{ r: 4, fill: LEFT_KNEE_COLOR }}
                />

                <Area
                  type="monotone"
                  dataKey="right"
                  name="right"
                  stroke={RIGHT_KNEE_COLOR}
                  strokeWidth={2}
                  fill="url(#modalRightGradient)"
                  activeDot={{ r: 4, fill: RIGHT_KNEE_COLOR }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Controls */}
          <div className="px-6 py-4 border-t border-[var(--tropx-border)] flex-shrink-0 space-y-4">
            {/* Slider */}
            <div className="flex items-center gap-4">
              <span className="text-sm text-[var(--tropx-text-sub)] w-20">Offset:</span>
              <Slider
                value={[sliderOffsetMs]}
                onValueChange={(values: number[]) => setSliderOffsetMs(values[0])}
                min={sliderMin}
                max={sliderMax}
                step={10}
                className="flex-1 [&_[role=slider]]:bg-[var(--tropx-vibrant)] [&_[role=slider]]:border-[var(--tropx-vibrant)] [&_.bg-primary]:bg-[var(--tropx-vibrant)]"
              />
              <span className="text-sm font-mono text-[var(--tropx-text-main)] w-20 text-right">
                {sliderOffsetMs.toFixed(0)}ms
              </span>
            </div>

            {/* Info */}
            <div className="flex items-center justify-between text-xs text-[var(--tropx-text-sub)]">
              <span>
                Default: {defaultOptimalMs.toFixed(0)}ms
                {defaultPhaseAlignment && ` (${defaultPhaseAlignment.optimalOffsetDegrees.toFixed(1)}°)`}
              </span>
              {defaultPhaseAlignment && (
                <span>
                  Correlation: {(defaultPhaseAlignment.unalignedCorrelation * 100).toFixed(0)}%
                  → {(defaultPhaseAlignment.alignedCorrelation * 100).toFixed(0)}%
                </span>
              )}
            </div>

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetToDefault}
                disabled={sliderOffsetMs === defaultOptimalMs}
                className="gap-1.5"
              >
                <RotateCcw className="size-3.5" />
                Reset to Default
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleClose}
                className="gap-1.5"
              >
                <X className="size-3.5" />
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleApply}
                className="gap-1.5 bg-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/90"
              >
                <Check className="size-3.5" />
                Apply & Recalculate
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function formatTimeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  return `${seconds.toFixed(1)}s`;
}

export default PhaseAdjustModal;
