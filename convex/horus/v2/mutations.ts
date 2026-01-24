/**
 * Horus v2 Mutations
 *
 * Database operations for v2 pipeline results.
 */

import { mutation, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import type { V2PipelineOutput } from "./types";

// ─────────────────────────────────────────────────────────────────
// Internal Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Save v2 analysis result to database.
 */
export const saveAnalysisResult = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    output: v.any(), // V2PipelineOutput
  },
  handler: async (ctx, { sessionId, patientId, output }) => {
    const pipelineOutput = output as V2PipelineOutput;

    // Check if analysis already exists
    const existing = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    const analysisData = {
      sessionId,
      patientId,
      status: "complete" as const,
      // Store v2 output in analysis field
      analysis: {
        version: 2,
        radarScores: pipelineOutput.radarScores,
        keyFindings: pipelineOutput.keyFindings,
        clinicalImplications: pipelineOutput.clinicalImplications,
        sections: pipelineOutput.sections,
        enrichedSections: pipelineOutput.enrichedSections,
        summary: pipelineOutput.summary,
        strengths: pipelineOutput.strengths,
        weaknesses: pipelineOutput.weaknesses,
        recommendations: pipelineOutput.recommendations,
        failedEnrichments: pipelineOutput.failedEnrichments,
      },
      tokenUsage: {
        analysis: pipelineOutput.tokenUsage.analysis,
        research: pipelineOutput.tokenUsage.total, // Aggregate research usage
      },
      totalCost: pipelineOutput.tokenUsage.total.estimatedCost,
      startedAt: pipelineOutput.startedAt,
      completedAt: pipelineOutput.completedAt,
    };

    if (existing) {
      // Update existing analysis
      await ctx.db.patch(existing._id, analysisData);
      return existing._id;
    } else {
      // Create new analysis
      return ctx.db.insert("horusAnalyses", analysisData);
    }
  },
});

/**
 * Update pipeline status.
 */
export const updatePipelineStatus = internalMutation({
  args: {
    sessionId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("analyzing"),
      v.literal("researching"),
      v.literal("complete"),
      v.literal("error")
    ),
    error: v.optional(
      v.object({
        agent: v.union(v.literal("analysis"), v.literal("research")),
        message: v.string(),
        sectionId: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, { sessionId, status, error }) => {
    const existing = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    // Map v2 status values to pipeline status values
    const mappedStatus = status === "analyzing" ? "analysis" :
                        status === "researching" ? "research" :
                        status;

    // Build error object if present
    const errorData = error ? {
      agent: error.agent as "analysis" | "research" | "decomposition" | "validator" | "progress",
      message: error.message,
      retryable: true,
    } : undefined;

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionId,
        status: mappedStatus,
        updatedAt: Date.now(),
        ...(errorData && { error: errorData }),
      });
    } else {
      await ctx.db.insert("horusPipelineStatus", {
        sessionId,
        status: mappedStatus,
        updatedAt: Date.now(),
        startedAt: Date.now(),
        revisionCount: 0,
        ...(errorData && { error: errorData }),
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Public Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Cancel/stop an in-progress analysis.
 * Note: Running Convex actions can't be truly cancelled, but this marks
 * the status so the UI knows it was stopped.
 */
export const cancelAnalysis = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const existing = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existing && existing.status !== "complete") {
      await ctx.db.patch(existing._id, {
        status: "error",
        error: {
          agent: "analysis" as const,
          message: "Analysis cancelled by user",
          retryable: true,
        },
        updatedAt: Date.now(),
      });
      return { cancelled: true };
    }

    return { cancelled: false };
  },
});

/**
 * Clear error from pipeline status.
 */
export const clearError = internalMutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const existing = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        error: undefined,
        status: "pending",
        updatedAt: Date.now(),
      });
    }
  },
});
