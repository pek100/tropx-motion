/**
 * ChartBlock Block
 *
 * Generic Recharts wrapper supporting multiple chart types.
 * Uses TropX theme tokens for consistent styling.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  RadialBarChart,
  RadialBar,
  ScatterChart,
  Scatter,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import type { RechartsType } from "../types";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface ChartSeries {
  name: string;
  dataKey: string;
  color?: string;
}

interface ChartReference {
  label: string;
  value: number;
  color?: string;
  dashed?: boolean;
}

interface ChartBlockProps {
  chartType: RechartsType;
  title: string;
  data: Array<Record<string, string | number>>;
  series?: ChartSeries[];
  references?: ChartReference[];
  config?: {
    height?: number;
    showLegend?: boolean;
    showTooltip?: boolean;
    showGrid?: boolean;
    xAxisLabel?: string;
    yAxisLabel?: string;
    colors?: string[];
    animate?: boolean;
  };
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Theme-based Colors (using CSS variables)
// ─────────────────────────────────────────────────────────────────

// Get computed CSS variable value
function getCssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Chart colors using theme tokens
const getThemeColors = (): string[] => {
  // These map to --chart-1 through --chart-5 and leg colors
  return [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "var(--leg-left-band)",
    "var(--leg-right-band)",
    "var(--tropx-vibrant)",
  ];
};

// Bilateral comparison colors (left/right leg)
const LEG_COLORS = {
  left: "var(--leg-left-band)",
  right: "var(--leg-right-band)",
};

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function ChartBlock({
  chartType,
  title,
  data,
  series = [],
  references = [],
  config = {},
  className,
}: ChartBlockProps) {
  const {
    height = 180,
    showLegend = true,
    showTooltip = true,
    showGrid = true,
    xAxisLabel,
    yAxisLabel,
    colors,
    animate = true,
  } = config;

  // Use theme colors or provided colors
  const chartColors = useMemo(() => colors || getThemeColors(), [colors]);

  // Infer series from data keys if not provided
  const effectiveSeries = useMemo(() => {
    if (series.length > 0) return series;

    // Auto-detect numeric keys from first data point
    if (data.length === 0) return [];

    const firstPoint = data[0];
    const numericKeys = Object.keys(firstPoint).filter(
      (key) => key !== "name" && key !== "label" && typeof firstPoint[key] === "number"
    );

    return numericKeys.map((key, index) => ({
      name: key,
      dataKey: key,
      color: chartColors[index % chartColors.length],
    }));
  }, [series, data, chartColors]);

  // Common chart wrapper
  const chartWrapper = (chart: React.ReactElement) => (
    <Card className={cn("py-4 bg-[var(--tropx-card)] border-[var(--tropx-border)]", className)}>
      <CardHeader className="pb-2 pt-0">
        <CardTitle className="text-base font-semibold text-[var(--tropx-text-main)]">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ResponsiveContainer width="100%" height={height}>
          {chart}
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );

  // Common axis and grid elements
  const commonCartesian = (
    <>
      {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-border opacity-50" />}
      <XAxis
        dataKey="name"
        tick={{ fontSize: 11 }}
        tickLine={false}
        className="text-muted-foreground"
        axisLine={{ className: "stroke-border" }}
        label={
          xAxisLabel
            ? { value: xAxisLabel, position: "bottom", fontSize: 11 }
            : undefined
        }
      />
      <YAxis
        tick={{ fontSize: 11 }}
        tickLine={false}
        className="text-muted-foreground"
        axisLine={{ className: "stroke-border" }}
        label={
          yAxisLabel
            ? { value: yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11 }
            : undefined
        }
      />
      {showTooltip && (
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(var(--card))",
            border: "1px solid hsl(var(--border))",
            borderRadius: "var(--radius)",
          }}
        />
      )}
      {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
      {references.map((ref, index) => (
        <ReferenceLine
          key={index}
          y={ref.value}
          stroke={ref.color || "hsl(var(--muted-foreground))"}
          strokeDasharray={ref.dashed ? "5 5" : undefined}
          label={{
            value: ref.label,
            position: "right",
            fontSize: 10,
            fill: "hsl(var(--muted-foreground))",
          }}
        />
      ))}
    </>
  );

  // Render based on chart type
  switch (chartType) {
    case "line":
      return chartWrapper(
        <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          {commonCartesian}
          {effectiveSeries.map((s, index) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color || chartColors[index % chartColors.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={animate}
            />
          ))}
        </LineChart>
      );

    case "bar":
      return chartWrapper(
        <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          {commonCartesian}
          {effectiveSeries.map((s, index) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.name}
              fill={s.color || chartColors[index % chartColors.length]}
              radius={[4, 4, 0, 0]}
              isAnimationActive={animate}
            />
          ))}
        </BarChart>
      );

    case "area":
      return chartWrapper(
        <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          {commonCartesian}
          {effectiveSeries.map((s, index) => (
            <Area
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.color || chartColors[index % chartColors.length]}
              fill={s.color || chartColors[index % chartColors.length]}
              fillOpacity={0.3}
              isAnimationActive={animate}
            />
          ))}
        </AreaChart>
      );

    case "pie":
      return chartWrapper(
        <PieChart>
          {showTooltip && (
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
            />
          )}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <Pie
            data={data}
            dataKey={effectiveSeries[0]?.dataKey || "value"}
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
            labelLine={false}
            isAnimationActive={animate}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
            ))}
          </Pie>
        </PieChart>
      );

    case "radar":
      return chartWrapper(
        <RadarChart data={data} cx="50%" cy="50%" outerRadius={80}>
          <PolarGrid className="stroke-border" />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" />
          <PolarRadiusAxis tick={{ fontSize: 9 }} className="text-muted-foreground" />
          {showTooltip && (
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
            />
          )}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          {effectiveSeries.map((s, index) => (
            <Radar
              key={s.dataKey}
              name={s.name}
              dataKey={s.dataKey}
              stroke={s.color || chartColors[index % chartColors.length]}
              fill={s.color || chartColors[index % chartColors.length]}
              fillOpacity={0.3}
              isAnimationActive={animate}
            />
          ))}
        </RadarChart>
      );

    case "radialBar":
      return chartWrapper(
        <RadialBarChart
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="30%"
          outerRadius="100%"
          startAngle={180}
          endAngle={0}
        >
          {showTooltip && (
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
            />
          )}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <RadialBar
            dataKey={effectiveSeries[0]?.dataKey || "value"}
            background
            isAnimationActive={animate}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
            ))}
          </RadialBar>
        </RadialBarChart>
      );

    case "scatter":
      return chartWrapper(
        <ScatterChart margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" className="stroke-border opacity-50" />}
          <XAxis
            type="number"
            dataKey={effectiveSeries[0]?.dataKey || "x"}
            name={effectiveSeries[0]?.name || "X"}
            tick={{ fontSize: 11 }}
            className="text-muted-foreground"
          />
          <YAxis
            type="number"
            dataKey={effectiveSeries[1]?.dataKey || "y"}
            name={effectiveSeries[1]?.name || "Y"}
            tick={{ fontSize: 11 }}
            className="text-muted-foreground"
          />
          {showTooltip && (
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: "var(--radius)",
              }}
            />
          )}
          {showLegend && <Legend wrapperStyle={{ fontSize: 11 }} />}
          <Scatter
            name={title}
            data={data}
            fill={chartColors[0]}
            isAnimationActive={animate}
          />
        </ScatterChart>
      );

    case "composed":
      return chartWrapper(
        <ComposedChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          {commonCartesian}
          {/* Default: first series as bar, rest as lines */}
          {effectiveSeries.map((s, index) =>
            index === 0 ? (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                fill={s.color || chartColors[index % chartColors.length]}
                radius={[4, 4, 0, 0]}
                isAnimationActive={animate}
              />
            ) : (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color || chartColors[index % chartColors.length]}
                strokeWidth={2}
                isAnimationActive={animate}
              />
            )
          )}
        </ComposedChart>
      );

    case "funnel":
    case "treemap":
      // These require more complex data structures - show placeholder
      return chartWrapper(
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          {chartType} chart type not yet implemented
        </div>
      );

    default:
      return chartWrapper(
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
          Unknown chart type: {chartType}
        </div>
      );
  }
}

// Export leg colors for use in bilateral comparisons
export { LEG_COLORS };
