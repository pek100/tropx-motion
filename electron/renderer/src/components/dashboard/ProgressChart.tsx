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
import { Activity } from "lucide-react";
import type { SessionData, PreviewPaths } from "./SessionCard";
import { METRIC_DEFINITIONS } from "./MetricsTable";
import { SvgPreviewChart } from "../SvgPreviewChart";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ProgressChartProps {
  sessions: SessionData[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  /** Callback to view session waveform (selects session + switches to waveform tab) */
  onViewSession?: (sessionId: string) => void;
  selectedMetrics?: Set<string>;
  className?: string;
}

interface ChartDataPoint {
  sessionId: string;
  date: number;
  dateLabel: string;
  title: string;
  grade: string;
  previewLeftPaths?: PreviewPaths | null;
  previewRightPaths?: PreviewPaths | null;
  [key: string]: string | number | PreviewPaths | null | undefined; // Dynamic metric values + preview paths
}

// ─────────────────────────────────────────────────────────────────
// Metric Colors - matches domain colors from MetricsTable
// ─────────────────────────────────────────────────────────────────

const METRIC_COLORS: Record<string, string> = {
  // OPI
  opiScore: "var(--tropx-vibrant)",

  // Range (emerald) - TIER 1
  avgMaxROM: "#10b981",
  avgPeakFlexion: "#34d399",
  avgPeakExtension: "#059669",

  // Symmetry/Balance (violet) - TIER 2 & 3
  romAsymmetry: "#8b5cf6",
  realAsymmetryAvg: "#a78bfa",
  velocityAsymmetry: "#7c3aed",
  crossCorrelation: "#6d28d9",
  netGlobalAsymmetry: "#c4b5fd",

  // Power (orange) - TIER 3
  peakAngularVelocity: "#f97316",
  explosivenessConcentric: "#ea580c",
  explosivenessLoading: "#fb923c",

  // Control (cyan) - TIER 2 & 4
  romCoV: "#22d3ee",
  sparc: "#06b6d4",
  ldlj: "#0891b2",
  nVelocityPeaks: "#0e7490",
  rmsJerk: "#155e75",

  // Timing (pink) - TIER 3 & 4
  maxFlexionTimingDiff: "#ec4899",
  phaseShift: "#f472b6",
  temporalLag: "#db2777",
  zeroVelocityPhaseMs: "#be185d",
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
  onViewSession,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  selectedSessionId: string | null;
  selectedMetrics?: Set<string>;
  onViewSession?: (sessionId: string) => void;
}) {
  if (!active || !payload?.[0]?.payload) return null;

  const data = payload[0].payload;
  const isSelected = data.sessionId === selectedSessionId;

  // Get metric definitions for formatting
  const metricDefs = new Map(METRIC_DEFINITIONS.map((m) => [m.id, m]));

  return (
    <div
      className={cn(
        "px-3 py-2.5 rounded-xl shadow-lg text-xs min-w-[180px]",
        "bg-[var(--tropx-card)] border-2",
        isSelected
          ? "border-[var(--tropx-vibrant)]"
          : "border-[var(--tropx-border)]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <p className="font-semibold text-[var(--tropx-text-main)] truncate">
            {data.title}
          </p>
          <p className="text-[10px] text-[var(--tropx-text-sub)]">
            {data.dateLabel}
          </p>
        </div>
        {/* OPI Score Badge */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <span className="text-lg font-bold text-[var(--tropx-text-main)]">
            {Math.round(data.opiScore as number)}
          </span>
          <span className="text-[8px] uppercase text-[var(--tropx-text-sub)]">OPI</span>
        </div>
      </div>

      {/* Mini Preview Chart */}
      <SvgPreviewChart
        leftPaths={data.previewLeftPaths}
        rightPaths={data.previewRightPaths}
        height={48}
        showLegend
        className="mt-2"
      />

      {/* Metrics */}
      <div className="mt-2 pt-2 border-t border-[var(--tropx-border)] space-y-1">
        {payload.filter(e => e.dataKey !== 'opiScore').slice(0, 4).map((entry) => {
          const def = metricDefs.get(entry.dataKey);
          const displayName = def?.name || entry.dataKey;
          const value = entry.value;
          const formatted = def ? def.format(value) : Math.round(value).toString();

          return (
            <div key={entry.dataKey} className="flex justify-between gap-3">
              <span className="truncate" style={{ color: entry.color }}>
                {displayName}
              </span>
              <span className="font-medium text-[var(--tropx-text-main)]">
                {formatted}
              </span>
            </div>
          );
        })}
        {payload.filter(e => e.dataKey !== 'opiScore').length > 4 && (
          <p className="text-[10px] text-[var(--tropx-text-sub)] text-center">
            +{payload.filter(e => e.dataKey !== 'opiScore').length - 4} more metrics
          </p>
        )}
      </div>

      {/* View Waveform Button */}
      {onViewSession && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewSession(data.sessionId);
          }}
          className={cn(
            "w-full mt-2.5 py-1.5 rounded-lg text-[11px] font-medium",
            "flex items-center justify-center gap-1.5",
            "transition-colors",
            isSelected
              ? "bg-[var(--tropx-vibrant)] text-white"
              : "bg-[var(--tropx-muted)] text-[var(--tropx-text-main)] hover:bg-[var(--tropx-vibrant)]/10 hover:text-[var(--tropx-vibrant)]"
          )}
        >
          <Activity className="size-3" />
          View Waveform
        </button>
      )}
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
  onViewSession,
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
        previewLeftPaths: s.previewLeftPaths,
        previewRightPaths: s.previewRightPaths,
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
                onViewSession={onViewSession}
              />
            }
            cursor={{ stroke: "var(--tropx-vibrant)", strokeOpacity: 0.3 }}
            wrapperStyle={{ pointerEvents: 'auto' }}
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
