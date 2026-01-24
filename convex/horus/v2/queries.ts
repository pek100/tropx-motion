/**
 * Horus v2 Queries
 *
 * Read operations for v2 analysis results.
 */

import { query, internalQuery } from "../../_generated/server";
import { v } from "convex/values";
import type { V2PipelineOutput, EnrichedSection } from "./types";

// ─────────────────────────────────────────────────────────────────
// Public Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get v2 analysis for a session.
 */
export const getAnalysisV2 = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!analysis?.analysis || (analysis.analysis as any).version !== 2) {
      return null;
    }

    return {
      sessionId: analysis.sessionId,
      status: analysis.status,
      output: analysis.analysis as {
        version: number;
        radarScores: {
          flexibility: number;
          consistency: number;
          symmetry: number;
          smoothness: number;
          control: number;
        };
        keyFindings: Array<{ text: string; severity: string }>;
        clinicalImplications: string;
        sections: any[];
        enrichedSections: EnrichedSection[];
        summary: string;
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
        failedEnrichments: string[];
      },
      tokenUsage: analysis.tokenUsage,
      totalCost: analysis.totalCost,
      startedAt: analysis.startedAt,
      completedAt: analysis.completedAt,
    };
  },
});

/**
 * Get v2 analysis status for a session.
 */
export const getAnalysisStatusV2 = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const status = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!status) {
      return null;
    }

    return {
      sessionId: status.sessionId,
      status: status.status,
      error: status.error,
      startedAt: status.startedAt,
      updatedAt: status.updatedAt,
    };
  },
});

/**
 * Get enriched sections for a session.
 */
export const getEnrichedSections = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!analysis?.analysis || (analysis.analysis as any).version !== 2) {
      return [];
    }

    return (analysis.analysis as any).enrichedSections as EnrichedSection[];
  },
});

/**
 * Get analysis summary for a session.
 */
export const getAnalysisSummary = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!analysis?.analysis || (analysis.analysis as any).version !== 2) {
      return null;
    }

    const output = analysis.analysis as any;

    return {
      summary: output.summary,
      strengths: output.strengths,
      weaknesses: output.weaknesses,
      sectionCount: output.enrichedSections?.length || 0,
      failedEnrichments: output.failedEnrichments?.length || 0,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Check if v2 analysis exists for a session.
 */
export const hasV2Analysis = internalQuery({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    return analysis?.analysis && (analysis.analysis as any).version === 2;
  },
});
