/**
 * SessionChart - Knee angle waveforms for selected session.
 * Larger version of MiniRecordingChart with legend and better visualization.
 * Supports asymmetry event overlay to highlight time windows of detected asymmetries.
 */

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  AreaChart,
  Area,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { cn } from "@/lib/utils";
import { Loader2, Layers, GitCompareArrows, SlidersHorizontal, Play, Pause, ZoomIn, RotateCcw, Combine } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PhaseAdjustModal } from "./PhaseAdjustModal";
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
  /** Callback when user applies a custom phase offset (triggers recalculation) */
  onPhaseOffsetApply?: (newOffsetMs: number) => void;
}

interface ChartDataPoint {
  time: number;
  timeLabel: string;
  left: number | null;
  right: number | null;
  // Multi-axis data: left_x, left_y, left_z, right_x, right_y, right_z
  [key: string]: number | string | null;
}

interface PhaseDataPoint {
  x: number; // right knee
  y: number; // left knee
  time: number;
}

type ChartViewMode = "waveform" | "phase";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const LEFT_KNEE_COLOR = "#f97066"; // coral
const RIGHT_KNEE_COLOR = "#60a5fa"; // blue
const ZOOM_WINDOW_SAMPLES = 200; // Number of samples to show when zoomed

// Multi-axis mode colors (Tailwind tokens)
const AXIS_COLORS = {
  x: "#d946ef", // fuchsia-500
  y: "#06b6d4", // cyan-500
  z: "#8b5cf6", // violet-500
} as const;

// Asymmetry overlay colors
const LEFT_DOMINANT_COLOR = "#f97066"; // coral (same as left knee)
const RIGHT_DOMINANT_COLOR = "#60a5fa"; // blue (same as right knee)
const OVERLAP_COLOR = "#a855f7"; // purple for overlapping regions
const ASYMMETRY_OPACITY = 0.25; // Base opacity for overlays

// ─────────────────────────────────────────────────────────────────
// Overlap Detection
// ─────────────────────────────────────────────────────────────────

interface ShiftedEvent {
  startTimeMs: number;
  endTimeMs: number;
  direction: "left_dominant" | "right_dominant";
  avgAsymmetry: number;
}

interface OverlapRegion {
  startTimeMs: number;
  endTimeMs: number;
  avgAsymmetry: number; // average of both overlapping events
}

/** Find overlapping time regions between left and right dominant events */
function findOverlappingRegions(
  events: Array<{ startTimeMs: number; endTimeMs: number; direction: "left_dominant" | "right_dominant"; avgAsymmetry: number }>,
  currentShiftMs: number
): OverlapRegion[] {
  // Separate and shift events by direction
  const leftEvents: ShiftedEvent[] = [];
  const rightEvents: ShiftedEvent[] = [];

  for (const event of events) {
    const shift = event.direction === "left_dominant" ? currentShiftMs : -currentShiftMs;
    const shifted: ShiftedEvent = {
      startTimeMs: event.startTimeMs + shift,
      endTimeMs: event.endTimeMs + shift,
      direction: event.direction,
      avgAsymmetry: event.avgAsymmetry,
    };
    if (event.direction === "left_dominant") {
      leftEvents.push(shifted);
    } else {
      rightEvents.push(shifted);
    }
  }

  // Find overlaps between left and right events
  const overlaps: OverlapRegion[] = [];

  for (const left of leftEvents) {
    for (const right of rightEvents) {
      // Check for overlap
      const overlapStart = Math.max(left.startTimeMs, right.startTimeMs);
      const overlapEnd = Math.min(left.endTimeMs, right.endTimeMs);

      if (overlapStart < overlapEnd) {
        overlaps.push({
          startTimeMs: overlapStart,
          endTimeMs: overlapEnd,
          avgAsymmetry: (left.avgAsymmetry + right.avgAsymmetry) / 2,
        });
      }
    }
  }

  return overlaps;
}

