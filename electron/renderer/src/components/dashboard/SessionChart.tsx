/**
 * SessionChart - Knee angle waveforms for selected session.
 * Larger version of MiniRecordingChart with legend and better visualization.
 * Supports asymmetry event overlay to highlight time windows of detected asymmetries.
 */

import { useMemo, useState } from "react";
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
  ReferenceArea,
} from "recharts";
import { cn } from "@/lib/utils";
import { Loader2, Layers, GitCompareArrows } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip as UITooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  PackedChunkData,
  unpackToAngles,
} from "../../../../../shared/QuaternionCodec";
import type { AsymmetryEventsData } from "./ChartPane";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionChartProps {
  packedData: PackedChunkData | null;
  isLoading?: boolean;
  sessionTitle?: string;
  asymmetryEvents?: AsymmetryEventsData;
  className?: string;
}

interface ChartDataPoint {
  time: number;
  timeLabel: string;
  left: number;
  right: number;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const LEFT_KNEE_COLOR = "#f97066"; // coral
const RIGHT_KNEE_COLOR = "#60a5fa"; // blue
const TARGET_POINTS = 200;

// Asymmetry overlay colors
const LEFT_DOMINANT_COLOR = "#f97066"; // coral (same as left knee)
const RIGHT_DOMINANT_COLOR = "#60a5fa"; // blue (same as right knee)
const ASYMMETRY_OPACITY = 0.25; // Base opacity for overlays

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

export function SessionChart({
  packedData,
  isLoading,
  sessionTitle,
  asymmetryEvents,
  className,
}: SessionChartProps) {
  // Toggle states
  const [showAsymmetryOverlay, setShowAsymmetryOverlay] = useState(true);
  const [applyPhaseShift, setApplyPhaseShift] = useState(false);

  // Check if asymmetry data is available
  const hasAsymmetryData = asymmetryEvents?.events && asymmetryEvents.events.length > 0;

  // Check if phase alignment data is available
  const phaseAlignment = asymmetryEvents?.phaseAlignment;
  const hasPhaseShift = phaseAlignment !== null && phaseAlignment !== undefined;

  // Convert packed data to chart points (with optional phase shift)
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!packedData || packedData.sampleCount === 0) return [];

    const angleSamples = unpackToAngles(packedData, "y");
    if (angleSamples.length === 0) return [];

    const sampleRate = asymmetryEvents?.sampleRate ?? packedData.sampleRate;

    // Calculate phase shift in samples if enabled
    let phaseShiftSamples = 0;
    if (applyPhaseShift && phaseAlignment) {
      phaseShiftSamples = Math.round((phaseAlignment.optimalOffsetMs / 1000) * sampleRate);
    }

    // Downsample for performance
    const step = Math.max(1, Math.floor(angleSamples.length / TARGET_POINTS));
    const points: ChartDataPoint[] = [];

    const durationMs = packedData.endTime - packedData.startTime;

    for (let i = 0; i < angleSamples.length; i += step) {
      const sample = angleSamples[i];
      const progress = i / angleSamples.length;
      const timeMs = progress * durationMs;

      // Apply phase shift to right knee (shift the index)
      let rightValue = sample.right;

      if (phaseShiftSamples !== 0) {
        const shiftedIndex = i + phaseShiftSamples;
        if (shiftedIndex >= 0 && shiftedIndex < angleSamples.length) {
          rightValue = angleSamples[shiftedIndex].right;
        }
      }

      points.push({
        time: timeMs,
        timeLabel: formatTimeMs(timeMs),
        left: sample.left,
        right: rightValue,
      });
    }

