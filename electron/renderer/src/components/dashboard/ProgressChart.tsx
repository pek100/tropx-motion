/**
 * ProgressChart - Multi-metric line chart with clickable data points.
 * Renders lines for each selected metric from the table.
 */

import { useMemo, useCallback, useState, useRef, useEffect } from "react";
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

// Using CSS variables from globals.css for base domain colors
// Shade variations use Tailwind palette for visual distinction within domains
const METRIC_COLORS: Record<string, string> = {
  // OPI
  opiScore: "var(--tropx-vibrant)",

  // Range (emerald) - TIER 1 - base: var(--domain-range)
  avgMaxROM: "var(--domain-range)",     // emerald-500
  avgPeakFlexion: "#34d399",            // emerald-400
  avgPeakExtension: "#059669",          // emerald-600

  // Symmetry/Balance (violet) - TIER 2 & 3 - base: var(--domain-symmetry)
  romAsymmetry: "var(--domain-symmetry)", // violet-500
  realAsymmetryAvg: "#a78bfa",            // violet-400
  velocityAsymmetry: "#7c3aed",           // violet-600
  crossCorrelation: "#6d28d9",            // violet-700
  netGlobalAsymmetry: "#c4b5fd",          // violet-300

  // Power (orange) - TIER 3 - base: var(--domain-power)
  peakAngularVelocity: "var(--domain-power)", // orange-500
  explosivenessConcentric: "#ea580c",         // orange-600
  explosivenessLoading: "#fb923c",            // orange-400

  // Control (cyan) - TIER 2 & 4 - base: var(--domain-control)
  romCoV: "#22d3ee",                    // cyan-400
  sparc: "var(--domain-control)",       // cyan-500
  ldlj: "#0891b2",                      // cyan-600
  nVelocityPeaks: "#0e7490",            // cyan-700
  rmsJerk: "#155e75",                   // cyan-800

  // Timing (pink) - TIER 3 & 4 - base: var(--domain-timing)
  maxFlexionTimingDiff: "var(--domain-timing)", // pink-500
  phaseShift: "#f472b6",                        // pink-400
  temporalLag: "#db2777",                       // pink-600
  zeroVelocityPhaseMs: "#be185d",               // pink-700
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

interface StickyTooltipState {
  data: ChartDataPoint | null;
  payload: TooltipPayload[];
  isHoveringTooltip: boolean;
}

function CustomTooltip({
  active,
  payload,
  selectedSessionId,
  selectedMetrics,
  onViewSession,
  stickyState,
  onStickyStateChange,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  selectedSessionId: string | null;
  selectedMetrics?: Set<string>;
  onViewSession?: (sessionId: string) => void;
  stickyState: StickyTooltipState;
  onStickyStateChange: (state: Partial<StickyTooltipState>) => void;
}) {
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use sticky data if hovering tooltip, otherwise use active payload
  const effectivePayload = stickyState.isHoveringTooltip ? stickyState.payload : payload;
  const isActive = active || stickyState.isHoveringTooltip;

  // Update sticky state when new data comes in
  useEffect(() => {
    if (active && payload?.[0]?.payload) {
      // Clear any pending hide timeout
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
      // Update sticky data
      onStickyStateChange({
        data: payload[0].payload,
        payload: payload,
      });
    }
  }, [active, payload, onStickyStateChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  if (!isActive || !effectivePayload?.[0]?.payload) return null;

  const data = effectivePayload[0].payload;
  const isSelected = data.sessionId === selectedSessionId;

  // Get metric definitions for formatting
  const metricDefs = new Map(METRIC_DEFINITIONS.map((m) => [m.id, m]));

  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    onStickyStateChange({ isHoveringTooltip: true });
  };

  const handleMouseLeave = () => {
    // Add a small delay before hiding to allow re-entry
    hideTimeoutRef.current = setTimeout(() => {
      onStickyStateChange({ isHoveringTooltip: false });
    }, 150);
  };

  return (
    <div
      className={cn(
        "px-3 py-2.5 rounded-xl shadow-lg text-xs min-w-[180px]",
        "bg-[var(--tropx-card)] border-2",
        isSelected
          ? "border-[var(--tropx-vibrant)]"
          : "border-[var(--tropx-border)]"
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
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
        {effectivePayload.filter(e => e.dataKey !== 'opiScore').slice(0, 4).map((entry) => {
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
        {effectivePayload.filter(e => e.dataKey !== 'opiScore').length > 4 && (
          <p className="text-[10px] text-[var(--tropx-text-sub)] text-center">
            +{effectivePayload.filter(e => e.dataKey !== 'opiScore').length - 4} more metrics
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
  // Sticky tooltip state
  const [stickyState, setStickyState] = useState<StickyTooltipState>({
    data: null,
    payload: [],
    isHoveringTooltip: false,
  });

  const handleStickyStateChange = useCallback((update: Partial<StickyTooltipState>) => {
    setStickyState((prev) => ({ ...prev, ...update }));
  }, []);

  // Get active metrics (default to OPI if none selected)
  const activeMetrics = useMemo(() => {
    if (!selectedMetrics || selectedMetrics.size === 0) {
      return new Set(["opiScore"]);
    }
    return selectedMetrics;
  }, [selectedMetrics]);

  // Transform sessions to chart data with all metrics
  const chartData = useMemo<ChartDataPoint[]>(() => {
    // Defensive: ensure sessions is an array
    if (!Array.isArray(sessions)) return [];

    return sessions
      .filter((s) => s && typeof s.sessionId === 'string') // Skip invalid entries
      .map((s) => {
        const dataPoint: ChartDataPoint = {
          sessionId: s.sessionId,
          date: s.recordedAt,
          dateLabel: formatDate(s.recordedAt),
          title: Array.isArray(s.tags) && s.tags[0] ? s.tags[0] : "Untitled",
          grade: s.opiGrade || "C",
          opiScore: typeof s.opiScore === 'number' ? s.opiScore : 0,
          previewLeftPaths: s.previewLeftPaths,
          previewRightPaths: s.previewRightPaths,
        };

        // Add all metrics from session (defensive: check metrics is an object)
        if (s.metrics && typeof s.metrics === 'object') {
          Object.entries(s.metrics).forEach(([key, value]) => {
            if (typeof value === 'number') {
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
                stickyState={stickyState}
                onStickyStateChange={handleStickyStateChange}
              />
            }
            cursor={{ stroke: "var(--tropx-vibrant)", strokeOpacity: 0.3 }}
            wrapperStyle={{ pointerEvents: 'auto' }}
            isAnimationActive={false}
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