// Animation
const PHASE_ANIMATION_DURATION_MS = 400;
const ANIMATION_FRAME_INTERVAL_MS = 32; // ~30fps for smoother perf
const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

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

  // Parse dataKey to get knee side and axis (e.g., "left_x" -> { knee: "Left", axis: "X" })
  const parseDataKey = (dataKey: string) => {
    if (dataKey === "left") return { knee: "Left", axis: null };
    if (dataKey === "right") return { knee: "Right", axis: null };
    const match = dataKey.match(/^(left|right)_([xyz])$/);
    if (match) {
      return {
        knee: match[1] === "left" ? "Left" : "Right",
        axis: match[2].toUpperCase(),
      };
    }
    return { knee: dataKey, axis: null };
  };

  return (
    <div className="px-3 py-2 rounded-lg shadow-lg border border-[var(--tropx-border)] bg-[var(--tropx-card)] text-xs">
      <p className="text-[var(--tropx-text-sub)] mb-1">{timeLabel}</p>
      <div className="space-y-1">
        {payload.map((item) => {
          const { knee, axis } = parseDataKey(item.dataKey);
          const label = axis ? `${knee} (${axis})` : knee;
          return (
            <div key={item.dataKey} className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[var(--tropx-text-main)]">
                {label}: <strong>{item.value.toFixed(1)}°</strong>
              </span>
            </div>
          );
        })}
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
  onPhaseOffsetApply,
}: SessionChartProps) {
  // Chart view mode (waveform vs phase diagram)
  const [chartViewMode, setChartViewMode] = useState<ChartViewMode>("waveform");

  // Axis selection for angle extraction (x, y, z)
  const [selectedAxis, setSelectedAxis] = useState<"x" | "y" | "z">("y");

  // Multi-axis mode: allows selecting multiple axes at once
  const [multiAxisMode, setMultiAxisMode] = useState(false);
  const [selectedAxes, setSelectedAxes] = useState<Set<"x" | "y" | "z">>(new Set(["y"]));

  // Toggle axis in multi-mode
  const toggleAxis = useCallback((axis: "x" | "y" | "z") => {
    if (multiAxisMode) {
      setSelectedAxes((prev) => {
        const next = new Set(prev);
        if (next.has(axis)) {
          // Don't allow deselecting if it's the only one
          if (next.size > 1) next.delete(axis);
        } else {
          next.add(axis);
        }
        return next;
      });
    } else {
      setSelectedAxis(axis);
    }
  }, [multiAxisMode]);

  // Toggle multi-axis mode
  const toggleMultiAxisMode = useCallback(() => {
    setMultiAxisMode((prev) => {
      if (!prev) {
        // Entering multi-mode: initialize selectedAxes with current single axis
        setSelectedAxes(new Set([selectedAxis]));
      } else {
        // Exiting multi-mode: set single axis to first of selected
        const firstAxis = Array.from(selectedAxes)[0] || "y";
        setSelectedAxis(firstAxis);
      }
      return !prev;
    });
  }, [selectedAxis, selectedAxes]);

  // Knee visibility toggle states
  const [kneeVisibility, setKneeVisibility] = useState({
    left: true,
    right: true,
  });

  // Toggle states
  const [showAsymmetryOverlay, setShowAsymmetryOverlay] = useState(true);
  const [applyPhaseShift, setApplyPhaseShift] = useState(false);

  // Toggle knee visibility
  const toggleKneeVisibility = useCallback((knee: "left" | "right") => {
    setKneeVisibility((prev) => ({
      ...prev,
      [knee]: !prev[knee],
    }));
  }, []);

  // Modal state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);

  // Animation state (0 = unshifted, 1 = fully shifted)
  const [animationProgress, setAnimationProgress] = useState(0);
  const animationRef = useRef<number | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeRange, setTimeRange] = useState<[number, number]>([0, 0]); // [startTime, endTime] in ms
  const [isZoomed, setIsZoomed] = useState(true); // Zoom to window (enabled by default)
  const playbackRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  // For center drag on range slider
  const [isDraggingCenter, setIsDraggingCenter] = useState(false);
  const dragStartRef = useRef<{ x: number; range: [number, number] } | null>(null);

  // Check if asymmetry data is available
  const hasAsymmetryData = asymmetryEvents?.events && asymmetryEvents.events.length > 0;

  // Get phase alignment data
  // phaseOffsetMs = currently applied offset (may be manually adjusted)
  // defaultPhaseAlignment = calculated optimal (for display and reset)
  const phaseOffsetMs = asymmetryEvents?.phaseOffsetMs ?? 0;
  const defaultPhaseAlignment = asymmetryEvents?.defaultPhaseAlignment;
  const hasPhaseShift = phaseOffsetMs !== 0 || defaultPhaseAlignment !== null;

  // Animate phase shift with throttled updates
  const animatePhaseShift = useCallback((targetProgress: number) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const startProgress = animationProgress;
    const startTime = performance.now();
    let lastUpdateTime = 0;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const t = Math.min(elapsed / PHASE_ANIMATION_DURATION_MS, 1);

      // Throttle updates to reduce re-renders
      if (currentTime - lastUpdateTime >= ANIMATION_FRAME_INTERVAL_MS || t >= 1) {
        lastUpdateTime = currentTime;
        const easedT = EASE_OUT_CUBIC(t);
        const newProgress = startProgress + (targetProgress - startProgress) * easedT;
        setAnimationProgress(newProgress);
      }

      if (t < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [animationProgress]);

  // Handle toggle with animation
  const handlePhaseShiftToggle = useCallback((checked: boolean) => {
    setApplyPhaseShift(checked);
    animatePhaseShift(checked ? 1 : 0);
  }, [animatePhaseShift]);

  // No auto-animation on load - user must toggle manually
  // (Removed auto-animation to avoid unexpected behavior)

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // Determine which axes to compute
  const axesToCompute = multiAxisMode ? Array.from(selectedAxes) : [selectedAxis];

  // Pre-compute base data and shift info (expensive unpack only once)
  const { baseData, multiAxisData, maxHalfShift } = useMemo(() => {
    type AxisSamples = { left: number; right: number }[];
    const emptyResult = {
      baseData: { samples: [] as AxisSamples, durationMs: 0, step: 1 },
      multiAxisData: {} as Record<"x" | "y" | "z", AxisSamples>,
      maxHalfShift: 0,
    };

    // Defensive: validate packedData structure (could be corrupted cache)
    if (!packedData || typeof packedData !== 'object') {
      return emptyResult;
    }

    if (typeof packedData.sampleCount !== 'number' || packedData.sampleCount === 0) {
      return emptyResult;
    }

    // Defensive: ensure required properties exist
    if (typeof packedData.startTime !== 'number' || typeof packedData.endTime !== 'number') {
      return emptyResult;
    }

    const durationMs = packedData.endTime - packedData.startTime;

    // For multi-axis mode, compute all selected axes
    const axisData: Record<"x" | "y" | "z", AxisSamples> = { x: [], y: [], z: [] };
    let primarySamples: AxisSamples = [];

    for (const axis of axesToCompute) {
      try {
        const samples = unpackToAngles(packedData, axis);
        axisData[axis] = samples;
        if (axis === axesToCompute[0]) {
          primarySamples = samples;
        }
      } catch (error) {
        console.error(`[SessionChart] Failed to unpack angles for axis ${axis}:`, error);
      }
    }

    if (primarySamples.length === 0) {
      return emptyResult;
    }

    // Calculate EFFECTIVE sample rate from actual data
    const effectiveSampleRate = durationMs > 0
      ? (primarySamples.length / durationMs) * 1000
      : (asymmetryEvents?.sampleRate ?? packedData.sampleRate);

    // Calculate max phase shift using EFFECTIVE sample rate of displayed data
    const maxPhaseShiftSamples = phaseOffsetMs !== 0
      ? Math.round((phaseOffsetMs / 1000) * effectiveSampleRate)
      : 0;

    // Downsample step
    const step = 1; // Use all data points

    return {
      baseData: { samples: primarySamples, durationMs, step },
      multiAxisData: axisData,
      maxHalfShift: Math.round(maxPhaseShiftSamples / 2),
    };
  }, [packedData, phaseOffsetMs, asymmetryEvents?.sampleRate, axesToCompute.join(",")]);

  // Calculate current shift in milliseconds (for asymmetry overlay positioning)
  const currentShiftMs = useMemo(() => {
    const { samples, durationMs } = baseData;
    if (samples.length === 0) return 0;

    const currentHalfShift = Math.round(maxHalfShift * animationProgress);

    // Convert sample shift to time shift
    return (currentHalfShift / samples.length) * durationMs;
  }, [baseData, maxHalfShift, animationProgress]);

  // Calculate overlapping asymmetry regions (where left and right dominant events overlap after shifting)
  // Only compute when overlay is visible to avoid unnecessary recalculations
  const overlappingRegions = useMemo(() => {
    if (!showAsymmetryOverlay || !asymmetryEvents?.events || asymmetryEvents.events.length === 0) {
      return [];
    }
    return findOverlappingRegions(asymmetryEvents.events, currentShiftMs);
  }, [showAsymmetryOverlay, asymmetryEvents?.events, currentShiftMs]);

  // Apply animated shift to create chart data (cheap - just index math)
  const chartData = useMemo<ChartDataPoint[]>(() => {
    const { samples, durationMs, step } = baseData;
    if (samples.length === 0) return [];

    const currentHalfShift = Math.round(maxHalfShift * animationProgress);
    const points: ChartDataPoint[] = [];

    for (let i = 0; i < samples.length; i += step) {
      const progress = i / samples.length;
      const timeMs = progress * durationMs;

      // Sliding shift - each signal moves towards center
      const leftIndex = i - currentHalfShift;
      const rightIndex = i + currentHalfShift;

      const point: ChartDataPoint = {
        time: timeMs,
        timeLabel: formatTimeMs(timeMs),
        left: (leftIndex >= 0 && leftIndex < samples.length)
          ? samples[leftIndex].left
          : null,
        right: (rightIndex >= 0 && rightIndex < samples.length)
          ? samples[rightIndex].right
          : null,
      };

      // Add multi-axis data when in multi-axis mode
      if (multiAxisMode) {
        for (const axis of axesToCompute) {
          const axisSamples = multiAxisData[axis];
          if (axisSamples && axisSamples.length > 0) {
            point[`left_${axis}`] = (leftIndex >= 0 && leftIndex < axisSamples.length)
              ? axisSamples[leftIndex].left
              : null;
            point[`right_${axis}`] = (rightIndex >= 0 && rightIndex < axisSamples.length)
              ? axisSamples[rightIndex].right
              : null;
          }
        }
      }

      points.push(point);
    }

    return points;
  }, [baseData, multiAxisData, maxHalfShift, animationProgress, multiAxisMode, axesToCompute]);

  // Calculate Y-axis domain
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-45, 90];

    let allValues: number[];

    if (multiAxisMode) {
      // In multi-axis mode, collect values from all selected axes
      allValues = chartData.flatMap((p) => {
        const values: (number | null)[] = [];
        for (const axis of axesToCompute) {
          values.push(p[`left_${axis}`] as number | null);
          values.push(p[`right_${axis}`] as number | null);
        }
        return values;
      }).filter((v): v is number => v !== null);
    } else {
      allValues = chartData
        .flatMap((p) => [p.left, p.right])
        .filter((v): v is number => v !== null);
    }

    if (allValues.length === 0) return [-45, 90];

    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1;

    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData, multiAxisMode, axesToCompute]);

  // Get session duration from chart data (must be before other calculations)
  const sessionDuration = useMemo(() => {
    if (chartData.length === 0) return 0;
    return chartData[chartData.length - 1].time;
  }, [chartData]);

  // Reset timeRange when new session data loads
  useEffect(() => {
    if (sessionDuration > 0) {
      setTimeRange([0, sessionDuration]);
      setIsPlaying(false);
    }
  }, [packedData]); // Reset when packedData changes (new session loaded)

  // Update end time if session duration changes (e.g., after initial load)
  useEffect(() => {
    if (sessionDuration > 0 && timeRange[1] === 0) {
      setTimeRange([0, sessionDuration]);
    }
  }, [sessionDuration]);

  // Visible chart data - filter by timeRange
  const visibleChartData = useMemo(() => {
    if (chartData.length === 0) return [];

    const [startTime, endTime] = timeRange;

    // If range covers full session, return all data
    if (startTime === 0 && endTime >= sessionDuration) {
      return chartData;
    }

    // Filter samples within the time range
    return chartData.filter((p) => p.time >= startTime && p.time <= endTime);
  }, [chartData, timeRange, sessionDuration]);

  // X-axis domain - zoomed uses timeRange, not zoomed shows full session
  const xAxisDomain = useMemo((): [number, number] => {
    if (!isZoomed) return [0, sessionDuration];
    const [startTime, endTime] = timeRange;
    if (startTime === endTime) return [0, sessionDuration];
    return [startTime, endTime];
  }, [isZoomed, timeRange, sessionDuration]);

  // Phase diagram data (right knee = X, left knee = Y)
  // Uses same visible data for consistency
  const phaseData = useMemo<PhaseDataPoint[]>(() => {
    return visibleChartData
      .filter((p) => p.left !== null && p.right !== null)
      .map((p) => ({
        x: p.right as number,
        y: p.left as number,
        time: p.time,
      }));
  }, [visibleChartData]);

  // Phase diagram axis domain (fixed scale for consistency)
  const phaseDomain: [number, number] = [-20, 180];

  // Calculate default window size based on zoom samples
  const defaultWindowSize = useMemo(() => {
    if (chartData.length === 0 || sessionDuration === 0) return sessionDuration;
    return (ZOOM_WINDOW_SAMPLES / chartData.length) * sessionDuration;
  }, [chartData.length, sessionDuration]);

  // Playback animation loop - slides the window forward
  useEffect(() => {
    if (!isPlaying || sessionDuration === 0) {
      if (playbackRef.current) {
        cancelAnimationFrame(playbackRef.current);
        playbackRef.current = null;
      }
      return;
    }

    const playbackSpeed = 1; // 1x speed
    lastFrameTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastFrameTimeRef.current;
      lastFrameTimeRef.current = currentTime;

      setTimeRange((prev) => {
        const windowSize = prev[1] - prev[0];
        const newEnd = prev[1] + deltaTime * playbackSpeed;

        if (newEnd >= sessionDuration) {
          setIsPlaying(false);
          return [sessionDuration - windowSize, sessionDuration];
        }

        return [newEnd - windowSize, newEnd];
      });

      playbackRef.current = requestAnimationFrame(animate);
    };

    playbackRef.current = requestAnimationFrame(animate);

    return () => {
      if (playbackRef.current) {
        cancelAnimationFrame(playbackRef.current);
        playbackRef.current = null;
      }
    };
  }, [isPlaying, sessionDuration]);

  // Toggle play/pause
  const togglePlayback = useCallback(() => {
    setIsPlaying((prev) => {
      if (!prev) {
        // Starting playback - set up window if at end or showing full session
        if (timeRange[1] >= sessionDuration || (timeRange[0] === 0 && timeRange[1] === sessionDuration)) {
          setTimeRange([0, Math.min(defaultWindowSize, sessionDuration)]);
        }
      }
      return !prev;
    });
  }, [timeRange, sessionDuration, defaultWindowSize]);

  // Handle range slider change
  const handleRangeChange = useCallback((newRange: [number, number]) => {
    setTimeRange(newRange);
  }, []);

  // Handle center drag of range slider
  const handleCenterDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartRef.current = { x: clientX, range: [...timeRange] as [number, number] };
    setIsDraggingCenter(true);
  }, [timeRange]);

  const handleCenterDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragStartRef.current || !isDraggingCenter) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const sliderWidth = (e.target as HTMLElement)?.closest('.range-slider-container')?.clientWidth || 1;
    const deltaX = clientX - dragStartRef.current.x;
    const deltaTime = (deltaX / sliderWidth) * sessionDuration;

    const windowSize = dragStartRef.current.range[1] - dragStartRef.current.range[0];
    let newStart = dragStartRef.current.range[0] + deltaTime;
    let newEnd = dragStartRef.current.range[1] + deltaTime;

    // Clamp to valid range
    if (newStart < 0) {
      newStart = 0;
      newEnd = windowSize;
    }
    if (newEnd > sessionDuration) {
      newEnd = sessionDuration;
      newStart = sessionDuration - windowSize;
    }

    setTimeRange([newStart, newEnd]);
  }, [isDraggingCenter, sessionDuration]);

  const handleCenterDragEnd = useCallback(() => {
    setIsDraggingCenter(false);
    dragStartRef.current = null;
  }, []);

  // Add global mouse/touch listeners for center drag
  useEffect(() => {
    if (isDraggingCenter) {
      window.addEventListener('mousemove', handleCenterDragMove);
      window.addEventListener('mouseup', handleCenterDragEnd);
      window.addEventListener('touchmove', handleCenterDragMove);
      window.addEventListener('touchend', handleCenterDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleCenterDragMove);
      window.removeEventListener('mouseup', handleCenterDragEnd);
      window.removeEventListener('touchmove', handleCenterDragMove);
      window.removeEventListener('touchend', handleCenterDragEnd);
    };
  }, [isDraggingCenter, handleCenterDragMove, handleCenterDragEnd]);

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
      {/* Chart controls - unified row */}
      <div className="flex items-center justify-between gap-2 mb-2 px-1 flex-wrap">
        {/* Left side: Unified tabs for chart type + L/R toggles */}
        <div className="inline-flex items-center gap-0.5 p-1 rounded-lg bg-[var(--tropx-muted)] border border-[var(--tropx-border)]">
          {/* Chart view mode dropdown styled as tab */}
          <select
            value={chartViewMode}
            onChange={(e) => setChartViewMode(e.target.value as ChartViewMode)}
            className={cn(
              "h-6 px-2 rounded-md text-xs font-medium cursor-pointer",
              "bg-transparent border-0",
              "text-[var(--tropx-text-main)]",
              "focus:outline-none focus:ring-0",
              "hover:bg-[var(--tropx-card)]"
            )}
          >
            <option value="waveform">Waveform</option>
            <option value="phase">Phase Plot</option>
          </select>

          {/* Divider + Multi-axis toggle + Axis selection tabs (X, Y, Z) */}
          <div className="w-px h-4 bg-[var(--tropx-border)]" />
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={toggleMultiAxisMode}
                className={cn(
                  "size-6 rounded-md flex items-center justify-center transition-all",
                  "hover:scale-105 active:scale-95",
                  multiAxisMode
                    ? "bg-[var(--tropx-vibrant)] text-white shadow-sm"
                    : "bg-transparent text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-card)]"
                )}
              >
                <Combine className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {multiAxisMode ? "Single axis mode" : "Multi-axis mode"}
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggleAxis("x")}
                className={cn(
                  "size-6 rounded-md flex items-center justify-center transition-all",
                  "hover:scale-105 active:scale-95",
                  (multiAxisMode ? selectedAxes.has("x") : selectedAxis === "x")
                    ? "bg-fuchsia-500 text-white shadow-sm"
                    : "bg-transparent text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-card)]"
                )}
              >
                <span className="text-xs font-bold">X</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              X-Axis (Roll)
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggleAxis("y")}
                className={cn(
                  "size-6 rounded-md flex items-center justify-center transition-all",
                  "hover:scale-105 active:scale-95",
                  (multiAxisMode ? selectedAxes.has("y") : selectedAxis === "y")
                    ? "bg-cyan-500 text-white shadow-sm"
                    : "bg-transparent text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-card)]"
                )}
              >
                <span className="text-xs font-bold">Y</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Y-Axis (Pitch)
            </TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggleAxis("z")}
                className={cn(
                  "size-6 rounded-md flex items-center justify-center transition-all",
                  "hover:scale-105 active:scale-95",
                  (multiAxisMode ? selectedAxes.has("z") : selectedAxis === "z")
                    ? "bg-violet-500 text-white shadow-sm"
                    : "bg-transparent text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-card)]"
                )}
              >
                <span className="text-xs font-bold">Z</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Z-Axis (Yaw)
            </TooltipContent>
          </Tooltip>

          {/* Divider + Knee visibility toggles (only show for waveform mode) */}
          {chartViewMode === "waveform" && (
            <>
              <div className="w-px h-4 bg-[var(--tropx-border)]" />
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => toggleKneeVisibility("left")}
                    className={cn(
                      "size-6 rounded-md flex items-center justify-center transition-all",
                      "hover:scale-105 active:scale-95",
                      kneeVisibility.left
                        ? "bg-blue-400 text-white shadow-sm"
                        : "bg-transparent text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-card)]"
                    )}
                  >
                    <span className="text-xs font-bold">L</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {kneeVisibility.left ? "Hide" : "Show"} Left Knee
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => toggleKneeVisibility("right")}
                    className={cn(
                      "size-6 rounded-md flex items-center justify-center transition-all",
                      "hover:scale-105 active:scale-95",
                      kneeVisibility.right
                        ? "bg-red-400 text-white shadow-sm"
                        : "bg-transparent text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-card)]"
                    )}
                  >
                    <span className="text-xs font-bold">R</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {kneeVisibility.right ? "Hide" : "Show"} Right Knee
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>

        {/* Right side: Phase/Asymmetry controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Phase Alignment Controls */}
          {hasPhaseShift && (
            <div className="flex items-center gap-1">
              {/* Adjust button */}
              {onPhaseOffsetApply && (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setIsAdjustModalOpen(true)}
                      className={cn(
                        "size-7 rounded-md flex items-center justify-center transition-all",
                        "border shadow-sm hover:scale-105 active:scale-95",
                        "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] border-[var(--tropx-border)]",
                        "hover:border-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)]"
                      )}
                    >
                      <SlidersHorizontal className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    Adjust Phase Offset ({phaseOffsetMs.toFixed(0)}ms)
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Phase align toggle */}
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => handlePhaseShiftToggle(!applyPhaseShift)}
                    className={cn(
                      "size-7 rounded-md flex items-center justify-center transition-all",
                      "border hover:scale-105 active:scale-95",
                      applyPhaseShift
                        ? "bg-[var(--tropx-vibrant)] text-white border-[var(--tropx-vibrant)] shadow-md shadow-[var(--tropx-vibrant)]/25"
                        : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] border-[var(--tropx-border)] shadow-sm"
                    )}
                  >
                    <GitCompareArrows className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {applyPhaseShift ? "Disable" : "Enable"} Phase Alignment ({phaseOffsetMs.toFixed(0)}ms)
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Asymmetry Overlay Toggle */}
          {hasAsymmetryData && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowAsymmetryOverlay(!showAsymmetryOverlay)}
                  className={cn(
                    "size-7 rounded-md flex items-center justify-center transition-all",
                    "border hover:scale-105 active:scale-95",
                    showAsymmetryOverlay
                      ? "bg-[var(--tropx-vibrant)] text-white border-[var(--tropx-vibrant)] shadow-md shadow-[var(--tropx-vibrant)]/25"
                      : "bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] border-[var(--tropx-border)] shadow-sm"
                  )}
                >
                  <Layers className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <div className="flex flex-col gap-1">
                  <span>{showAsymmetryOverlay ? "Hide" : "Show"} Asymmetry Events ({asymmetryEvents!.events.length})</span>
                  {showAsymmetryOverlay && (
                    <div className="flex items-center gap-2 pt-1 border-t border-[var(--tropx-border)]">
                      <span className="flex items-center gap-1">
                        <span
                          className="size-2 rounded-sm"
                          style={{ backgroundColor: LEFT_DOMINANT_COLOR, opacity: 0.6 }}
                        />
                        Left
                      </span>
                      <span className="flex items-center gap-1">
                        <span
                          className="size-2 rounded-sm"
                          style={{ backgroundColor: RIGHT_DOMINANT_COLOR, opacity: 0.6 }}
                        />
                        Right
                      </span>
                      {overlappingRegions.length > 0 && (
                        <span className="flex items-center gap-1">
                          <span
                            className="size-2 rounded-sm border border-purple-400"
                            style={{
                              background: `repeating-linear-gradient(45deg, ${LEFT_DOMINANT_COLOR}66, ${LEFT_DOMINANT_COLOR}66 2px, ${RIGHT_DOMINANT_COLOR}66 2px, ${RIGHT_DOMINANT_COLOR}66 4px)`,
                            }}
                          />
                          Overlap
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Loading state */}
          {asymmetryEvents === undefined && !hasAsymmetryData && !hasPhaseShift && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <div className="size-7 rounded-md flex items-center justify-center bg-[var(--tropx-muted)] border border-[var(--tropx-border)]">
                  <Loader2 className="size-3.5 animate-spin text-[var(--tropx-text-sub)] opacity-50" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Loading metrics...
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Phase Adjust Modal */}
      <PhaseAdjustModal
        open={isAdjustModalOpen}
        onOpenChange={setIsAdjustModalOpen}
        packedData={packedData}
        currentOffsetMs={phaseOffsetMs}
        defaultPhaseAlignment={defaultPhaseAlignment ?? null}
        sampleRate={asymmetryEvents?.sampleRate}
        onApply={(newOffsetMs) => {
          onPhaseOffsetApply?.(newOffsetMs);
        }}
      />

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          {chartViewMode === "waveform" ? (
            <AreaChart
              data={visibleChartData as any}
              margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
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
                {/* Multi-axis mode gradients - subtle fill per axis */}
                <linearGradient id="leftKneeGradient_x" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.x} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={AXIS_COLORS.x} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="rightKneeGradient_x" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.x} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={AXIS_COLORS.x} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="leftKneeGradient_y" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.y} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={AXIS_COLORS.y} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="rightKneeGradient_y" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.y} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={AXIS_COLORS.y} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="leftKneeGradient_z" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.z} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={AXIS_COLORS.z} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="rightKneeGradient_z" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={AXIS_COLORS.z} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={AXIS_COLORS.z} stopOpacity={0.05} />
                </linearGradient>
                {/* Diagonal stripe pattern for overlapping asymmetry regions */}
                <pattern
                  id="diagonalStripes"
                  patternUnits="userSpaceOnUse"
                  width="8"
                  height="8"
                  patternTransform="rotate(45)"
                >
                  <line
                    x1="0" y1="0" x2="0" y2="8"
                    stroke={LEFT_DOMINANT_COLOR}
                    strokeWidth="4"
                    strokeOpacity="0.4"
                  />
                  <line
                    x1="4" y1="0" x2="4" y2="8"
                    stroke={RIGHT_DOMINANT_COLOR}
                    strokeWidth="4"
                    strokeOpacity="0.4"
                  />
                </pattern>
              </defs>

              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-700" />

              <XAxis
                dataKey="time"
                type="number"
                domain={xAxisDomain}
                allowDataOverflow={false}
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
                asymmetryEvents!.events.map((event, index) => {
                  const eventShift = event.direction === "left_dominant"
                    ? currentShiftMs
                    : -currentShiftMs;
                  return (
                    <ReferenceArea
                      key={`asymmetry-${index}`}
                      x1={event.startTimeMs + eventShift}
                      x2={event.endTimeMs + eventShift}
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
                      ifOverflow="hidden"
                    />
                  );
                })}

              {/* Overlapping asymmetry regions */}
              {showAsymmetryOverlay &&
                overlappingRegions.map((overlap, index) => (
                  <ReferenceArea
                    key={`overlap-${index}`}
                    x1={overlap.startTimeMs}
                    x2={overlap.endTimeMs}
                    fill="url(#diagonalStripes)"
                    fillOpacity={1}
                    stroke={OVERLAP_COLOR}
                    strokeOpacity={0.5}
                    strokeWidth={1}
                    strokeDasharray="4 2"
                    ifOverflow="hidden"
                  />
                ))}

              {/* Zero reference line */}
              <ReferenceLine y={0} className="stroke-gray-300 dark:stroke-zinc-600" strokeWidth={1} />

              <RechartsTooltip content={<CustomTooltip />} />

              {/* Single-axis mode: render standard left/right areas */}
              {!multiAxisMode && kneeVisibility.left && (
                <Area
                  type="monotone"
                  dataKey="left"
                  name="left"
                  stroke={LEFT_KNEE_COLOR}
                  strokeWidth={2}
                  fill="url(#leftKneeGradient)"
                  activeDot={{ r: 4, fill: LEFT_KNEE_COLOR }}
                />
              )}

              {!multiAxisMode && kneeVisibility.right && (
                <Area
                  type="monotone"
                  dataKey="right"
                  name="right"
                  stroke={RIGHT_KNEE_COLOR}
                  strokeWidth={2}
                  fill="url(#rightKneeGradient)"
                  activeDot={{ r: 4, fill: RIGHT_KNEE_COLOR }}
                />
              )}

              {/* Multi-axis mode: render alternating dash pattern (knee color + axis color) */}
              {/* Left knee - base layer (knee color, dashed) */}
              {multiAxisMode && kneeVisibility.left && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`left_${axis}_base`}
                  type="monotone"
                  dataKey={`left_${axis}`}
                  name={`Left (${axis.toUpperCase()})`}
                  stroke={LEFT_KNEE_COLOR}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  fill={`url(#leftKneeGradient_${axis})`}
                  activeDot={{ r: 4, fill: AXIS_COLORS[axis], stroke: LEFT_KNEE_COLOR, strokeWidth: 2 }}
                  dot={false}
                  legendType="none"
                />
              ))}
              {/* Left knee - overlay layer (axis color, dashed with offset) */}
              {multiAxisMode && kneeVisibility.left && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`left_${axis}_overlay`}
                  type="monotone"
                  dataKey={`left_${axis}`}
                  stroke={AXIS_COLORS[axis]}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  strokeDashoffset={6}
                  fill="none"
                  activeDot={false}
                  dot={false}
                  legendType="none"
                />
              ))}

              {/* Right knee - base layer (knee color, dashed) */}
              {multiAxisMode && kneeVisibility.right && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`right_${axis}_base`}
                  type="monotone"
                  dataKey={`right_${axis}`}
                  name={`Right (${axis.toUpperCase()})`}
                  stroke={RIGHT_KNEE_COLOR}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  fill={`url(#rightKneeGradient_${axis})`}
                  activeDot={{ r: 4, fill: AXIS_COLORS[axis], stroke: RIGHT_KNEE_COLOR, strokeWidth: 2 }}
                  dot={false}
                  legendType="none"
                />
              ))}
              {/* Right knee - overlay layer (axis color, dashed with offset) */}
              {multiAxisMode && kneeVisibility.right && Array.from(selectedAxes).map((axis) => (
                <Area
                  key={`right_${axis}_overlay`}
                  type="monotone"
                  dataKey={`right_${axis}`}
                  stroke={AXIS_COLORS[axis]}
                  strokeWidth={2}
                  strokeDasharray="6 6"
                  strokeDashoffset={6}
                  fill="none"
                  activeDot={false}
                  dot={false}
                  legendType="none"
                />
              ))}
            </AreaChart>
          ) : (
            /* Phase Plot: Right Knee (X) vs Left Knee (Y) */
            <ScatterChart
              margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
            >
              <defs>
                {/* Gradient for phase trail - 0-90% constant opacity, 90-100% gradient to full */}
                <linearGradient id="phaseTrailGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--tropx-vibrant)" stopOpacity={0.3} />
                  <stop offset="90%" stopColor="var(--tropx-vibrant)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="var(--tropx-vibrant)" stopOpacity={1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-zinc-700" />

              <XAxis
                type="number"
                dataKey="x"
                name="Right Knee"
                domain={phaseDomain}
                className="text-gray-400 dark:text-gray-500"
                tick={{ fill: "currentColor" }}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v}°`}
                label={{
                  value: "Right Knee",
                  position: "bottom",
                  offset: -5,
                  style: { fill: RIGHT_KNEE_COLOR, fontSize: 11 },
                }}
              />

              <YAxis
                type="number"
                dataKey="y"
                name="Left Knee"
                domain={phaseDomain}
                className="text-gray-400 dark:text-gray-500"
                tick={{ fill: "currentColor" }}
                fontSize={11}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => `${v}°`}
                label={{
                  value: "Left Knee",
                  angle: -90,
                  position: "insideLeft",
                  offset: 10,
                  style: { fill: LEFT_KNEE_COLOR, fontSize: 11 },
                }}
              />

              {/* Diagonal reference line (perfect symmetry) */}
              <ReferenceLine
                segment={[
                  { x: phaseDomain[0], y: phaseDomain[0] },
                  { x: phaseDomain[1], y: phaseDomain[1] },
                ]}
                stroke="var(--tropx-vibrant)"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
                strokeWidth={1}
              />

              <RechartsTooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload as PhaseDataPoint;
                  return (
                    <div className="px-3 py-2 rounded-lg shadow-lg border border-[var(--tropx-border)] bg-[var(--tropx-card)] text-xs">
                      <p className="text-[var(--tropx-text-sub)] mb-1">{formatTimeMs(data.time)}</p>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full" style={{ backgroundColor: LEFT_KNEE_COLOR }} />
                          <span className="text-[var(--tropx-text-main)]">
                            Left: <strong>{data.y.toFixed(1)}°</strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="size-2 rounded-full" style={{ backgroundColor: RIGHT_KNEE_COLOR }} />
                          <span className="text-[var(--tropx-text-main)]">
                            Right: <strong>{data.x.toFixed(1)}°</strong>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />

              <Scatter
                name="Phase"
                data={phaseData}
                fill="transparent"
                line={{ stroke: "url(#phaseTrailGradient)", strokeWidth: 1.5 }}
                isAnimationActive={false}
                shape={{ r: 0 }}
                activeDot={{
                  r: 5,
                  fill: "var(--tropx-vibrant)",
                  stroke: "white",
                  strokeWidth: 2,
                  cursor: "crosshair",
                }}
              />

            </ScatterChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Playback timeline with dual-range slider */}
      {sessionDuration > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 border-t border-[var(--tropx-border)]">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={togglePlayback}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  "hover:bg-[var(--tropx-muted)]",
                  isPlaying ? "text-[var(--tropx-vibrant)]" : "text-[var(--tropx-text-sub)]"
                )}
              >
                {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {isPlaying ? "Pause" : "Play"}
            </TooltipContent>
          </Tooltip>

          <span className="text-[10px] font-mono text-[var(--tropx-text-sub)] w-14 text-right">
            {formatTimeMs(timeRange[0])}
          </span>

          {/* Dual-range slider - always visible, behavior changes with zoom */}
          <div className="flex-1 relative h-6 flex items-center range-slider-container">
            {/* Track background */}
            <div className="absolute inset-x-0 h-1.5 bg-[var(--tropx-muted)] rounded-full" />

            {/* Selected range highlight with center drag zone */}
            <div
              className={cn(
                "absolute h-1.5 rounded-full z-20 cursor-grab active:cursor-grabbing",
                isDraggingCenter ? "cursor-grabbing" : ""
              )}
              style={{
                left: `${(timeRange[0] / sessionDuration) * 100}%`,
                right: `${100 - (timeRange[1] / sessionDuration) * 100}%`,
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
              max={sessionDuration}
              value={timeRange[0]}
              onChange={(e) => {
                const newStart = Math.min(parseFloat(e.target.value), timeRange[1] - 100);
                handleRangeChange([Math.max(0, newStart), timeRange[1]]);
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
              max={sessionDuration}
              value={timeRange[1]}
              onChange={(e) => {
                const newEnd = Math.max(parseFloat(e.target.value), timeRange[0] + 100);
                handleRangeChange([timeRange[0], Math.min(sessionDuration, newEnd)]);
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

          <span className="text-[10px] font-mono text-[var(--tropx-text-sub)] w-14">
            {formatTimeMs(timeRange[1])}
          </span>

          {/* Zoom toggle button - only affects chart axis scale */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsZoomed(!isZoomed)}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  "hover:bg-[var(--tropx-muted)]",
                  isZoomed ? "text-[var(--tropx-vibrant)]" : "text-[var(--tropx-text-sub)]"
                )}
              >
                <ZoomIn className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {isZoomed ? "Show full time scale" : "Zoom to selection"}
            </TooltipContent>
          </Tooltip>

          {/* Reset button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => {
                  setTimeRange([0, sessionDuration]);
                  setIsZoomed(false);
                  setIsPlaying(false);
                }}
                className={cn(
                  "p-1 rounded-md transition-colors",
                  "hover:bg-[var(--tropx-muted)]",
                  "text-[var(--tropx-text-sub)]"
                )}
              >
                <RotateCcw className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Reset to full session
            </TooltipContent>
          </Tooltip>
        </div>
      )}
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