    return points;
  }, [packedData, applyPhaseShift, phaseAlignment, asymmetryEvents?.sampleRate]);

  // Calculate Y-axis domain
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-45, 90];

    const allValues = chartData.flatMap((p) => [p.left, p.right]);
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1;

    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);


  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full",
          "text-[var(--tropx-shadow)]",
          className
        )}
      >
        <Loader2 className="size-6 animate-spin mr-2" />
        <span className="text-sm">Loading session data...</span>
      </div>
    );
  }

  // No data state
  if (!packedData || chartData.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center h-full",
          "text-[var(--tropx-shadow)]",
          className
        )}
      >
        <p className="text-sm">Select a session to view waveforms</p>
      </div>
    );
  }

  return (
    <div className={cn("w-full h-full flex flex-col", className)}>
      {/* Chart controls */}
      {(hasAsymmetryData || hasPhaseShift || asymmetryEvents === undefined) && (
        <div className="flex items-center justify-end gap-4 mb-2 px-1 flex-wrap">
          {/* Phase Shift Toggle */}
          {hasPhaseShift && (
            <UITooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  <Switch
                    id="phase-shift-toggle"
                    checked={applyPhaseShift}
                    onCheckedChange={setApplyPhaseShift}
                    className="data-[state=checked]:bg-emerald-500"
                  />
                  <Label
                    htmlFor="phase-shift-toggle"
                    className="text-xs text-[var(--tropx-text-sub)] cursor-pointer flex items-center gap-1.5"
                  >
                    <GitCompareArrows className="size-3.5" />
                    Phase Align
                    <span className="text-[10px] opacity-70">
                      ({phaseAlignment!.optimalOffsetMs.toFixed(0)}ms)
                    </span>
                  </Label>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p className="text-xs">
                  Shifts right knee by {phaseAlignment!.optimalOffsetMs.toFixed(1)}ms
                  ({phaseAlignment!.optimalOffsetDegrees.toFixed(1)}°) to align phases.
                  <br />
                  <span className="opacity-70">
                    Correlation: {(phaseAlignment!.unalignedCorrelation * 100).toFixed(0)}%
                    → {(phaseAlignment!.alignedCorrelation * 100).toFixed(0)}%
                    {phaseAlignment!.correlationImprovement > 0 && (
                      <span className="text-emerald-400">
                        {" "}(+{(phaseAlignment!.correlationImprovement * 100).toFixed(0)}%)
                      </span>
                    )}
                  </span>
                </p>
              </TooltipContent>
            </UITooltip>
          )}

          {/* Asymmetry Overlay Toggle */}
          {hasAsymmetryData && (
            <>
              <div className="flex items-center gap-2">
                <Switch
                  id="asymmetry-toggle"
                  checked={showAsymmetryOverlay}
                  onCheckedChange={setShowAsymmetryOverlay}
                  className="data-[state=checked]:bg-[var(--tropx-vibrant)]"
                />
                <Label
                  htmlFor="asymmetry-toggle"
                  className="text-xs text-[var(--tropx-text-sub)] cursor-pointer flex items-center gap-1.5"
                >
                  <Layers className="size-3.5" />
                  Asymmetry
                  <span className="text-[10px] opacity-70">
                    ({asymmetryEvents!.events.length})
                  </span>
                </Label>
              </div>
              {showAsymmetryOverlay && (
                <div className="flex items-center gap-3 text-[10px] text-[var(--tropx-text-sub)]">
                  <span className="flex items-center gap-1">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ backgroundColor: LEFT_DOMINANT_COLOR, opacity: 0.4 }}
                    />
                    L
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="size-2.5 rounded-sm"
                      style={{ backgroundColor: RIGHT_DOMINANT_COLOR, opacity: 0.4 }}
                    />
                    R
                  </span>
                  <span className="opacity-70">
                    Avg: {asymmetryEvents!.summary.avgRealAsymmetry.toFixed(1)}%
                  </span>
                </div>
              )}
            </>
          )}

          {/* Loading state */}
          {asymmetryEvents === undefined && !hasAsymmetryData && !hasPhaseShift && (
            <span className="text-[10px] text-[var(--tropx-text-sub)] opacity-50">
              Loading metrics...
            </span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
            baseValue={0}
          >
            <defs>
              <linearGradient id="leftKneeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.4} />
                <stop offset="95%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.1} />
              </linearGradient>
              <linearGradient id="rightKneeGradient" x1="0" y1="0" x2="0" y2="1">
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

            {/* Asymmetry event overlays - rendered behind the waveforms */}
            {showAsymmetryOverlay &&
              hasAsymmetryData &&
              asymmetryEvents!.events.map((event, index) => (
                <ReferenceArea
                  key={`asymmetry-${index}`}
                  x1={event.startTimeMs}
                  x2={event.endTimeMs}
                  fill={
                    event.direction === "left_dominant"
                      ? LEFT_DOMINANT_COLOR
                      : RIGHT_DOMINANT_COLOR
                  }
                  fillOpacity={ASYMMETRY_OPACITY + (event.avgAsymmetry / 100) * 0.15}
                  stroke={
                    event.direction === "left_dominant"
                      ? LEFT_DOMINANT_COLOR
                      : RIGHT_DOMINANT_COLOR
                  }
                  strokeOpacity={0.3}
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                />
              ))}

            {/* Zero reference line */}
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
              fill="url(#leftKneeGradient)"
              activeDot={{ r: 4, fill: LEFT_KNEE_COLOR }}
            />

            <Area
              type="monotone"
              dataKey="right"
              name="right"
              stroke={RIGHT_KNEE_COLOR}
              strokeWidth={2}
              fill="url(#rightKneeGradient)"
              activeDot={{ r: 4, fill: RIGHT_KNEE_COLOR }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Format milliseconds as mm:ss.ms */
function formatTimeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
  }
  return `${seconds.toFixed(1)}s`;
}

export default SessionChart;
