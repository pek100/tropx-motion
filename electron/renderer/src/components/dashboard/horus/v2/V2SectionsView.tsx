/**
 * V2SectionsView Component
 *
 * Main view for displaying Horus v2 analysis results.
 * Handles loading, error, and complete states.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Loader2, AlertTriangle, RefreshCw, AlertCircle } from "lucide-react";
import { V2SummaryCard } from "./V2SummaryCard";
import { SectionCard, type EnrichedSectionData, type SeverityLevel } from "./SectionCard";
import type { RadarScores } from "./PerformanceRadar";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface KeyFinding {
  text: string;
  severity: SeverityLevel;
}

export interface V2PipelineOutput {
  sessionId: string;
  radarScores: RadarScores;
  keyFindings: KeyFinding[];
  clinicalImplications: string;
  enrichedSections: EnrichedSectionData[];
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  failedEnrichments: string[];
  totalDurationMs: number;
}

// Note: DB stores "analysis"/"research", not "analyzing"/"researching"
export type V2PipelineStatus =
  | "pending"
  | "analysis"
  | "research"
  | "complete"
  | "error";

interface V2SectionsViewProps {
  output?: V2PipelineOutput | null;
  status: V2PipelineStatus;
  error?: { message: string } | null;
  onRetry?: () => void;
  className?: string;
}

// Re-export types for convenience
export type { EnrichedSectionData, SeverityLevel } from "./SectionCard";
export type { RadarScores } from "./PerformanceRadar";

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function V2SectionsView({
  output,
  status,
  error,
  onRetry,
  className,
}: V2SectionsViewProps) {
  // Pending state
  if (status === "pending") {
    return (
      <section
        className={cn("flex flex-col items-center justify-center py-12", className)}
        aria-busy="true"
        aria-live="polite"
      >
        <Loader2
          className="h-8 w-8 text-[var(--tropx-text-sub)] animate-pulse mb-4"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-[var(--tropx-text-main)]">
          Waiting for metrics...
        </p>
        <p className="text-xs text-[var(--tropx-text-sub)] mt-1">
          Analysis will start automatically
        </p>
      </section>
    );
  }

  // Loading states (DB stores "analysis"/"research")
  if (status === "analysis" || status === "research") {
    return (
      <section
        className={cn("flex flex-col items-center justify-center py-12", className)}
        aria-busy="true"
        aria-live="polite"
      >
        <Loader2
          className="h-8 w-8 text-[var(--tropx-vibrant)] animate-spin mb-4"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-[var(--tropx-text-main)]">
          {status === "analysis" ? "Analyzing session data..." : "Researching findings..."}
        </p>
        <p className="text-xs text-[var(--tropx-text-sub)] mt-1">
          {status === "analysis"
            ? "Identifying clinical findings"
            : "Validating with research evidence"}
        </p>
        <span className="sr-only">
          {status === "analysis"
            ? "Analysis in progress, please wait"
            : "Research validation in progress, please wait"}
        </span>
      </section>
    );
  }

  // Error state
  if (status === "error" || error) {
    return (
      <section
        className={cn("flex flex-col items-center justify-center py-12", className)}
        role="alert"
        aria-live="assertive"
      >
        <AlertTriangle
          className="h-8 w-8 text-[var(--tropx-red)] mb-4"
          aria-hidden="true"
        />
        <p className="text-sm font-medium text-[var(--tropx-text-main)] mb-2">
          Analysis Failed
        </p>
        <p className="text-xs text-[var(--tropx-text-sub)] mb-4 text-center max-w-xs">
          {error?.message || "An unexpected error occurred during analysis."}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--tropx-vibrant)] text-white hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Analysis
          </button>
        )}
      </section>
    );
  }

  // No output yet
  if (!output) {
    return null;
  }

  const { enrichedSections, failedEnrichments } = output;

  // Sort sections by priority (highest first)
  const sortedSections = useMemo(() => {
    return [...enrichedSections].sort((a, b) => (b.priority || 5) - (a.priority || 5));
  }, [enrichedSections]);

  // Completed state with results
  return (
    <section className={cn("space-y-6", className)} aria-label="Analysis Results">
      {/* Screen reader announcement */}
      <span className="sr-only" role="status">
        Analysis complete: {sortedSections.length} findings identified
      </span>

      {/* Summary Section */}
      <V2SummaryCard
        radarScores={output.radarScores}
        keyFindings={output.keyFindings}
        clinicalImplications={output.clinicalImplications}
        strengths={output.strengths}
        weaknesses={output.weaknesses}
        recommendations={output.recommendations}
      />

      {/* Divider */}
      <div className="border-t border-[var(--tropx-border)]" />

      {/* Failed enrichments warning */}
      {failedEnrichments.length > 0 && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--tropx-warning-bg)] text-[var(--tropx-warning-text)]">
          <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs">
            {failedEnrichments.length} section(s) could not be enriched with research evidence
          </p>
        </div>
      )}

      {/* Section Cards - Sorted by priority, first one expanded */}
      <div className="space-y-4">
        {sortedSections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            defaultExpanded={index === 0}
          />
        ))}
      </div>
    </section>
  );
}
