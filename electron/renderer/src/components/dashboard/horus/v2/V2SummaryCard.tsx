/**
 * V2SummaryCard Component
 *
 * Visual-first summary with progressive disclosure.
 * Radar chart as hero, quick stats, details on demand.
 */

import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  AlertOctagon,
  AlertCircle,
  Info,
  CheckCircle2,
  Circle,
} from "lucide-react";
import {
  RadialBarChart,
  RadialBar,
  BarChart,
  Bar,
  Cell,
  PolarAngleAxis,
} from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { PerformanceRadar, type RadarScores } from "./PerformanceRadar";
import { CrossAnalysisCard } from "./CrossAnalysisCard";
import type { SeverityLevel } from "./SectionCard";
import type { CrossAnalysisResult } from "../../../../../../../convex/horus/crossAnalysis/types";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface FindingViz {
  type: "gauge" | "comparison" | "grade" | "level";
  value?: string | number;
  max?: number;
  unit?: string;
  thresholds?: number[];
  scale?: string[];
  left?: number;
  right?: number;
  labels?: string[];
}

export interface KeyFinding {
  text: string;
  severity: SeverityLevel;
  viz?: FindingViz;
}

export interface SpeculativeInsight {
  /** Short 2-5 word title for the hypothesis */
  label: string;
  /** 1-2 sentence explanation of the hypothesis */
  description: string;
}

