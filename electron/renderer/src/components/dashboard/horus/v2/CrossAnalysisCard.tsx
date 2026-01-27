/**
 * CrossAnalysisCard Component
 *
 * Displays cross-analysis insights including trend insights,
 * recurring patterns, and baseline comparison.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Target,
  RefreshCw,
  Activity,
  Calendar,
  Lightbulb,
  Footprints,
  Scale,
  Zap,
  Move,
  Timer,
  Dumbbell,
  Heart,
  ScatterChart,
} from "lucide-react";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { VectorVisualizationModal } from "../../VectorVisualizationModal";
import type {
  CrossAnalysisResult,
  CrossAnalysisOutput,
  MinimalCrossAnalysisOutput,
  TrendInsight,
  RecurringPattern,
  RefinedInsight,
  InsightIconHint,
} from "../../../../../../../convex/horus/crossAnalysis/types";
import type { SpeculativeInsight } from "./V2SummaryCard";

// ─────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────

function hasFullAnalysis(
  result: CrossAnalysisResult
): result is CrossAnalysisOutput {
  return !("insufficientHistory" in result);
}

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────

interface CrossAnalysisCardProps {
  crossAnalysis?: CrossAnalysisResult;
  speculativeInsights?: SpeculativeInsight[];
  patientId?: Id<"users">;
  patientName?: string;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function getTrendIcon(direction: TrendInsight["direction"]) {
  switch (direction) {
    case "improving":
      return <TrendingUp className="h-4 w-4 text-[var(--tropx-success-text)]" />;
    case "declining":
      return <TrendingDown className="h-4 w-4 text-[var(--tropx-red)]" />;
    case "stable":
      return <Minus className="h-4 w-4 text-[var(--tropx-text-sub)]" />;
  }
}

function getTrendColor(direction: TrendInsight["direction"]) {
  switch (direction) {
    case "improving":
      return "var(--tropx-success-text)";
    case "declining":
      return "var(--tropx-red)";
    case "stable":
      return "var(--tropx-text-sub)";
  }
}

function getMagnitudeLabel(magnitude: TrendInsight["magnitude"]) {
  switch (magnitude) {
    case "significant":
      return "Significant";
    case "moderate":
      return "Moderate";
    case "slight":
      return "Slight";
  }
}

function getPatternIcon(patternType: RecurringPattern["patternType"]) {
  switch (patternType) {
    case "consistent_weakness":
      return <AlertTriangle className="h-4 w-4 text-[var(--tropx-warning-text)]" />;
    case "improving_metric":
      return <TrendingUp className="h-4 w-4 text-[var(--tropx-success-text)]" />;
    case "declining_metric":
      return <TrendingDown className="h-4 w-4 text-[var(--tropx-red)]" />;
    case "plateau":
      return <Minus className="h-4 w-4 text-[var(--tropx-text-sub)]" />;
    case "asymmetry_persistent":
      return <AlertTriangle className="h-4 w-4 text-[var(--tropx-warning-text)]" />;
    case "asymmetry_resolving":
      return <CheckCircle2 className="h-4 w-4 text-[var(--tropx-success-text)]" />;
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getConfidenceLabel(confidence: CrossAnalysisOutput["analysisConfidence"]) {
  switch (confidence) {
    case "high":
      return { label: "High Confidence", color: "var(--tropx-success-text)" };
    case "moderate":
      return { label: "Moderate Confidence", color: "var(--tropx-warning-text)" };
    case "low":
      return { label: "Limited Data", color: "var(--tropx-text-sub)" };
  }
}

/** Map icon hints to Lucide icons */
function getInsightIcon(iconHint: InsightIconHint) {
  switch (iconHint) {
    case "leg":
      return <Footprints className="h-4 w-4" />;
    case "balance":
      return <Scale className="h-4 w-4" />;
    case "speed":
      return <Zap className="h-4 w-4" />;
    case "range":
      return <Move className="h-4 w-4" />;
    case "trend":
      return <TrendingUp className="h-4 w-4" />;
    case "warning":
      return <AlertTriangle className="h-4 w-4" />;
    case "strength":
      return <Dumbbell className="h-4 w-4" />;
    case "timing":
      return <Timer className="h-4 w-4" />;
    case "recovery":
      return <Heart className="h-4 w-4" />;
    default:
      return <Lightbulb className="h-4 w-4" />;
  }
}

// ─────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────

