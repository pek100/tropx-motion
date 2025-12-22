/**
 * PhaseAdjustModal - Modal for manual phase offset adjustment.
 * Shows the chart without asymmetry overlays for precise alignment tuning.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PackedChunkData,
  unpackToAngles,
} from "../../../../../shared/QuaternionCodec";
import type { PhaseAlignmentData } from "./ChartPane";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface PhaseAdjustModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packedData: PackedChunkData | null;
  phaseAlignment: PhaseAlignmentData | null;
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

const LEFT_KNEE_COLOR = "#f97066";
const RIGHT_KNEE_COLOR = "#60a5fa";
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
  phaseAlignment,
  sampleRate,
  onApply,
}: PhaseAdjustModalProps) {
  // Manual adjustment state (-1 to 1, where 0 = optimal)
  const [manualAdjustment, setManualAdjustment] = useState(0);

  // Reset adjustment when modal opens
  useEffect(() => {
    if (open) {
      setManualAdjustment(0);
    }
  }, [open]);

  // Pre-compute base data
  const { baseData, maxHalfShift } = useMemo(() => {
    if (!packedData || packedData.sampleCount === 0 || !phaseAlignment) {
      return { baseData: { samples: [] as { left: number; right: number }[], durationMs: 0, step: 1 }, maxHalfShift: 0 };
    }

    const angleSamples = unpackToAngles(packedData, "y");
    if (angleSamples.length === 0) {
      return { baseData: { samples: [], durationMs: 0, step: 1 }, maxHalfShift: 0 };
    }

    const effectiveSampleRate = sampleRate ?? packedData.sampleRate;
    const durationMs = packedData.endTime - packedData.startTime;

    const maxPhaseShiftSamples = Math.round((phaseAlignment.optimalOffsetMs / 1000) * effectiveSampleRate);
    const step = Math.max(1, Math.floor(angleSamples.length / TARGET_POINTS));

    return {
      baseData: { samples: angleSamples, durationMs, step },
      maxHalfShift: Math.round(maxPhaseShiftSamples / 2),
    };
  }, [packedData, phaseAlignment, sampleRate]);

  // Calculate current offset in ms
  const currentOffsetMs = useMemo(() => {
    if (!phaseAlignment) return 0;
    return (1 + manualAdjustment) * phaseAlignment.optimalOffsetMs;
  }, [phaseAlignment, manualAdjustment]);

  // Apply shift to create chart data
  const chartData = useMemo<ChartDataPoint[]>(() => {
    const { samples, durationMs, step } = baseData;
    if (samples.length === 0 || !phaseAlignment) return [];

    const adjustmentMultiplier = 1 + manualAdjustment;
    const currentHalfShift = Math.round(maxHalfShift * adjustmentMultiplier);
    const points: ChartDataPoint[] = [];

    for (let i = 0; i < samples.length; i += step) {
      const progress = i / samples.length;
      const timeMs = progress * durationMs;

      const leftIndex = i - currentHalfShift;
      const rightIndex = i + currentHalfShift;

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
  }, [baseData, maxHalfShift, manualAdjustment, phaseAlignment]);

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
    onApply(currentOffsetMs);
    onOpenChange(false);
  }, [currentOffsetMs, onApply, onOpenChange]);

  // Handle reset
  const handleReset = useCallback(() => {
    setManualAdjustment(0);
  }, []);

  if (!phaseAlignment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b border-[var(--tropx-border)] flex-shrink-0">
          <DialogTitle className="text-lg font-bold text-[var(--tropx-text-main)]">
            Adjust Phase Alignment
          </DialogTitle>
        </DialogHeader>

        {/* Chart */}
        <div className="flex-1 min-h-0 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData as any}
              margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
            >
              <defs>
                <linearGradient id="modalLeftGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="modalRightGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={0.1} />
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
              value={[manualAdjustment]}
              onValueChange={(values: number[]) => setManualAdjustment(values[0])}
              min={-1}
              max={1}
              step={0.02}
              className="flex-1 [&_[role=slider]]:bg-[var(--tropx-vibrant)] [&_[role=slider]]:border-[var(--tropx-vibrant)] [&_.bg-primary]:bg-[var(--tropx-vibrant)]"
            />
            <span className="text-sm font-mono text-[var(--tropx-text-main)] w-20 text-right">
              {currentOffsetMs.toFixed(1)}ms
            </span>
          </div>

          {/* Info */}
          <div className="flex items-center justify-between text-xs text-[var(--tropx-text-sub)]">
            <span>
              Optimal: {phaseAlignment.optimalOffsetMs.toFixed(1)}ms
              ({phaseAlignment.optimalOffsetDegrees.toFixed(1)}°)
            </span>
            <span>
              Correlation: {(phaseAlignment.unalignedCorrelation * 100).toFixed(0)}%
              → {(phaseAlignment.alignedCorrelation * 100).toFixed(0)}%
            </span>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
              disabled={manualAdjustment === 0}
              className="gap-1.5"
            >
              <RotateCcw className="size-3.5" />
              Reset to Optimal
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
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
      </DialogContent>
    </Dialog>
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
