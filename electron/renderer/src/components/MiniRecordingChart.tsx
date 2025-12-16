/**
 * MiniRecordingChart - Sparkline chart for recording preview.
 * Uses QuaternionCodec for proper decoding of packed quaternion data.
 */

import { useMemo } from 'react';
import {
  PackedChunkData,
  unpackToAngles,
  AngleSample,
  QuaternionSample,
  quaternionToAngle,
} from '../../../../shared/QuaternionCodec';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface MiniRecordingChartProps {
  /** Packed chunk data from Convex (for LoadModal) */
  packedData?: PackedChunkData | null;
  /** Raw quaternion samples (for SaveModal) */
  samples?: QuaternionSample[];
  /** Chart height in pixels */
  height?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function MiniRecordingChart({
  packedData,
  samples,
  height = 56,
  isLoading = false,
}: MiniRecordingChartProps) {
  // Convert data to angle points for charting
  const points = useMemo(() => {
    // From packed Convex data
    if (packedData && packedData.sampleCount > 0) {
      const angleSamples = unpackToAngles(packedData, 'y');
      return downsampleAngles(angleSamples);
    }

    // From raw quaternion samples
    if (samples && samples.length > 0) {
      return downsampleQuaternions(samples);
    }

    return [];
  }, [packedData, samples]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden animate-pulse"
        style={{ height }}
      >
        <div className="w-full h-full bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100" />
      </div>
    );
  }

  // No data state
  if (points.length === 0) {
    return (
      <div
        className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden flex items-center justify-center"
        style={{ height }}
      >
        <span className="text-xs text-gray-400">No data</span>
      </div>
    );
  }

  // Chart dimensions
  const width = 280;
  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Find min/max for normalization
  const allValues = points.flatMap((p) => [p.left, p.right]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  // Generate SVG paths
  const createPath = (data: number[], color: string) => {
    const xStep = chartWidth / (data.length - 1 || 1);
    const pathData = data
      .map((val, i) => {
        const x = padding + i * xStep;
        // Normalize value to chart height (lower values at top, matching main chart)
        const normalized = (val - minVal) / range;
        const y = padding + normalized * chartHeight;
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <path
        key={color}
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    );
  };

  return (
    <div
      className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden"
      style={{ height }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        {/* Grid line at center */}
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="#e5e7eb"
          strokeWidth="0.5"
        />
        {/* Left knee (coral/red) */}
        {createPath(
          points.map((p) => p.left),
          'var(--tropx-coral, #f97066)'
        )}
        {/* Right knee (blue) */}
        {createPath(
          points.map((p) => p.right),
          'var(--tropx-sky, #60a5fa)'
        )}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

interface ChartPoint {
  left: number;
  right: number;
}

const TARGET_POINTS = 80;

/**
 * Downsample angle samples to ~80 points for chart performance
 */
function downsampleAngles(samples: AngleSample[]): ChartPoint[] {
  if (samples.length === 0) return [];
  if (samples.length <= TARGET_POINTS) {
    return samples.map((s) => ({ left: s.left, right: s.right }));
  }

  const step = Math.floor(samples.length / TARGET_POINTS);
  const points: ChartPoint[] = [];

  for (let i = 0; i < samples.length; i += step) {
    const sample = samples[i];
    points.push({ left: sample.left, right: sample.right });
  }

  return points;
}

/**
 * Downsample quaternion samples to ~80 points, converting to angles
 */
function downsampleQuaternions(samples: QuaternionSample[]): ChartPoint[] {
  if (samples.length === 0) return [];

  const step = Math.max(1, Math.floor(samples.length / TARGET_POINTS));
  const points: ChartPoint[] = [];

  for (let i = 0; i < samples.length; i += step) {
    const sample = samples[i];
    points.push({
      left: sample.lq ? quaternionToAngle(sample.lq, 'y') : 0,
      right: sample.rq ? quaternionToAngle(sample.rq, 'y') : 0,
    });
  }

  return points;
}

export default MiniRecordingChart;