interface V2SummaryCardProps {
  radarScores: RadarScores;
  keyFindings: KeyFinding[];
  clinicalImplications: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  speculativeInsights?: SpeculativeInsight[];
  crossAnalysis?: CrossAnalysisResult;
  patientId?: Id<"users">;
  patientName?: string;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Finding Visualization Components
// ─────────────────────────────────────────────────────────────────
// Finding Visualizations - Clean, consistent mini-charts
// Using shadcn ChartContainer for proper styling
// ─────────────────────────────────────────────────────────────────

/** Format number to 1 decimal place, removing trailing .0 */
function formatNumber(value: number): string {
  const formatted = value.toFixed(1);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
}

/** Get status color based on thresholds */
function getStatusColor(value: number, thresholds: number[]): string {
  if (value <= thresholds[0]) return "hsl(var(--chart-2))"; // green
  if (value <= thresholds[1]) return "hsl(var(--chart-4))"; // yellow
  if (value <= thresholds[2]) return "hsl(var(--chart-5))"; // orange
  return "hsl(var(--destructive))"; // red
}

/** Radial gauge for percentages - clean donut style */
function GaugeViz({ value, max = 100, unit = "", thresholds = [25, 50, 75] }: {
  value: number;
  max?: number;
  unit?: string;
  thresholds?: number[];
}) {
  const pct = Math.min((value / max) * 100, 100);
  const color = getStatusColor(value, thresholds);

  const chartConfig: ChartConfig = {
    value: { label: "Value", color },
    background: { label: "Background", color: "hsl(var(--muted))" },
  };

  const data = [{ name: "value", value: pct, fill: color }];

  return (
    <div className="relative flex items-center justify-center">
      <ChartContainer config={chartConfig} className="h-28 w-28">
        <RadialBarChart
          data={data}
          startAngle={90}
          endAngle={-270}
          innerRadius="75%"
          outerRadius="95%"
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            dataKey="value"
            background={{ fill: "hsl(var(--muted))" }}
            cornerRadius={10}
            angleAxisId={0}
          />
        </RadialBarChart>
      </ChartContainer>
      <span className="absolute inset-0 flex items-center justify-center text-base font-semibold text-[var(--tropx-text-main)]">
        {formatNumber(value)}<span className="text-xs text-[var(--tropx-text-sub)]">{unit}</span>
      </span>
    </div>
  );
}

/** Comparison bar chart - two bars side by side */
function ComparisonViz({ left, right, unit = "", labels = ["L", "R"] }: {
  left: number;
  right: number;
  unit?: string;
  labels?: string[];
}) {
  const chartConfig: ChartConfig = {
    left: { label: labels[0], color: "hsl(var(--chart-1))" },
    right: { label: labels[1], color: "hsl(var(--chart-3))" },
  };

  const data = [
    { name: labels[0], value: left, fill: "var(--color-left)" },
    { name: labels[1], value: right, fill: "var(--color-right)" },
  ];

  return (
    <div className="flex flex-col items-center w-full">
      <ChartContainer config={chartConfig} className="h-20 w-full max-w-[120px]">
        <BarChart data={data} barGap={8}>
          <Bar dataKey="value" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ChartContainer>
      <div className="flex justify-between w-full max-w-[120px] text-xs mt-1.5">
        <span className="text-[var(--tropx-text-sub)]">{labels[0]} <span className="font-medium text-[var(--tropx-text-main)]">{formatNumber(left)}{unit}</span></span>
        <span className="text-[var(--tropx-text-sub)]">{labels[1]} <span className="font-medium text-[var(--tropx-text-main)]">{formatNumber(right)}{unit}</span></span>
      </div>
    </div>
  );
}

/** Grade display - radial with letter in center */
function GradeViz({ value, scale = ["A", "B", "C", "D", "F"] }: {
  value: string;
  scale?: string[];
}) {
  const idx = scale.indexOf(value.toUpperCase());
  const pct = ((scale.length - 1 - idx) / (scale.length - 1)) * 100;

  // Color based on grade position
  const color = idx <= 1 ? "hsl(var(--chart-2))"
    : idx === 2 ? "hsl(var(--chart-4))"
    : "hsl(var(--destructive))";

  const chartConfig: ChartConfig = {
    grade: { label: "Grade", color },
  };

  const data = [{ name: "grade", value: pct, fill: color }];

  return (
    <div className="relative flex items-center justify-center">
      <ChartContainer config={chartConfig} className="h-28 w-28">
        <RadialBarChart
          data={data}
          startAngle={90}
          endAngle={-270}
          innerRadius="75%"
          outerRadius="95%"
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            dataKey="value"
            background={{ fill: "hsl(var(--muted))" }}
            cornerRadius={10}
            angleAxisId={0}
          />
        </RadialBarChart>
      </ChartContainer>
      <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold" style={{ color }}>
        {value.toUpperCase()}
      </span>
    </div>
  );
}

/** Level indicator - horizontal segmented bar */
function LevelViz({ value, scale = ["low", "moderate", "high", "critical"] }: {
  value: string;
  scale?: string[];
}) {
  const idx = scale.indexOf(value.toLowerCase());
  const colors = [
    "hsl(var(--chart-2))",  // green
    "hsl(var(--chart-4))",  // yellow
    "hsl(var(--chart-5))",  // orange
    "hsl(var(--destructive))", // red
  ];
  const activeColor = colors[idx] || colors[0];

  const chartConfig: ChartConfig = {
    level: { label: "Level", color: activeColor },
  };

  const data = scale.map((_, i) => ({
    segment: i,
    value: 1,
    fill: i <= idx ? activeColor : "hsl(var(--muted))",
  }));

  return (
    <div className="flex flex-col items-center w-full">
      <ChartContainer config={chartConfig} className="h-12 w-full max-w-[120px]">
        <BarChart data={data} layout="horizontal" barGap={4}>
          <Bar dataKey="value" radius={4}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <span className="text-sm font-semibold capitalize mt-2" style={{ color: activeColor }}>
        {value}
      </span>
    </div>
  );
}

/** Render the appropriate visualization based on type */
function FindingVisualization({ viz }: { viz: FindingViz }) {
  switch (viz.type) {
    case "gauge":
      return <GaugeViz value={viz.value as number} max={viz.max} unit={viz.unit} thresholds={viz.thresholds} />;
    case "comparison":
      return <ComparisonViz left={viz.left!} right={viz.right!} unit={viz.unit} labels={viz.labels} />;
    case "grade":
      return <GradeViz value={viz.value as string} scale={viz.scale} />;
    case "level":
      return <LevelViz value={viz.value as string} scale={viz.scale} />;
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────
// Severity color helper
// ─────────────────────────────────────────────────────────────────

/** Get implications severity based on critical findings count */
function getImplicationsSeverity(criticalCount: number, totalFindings: number): {
  icon: React.ReactNode;
  color: string;
  bgColor: string;
} {
  const ratio = totalFindings > 0 ? criticalCount / totalFindings : 0;

  if (criticalCount >= 3 || ratio >= 0.6) {
    return {
      icon: <AlertOctagon className="h-4 w-4 flex-shrink-0" />,
      color: "var(--tropx-red)",
      bgColor: "var(--tropx-red)",
    };
  }
  if (criticalCount >= 2 || ratio >= 0.4) {
    return {
      icon: <AlertTriangle className="h-4 w-4 flex-shrink-0" />,
      color: "#f97316",
      bgColor: "#f97316",
    };
  }
  if (criticalCount >= 1 || ratio >= 0.2) {
    return {
      icon: <AlertCircle className="h-4 w-4 flex-shrink-0" />,
      color: "var(--tropx-warning-text)",
      bgColor: "var(--tropx-warning-text)",
    };
  }
  return {
    icon: <Info className="h-4 w-4 flex-shrink-0" />,
    color: "var(--tropx-text-sub)",
    bgColor: "var(--tropx-accent)",
  };
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function V2SummaryCard({
  radarScores,
  keyFindings,
  clinicalImplications,
  strengths,
  weaknesses,
  recommendations,
  speculativeInsights,
  crossAnalysis,
  patientId,
  patientName,
  className,
}: V2SummaryCardProps) {
  // Count critical/severe findings
  const criticalCount = keyFindings.filter(
    (f) => f.severity === "critical" || f.severity === "profound" || f.severity === "severe"
  ).length;

  const insights = speculativeInsights ?? [];

  return (
    <div
      className={cn(
        "rounded-xl bg-[var(--tropx-card)] border border-[var(--tropx-border)] p-4",
        className
      )}
    >
      {/* Hero: Radar + Quick Stats */}
      <div className="flex flex-col md:flex-row items-center gap-4 mb-4">
        {/* Radar Chart */}
        <div className="w-full max-w-[280px] flex-shrink-0 p-4 rounded-xl bg-[var(--tropx-surface)]/50">
          <PerformanceRadar scores={radarScores} />
        </div>

        {/* Quick Stats */}
        <div className="flex-1 space-y-3">
          {/* Stat badges with subtle backgrounds */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--tropx-success-text)]/10">
              <TrendingUp className="h-4 w-4 text-[var(--tropx-success-text)]" />
              <span className="text-lg font-semibold text-[var(--tropx-success-text)]">{strengths.length}</span>
              <span className="text-xs text-[var(--tropx-text-sub)]">strengths</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--tropx-red)]/10">
              <TrendingDown className="h-4 w-4 text-[var(--tropx-red)]" />
              <span className="text-lg font-semibold text-[var(--tropx-red)]">{weaknesses.length}</span>
              <span className="text-xs text-[var(--tropx-text-sub)]">to improve</span>
            </div>
            {criticalCount > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#f97316]/10">
                <AlertTriangle className="h-4 w-4 text-[#f97316]" />
                <span className="text-lg font-semibold text-[#f97316]">{criticalCount}</span>
                <span className="text-xs text-[var(--tropx-text-sub)]">attention</span>
              </div>
            )}
          </div>

          {/* Clinical Implications */}
          {clinicalImplications && (() => {
            const severity = getImplicationsSeverity(criticalCount, keyFindings.length);
            return (
              <div
                className="flex items-start gap-2 p-2.5 rounded-lg"
                style={{ backgroundColor: `color-mix(in srgb, ${severity.bgColor} 10%, transparent)` }}
              >
                <span style={{ color: severity.color }} className="mt-0.5">
                  {severity.icon}
                </span>
                <p className="text-sm text-[var(--tropx-text-main)]">
                  {clinicalImplications}
                </p>
              </div>
            );
          })()}

          {/* Primary recommendation */}
          {recommendations[0] && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--tropx-success-text)]/10">
              <CheckCircle2 className="h-4 w-4 text-[var(--tropx-success-text)] mt-0.5 flex-shrink-0" />
              <p className="text-sm text-[var(--tropx-text-main)]">
                {recommendations[0]}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Key Findings Gallery - single row on desktop, 2 cols on mobile */}
      {keyFindings.length > 0 && (
        <div className="mb-4">
          <span className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
            Key Findings
          </span>
          <div className="mt-2 grid grid-cols-2 gap-3 md:flex md:flex-nowrap md:gap-4">
            {keyFindings.map((finding, index) => (
              <div
                key={index}
                className="flex flex-col items-center p-3 md:p-4 rounded-xl bg-[var(--tropx-surface)]/40 md:flex-1 md:min-w-0"
              >
                {/* Visualization */}
                <div className="flex items-center justify-center w-full h-28">
                  {finding.viz ? (
                    <FindingVisualization viz={finding.viz} />
                  ) : (
                    <Circle className="h-8 w-8 text-[var(--tropx-border)]" />
                  )}
                </div>
                {/* Label - full text display */}
                <span className="text-sm text-[var(--tropx-text-sub)] leading-snug text-center mt-2">
                  {finding.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths & Weaknesses - always visible */}
      <div className="border-t border-[var(--tropx-border)]/30 pt-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Strengths */}
          <div>
            <span className="text-xs font-semibold text-[var(--tropx-success-text)] uppercase tracking-wide">
              Strengths
            </span>
            {strengths.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Circle className="h-1.5 w-1.5 fill-current text-[var(--tropx-success-text)] mt-1.5 flex-shrink-0" />
                    <span className="text-sm text-[var(--tropx-text-main)]">{s}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[var(--tropx-text-sub)] italic">No strengths identified</p>
            )}
          </div>

          {/* Weaknesses */}
          <div>
            <span className="text-xs font-semibold text-[var(--tropx-red)] uppercase tracking-wide">
              To Improve
            </span>
            {weaknesses.length > 0 ? (
              <ul className="mt-1 space-y-1">
                {weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Circle className="h-1.5 w-1.5 fill-current text-[var(--tropx-red)] mt-1.5 flex-shrink-0" />
                    <span className="text-sm text-[var(--tropx-text-main)]">{w}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[var(--tropx-text-sub)] italic">No areas for improvement identified</p>
            )}
          </div>
        </div>
      </div>

      {/* Cross-Analysis Insights (Stage 3) - Combined with Worth Investigating */}
      {(insights.length > 0 || crossAnalysis) && (
        <CrossAnalysisCard
          crossAnalysis={crossAnalysis}
          speculativeInsights={insights}
          patientId={patientId}
          patientName={patientName}
          className="mt-4"
        />
      )}
    </div>
  );
}
