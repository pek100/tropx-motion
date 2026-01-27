/**
 * VectorVisualizationModal - Interactive 2D visualization of patient metrics vectors.
 *
 * Shows sessions projected from 32-dim to 2D using PCA, colored by cluster assignment.
 * Supports hover for details, time-based filtering, and cluster highlighting.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { X, Clock, TrendingUp, RotateCcw } from "lucide-react";
import {
  ComposedChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Customized,
} from "recharts";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface VectorVisualizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: Id<"users">;
  patientName?: string;
}

interface SessionPoint {
  x: number;
  y: number;
  sessionId: string;
  recordedAt: number;
  tags: string[];
  notes?: string;
  opiScore?: number;
  clusterId: string;
  clusterLabel: string;
  baseColor: string;
  displayColor: string;
  timeNormalized: number; // 0 = oldest, 1 = newest
  metrics?: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

// Convert hex to HSL for gradient manipulation
function hexToHSL(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToString(h: number, s: number, l: number): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// Create time-based gradient color
function getGradientColor(baseHex: string, timeNormalized: number): string {
  const { h } = hexToHSL(baseHex);
  // Older sessions = lighter (higher L), newer = more saturated and vibrant
  const lightness = 75 - (timeNormalized * 35); // 75% to 40%
  const saturation = 40 + (timeNormalized * 45); // 40% to 85%
  return hslToString(h, saturation, lightness);
}

// ─────────────────────────────────────────────────────────────────
// Mini Radar SVG Preview
// ─────────────────────────────────────────────────────────────────

interface MiniRadarProps {
  metrics: Record<string, number>;
  color: string;
  size?: number;
}

function MiniRadar({ metrics, color, size = 80 }: MiniRadarProps) {
  // Key metrics to display (normalized 0-1)
  const metricKeys = ["avgMaxROM", "asymmetryIndex", "avgVelocity", "avgSmoothness", "opiScore"];
  const center = size / 2;
  const radius = (size / 2) - 8;
  const angleStep = (2 * Math.PI) / metricKeys.length;

  // Normalize values (assuming rough ranges)
  const normalizeValue = (key: string, value: number): number => {
    const ranges: Record<string, [number, number]> = {
      avgMaxROM: [0, 180],
      asymmetryIndex: [0, 50], // Inverted - lower is better
      avgVelocity: [0, 300],
      avgSmoothness: [0, 1],
      opiScore: [0, 100],
    };
    const range = ranges[key] || [0, 100];
    let normalized = (value - range[0]) / (range[1] - range[0]);
    if (key === "asymmetryIndex") normalized = 1 - normalized; // Invert asymmetry
    return Math.max(0, Math.min(1, normalized));
  };

  const points = metricKeys.map((key, i) => {
    const value = metrics[key] ?? 0.5;
    const normalized = normalizeValue(key, value);
    const angle = i * angleStep - Math.PI / 2;
    return {
      x: center + normalized * radius * Math.cos(angle),
      y: center + normalized * radius * Math.sin(angle),
    };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z';

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Background circles */}
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <circle
          key={scale}
          cx={center}
          cy={center}
          r={radius * scale}
          fill="none"
          stroke="var(--tropx-border)"
          strokeWidth="0.5"
          opacity={0.5}
        />
      ))}
      {/* Axis lines */}
      {metricKeys.map((_, i) => {
        const angle = i * angleStep - Math.PI / 2;
        return (
          <line
            key={i}
            x1={center}
            y1={center}
            x2={center + radius * Math.cos(angle)}
            y2={center + radius * Math.sin(angle)}
            stroke="var(--tropx-border)"
            strokeWidth="0.5"
            opacity={0.5}
          />
        );
      })}
      {/* Data polygon */}
      <path
        d={pathD}
        fill={color}
        fillOpacity={0.3}
        stroke={color}
        strokeWidth="2"
      />
      {/* Data points */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r="3"
          fill={color}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
// Custom Tooltip with SVG Preview
// ─────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;

  const data = payload[0].payload as SessionPoint;
  const date = new Date(data.recordedAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const hasMetrics = data.metrics && Object.keys(data.metrics).length > 0;

  return (
    <div className="bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-xl p-4 shadow-xl max-w-sm backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Mini radar preview */}
        {hasMetrics && (
          <div className="flex-shrink-0">
            <MiniRadar metrics={data.metrics!} color={data.baseColor} size={72} />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: data.displayColor }}
            />
            <span className="font-semibold text-[var(--tropx-text)] truncate">
              {data.clusterLabel}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--tropx-text-sub)]">
            <Clock className="w-3 h-3" />
            <span>{date}</span>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      {hasMetrics && (
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          {data.metrics!.avgMaxROM !== undefined && (
            <div className="bg-[var(--tropx-muted)] rounded-lg px-2 py-1.5">
              <div className="text-[var(--tropx-text-sub)]">ROM</div>
              <div className="font-medium text-[var(--tropx-text)]">
                {data.metrics!.avgMaxROM.toFixed(0)}°
              </div>
            </div>
          )}
          {data.metrics!.asymmetryIndex !== undefined && (
            <div className="bg-[var(--tropx-muted)] rounded-lg px-2 py-1.5">
              <div className="text-[var(--tropx-text-sub)]">Asymmetry</div>
              <div className="font-medium text-[var(--tropx-text)]">
                {data.metrics!.asymmetryIndex.toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      )}

      {data.opiScore !== undefined && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-[var(--tropx-vibrant)]/10 rounded-lg">
          <TrendingUp className="w-3.5 h-3.5 text-[var(--tropx-vibrant)]" />
          <span className="text-xs font-medium text-[var(--tropx-text)]">
            OPI Score: {data.opiScore.toFixed(0)}
          </span>
        </div>
      )}

      {/* Tags */}
      {data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {data.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] rounded-full text-xs"
            >
              {tag}
            </span>
          ))}
          {data.tags.length > 4 && (
            <span className="px-2 py-0.5 text-[var(--tropx-text-sub)] text-xs">
              +{data.tags.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Notes */}
      {data.notes && (
        <p className="text-xs text-[var(--tropx-text-sub)] italic line-clamp-2 border-t border-[var(--tropx-border)] pt-2 mt-2">
          "{data.notes}"
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Cluster Legend
// ─────────────────────────────────────────────────────────────────

interface ClusterLegendProps {
  clusters: Array<{
    clusterId: string;
    label: string;
    sessionCount: number;
    color: string;
  }>;
  selectedCluster: string | null;
  onClusterSelect: (clusterId: string | null) => void;
}

function ClusterLegend({
  clusters,
  selectedCluster,
  onClusterSelect,
}: ClusterLegendProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {clusters.map((cluster) => (
        <button
          key={cluster.clusterId}
          onClick={() =>
            onClusterSelect(
              selectedCluster === cluster.clusterId ? null : cluster.clusterId
            )
          }
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all duration-200",
            "border",
            selectedCluster === cluster.clusterId
              ? "border-transparent shadow-sm"
              : "border-[var(--tropx-border)] hover:border-[var(--tropx-vibrant)]/50",
            selectedCluster && selectedCluster !== cluster.clusterId && "opacity-40"
          )}
          style={{
            backgroundColor: selectedCluster === cluster.clusterId
              ? `${cluster.color}20`
              : undefined,
          }}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: cluster.color }}
          />
          <span className="text-[var(--tropx-text)] font-medium">{cluster.label}</span>
          <span className="text-[var(--tropx-text-sub)] text-xs tabular-nums">
            {cluster.sessionCount}
          </span>
        </button>
      ))}
      {selectedCluster && (
        <button
          onClick={() => onClusterSelect(null)}
          className="px-2 py-1.5 text-xs text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text)] transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Dual-Range Timeline Slider (ChartPane style)
// ─────────────────────────────────────────────────────────────────

interface TimelineSliderProps {
  sessions: Array<{ recordedAt: number }>;
  range: [number, number]; // indices into sessions array
  onChange: (range: [number, number]) => void;
  onReset: () => void;
}

function TimelineSlider({ sessions, range, onChange, onReset }: TimelineSliderProps) {
  const totalSessions = sessions.length;
  const [isDraggingCenter, setIsDraggingCenter] = useState(false);
  const dragStartRef = useRef<{ x: number; range: [number, number] } | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  const formatDate = (idx: number) => {
    if (idx < 0 || idx >= sessions.length) return "—";
    return new Date(sessions[idx].recordedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  // Handle center drag
  const handleCenterDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartRef.current = { x: clientX, range: [...range] as [number, number] };
    setIsDraggingCenter(true);
  }, [range]);

  const handleCenterDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragStartRef.current || !isDraggingCenter || !sliderRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const deltaX = clientX - dragStartRef.current.x;
    const sliderWidth = sliderRef.current.getBoundingClientRect().width;
    const deltaIdx = Math.round((deltaX / sliderWidth) * (totalSessions - 1));

    const [startIdx, endIdx] = dragStartRef.current.range;
    const rangeSize = endIdx - startIdx;

    let newStart = startIdx + deltaIdx;
    let newEnd = endIdx + deltaIdx;

    // Clamp to bounds
    if (newStart < 0) {
      newStart = 0;
      newEnd = rangeSize;
    }
    if (newEnd > totalSessions - 1) {
      newEnd = totalSessions - 1;
      newStart = newEnd - rangeSize;
    }

    onChange([newStart, newEnd]);
  }, [isDraggingCenter, totalSessions, onChange]);

  const handleCenterDragEnd = useCallback(() => {
    setIsDraggingCenter(false);
    dragStartRef.current = null;
  }, []);

  // Global mouse/touch listeners for center drag
  useEffect(() => {
    if (!isDraggingCenter) return;

    window.addEventListener('mousemove', handleCenterDragMove);
    window.addEventListener('mouseup', handleCenterDragEnd);
    window.addEventListener('touchmove', handleCenterDragMove);
    window.addEventListener('touchend', handleCenterDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleCenterDragMove);
      window.removeEventListener('mouseup', handleCenterDragEnd);
      window.removeEventListener('touchmove', handleCenterDragMove);
      window.removeEventListener('touchend', handleCenterDragEnd);
    };
  }, [isDraggingCenter, handleCenterDragMove, handleCenterDragEnd]);

  if (totalSessions < 2) return null;

  return (
    <div className="flex items-center gap-3">
      {/* Start date */}
      <span className="text-xs font-medium text-[var(--tropx-text-sub)] min-w-[60px]">
        {formatDate(range[0])}
      </span>

      {/* Dual-range slider */}
      <div ref={sliderRef} className="flex-1 relative h-6 flex items-center">
        {/* Track background */}
        <div className="absolute inset-x-0 h-1.5 bg-[var(--tropx-muted)] rounded-full" />

        {/* Selected range highlight with center drag zone */}
        <div
          className={cn(
            "absolute h-1.5 rounded-full z-20 cursor-grab active:cursor-grabbing",
            isDraggingCenter && "cursor-grabbing"
          )}
          style={{
            left: `${(range[0] / (totalSessions - 1)) * 100}%`,
            right: `${100 - (range[1] / (totalSessions - 1)) * 100}%`,
            background: `repeating-linear-gradient(
              90deg,
              color-mix(in srgb, var(--tropx-vibrant) 70%, white) 0px,
              color-mix(in srgb, var(--tropx-vibrant) 70%, white) 2px,
              color-mix(in srgb, var(--tropx-vibrant) 40%, white) 2px,
              color-mix(in srgb, var(--tropx-vibrant) 40%, white) 4px
            )`,
          }}
          onMouseDown={handleCenterDragStart}
          onTouchStart={handleCenterDragStart}
        />

        {/* Left thumb */}
        <input
          type="range"
          min={0}
          max={totalSessions - 1}
          value={range[0]}
          onChange={(e) => {
            const newStart = Math.min(parseInt(e.target.value), range[1] - 1);
            onChange([Math.max(0, newStart), range[1]]);
          }}
          className={cn(
            "absolute w-full h-6 appearance-none bg-transparent pointer-events-none z-30",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--tropx-vibrant)]",
            "[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
            "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125",
            "[&::-webkit-slider-thumb]:pointer-events-auto",
            "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
            "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--tropx-vibrant)]",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
            "[&::-moz-range-thumb]:cursor-pointer",
            "[&::-moz-range-thumb]:pointer-events-auto"
          )}
        />

        {/* Right thumb */}
        <input
          type="range"
          min={0}
          max={totalSessions - 1}
          value={range[1]}
          onChange={(e) => {
            const newEnd = Math.max(parseInt(e.target.value), range[0] + 1);
            onChange([range[0], Math.min(totalSessions - 1, newEnd)]);
          }}
          className={cn(
            "absolute w-full h-6 appearance-none bg-transparent pointer-events-none z-30",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--tropx-vibrant)]",
            "[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
            "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125",
            "[&::-webkit-slider-thumb]:pointer-events-auto",
            "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4",
            "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[var(--tropx-vibrant)]",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
            "[&::-moz-range-thumb]:cursor-pointer",
            "[&::-moz-range-thumb]:pointer-events-auto"
          )}
        />
      </div>

      {/* End date */}
      <span className="text-xs font-medium text-[var(--tropx-text-sub)] min-w-[60px] text-right">
        {formatDate(range[1])}
      </span>

      {/* Reset button */}
      <button
        onClick={onReset}
        className="p-1.5 rounded-md hover:bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text)] transition-colors"
        title="Reset to all sessions"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Gradient Legend
