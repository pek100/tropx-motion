/**
 * BlockRenderer
 *
 * Routes visualization block types to their respective React components.
 * Handles value computation from metric expressions.
 */

import { useMemo } from "react";
import type {
  VisualizationBlock,
  EvaluationContext,
  EvaluatedValue,
} from "./types";
import {
  evaluateMetric,
  evaluateFormula,
  resolveMetricValue,
} from "./types";
import {
  ExecutiveSummary,
  StatCard,
  AlertCard,
  NextSteps,
  ComparisonCard,
  ProgressCard,
  MetricGrid,
  QuoteCard,
  ChartBlock,
} from "./blocks";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface BlockRendererProps {
  block: VisualizationBlock;
  context: EvaluationContext;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function computeTrend(
  metricPath: string,
  context: EvaluationContext
): "up" | "down" | "stable" | null {
  if (!context.previous) return null;

  const current = resolveMetricValue(metricPath, context.current);
  const previous = resolveMetricValue(metricPath, context.previous);

  if (current === undefined || previous === undefined) return null;

  const diff = current - previous;
  const threshold = Math.abs(previous) * 0.02; // 2% threshold for "stable"

  if (diff > threshold) return "up";
  if (diff < -threshold) return "down";
  return "stable";
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function BlockRenderer({ block, context, className }: BlockRendererProps) {
  const renderedBlock = useMemo(() => {
    switch (block.type) {
      case "executive_summary":
        return (
          <ExecutiveSummary
            title={block.title}
            content={block.content}
            className={className}
          />
        );

      case "stat_card": {
        const metricResult = evaluateMetric(block.metric, context);

        // Compute comparison if specified
        let comparison:
          | { value: number; label?: string; type?: "baseline" | "previous" | "average" | "target" }
          | undefined;

        if (block.comparison) {
          if (block.comparison.formula) {
            const formulaResult = evaluateFormula(
              block.comparison.formula,
              context,
              block.metric
            );
            if (formulaResult.success) {
              comparison = {
                value: formulaResult.value,
                label: block.comparison.label,
                type: block.comparison.type,
              };
            }
          } else {
            // Default comparison formulas
            let compValue: number | undefined;
            switch (block.comparison.type) {
              case "baseline":
                if (context.baseline) {
                  const baseline = resolveMetricValue(block.metric, context.baseline);
                  const current = resolveMetricValue(block.metric, context.current);
                  if (baseline !== undefined && current !== undefined && baseline !== 0) {
                    compValue = ((current - baseline) / baseline) * 100;
                  }
                }
                break;
              case "previous":
                if (context.previous) {
                  const previous = resolveMetricValue(block.metric, context.previous);
                  const current = resolveMetricValue(block.metric, context.current);
                  if (previous !== undefined && current !== undefined && previous !== 0) {
                    compValue = ((current - previous) / previous) * 100;
                  }
                }
                break;
              case "average":
                if (context.history && context.history.length > 0) {
                  const values = context.history
                    .map((s) => resolveMetricValue(block.metric, s))
                    .filter((v): v is number => v !== undefined);
                  if (values.length > 0) {
                    const avg = values.reduce((a, b) => a + b, 0) / values.length;
                    const current = resolveMetricValue(block.metric, context.current);
                    if (current !== undefined && avg !== 0) {
                      compValue = ((current - avg) / avg) * 100;
                    }
                  }
                }
                break;
              case "target":
                if (block.comparison.targetValue !== undefined) {
                  const current = resolveMetricValue(block.metric, context.current);
                  if (current !== undefined && block.comparison.targetValue !== 0) {
                    compValue =
                      ((current - block.comparison.targetValue) /
                        block.comparison.targetValue) *
                      100;
                  }
                }
                break;
            }

            if (compValue !== undefined) {
              comparison = {
                value: compValue,
                label: block.comparison.label || `vs ${block.comparison.type}`,
                type: block.comparison.type,
              };
            }
          }
        }

        return (
          <StatCard
            title={block.title}
            value={metricResult.success ? metricResult.value.toFixed(1) : "N/A"}
            unit={block.unit}
            comparison={comparison}
            icon={block.icon}
            variant={block.variant}
            className={className}
          />
        );
      }

      case "alert_card":
        return (
          <AlertCard
            title={block.title}
            description={block.description}
            severity={block.severity}
            icon={block.icon}
            className={className}
          />
        );

      case "next_steps":
        return (
          <NextSteps
            title={block.title}
            items={block.items}
            collapsible={block.collapsible}
            defaultCollapsed={block.defaultCollapsed}
            className={className}
          />
        );

      case "comparison_card": {
        // Check if metrics are defined
        if (!block.leftMetric || !block.rightMetric) {
          console.warn("[BlockRenderer] Comparison card missing metrics:", {
            title: block.title,
            leftMetric: block.leftMetric,
            rightMetric: block.rightMetric,
          });
          // Show error state when metrics are missing
          return (
            <div className="p-4 border border-dashed border-yellow-500/50 rounded-lg bg-yellow-500/5">
              <p className="text-sm text-yellow-600 dark:text-yellow-400">
                ⚠️ {block.title}: Missing metric configuration
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Re-run analysis to fix visualization
              </p>
            </div>
          );
        }

        const leftResult = evaluateMetric(block.leftMetric, context);
        const rightResult = evaluateMetric(block.rightMetric, context);

        return (
          <ComparisonCard
            title={block.title}
            leftLabel={block.leftLabel}
            rightLabel={block.rightLabel}
            leftValue={leftResult.success ? leftResult.value : 0}
            rightValue={rightResult.success ? rightResult.value : 0}
            unit={block.unit}
            showDifference={block.showDifference}
            highlightBetter={block.highlightBetter}
            className={className}
          />
        );
      }

      case "progress_card": {
        const currentResult = evaluateMetric(block.metric, context);
        const targetValue =
          typeof block.target === "number"
            ? block.target
            : evaluateMetric(block.target, context).value;

        return (
          <ProgressCard
            title={block.title}
            description={block.description}
            current={currentResult.success ? currentResult.value : 0}
            target={targetValue}
            icon={block.icon}
            celebrationLevel={block.celebrationLevel}
            className={className}
          />
        );
      }

      case "metric_grid": {
        const metrics = block.metrics.map((m) => {
          const result = evaluateMetric(m.metric, context);
          const trend = m.trend === "show" ? computeTrend(m.metric, context) : null;

          return {
            label: m.label,
            value: result.success ? result.value : "N/A",
            unit: m.unit,
            trend,
          };
        });

        // Parse columns from string (schema constraint) to number
        const columns = typeof block.columns === "string"
          ? (parseInt(block.columns, 10) as 2 | 3 | 4)
          : block.columns;

        return (
          <MetricGrid
            title={block.title}
            columns={columns}
            metrics={metrics}
            className={className}
          />
        );
      }

      case "quote_card":
        return (
          <QuoteCard
            content={block.content}
            citation={block.citation}
            icon={block.icon}
            variant={block.variant}
            className={className}
          />
        );

      case "chart": {
        // Build chart data from dataSpec
        // This is a simplified implementation - real implementation would
        // need to handle all dataSpec variations
        const chartData: Array<Record<string, string | number>> = [];
        const series: Array<{ name: string; dataKey: string; color?: string }> = [];

        if (block.dataSpec.series) {
          // For single/multi series: each metric becomes a series
          block.dataSpec.series.forEach((s, index) => {
            const value = resolveMetricValue(s.metric, context.current);
            if (value !== undefined) {
              if (chartData.length === 0) {
                chartData.push({ name: "Current", [s.name]: value });
              } else {
                chartData[0][s.name] = value;
              }
              series.push({
                name: s.name,
                dataKey: s.name,
                color: s.color,
              });
            }
          });
        }

        if (block.dataSpec.comparisons) {
          // For comparison charts
          block.dataSpec.comparisons.forEach((comp) => {
            const leftValue = resolveMetricValue(comp.leftMetric, context.current);
            const rightValue = resolveMetricValue(comp.rightMetric, context.current);
            chartData.push({
              name: comp.label,
              left: leftValue ?? 0,
              right: rightValue ?? 0,
            });
          });
          series.push(
            { name: "Left Leg", dataKey: "left", color: "#3B82F6" },
            { name: "Right Leg", dataKey: "right", color: "#EF4444" }
          );
        }

        if (block.dataSpec.timeSeries && context.history) {
          // Debug: Check if any bilateral metrics are in time series
          const hasBilateralMetric = block.dataSpec.timeSeries.metrics.some(
            (m) => m?.startsWith("bilateral.")
          );
          if (hasBilateralMetric) {
            console.log("[BlockRenderer] Time series with bilateral metrics:", JSON.stringify({
              metrics: block.dataSpec.timeSeries.metrics,
              historyCount: context.history.length,
              firstSessionBilateral: context.history[0]?.bilateral,
            }, null, 2));
          }

          // For time series: build data from history
          block.dataSpec.timeSeries.metrics.forEach((metricPath) => {
            if (!metricPath) return;
            series.push({
              name: metricPath.split(".").pop() || metricPath,
              dataKey: metricPath,
            });
          });

          context.history.forEach((session, idx) => {
            const point: Record<string, string | number> = {
              name: new Date(session.recordedAt).toLocaleDateString(),
            };
            block.dataSpec.timeSeries?.metrics.forEach((metricPath) => {
              const value = resolveMetricValue(metricPath, session);
              // Debug: Log bilateral value resolution for first session
              if (idx === 0 && metricPath?.startsWith("bilateral.")) {
                console.log("[BlockRenderer] Time series bilateral value:", JSON.stringify({
                  metricPath,
                  value,
                  sessionBilateral: session.bilateral,
                }, null, 2));
              }
              if (value !== undefined) {
                point[metricPath] = value;
              }
            });
            chartData.push(point);
          });
        }

        if (block.dataSpec.radarMetrics) {
          // For radar charts
          block.dataSpec.radarMetrics.forEach((rm) => {
            const value = resolveMetricValue(rm.metric, context.current);
            chartData.push({
              name: rm.name,
              value: value ?? 0,
            });
          });
          series.push({ name: "Current", dataKey: "value" });
        }

        // Build references
        const references = (block.dataSpec.references || []).map((ref) => ({
          label: ref.label,
          value:
            typeof ref.value === "number"
              ? ref.value
              : resolveMetricValue(ref.value, context.current) ?? 0,
          color: ref.color,
          dashed: ref.dashed,
        }));

        return (
          <ChartBlock
            chartType={block.chartType}
            title={block.title}
            data={chartData}
            series={series}
            references={references}
            config={block.config}
            className={className}
          />
        );
      }

      default:
        // TypeScript exhaustiveness check
        const _exhaustive: never = block;
        return (
          <div className="p-4 border border-dashed rounded-lg text-muted-foreground text-sm">
            Unknown block type: {(block as VisualizationBlock).type}
          </div>
        );
    }
  }, [block, context, className]);

  return renderedBlock;
}