/** Insufficient history message (compact version for inline display) */
function InsufficientHistoryCard({ data }: { data: MinimalCrossAnalysisOutput }) {
  return (
    <div className="flex items-center gap-3">
      <Clock className="h-8 w-8 text-[var(--tropx-text-sub)] flex-shrink-0" />
      <div>
        <h4 className="text-sm font-medium text-[var(--tropx-text-main)]">
          Building Patient History
        </h4>
        <p className="text-xs text-[var(--tropx-text-sub)]">
          {data.message}
        </p>
        <div className="flex items-center gap-2 mt-1 text-xs text-[var(--tropx-text-sub)]">
          <Activity className="h-3 w-3" />
          <span>
            {data.sessionsAvailable} of {data.sessionsRequired} sessions
          </span>
        </div>
      </div>
    </div>
  );
}

/** Trend insight row - compact bullet style */
function TrendInsightRow({ insight, color }: { insight: TrendInsight; color: string }) {
  const changeLabel =
    insight.changePercent > 0
      ? `+${insight.changePercent.toFixed(0)}%`
      : `${insight.changePercent.toFixed(0)}%`;

  return (
    <li className="flex items-start gap-2">
      <div
        className="h-1.5 w-1.5 rounded-full mt-1.5 flex-shrink-0"
        style={{ backgroundColor: color }}
      />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-[var(--tropx-text-main)]">
          <strong>{insight.displayName}</strong>: {insight.narrative}
        </span>
        <span
          className="ml-1.5 text-xs font-medium"
          style={{ color }}
        >
          ({changeLabel})
        </span>
      </div>
    </li>
  );
}

/** Recurring pattern card */
function PatternCard({ pattern }: { pattern: RecurringPattern }) {
  return (
    <div className="p-3 rounded-lg border border-[var(--tropx-border)]/30 bg-[var(--tropx-surface)]/30">
      {/* Header */}
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-shrink-0 mt-0.5">{getPatternIcon(pattern.patternType)}</div>
        <div>
          <h5 className="text-sm font-medium text-[var(--tropx-text-main)]">
            {pattern.title}
          </h5>
          <p className="text-xs text-[var(--tropx-text-sub)]">
            Seen in {pattern.sessionIds.length} sessions
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-[var(--tropx-text-sub)] mb-2">
        {pattern.description}
      </p>

      {/* Recommendation */}
      {pattern.recommendation && (
        <div className="flex items-start gap-2 p-2 rounded bg-[var(--tropx-success-text)]/10">
          <Target className="h-3.5 w-3.5 text-[var(--tropx-success-text)] flex-shrink-0 mt-0.5" />
          <span className="text-xs text-[var(--tropx-text-main)]">
            {pattern.recommendation}
          </span>
        </div>
      )}
    </div>
  );
}

/** Visual insight card (gallery-style like Key Findings) */
function InsightCard({ insight }: { insight: RefinedInsight }) {
  return (
    <div className="flex flex-col items-center p-3 md:p-4 rounded-xl bg-[var(--tropx-surface)]/40 md:flex-1 md:min-w-0">
      {/* Icon - hero element */}
      <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-[var(--tropx-vibrant)]/15 text-[var(--tropx-vibrant)] mb-3">
        {getInsightIcon(insight.iconHint)}
      </div>
      {/* Title */}
      <h5 className="text-sm font-semibold text-[var(--tropx-text-main)] text-center mb-1">
        {insight.title}
      </h5>
      {/* Summary */}
      <p className="text-xs text-[var(--tropx-text-sub)] text-center leading-relaxed line-clamp-3">
        {insight.summary}
      </p>
    </div>
  );
}

/** Visual speculative insight card (gallery-style like Key Findings) */
function SpeculativeInsightCard({ insight }: { insight: SpeculativeInsight }) {
  return (
    <div className="flex flex-col items-center p-3 md:p-4 rounded-xl bg-[var(--tropx-surface)]/40 md:flex-1 md:min-w-0">
      {/* Icon - hero element */}
      <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-[var(--tropx-vibrant)]/15 text-[var(--tropx-vibrant)] mb-3">
        <Lightbulb className="h-6 w-6" />
      </div>
      {/* Title */}
      <h5 className="text-sm font-semibold text-[var(--tropx-text-main)] text-center mb-1">
        {insight.label}
      </h5>
      {/* Description */}
      <p className="text-xs text-[var(--tropx-text-sub)] text-center leading-relaxed line-clamp-3">
        {insight.description}
      </p>
    </div>
  );
}