// ─────────────────────────────────────────────────────────────────

function GradientLegend() {
  return (
    <div className="flex items-center gap-2 text-xs text-[var(--tropx-text-sub)]">
      <span>Older</span>
      <div
        className="w-16 h-2 rounded-full"
        style={{
          background: "linear-gradient(to right, hsl(14, 40%, 75%), hsl(14, 85%, 40%))"
        }}
      />
      <span>Newer</span>
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function VectorVisualizationModal({
  open,
  onOpenChange,
  patientId,
  patientName,
}: VectorVisualizationModalProps) {
  const [selectedCluster, setSelectedCluster] = useState<string | null>(null);
  const [showTrails, setShowTrails] = useState(false);

  // Fetch visualization data
  const vizData = useQuery(
    api.horus.crossAnalysis.visualization.getVisualizationData,
    open ? { patientId } : "skip"
  );

  // Session index range (not timestamp range)
  const [sessionRange, setSessionRange] = useState<[number, number] | null>(null);

  // Sort sessions by date for proper indexing
  const sortedSessions = useMemo(() => {
    if (!vizData) return [];
    return [...vizData.sessions].sort(
      (a: { recordedAt: number }, b: { recordedAt: number }) => a.recordedAt - b.recordedAt
    );
  }, [vizData]);

  // Effective range (default to all sessions)
  const effectiveRange: [number, number] = sessionRange ?? [0, sortedSessions.length - 1];

  // Reset range when modal opens with new data
  useEffect(() => {
    if (open && vizData) {
      setSessionRange(null);
    }
  }, [open, vizData?.totalSessions]);

  // Compute time normalization factor (0 = oldest, 1 = newest)
  const timeNormalizer = useMemo(() => {
    if (!vizData) return { min: 0, max: 1, range: 1 };
    const min = vizData.dateRange.earliest;
    const max = vizData.dateRange.latest;
    return { min, max, range: max - min || 1 };
  }, [vizData]);

  // Process data for chart with gradient colors
  const chartData = useMemo((): SessionPoint[] => {
    if (!vizData || sortedSessions.length === 0) return [];

    const clusterColorMap = new Map<string, string>(
      vizData.clusters.map((c: { clusterId: string; color: string }) => [c.clusterId, c.color])
    );

    // Get session IDs in the selected range
    const visibleSessionIds = new Set(
      sortedSessions
        .slice(effectiveRange[0], effectiveRange[1] + 1)
        .map((s: { sessionId: string }) => s.sessionId)
    );

    return vizData.sessions
      .filter((s: { sessionId: string; clusterId: string }) => {
        if (!visibleSessionIds.has(s.sessionId)) return false;
        if (selectedCluster && s.clusterId !== selectedCluster) return false;
        return true;
      })
      .map((s: any): SessionPoint => {
        const baseColor = clusterColorMap.get(s.clusterId) ?? "#888888";
        const timeNormalized = (s.recordedAt - timeNormalizer.min) / timeNormalizer.range;
        const displayColor = getGradientColor(baseColor, timeNormalized);

        return {
          x: s.projected.x,
          y: s.projected.y,
          sessionId: s.sessionId,
          recordedAt: s.recordedAt,
          tags: s.tags,
          notes: s.notes,
          opiScore: s.opiScore,
          clusterId: s.clusterId,
          clusterLabel: s.clusterLabel,
          baseColor,
          displayColor,
          timeNormalized,
          metrics: s.metrics,
        };
      });
  }, [vizData, sortedSessions, effectiveRange, selectedCluster, timeNormalizer]);

  // Trail points (connecting sessions chronologically)
  const trailPoints = useMemo(() => {
    if (!showTrails || !vizData || sortedSessions.length === 0) return [];

    const visibleSessions = sortedSessions.slice(effectiveRange[0], effectiveRange[1] + 1);

    return visibleSessions.map((s: any) => ({
      x: s.projected.x,
      y: s.projected.y,
    }));
  }, [vizData, sortedSessions, showTrails, effectiveRange]);

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleResetRange = useCallback(() => {
    setSessionRange(null);
  }, []);

  // Axis tick formatter - truncate to 1 decimal
  const tickFormatter = (value: number) => value.toFixed(1);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Blur overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 modal-blur-overlay cursor-default",
            "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
            "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
          )}
          onClick={handleClose}
        />

        {/* Modal content */}
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-0 z-[51] m-auto",
            "w-[95vw] max-w-5xl h-[85vh] flex flex-col",
            "bg-[var(--tropx-card)] rounded-2xl shadow-2xl border border-[var(--tropx-border)]",
            "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
            "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
            "pointer-events-auto overflow-hidden"
          )}
          onPointerDownOutside={handleClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--tropx-border)] bg-[var(--tropx-muted)]/30">
            <div>
              <h2 className="text-lg font-semibold text-[var(--tropx-text)]">
                Session Clusters
              </h2>
              <p className="text-xs text-[var(--tropx-text-sub)] mt-0.5">
                {patientName && <span className="font-medium">{patientName}</span>}
                {patientName && " · "}
                {vizData?.totalSessions ?? 0} sessions · PCA projection
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle trails */}
              <button
                onClick={() => setShowTrails(!showTrails)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                  showTrails
                    ? "bg-[var(--tropx-vibrant)] text-white shadow-sm"
                    : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text)] hover:bg-[var(--tropx-muted)]/80"
                )}
              >
                <Clock className="w-3.5 h-3.5" />
                Timeline
              </button>

              {/* Close button */}
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg p-2 hover:bg-[var(--tropx-muted)] transition-colors"
              >
                <X className="w-4 h-4 text-[var(--tropx-text-sub)]" />
              </button>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
            {!vizData ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-[var(--tropx-vibrant)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-[var(--tropx-text-sub)]">
                    {vizData === null
                      ? "Not enough sessions (need at least 2)"
                      : "Loading visualization..."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Controls row */}
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  {/* Cluster legend */}
                  <ClusterLegend
                    clusters={vizData.clusters}
                    selectedCluster={selectedCluster}
                    onClusterSelect={setSelectedCluster}
                  />

                  {/* Gradient legend */}
                  <GradientLegend />
                </div>

                {/* Timeline slider */}
                <div className="px-2">
                  <TimelineSlider
                    sessions={sortedSessions}
                    range={effectiveRange}
                    onChange={setSessionRange}
                    onReset={handleResetRange}
                  />
                </div>

                {/* Chart */}
                <div className="flex-1 min-h-0 bg-[var(--tropx-muted)]/20 rounded-xl p-2 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      margin={{ top: 16, right: 16, bottom: 32, left: 32 }}
                    >
                      <XAxis
                        type="number"
                        dataKey="x"
                        domain={[vizData.bounds.minX, vizData.bounds.maxX]}
                        name="PC1"
                        tickFormatter={tickFormatter}
                        tick={{ fill: "var(--tropx-text-sub)", fontSize: 10 }}
                        axisLine={{ stroke: "var(--tropx-border)", strokeOpacity: 0.5 }}
                        tickLine={false}
                        tickCount={7}
                        label={{
                          value: "Component 1",
                          position: "bottom",
                          offset: 16,
                          fill: "var(--tropx-text-sub)",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        type="number"
                        dataKey="y"
                        domain={[vizData.bounds.minY, vizData.bounds.maxY]}
                        name="PC2"
                        tickFormatter={tickFormatter}
                        tick={{ fill: "var(--tropx-text-sub)", fontSize: 10 }}
                        axisLine={{ stroke: "var(--tropx-border)", strokeOpacity: 0.5 }}
                        tickLine={false}
                        tickCount={7}
                        label={{
                          value: "Component 2",
                          angle: -90,
                          position: "left",
                          offset: 16,
                          fill: "var(--tropx-text-sub)",
                          fontSize: 11,
                        }}
                      />

                      {/* Origin lines */}
                      <ReferenceLine x={0} stroke="var(--tropx-border)" strokeDasharray="4 4" strokeOpacity={0.4} />
                      <ReferenceLine y={0} stroke="var(--tropx-border)" strokeDasharray="4 4" strokeOpacity={0.4} />

                      {/* Timeline trail line (rendered first so points appear on top) */}
                      {showTrails && trailPoints.length > 1 && (
                        <Customized
                          component={(props: any) => {
                            const { xAxisMap, yAxisMap } = props;
                            if (!xAxisMap || !yAxisMap) return null;

                            const xAxis = Object.values(xAxisMap)[0] as any;
                            const yAxis = Object.values(yAxisMap)[0] as any;
                            if (!xAxis?.scale || !yAxis?.scale) return null;

                            // Convert data coordinates to pixel coordinates
                            const pixelPoints = trailPoints.map((p) => ({
                              x: xAxis.scale(p.x),
                              y: yAxis.scale(p.y),
                            })).filter((p) => !isNaN(p.x) && !isNaN(p.y));

                            if (pixelPoints.length < 2) return null;

                            const pathD = pixelPoints
                              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                              .join(' ');

                            return (
                              <g className="timeline-trail">
                                <defs>
                                  <linearGradient id="trailGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                    <stop offset="0%" stopColor="#ff4d35" stopOpacity="0.3" />
                                    <stop offset="100%" stopColor="#ff4d35" stopOpacity="0.8" />
                                  </linearGradient>
                                </defs>
                                <path
                                  d={pathD}
                                  fill="none"
                                  stroke="url(#trailGrad)"
                                  strokeWidth={2}
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                                {/* Direction markers */}
                                {pixelPoints
                                  .filter((_, i) => i > 0 && i % Math.max(1, Math.floor(pixelPoints.length / 6)) === 0)
                                  .map((p, i) => (
                                    <circle
                                      key={i}
                                      cx={p.x}
                                      cy={p.y}
                                      r={4}
                                      fill="#ff4d35"
                                      opacity={0.7}
                                    />
                                  ))}
                              </g>
                            );
                          }}
                        />
                      )}

                      {/* Session points */}
                      <Scatter
                        data={chartData}
                        shape="circle"
                        fill="#888"
                      >
                        {chartData.map((entry: SessionPoint) => (
                          <Cell
                            key={entry.sessionId}
                            fill={entry.displayColor}
                            fillOpacity={0.9}
                            stroke={entry.baseColor}
                            strokeWidth={1.5}
                            style={{ cursor: 'pointer' }}
                          />
                        ))}
                      </Scatter>

                      {/* Cluster centroids */}
                      <Scatter
                        data={vizData.clusters.map((c: any) => ({
                          x: c.centroid2D.x,
                          y: c.centroid2D.y,
                          label: c.label,
                          color: c.color,
                        }))}
                        shape="diamond"
                        fill="#fff"
                      >
                        {vizData.clusters.map((c: any) => (
                          <Cell
                            key={c.clusterId}
                            fill={c.color}
                            stroke="white"
                            strokeWidth={2}
                          />
                        ))}
                      </Scatter>

                      <Tooltip
                        content={<CustomTooltip />}
                        cursor={{ strokeDasharray: '3 3', stroke: 'var(--tropx-vibrant)', strokeOpacity: 0.5 }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>

                {/* Stats footer */}
                <div className="flex items-center justify-between text-xs text-[var(--tropx-text-sub)] px-1">
                  <span>
                    Showing <span className="font-medium text-[var(--tropx-text)]">{chartData.length}</span> of {vizData.totalSessions} sessions
                  </span>
                  <span>
                    <span className="font-medium text-[var(--tropx-text)]">{vizData.clusters.length}</span> clusters · Hover for details
                  </span>
                </div>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default VectorVisualizationModal;
