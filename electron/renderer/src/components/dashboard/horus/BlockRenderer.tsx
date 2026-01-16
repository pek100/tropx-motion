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
  resolveMetricWithUnit,
  getMetricConfig,
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
            variant={block.variant}
            className={className}
          />
        );

      case "stat_card": {
        // Use resolveMetricWithUnit to get value AND unit from tag
        const resolved = resolveMetricWithUnit(block.metric, context.current, block.unit);
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
            value={resolved.success ? resolved.formatted : "N/A"}
            unit={resolved.unit}
            comparison={comparison}
            icon={block.icon}
            variant={block.variant}
            className={className}
            // Composable slots
            id={block.id}
            classification={block.classification}
            limb={block.limb}
            benchmark={block.benchmark}
            domain={block.domain}
            details={block.details}
            expandable={block.expandable}
            defaultExpanded={block.defaultExpanded}
          />
        );
      }

      case "alert_card":
        return (
          <AlertCard
            title={block.title}
            description={block.description}
            severity={block.severity}
            variant={block.variant}
            icon={block.icon}
            className={className}
            // Composable slots
            id={block.id}
            limb={block.limb}
            domain={block.domain}
            details={block.details}
            expandable={block.expandable}
            defaultExpanded={block.defaultExpanded}
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

        // Use resolveMetricWithUnit to get value AND unit from tags
        const leftResolved = resolveMetricWithUnit(block.leftMetric, context.current, block.unit);
        const rightResolved = resolveMetricWithUnit(block.rightMetric, context.current, block.unit);

        return (
          <ComparisonCard
            title={block.title}
            leftLabel={block.leftLabel}
            rightLabel={block.rightLabel}
            leftValue={leftResolved.success ? leftResolved.value : 0}
            rightValue={rightResolved.success ? rightResolved.value : 0}
            unit={leftResolved.unit || rightResolved.unit}
            showDifference={block.showDifference}
            highlightBetter={block.highlightBetter}
            direction={block.direction}
            className={className}
            // Composable slots
            id={block.id}
            classification={block.classification}
            deficitLimb={block.deficitLimb}
            domain={block.domain}
            details={block.details}
            expandable={block.expandable}
            defaultExpanded={block.defaultExpanded}
          />
        );
      }

      case "progress_card": {
        // Use resolveMetricWithUnit to get value AND unit from tag
        const resolved = resolveMetricWithUnit(block.metric, context.current, block.unit);
        const targetValue =
          typeof block.target === "number"
            ? block.target
            : evaluateMetric(block.target, context).value;

        return (
          <ProgressCard
            title={block.title}
            description={block.description}
            current={resolved.success ? resolved.value : 0}
            target={targetValue}
            unit={resolved.unit}
            icon={block.icon}
            celebrationLevel={block.celebrationLevel}
            className={className}
            // Composable slots
            id={block.id}
            classification={block.classification}
            limb={block.limb}
            details={block.details}
            expandable={block.expandable}
            defaultExpanded={block.defaultExpanded}
          />
        );
      }

      case "metric_grid": {
        const metrics = block.metrics.map((m) => {
          // Use resolveMetricWithUnit to get value AND unit from tag
          const resolved = resolveMetricWithUnit(m.metric, context.current, m.unit);
          const trend = m.trend === "show" ? computeTrend(m.metric, context) : null;

          return {
            label: m.label,
            value: resolved.success ? resolved.value : "N/A",
            unit: resolved.unit,
            trend,
            // Per-item composable slots
            classification: m.classification,
            benchmark: m.benchmark,
            limb: m.limb,
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
            // Composable slots
            id={block.id}
            domain={block.domain}
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
            { name: "Left Leg", dataKey: "left", color: "var(--leg-left-band)" },
            { name: "Right Leg", dataKey: "right", color: "var(--leg-right-band)" }
          );
        }

        if (block.dataSpec.timeSeries && context.history) {
          // For time series: build data from history
          block.dataSpec.timeSeries.metrics.forEach((metricPath) => {
            if (!metricPath) return;
            series.push({
              name: metricPath.split(".").pop() || metricPath,
              dataKey: metricPath,
            });
          });

          context.history.forEach((session) => {
            const point: Record<string, string | number> = {
              name: new Date(session.recordedAt).toLocaleDateString(),
            };
            block.dataSpec.timeSeries?.metrics.forEach((metricPath) => {
              const value = resolveMetricValue(metricPath, session);
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
