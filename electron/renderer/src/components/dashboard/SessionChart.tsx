/**
 * SessionChart - Knee angle waveforms for selected session.
 * Larger version of MiniRecordingChart with legend and better visualization.
 */

import { useMemo } from "react";
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
import { Loader2 } from "lucide-react";
import {
  PackedChunkData,
  unpackToAngles,
} from "../../../../../shared/QuaternionCodec";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionChartProps {
  packedData: PackedChunkData | null;
  isLoading?: boolean;
  sessionTitle?: string;
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
  className,
}: SessionChartProps) {
  // Convert packed data to chart points
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!packedData || packedData.sampleCount === 0) return [];

    const angleSamples = unpackToAngles(packedData, "y");
    if (angleSamples.length === 0) return [];

    // Downsample for performance
    const step = Math.max(1, Math.floor(angleSamples.length / TARGET_POINTS));
    const points: ChartDataPoint[] = [];

    const startTime = packedData.startTime;
    const durationMs = packedData.endTime - packedData.startTime;

    for (let i = 0; i < angleSamples.length; i += step) {
      const sample = angleSamples[i];
      const progress = i / angleSamples.length;
      const timeMs = progress * durationMs;

      points.push({
        time: timeMs,
        timeLabel: formatTimeMs(timeMs),
        left: sample.left,
        right: sample.right,
      });
    }

    return points;
  }, [packedData]);

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
    <div className={cn("w-full h-full", className)}>
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
