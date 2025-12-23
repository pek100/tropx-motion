/**
 * SessionChart - Knee angle waveforms for selected session.
 * Larger version of MiniRecordingChart with legend and better visualization.
 * Supports asymmetry event overlay to highlight time windows of detected asymmetries.
 */

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
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
import { Loader2, Layers, GitCompareArrows, SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  onPhaseOffsetApply,
}: SessionChartProps) {
  // Toggle states
  const [showAsymmetryOverlay, setShowAsymmetryOverlay] = useState(true);
  const [applyPhaseShift, setApplyPhaseShift] = useState(false);

  // Modal state
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);

  // Animation state (0 = unshifted, 1 = fully shifted)
  const [animationProgress, setAnimationProgress] = useState(0);
  const animationRef = useRef<number | null>(null);

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

  // Pre-compute base data and shift info (expensive unpack only once)
  const { baseData, maxHalfShift } = useMemo(() => {
    if (!packedData || packedData.sampleCount === 0) {
      return { baseData: { samples: [] as { left: number; right: number }[], durationMs: 0, step: 1 }, maxHalfShift: 0 };
    }

    const angleSamples = unpackToAngles(packedData, "y");
    if (angleSamples.length === 0) {
      return { baseData: { samples: [], durationMs: 0, step: 1 }, maxHalfShift: 0 };
    }

    const durationMs = packedData.endTime - packedData.startTime;

    // Calculate EFFECTIVE sample rate from actual data
    // This is crucial: the chart data may have different sample count than original recording
    // e.g., if we have 6000 samples over 60 seconds, effective rate is 100Hz
    // but if we have 100 preview samples over 60 seconds, effective rate is ~1.67Hz
    const effectiveSampleRate = durationMs > 0
      ? (angleSamples.length / durationMs) * 1000
      : (asymmetryEvents?.sampleRate ?? packedData.sampleRate);

    // Calculate max phase shift using EFFECTIVE sample rate of displayed data
    // Use the currently applied phaseOffsetMs (not the default)
    const maxPhaseShiftSamples = phaseOffsetMs !== 0
      ? Math.round((phaseOffsetMs / 1000) * effectiveSampleRate)
      : 0;

    // Downsample step
    const step = Math.max(1, Math.floor(angleSamples.length / TARGET_POINTS));

    return {
      baseData: { samples: angleSamples, durationMs, step },
      maxHalfShift: Math.round(maxPhaseShiftSamples / 2),
    };
  }, [packedData, phaseOffsetMs, asymmetryEvents?.sampleRate]);

  // Calculate current shift in milliseconds (for asymmetry overlay positioning)
  const currentShiftMs = useMemo(() => {
    const { samples, durationMs } = baseData;
    if (samples.length === 0) return 0;

    const currentHalfShift = Math.round(maxHalfShift * animationProgress);

    // Convert sample shift to time shift
    return (currentHalfShift / samples.length) * durationMs;
  }, [baseData, maxHalfShift, animationProgress]);

  // Calculate overlapping asymmetry regions (where left and right dominant events overlap after shifting)
  const overlappingRegions = useMemo(() => {
    if (!asymmetryEvents?.events || asymmetryEvents.events.length === 0) {
      return [];
    }
    return findOverlappingRegions(asymmetryEvents.events, currentShiftMs);
  }, [asymmetryEvents?.events, currentShiftMs]);

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
  }, [baseData, maxHalfShift, animationProgress]);

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
      {/* Chart controls - card-based toggles */}
      {(hasAsymmetryData || hasPhaseShift || asymmetryEvents === undefined) && (
        <div className="flex items-center justify-end gap-2 mb-2 px-1 flex-wrap">
          {/* Phase Alignment Card */}
          {hasPhaseShift && (
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all",
                applyPhaseShift
                  ? "bg-emerald-500/10 border-emerald-500/30"
                  : "bg-[var(--tropx-muted)] border-[var(--tropx-border)]"
              )}
            >
              {/* Adjust button */}
              {onPhaseOffsetApply && (
                <button
                  onClick={() => setIsAdjustModalOpen(true)}
                  className={cn(
                    "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                    "bg-[var(--tropx-card)] border border-[var(--tropx-border)]",
                    "hover:border-[var(--tropx-vibrant)] hover:text-[var(--tropx-vibrant)]"
                  )}
                >
                  <SlidersHorizontal className="size-3" />
                  Adjust
                </button>
              )}

              <div className="w-px h-4 bg-[var(--tropx-border)]" />

              <Switch
                id="phase-shift-toggle"
                checked={applyPhaseShift}
                onCheckedChange={handlePhaseShiftToggle}
                className="data-[state=checked]:bg-emerald-500 scale-90"
              />
              <label
                htmlFor="phase-shift-toggle"
                className="text-xs text-[var(--tropx-text-sub)] cursor-pointer flex items-center gap-1.5"
              >
                <GitCompareArrows className="size-3.5" />
                <span className="hidden sm:inline">Phase Align</span>
                <span className="text-[10px] font-mono opacity-70">
                  {phaseOffsetMs.toFixed(0)}ms
                </span>
              </label>
            </div>
          )}

          {/* Asymmetry Overlay Card */}
          {hasAsymmetryData && (
            <div
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all",
                showAsymmetryOverlay
                  ? "bg-[var(--tropx-vibrant)]/10 border-[var(--tropx-vibrant)]/30"
                  : "bg-[var(--tropx-muted)] border-[var(--tropx-border)]"
              )}
            >
              <Switch
                id="asymmetry-toggle"
                checked={showAsymmetryOverlay}
                onCheckedChange={setShowAsymmetryOverlay}
                className="data-[state=checked]:bg-[var(--tropx-vibrant)] scale-90"
              />
              <label
                htmlFor="asymmetry-toggle"
                className="text-xs text-[var(--tropx-text-sub)] cursor-pointer flex items-center gap-1.5"
              >
                <Layers className="size-3.5" />
                <span className="hidden sm:inline">Asymmetry</span>
                <span className="text-[10px] opacity-70">
                  ({asymmetryEvents!.events.length})
                </span>
              </label>

              {/* Legend indicators */}
              {showAsymmetryOverlay && (
                <>
                  <div className="w-px h-4 bg-[var(--tropx-border)]" />
                  <div className="flex items-center gap-2 text-[10px] text-[var(--tropx-text-sub)]">
                    <span className="flex items-center gap-0.5">
                      <span
                        className="size-2 rounded-sm"
                        style={{ backgroundColor: LEFT_DOMINANT_COLOR, opacity: 0.5 }}
                      />
                      L
                    </span>
                    <span className="flex items-center gap-0.5">
                      <span
                        className="size-2 rounded-sm"
                        style={{ backgroundColor: RIGHT_DOMINANT_COLOR, opacity: 0.5 }}
                      />
                      R
                    </span>
                    {overlappingRegions.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <span
                          className="size-2 rounded-sm border border-purple-400"
                          style={{
                            background: `repeating-linear-gradient(
                              45deg,
                              ${LEFT_DOMINANT_COLOR}66,
                              ${LEFT_DOMINANT_COLOR}66 2px,
                              ${RIGHT_DOMINANT_COLOR}66 2px,
                              ${RIGHT_DOMINANT_COLOR}66 4px
                            )`,
                          }}
                        />
                        L+R
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Loading state */}
          {asymmetryEvents === undefined && !hasAsymmetryData && !hasPhaseShift && (
            <div className="px-3 py-1.5 rounded-lg bg-[var(--tropx-muted)] border border-[var(--tropx-border)]">
              <span className="text-[10px] text-[var(--tropx-text-sub)] opacity-50">
                Loading metrics...
              </span>
            </div>
          )}
        </div>
      )}

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
          <AreaChart
            data={chartData as any}
            margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
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
            {/* Each overlay shifts with its corresponding signal:
                - Left dominant (red) events anchor to left signal → shifts +currentShiftMs (forward)
                - Right dominant (blue) events anchor to right signal → shifts -currentShiftMs (backward) */}
            {showAsymmetryOverlay &&
              hasAsymmetryData &&
              asymmetryEvents!.events.map((event, index) => {
                // Left signal shifts forward (+), right signal shifts backward (-)
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
                    ifOverflow="extendDomain"
                  />
                );
              })}

            {/* Overlapping asymmetry regions - diagonal stripes where L and R dominant events intersect */}
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
