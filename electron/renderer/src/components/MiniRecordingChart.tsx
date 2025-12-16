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

  // Find max for normalization (baseline is 0)
  const allValues = points.flatMap((p) => [p.left, p.right]);
  const maxVal = Math.max(...allValues, 0);
  const minVal = Math.min(...allValues, 0);
  // Ensure we include 0 in the range
  const rangeMax = Math.max(maxVal, 0);
  const rangeMin = Math.min(minVal, 0);
  const range = rangeMax - rangeMin || 1;

  // Generate SVG area paths
  const createAreaPath = (data: number[], color: string, fillColor: string) => {
    const xStep = chartWidth / (data.length - 1 || 1);

    // Build line path
    const linePoints = data.map((val, i) => {
      const x = padding + i * xStep;
      const normalized = (val - rangeMin) / range;
      const y = padding + normalized * chartHeight;
      return { x, y };
    });

    const linePath = linePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');

    // Build area path (line + close to zero baseline)
    const baselineY = padding + ((0 - rangeMin) / range) * chartHeight;
    const areaPath = linePath +
      ` L ${(padding + (data.length - 1) * xStep).toFixed(1)} ${baselineY.toFixed(1)} ` +
      `L ${padding} ${baselineY.toFixed(1)} Z`;

    return (
      <g key={color}>
        {/* Area fill */}
        <path
          d={areaPath}
          fill={fillColor}
          opacity="0.15"
        />
        {/* Line stroke */}
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
        />
      </g>
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
        {/* Grid line at zero baseline */}
        <line
          x1={padding}
          y1={padding + ((0 - rangeMin) / range) * chartHeight}
          x2={width - padding}
          y2={padding + ((0 - rangeMin) / range) * chartHeight}
          stroke="#e5e7eb"
          strokeWidth="0.5"
        />
        {/* Left knee (coral/red) */}
        {createAreaPath(
          points.map((p) => p.left),
          'var(--tropx-coral, #f97066)',
          '#f97066'
        )}
        {/* Right knee (blue) */}
        {createAreaPath(
          points.map((p) => p.right),
          'var(--tropx-sky, #60a5fa)',
          '#60a5fa'
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
