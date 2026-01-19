/**
 * CropModal - Compact modal for cropping/trimming recording time range.
 *
 * Features:
 * - Full-size Recharts waveform with interactive drag handles
 * - Red overlays for cropped regions with draggable boundary lines
 * - Floating action buttons (Apply/Reset) over the chart
 * - Embedded mode for side-by-side rendering with SaveModal
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { RotateCcw, Check, Wand2 } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { cn, formatDuration } from '@/lib/utils';
import { QuaternionSample, quaternionToAngle } from '../../../../shared/QuaternionCodec';
import { detectAutoCrop } from '../lib/recording/AutoCropService';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface CropRange {
  startMs: number;
  endMs: number;
}

interface CropModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  samples: QuaternionSample[];
  durationMs: number;
  cropRange: CropRange | null;
  onCropChange: (range: CropRange | null) => void;
  embedded?: boolean;
}

interface ChartDataPoint {
  time: number;
  left: number | null;
  right: number | null;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const MIN_CROP_DURATION_MS = 1000; // 1 second minimum
const CHART_HEIGHT = 260;

// Use CSS variables for knee colors (matching dashboard)
const LEFT_KNEE_COLOR = 'var(--chart-left)';   // coral
const RIGHT_KNEE_COLOR = 'var(--chart-right)'; // blue

// ─────────────────────────────────────────────────────────────────
// Main CropModal Component
// ─────────────────────────────────────────────────────────────────

export function CropModal({
  open,
  onOpenChange,
  samples,
  durationMs,
  cropRange,
  onCropChange,
  embedded = false,
}: CropModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Local state for crop range - initialize from parent cropRange
  const [localRange, setLocalRange] = useState<[number, number]>(() => {
    if (cropRange) {
      return [cropRange.startMs, cropRange.endMs];
    }
    return [0, durationMs];
  });

  // Drag state
  const [dragMode, setDragMode] = useState<'left' | 'right' | null>(null);

  // Track previous localRange to detect user changes
  const prevLocalRangeRef = useRef<[number, number]>(localRange);

  // Sync local state TO parent whenever localRange changes from user interaction
  useEffect(() => {
    if (!open) return;

    const prev = prevLocalRangeRef.current;
    // Only sync if localRange actually changed
    if (prev[0] !== localRange[0] || prev[1] !== localRange[1]) {
      // Always store explicit range (don't use null for full range)
      onCropChange({ startMs: localRange[0], endMs: localRange[1] });
      prevLocalRangeRef.current = localRange;
    }
  }, [open, localRange, onCropChange]);

  // Handle outside click for embedded mode - just close (changes already synced)
  useEffect(() => {
    if (!embedded || !open) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };

    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [embedded, open, onOpenChange]);

  // Convert samples to chart data (downsample for performance)
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (samples.length === 0) return [];

    const targetPoints = 300;
    const step = Math.max(1, Math.floor(samples.length / targetPoints));
    const timeStep = durationMs / samples.length;

    const points: ChartDataPoint[] = [];
    for (let i = 0; i < samples.length; i += step) {
      const sample = samples[i];
      points.push({
        time: i * timeStep,
        left: sample.lq ? Math.round(quaternionToAngle(sample.lq, 'y') * 10) / 10 : null,
        right: sample.rq ? Math.round(quaternionToAngle(sample.rq, 'y') * 10) / 10 : null,
      });
    }

    return points;
  }, [samples, durationMs]);

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

  // Calculate crop overlay positions as percentages
  const leftCropPercent = (localRange[0] / durationMs) * 100;
  const rightCropPercent = (localRange[1] / durationMs) * 100;

  // Calculate position from mouse/touch event
  const getTimeFromEvent = useCallback((e: MouseEvent | TouchEvent) => {
    if (!chartRef.current) return 0;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = chartRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * durationMs;
  }, [durationMs]);

  // Start dragging a specific handle
  const handleDragStart = useCallback((mode: 'left' | 'right', e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
  }, []);

  // Click anywhere on chart - drag the closest handle
  const handleChartClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!chartRef.current) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = chartRef.current.getBoundingClientRect();
    const clickTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * durationMs;

    // Calculate distance to each handle
    const distToLeft = Math.abs(clickTime - localRange[0]);
    const distToRight = Math.abs(clickTime - localRange[1]);

    // Start dragging the closer handle
    const closerHandle = distToLeft <= distToRight ? 'left' : 'right';
    setDragMode(closerHandle);

    // Immediately move the handle to click position
    if (closerHandle === 'left') {
      const maxAllowed = localRange[1] - MIN_CROP_DURATION_MS;
      const newStart = Math.max(0, Math.min(clickTime, maxAllowed));
      setLocalRange([newStart, localRange[1]]);
    } else {
      const minAllowed = localRange[0] + MIN_CROP_DURATION_MS;
      const newEnd = Math.min(durationMs, Math.max(clickTime, minAllowed));
      setLocalRange([localRange[0], newEnd]);
    }
  }, [durationMs, localRange]);

  // Handle drag movement
  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragMode || !chartRef.current) return;

    const currentTime = getTimeFromEvent(e);

    if (dragMode === 'left') {
      const maxAllowed = localRange[1] - MIN_CROP_DURATION_MS;
      const newStart = Math.max(0, Math.min(currentTime, maxAllowed));
      setLocalRange([newStart, localRange[1]]);
    } else if (dragMode === 'right') {
      const minAllowed = localRange[0] + MIN_CROP_DURATION_MS;
      const newEnd = Math.min(durationMs, Math.max(currentTime, minAllowed));
      setLocalRange([localRange[0], newEnd]);
    }
  }, [dragMode, durationMs, localRange, getTimeFromEvent]);

  // End dragging
  const handleDragEnd = useCallback(() => {
    setDragMode(null);
  }, []);

  // Global drag listeners
  useEffect(() => {
    if (dragMode) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [dragMode, handleDragMove, handleDragEnd]);

  // Commit current local range to parent state
  const commitChanges = useCallback(() => {
    if (localRange[0] === 0 && localRange[1] === durationMs) {
      onCropChange(null);
    } else {
      onCropChange({ startMs: localRange[0], endMs: localRange[1] });
    }
  }, [localRange, durationMs, onCropChange]);

  const handleApply = useCallback(() => {
    commitChanges();
    onOpenChange(false);
  }, [commitChanges, onOpenChange]);

  const handleReset = useCallback(() => {
    setLocalRange([0, durationMs]);
  }, [durationMs]);

  const handleAuto = useCallback(() => {
    const result = detectAutoCrop(samples, durationMs);
    if (result.detected) {
      setLocalRange([result.startMs, result.endMs]);
    } else {
      // No crop detected - reset to full
      setLocalRange([0, durationMs]);
    }
  }, [samples, durationMs]);

  const isCropped = localRange[0] > 0 || localRange[1] < durationMs;
  const selectedDuration = localRange[1] - localRange[0];

  if (!open) return null;
  if (chartData.length === 0 || durationMs <= 0) return null;

  const content = (
    <div
      ref={containerRef}
      className="w-[520px] rounded-xl shadow-lg border border-[var(--tropx-border)] overflow-hidden bg-[var(--tropx-card)]"
    >
      {/* Chart container with overlays - click anywhere to drag closest handle */}
      <div
        ref={chartRef}
        className="relative cursor-ew-resize"
        style={{ height: CHART_HEIGHT }}
        onMouseDown={handleChartClick}
        onTouchStart={handleChartClick}
      >
        {/* Recharts waveform */}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 24, right: 8, left: 0, bottom: 8 }}
          >
            <defs>
              <linearGradient id="cropLeftGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.3} />
                <stop offset="95%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="cropRightGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={0.3} />
                <stop offset="95%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <XAxis
              dataKey="time"
              type="number"
              domain={[0, durationMs]}
              tickFormatter={(ms) => formatTimeMs(ms)}
              tick={{ fill: 'var(--tropx-shadow)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickCount={6}
            />

            <YAxis domain={yDomain} reversed hide />

            <Area
              type="monotone"
              dataKey="left"
              name="left"
              stroke={LEFT_KNEE_COLOR}
              strokeWidth={1.5}
              fill="url(#cropLeftGradient)"
              isAnimationActive={false}
              dot={false}
            />

            <Area
              type="monotone"
              dataKey="right"
              name="right"
              stroke={RIGHT_KNEE_COLOR}
              strokeWidth={1.5}
              fill="url(#cropRightGradient)"
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Red overlay for cropped START region */}
        {localRange[0] > 0 && (
          <div
            className="absolute top-0 bottom-0 left-0 bg-red-500/30 cursor-ew-resize hover:bg-red-500/40 transition-colors"
            style={{ width: `${leftCropPercent}%` }}
            onMouseDown={(e) => handleDragStart('left', e)}
            onTouchStart={(e) => handleDragStart('left', e)}
          />
        )}

        {/* Red overlay for cropped END region */}
        {localRange[1] < durationMs && (
          <div
            className="absolute top-0 bottom-0 right-0 bg-red-500/30 cursor-ew-resize hover:bg-red-500/40 transition-colors"
            style={{ width: `${100 - rightCropPercent}%` }}
            onMouseDown={(e) => handleDragStart('right', e)}
            onTouchStart={(e) => handleDragStart('right', e)}
          />
        )}

        {/* Left crop boundary line - always visible, with larger hitbox */}
        <div
          className="absolute top-0 bottom-0 w-4 cursor-ew-resize z-20 flex justify-center"
          style={{ left: `calc(${leftCropPercent}% - 8px)` }}
          onMouseDown={(e) => handleDragStart('left', e)}
          onTouchStart={(e) => handleDragStart('left', e)}
        >
          <div
            className={cn(
              "h-full w-1 transition-colors",
              "bg-red-500 hover:bg-red-400",
              dragMode === 'left' && "bg-red-400"
            )}
          />
        </div>

        {/* Right crop boundary line - always visible, with larger hitbox */}
        <div
          className="absolute top-0 bottom-0 w-4 cursor-ew-resize z-20 flex justify-center"
          style={{ left: `calc(${rightCropPercent}% - 8px)` }}
          onMouseDown={(e) => handleDragStart('right', e)}
          onTouchStart={(e) => handleDragStart('right', e)}
        >
          <div
            className={cn(
              "h-full w-1 transition-colors",
              "bg-red-500 hover:bg-red-400",
              dragMode === 'right' && "bg-red-400"
            )}
          />
        </div>

        {/* Instruction message at top */}
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <span className="text-[11px] text-red-500 font-medium px-2 py-0.5 rounded bg-[var(--tropx-card)]/80 backdrop-blur-sm">
            Click to drag closest edge
          </span>
        </div>

        {/* Duration info - top right */}
        <div className="absolute top-1 right-2 z-30 pointer-events-none">
          <span className="text-[10px] text-[var(--tropx-shadow)] font-mono px-1.5 py-0.5 rounded bg-[var(--tropx-card)]/80 backdrop-blur-sm">
            {formatDuration(selectedDuration)}
          </span>
        </div>

        {/* Action buttons - bottom right */}
        <div
          className="absolute bottom-2 right-2 z-30 flex items-center gap-1.5"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleReset}
            disabled={!isCropped}
            className={cn(
              "size-8 flex items-center justify-center rounded-lg transition-all",
              "border border-[var(--tropx-border)] shadow-md",
              isCropped
                ? "bg-[var(--tropx-muted)] text-[var(--tropx-text-main)] hover:bg-[var(--tropx-hover)] hover:scale-105"
                : "bg-[var(--tropx-muted)]/50 text-[var(--tropx-shadow)]/50 cursor-not-allowed"
            )}
            title="Reset crop"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            onClick={handleAuto}
            className={cn(
              "size-8 flex items-center justify-center rounded-lg transition-all",
              "border border-[var(--tropx-border)] shadow-md",
              "bg-[var(--tropx-muted)] text-[var(--tropx-text-main)] hover:bg-[var(--tropx-hover)] hover:scale-105"
            )}
            title="Auto-detect crop"
          >
            <Wand2 className="size-4" />
          </button>
          <button
            onClick={handleApply}
            className={cn(
              "size-8 flex items-center justify-center rounded-lg transition-all",
              "bg-[var(--tropx-vibrant)] text-white hover:bg-[var(--tropx-vibrant)]/90 hover:scale-105",
              "shadow-md"
            )}
            title="Apply crop"
          >
            <Check className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function formatTimeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
  }
  return `${seconds.toFixed(1)}s`;
}

export default CropModal;