/** Baseline comparison section */
function BaselineSection({ comparison }: { comparison: CrossAnalysisOutput["baselineComparison"] }) {
  const comparisonColor =
    comparison.comparedToBaseline === "above"
      ? "var(--tropx-success-text)"
      : comparison.comparedToBaseline === "below"
        ? "var(--tropx-red)"
        : "var(--tropx-text-sub)";

  return (
    <div className="mt-3 pt-3 border-t border-[var(--tropx-border)]/30">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCw className="h-4 w-4 text-[var(--tropx-accent)]" />
        <span className="text-sm font-medium text-[var(--tropx-text-main)]">
          Compared to Baseline
        </span>
        <span
          className="text-xs font-medium px-1.5 py-0.5 rounded capitalize"
          style={{
            backgroundColor: `color-mix(in srgb, ${comparisonColor} 15%, transparent)`,
            color: comparisonColor,
          }}
        >
          {comparison.comparedToBaseline}
        </span>
      </div>
      <p className="text-sm text-[var(--tropx-text-sub)]">
        {comparison.overallAssessment}
      </p>

      {/* Significant deviations */}
      {comparison.significantDeviations.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {comparison.significantDeviations.slice(0, 3).map((dev, i) => (
            <span
              key={i}
              className="text-xs px-2 py-1 rounded-full"
              style={{
                backgroundColor:
                  dev.direction === "above"
                    ? "color-mix(in srgb, var(--tropx-success-text) 15%, transparent)"
                    : "color-mix(in srgb, var(--tropx-red) 15%, transparent)",
                color:
                  dev.direction === "above"
                    ? "var(--tropx-success-text)"
                    : "var(--tropx-red)",
              }}
            >
              {dev.displayName}: {dev.deviationPercent > 0 ? "+" : ""}
              {dev.deviationPercent.toFixed(0)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function CrossAnalysisCard({ crossAnalysis, speculativeInsights, patientId, patientName, className }: CrossAnalysisCardProps) {
  const [showVisualization, setShowVisualization] = useState(false);

  const insights = speculativeInsights ?? [];
  const hasInsights = insights.length > 0;
  const hasCrossAnalysis = !!crossAnalysis;
  const hasFullCrossAnalysis = hasCrossAnalysis && hasFullAnalysis(crossAnalysis);

  // If no content at all, don't render
  if (!hasInsights && !hasCrossAnalysis) {
    return null;
  }

  // Get refined insights from cross-analysis if available
  const refinedInsights: RefinedInsight[] = hasFullCrossAnalysis
    ? (crossAnalysis as CrossAnalysisOutput).refinedInsights || []
    : [];

  return (
    <div
      className={cn(
        "rounded-xl gradient-diagonal border border-[var(--tropx-vibrant)]/15 p-4",
        className
      )}
    >
      {/* Header - adapts based on content */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[var(--tropx-vibrant)]/10">
            {hasFullCrossAnalysis ? (
              <Activity className="h-4 w-4 text-[var(--tropx-vibrant)]" />
            ) : (
              <Lightbulb className="h-4 w-4 text-[var(--tropx-vibrant)]" />
            )}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--tropx-text-main)]">
              {hasFullCrossAnalysis ? "Cross-Analysis Insights" : "Worth Investigating"}
            </h4>
            {hasFullCrossAnalysis ? (
              <div className="flex items-center gap-2 text-xs text-[var(--tropx-text-sub)]">
                <Calendar className="h-3 w-3" />
                <span>
                  {(crossAnalysis as CrossAnalysisOutput).sessionsAnalyzed} sessions over {(crossAnalysis as CrossAnalysisOutput).dateRangeDays} days
                </span>
                <span className="mx-1">|</span>
                {(() => {
                  const confidenceInfo = getConfidenceLabel((crossAnalysis as CrossAnalysisOutput).analysisConfidence);
                  return (
                    <span style={{ color: confidenceInfo?.color }}>
                      {confidenceInfo?.label}
                    </span>
                  );
                })()}
              </div>
            ) : (
              <p className="text-xs text-[var(--tropx-text-sub)]">
                AI-identified patterns that may warrant further exploration
              </p>
            )}
          </div>
        </div>

        {/* Visualize Data Button */}
        {patientId && (
          <button
            onClick={() => setShowVisualization(true)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium",
              "bg-[var(--tropx-surface)]/60 hover:bg-[var(--tropx-surface)]",
              "text-[var(--tropx-text-sub)] hover:text-[var(--tropx-text-main)]",
              "border border-[var(--tropx-border)]/30 hover:border-[var(--tropx-border)]/50",
              "transition-all duration-150"
            )}
          >
            <ScatterChart className="h-3.5 w-3.5" />
            <span>Visualize</span>
          </button>
        )}
      </div>

      {/* Insufficient History Message (if applicable) */}
      {hasCrossAnalysis && !hasFullCrossAnalysis && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--tropx-surface)]/40">
          <InsufficientHistoryCard data={crossAnalysis as MinimalCrossAnalysisOutput} />
        </div>
      )}

      {/* Summary (only for full cross-analysis) */}
      {hasFullCrossAnalysis && (
        <p className="text-sm text-[var(--tropx-text-main)] mb-4 leading-relaxed">
          {(crossAnalysis as CrossAnalysisOutput).summary}
        </p>
      )}

      {/* Worth Investigating / Refined Insights Section - Gallery Layout */}
      {(hasFullCrossAnalysis ? refinedInsights.length > 0 : hasInsights) && (
        <div className="mb-4">
          <span className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
            {hasFullCrossAnalysis ? "Key Insights" : "Worth Investigating"}
          </span>
          <div className="mt-2 grid grid-cols-2 gap-3 md:flex md:flex-nowrap md:gap-4">
            {hasFullCrossAnalysis
              ? refinedInsights.map((insight: RefinedInsight, i: number) => (
                  <InsightCard key={`insight-${i}`} insight={insight} />
                ))
              : insights.map((insight: SpeculativeInsight, i: number) => (
                  <SpeculativeInsightCard key={`spec-${i}`} insight={insight} />
                ))}
          </div>
        </div>
      )}

      {/* Trend Insights - Two Column Layout (only for full cross-analysis) */}
      {hasFullCrossAnalysis && (crossAnalysis as CrossAnalysisOutput).trendInsights.length > 0 && (() => {
        const allTrends = (crossAnalysis as CrossAnalysisOutput).trendInsights;
        const improvingTrends = allTrends.filter((t) => t.direction === "improving");
        const decliningTrends = allTrends.filter((t) => t.direction === "declining" || t.direction === "stable");

        return (
          <div className="mb-4 border-t border-[var(--tropx-border)]/30 pt-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Improving Trends */}
              <div>
                <span className="text-xs font-semibold text-[var(--tropx-success-text)] uppercase tracking-wide">
                  Improving
                </span>
                {improvingTrends.length > 0 ? (
                  <ul className="mt-1 space-y-1.5">
                    {improvingTrends.slice(0, 4).map((insight) => (
                      <TrendInsightRow
                        key={insight.id}
                        insight={insight}
                        color="var(--tropx-success-text)"
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-[var(--tropx-text-sub)] italic">
                    No improving trends detected
                  </p>
                )}
              </div>

              {/* Declining/Needs Attention Trends */}
              <div>
                <span className="text-xs font-semibold text-[var(--tropx-red)] uppercase tracking-wide">
                  Needs Attention
                </span>
                {decliningTrends.length > 0 ? (
                  <ul className="mt-1 space-y-1.5">
                    {decliningTrends.slice(0, 4).map((insight) => (
                      <TrendInsightRow
                        key={insight.id}
                        insight={insight}
                        color={insight.direction === "declining" ? "var(--tropx-red)" : "var(--tropx-text-sub)"}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-[var(--tropx-text-sub)] italic">
                    No concerning trends detected
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Recurring Patterns (only for full cross-analysis) */}
      {hasFullCrossAnalysis && (crossAnalysis as CrossAnalysisOutput).recurringPatterns.length > 0 && (
        <div className="mb-4">
          <span className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
            Recurring Patterns
          </span>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            {(crossAnalysis as CrossAnalysisOutput).recurringPatterns.map((pattern) => (
              <PatternCard key={pattern.id} pattern={pattern} />
            ))}
          </div>
        </div>
      )}

      {/* Baseline Comparison (only for full cross-analysis) */}
      {hasFullCrossAnalysis && (
        <BaselineSection comparison={(crossAnalysis as CrossAnalysisOutput).baselineComparison} />
      )}

      {/* Footer */}
      <p className="mt-3 pt-2.5 border-t border-[var(--tropx-border)]/20 text-xs text-[var(--tropx-text-sub)] text-center">
        {hasFullCrossAnalysis
          ? "Analysis based on comparison with patient's personal baseline"
          : "These hypotheses are generated based on pattern analysis and should be validated clinically"}
      </p>

      {/* Visualization Modal */}
      {patientId && (
        <VectorVisualizationModal
          open={showVisualization}
          onOpenChange={setShowVisualization}
          patientId={patientId}
          patientName={patientName}
        />
      )}
    </div>
  );
}
