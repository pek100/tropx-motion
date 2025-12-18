/**
 * ProgressChart - Multi-metric line chart with clickable data points.
 * Renders lines for each selected metric from the table.
 */

import { useMemo, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { cn, formatDate } from "@/lib/utils";
import type { SessionData } from "./SessionCard";
import { METRIC_DEFINITIONS } from "./MetricsTable";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ProgressChartProps {
  sessions: SessionData[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  selectedMetrics?: Set<string>;
  className?: string;
}

interface ChartDataPoint {
  sessionId: string;
  date: number;
  dateLabel: string;
  title: string;
  grade: string;
  [key: string]: string | number; // Dynamic metric values
}

// ─────────────────────────────────────────────────────────────────
// Metric Colors - matches domain colors from MetricsTable
// ─────────────────────────────────────────────────────────────────

const METRIC_COLORS: Record<string, string> = {
  // OPI
  opiScore: "var(--tropx-vibrant)",
  // Symmetry (violet)
  romAsymmetry: "#8b5cf6",
  velocityAsymmetry: "#a78bfa",
  crossCorrelation: "#7c3aed",
  realAsymmetryAvg: "#6d28d9",
  // Power (orange)
  rsi: "#f97316",
  jumpHeightCm: "#fb923c",
  peakAngularVelocity: "#ea580c",
  explosivenessConcentric: "#c2410c",
  // Control (cyan)
  sparc: "#06b6d4",
  ldlj: "#22d3ee",
  nVelocityPeaks: "#0891b2",
  rmsJerk: "#0e7490",
  // Stability (green)
  romCoV: "#22c55e",
  groundContactTimeMs: "#16a34a",
};

// ─────────────────────────────────────────────────────────────────
// Custom Tooltip
// ─────────────────────────────────────────────────────────────────

interface TooltipPayload {
  dataKey: string;
  value: number;
  color: string;
  payload: ChartDataPoint;
}

function CustomTooltip({
  active,
  payload,
  selectedSessionId,
  selectedMetrics,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  selectedSessionId: string | null;
  selectedMetrics?: Set<string>;
}) {
  if (!active || !payload?.[0]?.payload) return null;

  const data = payload[0].payload;
  const isSelected = data.sessionId === selectedSessionId;

  // Get metric definitions for formatting
  const metricDefs = new Map(METRIC_DEFINITIONS.map((m) => [m.id, m]));

  return (
    <div
      className={cn(
        "px-3 py-2 rounded-lg shadow-lg text-xs min-w-[140px]",
        "bg-[var(--tropx-card)] border-2",
        isSelected
          ? "border-orange-500"
          : "border-[var(--tropx-border)]"
      )}
    >
      {isSelected && (
        <p className="text-[10px] uppercase font-bold mb-1 text-orange-500">
          Selected Session
        </p>
      )}
      <p className="font-semibold text-[var(--tropx-text-main)]">
        {data.title}
      </p>
      <p className="mt-0.5 text-[var(--tropx-text-sub)]">
        {data.dateLabel}
      </p>
      <div className="mt-1.5 pt-1.5 border-t border-[var(--tropx-border)] space-y-1">
        {payload.map((entry) => {
          const def = metricDefs.get(entry.dataKey);
          const displayName = def?.name || entry.dataKey;
          const value = entry.value;
          const formatted = def ? def.format(value) : Math.round(value).toString();

          return (
            <div key={entry.dataKey} className="flex justify-between gap-3">
              <span style={{ color: entry.color }}>
                {displayName}:
              </span>
              <span className="font-semibold text-[var(--tropx-text-main)]">
                {formatted}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Custom Dot
// ─────────────────────────────────────────────────────────────────

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: ChartDataPoint;
  stroke?: string;
  selectedSessionId: string | null;
  onSelect: (sessionId: string) => void;
}

function CustomDot({ cx, cy, payload, stroke, selectedSessionId, onSelect }: DotProps) {
  if (cx === undefined || cy === undefined || !payload) return null;

  const isSelected = payload.sessionId === selectedSessionId;

  return (
    <circle
      cx={cx}
      cy={cy}
      r={isSelected ? 6 : 4}
      fill={isSelected ? stroke : "#fff"}
      stroke={stroke}
      strokeWidth={isSelected ? 3 : 2}
      style={{ cursor: "pointer" }}
      onClick={() => onSelect(payload.sessionId)}
    />
  );
}

// ─────────────────────────────────────────────────────────────────
// Custom Legend
// ─────────────────────────────────────────────────────────────────

function CustomLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
  if (!payload || payload.length === 0) return null;

  const metricDefs = new Map(METRIC_DEFINITIONS.map((m) => [m.id, m]));

  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-2 text-xs">
      {payload.map((entry) => {
        const def = metricDefs.get(entry.value);
        const displayName = def?.name || entry.value;
        return (
          <div key={entry.value} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-[var(--tropx-shadow)]">{displayName}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ProgressChart({
  sessions,
  selectedSessionId,
  onSelectSession,
  selectedMetrics,
  className,
}: ProgressChartProps) {
  // Get active metrics (default to OPI if none selected)
  const activeMetrics = useMemo(() => {
    if (!selectedMetrics || selectedMetrics.size === 0) {
      return new Set(["opiScore"]);
    }
    return selectedMetrics;
  }, [selectedMetrics]);

  // Transform sessions to chart data with all metrics
  const chartData = useMemo<ChartDataPoint[]>(() => {
    return sessions.map((s) => {
      const dataPoint: ChartDataPoint = {
        sessionId: s.sessionId,
        date: s.recordedAt,
        dateLabel: formatDate(s.recordedAt),
        title: s.tags[0] || "Untitled",
        grade: s.opiGrade,
        opiScore: s.opiScore,
      };

      // Add all metrics from session
      if (s.metrics) {
        Object.entries(s.metrics).forEach(([key, value]) => {
          if (value !== undefined) {
            dataPoint[key] = value;
          }
        });
      }

      return dataPoint;
    });
  }, [sessions]);

  const handleDotClick = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId);
    },
    [onSelectSession]
  );

  if (sessions.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center h-full",
          "text-[var(--tropx-shadow)] text-sm",
          className
        )}
      >
        No data to display
      </div>
    );
  }

  // Get sorted metrics for consistent rendering
  const sortedMetrics = Array.from(activeMetrics).sort((a, b) => {
    // OPI always first
    if (a === "opiScore") return -1;
    if (b === "opiScore") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className={cn("w-full h-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 30 }}
          onClick={(e) => {
            if (e?.activePayload?.[0]?.payload?.sessionId) {
              onSelectSession(e.activePayload[0].payload.sessionId);
            }
          }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-700" vertical={false} />

          <XAxis
            dataKey="date"
            tickFormatter={(ts) => {
              const d = new Date(ts);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
            className="text-gray-400 dark:text-gray-500"
            tick={{ fill: "currentColor" }}
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />

          <YAxis
            domain={[0, 100]}
            ticks={[0, 20, 40, 60, 80, 100]}
            className="text-gray-400 dark:text-gray-500"
            tick={{ fill: "currentColor" }}
            fontSize={11}
            tickLine={false}
            axisLine={false}
            width={30}
          />

          <Tooltip
            content={
              <CustomTooltip
                selectedSessionId={selectedSessionId}
                selectedMetrics={activeMetrics}
              />
            }
            cursor={{ stroke: "var(--tropx-vibrant)", strokeOpacity: 0.3 }}
          />

          <Legend content={<CustomLegend />} />

          {/* Render a line for each selected metric */}
          {sortedMetrics.map((metricId) => {
            const color = METRIC_COLORS[metricId] || "#6b7280";
            const isOpi = metricId === "opiScore";

            return (
              <Line
                key={metricId}
                type="monotone"
                dataKey={metricId}
                stroke={color}
                strokeWidth={isOpi ? 3 : 2}
                dot={(props) => (
                  <CustomDot
                    {...props}
                    stroke={color}
                    selectedSessionId={selectedSessionId}
                    onSelect={handleDotClick}
                  />
                )}
                activeDot={{
                  r: 6,
                  fill: color,
                  stroke: "#fff",
                  strokeWidth: 2,
                }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ProgressChart;
