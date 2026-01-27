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
  ChevronDown,
  Footprints,
  Scale,
  Zap,
  Move,
  Timer,
  Dumbbell,
  Heart,
} from "lucide-react";
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

/** Trend insight row */
function TrendInsightRow({ insight }: { insight: TrendInsight }) {
  const changeLabel =
    insight.changePercent > 0
      ? `+${insight.changePercent.toFixed(0)}%`
      : `${insight.changePercent.toFixed(0)}%`;

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg bg-[var(--tropx-surface)]/40 hover:bg-[var(--tropx-surface)]/60 transition-colors">
      {/* Icon */}
      <div className="flex-shrink-0 mt-0.5">{getTrendIcon(insight.direction)}</div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-[var(--tropx-text-main)]">
            {insight.displayName}
          </span>
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `color-mix(in srgb, ${getTrendColor(insight.direction)} 15%, transparent)`,
              color: getTrendColor(insight.direction),
            }}
          >
            {insight.direction === "improving" ? "Improving" : insight.direction === "declining" ? "Declining" : "Stable"}
          </span>
        </div>
        <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed">
          {insight.narrative}
        </p>
        {/* Stats row */}
        <div className="flex items-center gap-4 mt-2 text-xs text-[var(--tropx-text-sub)]">
          <span>
            Current: <strong className="text-[var(--tropx-text-main)]">{insight.currentValue.toFixed(1)}</strong>
          </span>
          <span>
            Baseline: <strong className="text-[var(--tropx-text-main)]">{insight.baselineValue.toFixed(1)}</strong>
          </span>
          <span
            className="font-medium"
            style={{ color: getTrendColor(insight.direction) }}
          >
            {changeLabel} from baseline
          </span>
        </div>
      </div>
    </div>
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

/** Collapsible insight card (for refined insights from cross-analysis) */
function InsightCard({ insight }: { insight: RefinedInsight }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--tropx-border)]/30 bg-[var(--tropx-card)]/60 overflow-hidden">
      {/* Header - always visible, clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-[var(--tropx-surface)]/30 transition-colors"
      >
        {/* Icon */}
        <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)]">
          {getInsightIcon(insight.iconHint)}
        </div>
        {/* Title and summary */}
        <div className="flex-1 min-w-0">
          <h5 className="text-sm font-medium text-[var(--tropx-text-main)]">
            {insight.title}
          </h5>
          <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed mt-0.5">
            {insight.summary}
          </p>
        </div>
        {/* Expand indicator */}
        <ChevronDown
          className={cn(
            "flex-shrink-0 h-4 w-4 text-[var(--tropx-text-sub)] transition-transform",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {/* Details - expandable */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0">
          <div className="pl-11 border-l-2 border-[var(--tropx-vibrant)]/20 ml-1">
            <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed">
              {insight.details}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsible speculative insight card (for raw insights when no cross-analysis) */
function SpeculativeInsightCard({ insight }: { insight: SpeculativeInsight }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--tropx-border)]/30 bg-[var(--tropx-card)]/60 overflow-hidden">
      {/* Header - always visible, clickable */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:bg-[var(--tropx-surface)]/30 transition-colors"
      >
        {/* Icon */}
        <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--tropx-vibrant)]/10 text-[var(--tropx-vibrant)]">
          <Lightbulb className="h-4 w-4" />
        </div>
        {/* Title (label) */}
        <div className="flex-1 min-w-0">
          <h5 className="text-sm font-medium text-[var(--tropx-text-main)]">
            {insight.label}
          </h5>
        </div>
        {/* Expand indicator */}
        <ChevronDown
          className={cn(
            "flex-shrink-0 h-4 w-4 text-[var(--tropx-text-sub)] transition-transform",
            isExpanded && "rotate-180"
          )}
        />
      </button>

      {/* Details - expandable */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0">
          <div className="pl-11 border-l-2 border-[var(--tropx-vibrant)]/20 ml-1">
            <p className="text-sm text-[var(--tropx-text-sub)] leading-relaxed">
              {insight.description}
            </p>
          </div>
        </div>
      )}
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

export function CrossAnalysisCard({ crossAnalysis, speculativeInsights, className }: CrossAnalysisCardProps) {
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

      {/* Worth Investigating / Refined Insights Section */}
      {(hasFullCrossAnalysis ? refinedInsights.length > 0 : hasInsights) && (
        <div className="mb-4">
          <span className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
            {hasFullCrossAnalysis ? "Key Insights" : "Worth Investigating"}
          </span>
          <div className="mt-2 space-y-2">
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

      {/* Trend Insights (only for full cross-analysis) */}
      {hasFullCrossAnalysis && (crossAnalysis as CrossAnalysisOutput).trendInsights.length > 0 && (
        <div className="mb-4">
          <span className="text-xs font-medium text-[var(--tropx-text-sub)] uppercase tracking-wide">
            Trend Insights
          </span>
          <div className="mt-2 space-y-2">
            {(crossAnalysis as CrossAnalysisOutput).trendInsights.slice(0, 3).map((insight) => (
              <TrendInsightRow key={insight.id} insight={insight} />
            ))}
          </div>
        </div>
      )}

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
    </div>
  );
}
