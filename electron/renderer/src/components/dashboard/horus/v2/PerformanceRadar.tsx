/**
 * PerformanceRadar Component
 *
 * Compact pentagon radar chart showing 5 performance dimensions.
 * Each dimension scored 1-10 by the AI analysis.
 * Uses Chart.js for curved edges (tension) like horus_client.
 */

import { useMemo } from "react";
import { Radar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartOptions,
} from "chart.js";

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip);

export interface RadarScores {
  flexibility: number;
  consistency: number;
  symmetry: number;
  smoothness: number;
  control: number;
}

interface PerformanceRadarProps {
  scores: RadarScores;
  className?: string;
}

const DIMENSION_LABELS: Record<keyof RadarScores, string> = {
  flexibility: "Flex",
  consistency: "Cons",
  symmetry: "Sym",
  smoothness: "Smooth",
  control: "Ctrl",
};

const DIMENSION_ORDER: (keyof RadarScores)[] = [
  "flexibility",
  "symmetry",
  "smoothness",
  "control",
  "consistency",
];

/** Semi-logarithmic transform for 1-10 scale (blend of linear and log) */
function logTransform(value: number): number {
  const safeValue = Math.max(value, 0.1);

  // Full logarithmic
  const logValue = Math.log10(safeValue);
  const minLog = Math.log10(0.1);
  const maxLog = Math.log10(10);
  const logResult = ((logValue - minLog) / (maxLog - minLog)) * 100;

  // Linear
  const linearResult = (safeValue / 10) * 100;

  // Blend: 30% log, 70% linear (closer to linear)
  return logResult * 0.3 + linearResult * 0.7;
}

/** Get score color based on value (1-10 scale) */
function getScoreColor(value: number): string {
  if (value >= 7) return "#10b981"; // green - good
  if (value >= 4) return "#f59e0b"; // amber - monitor
  return "#ef4444"; // red - needs attention
}

function getOverallColor(scores: RadarScores): string {
  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / 5;
  if (avg >= 6) return "#10b981";
  if (avg >= 4) return "#f59e0b";
  return "#ef4444";
}

// Pre-calculate grid tick positions (constant) - all values 0-10 transformed
const GRID_TICK_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => logTransform(Math.max(v, 0.1)));

export function PerformanceRadar({ scores, className }: PerformanceRadarProps) {
  const dominantColor = useMemo(() => getOverallColor(scores), [scores]);

  // Transform scores with logarithmic scale
  const transformedData = useMemo(() => {
    return DIMENSION_ORDER.map((key) => {
      const originalValue = Math.max(1, Math.min(10, scores[key]));
      return {
        label: DIMENSION_LABELS[key],
        value: logTransform(originalValue),
        originalValue,
      };
    });
  }, [scores]);

  const chartData = useMemo(() => ({
    labels: transformedData.map((d) => d.label),
    datasets: [
      {
        label: "Performance",
        data: transformedData.map((d) => d.value),
        pointBackgroundColor: transformedData.map((d) => getScoreColor(d.originalValue)),
        pointBorderColor: "#fff",
        pointBorderWidth: 1,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderColor: dominantColor,
        borderWidth: 2.5,
        backgroundColor: `${dominantColor}40`,
        fill: true,
      },
    ],
  }), [transformedData, dominantColor]);

  const options: ChartOptions<"radar"> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    scales: {
      r: {
        min: 0,
        max: 100,
        ticks: {
          display: false,
          stepSize: 1,
        },
        afterBuildTicks: function(scale) {
          // Override ticks to match our semi-log transform
          scale.ticks = GRID_TICK_VALUES.map(v => ({ value: v }));
        },
        grid: {
          color: "rgba(128, 128, 128, 0.2)",
          circular: false,
        },
        angleLines: {
          color: "rgba(128, 128, 128, 0.2)",
        },
        pointLabels: {
          font: {
            size: 10,
            weight: 600,
          },
          color: "var(--tropx-text-main)",
        },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        enabled: true,
        backgroundColor: "#1f1e24",
        titleFont: { weight: "bold", size: 12 },
        bodyFont: { size: 11 },
        padding: 8,
        cornerRadius: 6,
        callbacks: {
          label: (context) => {
            const originalValue = transformedData[context.dataIndex].originalValue;
            return `Score: ${originalValue.toFixed(1)}/10`;
          },
        },
      },
    },
    elements: {
      line: {
        tension: 0.2, // Curved edges!
      },
    },
  }), [transformedData]);

  return (
    <div className={className}>
      <div className="w-full aspect-square">
        <Radar data={chartData} options={options} />
      </div>
    </div>
  );
}
