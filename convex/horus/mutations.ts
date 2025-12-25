/**
 * Horus Mutations
 *
 * Write endpoints for managing analyses and progress.
 */

import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

// ─────────────────────────────────────────────────────────────────
// Analysis Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Delete analysis for a session.
 */
export const deleteAnalysis = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    // Delete from horusAnalyses
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis) {
      await ctx.db.delete(analysis._id);
    }

    // Delete from horusPipelineStatus
    const status = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (status) {
      await ctx.db.delete(status._id);
    }

    return { deleted: !!analysis };
  },
});

/**
 * Clear error status and allow retry.
 */
export const clearError = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    // Update horusAnalyses
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis && analysis.status === "error") {
      await ctx.db.patch(analysis._id, {
        status: "pending",
        error: undefined,
      });
    }

    // Update horusPipelineStatus
    const status = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (status && status.status === "error") {
      await ctx.db.patch(status._id, {
        status: "pending",
        error: undefined,
        updatedAt: Date.now(),
      });
    }

    return { cleared: !!analysis };
  },
});

// ─────────────────────────────────────────────────────────────────
// Progress Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Delete progress report for a patient.
 */
export const deleteProgressReport = mutation({
  args: { patientId: v.id("users") },
  handler: async (ctx, { patientId }) => {
    const progress = await ctx.db
      .query("horusProgress")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .first();

    if (progress) {
      await ctx.db.delete(progress._id);
      return { deleted: true };
    }

    return { deleted: false };
  },
});

// ─────────────────────────────────────────────────────────────────
// Cache Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Clear all research cache entries.
 */
export const clearResearchCache = mutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("horusResearchCache").collect();
    let deleted = 0;

    for (const entry of entries) {
      await ctx.db.delete(entry._id);
      deleted++;
    }

    return { deleted };
  },
});

/**
 * Delete specific cache entry.
 */
export const deleteCacheEntry = mutation({
  args: { id: v.id("horusResearchCache") },
  handler: async (ctx, { id }) => {
    const entry = await ctx.db.get(id);
    if (entry) {
      await ctx.db.delete(id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});

// ─────────────────────────────────────────────────────────────────
// Admin Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Clean up old/stale pipeline statuses.
 */
export const cleanupStalePipelines = mutation({
  args: {
    maxAgeMs: v.optional(v.number()), // Default 24 hours
  },
  handler: async (ctx, { maxAgeMs = 24 * 60 * 60 * 1000 }) => {
    const now = Date.now();
    const cutoff = now - maxAgeMs;

    // Find stale pipelines (not complete/error and older than maxAge)
    const pipelines = await ctx.db
      .query("horusPipelineStatus")
      .filter((q) =>
        q.and(
          q.lt(q.field("updatedAt"), cutoff),
          q.neq(q.field("status"), "complete"),
          q.neq(q.field("status"), "error")
        )
      )
      .collect();

    let cleaned = 0;

    for (const pipeline of pipelines) {
      // Mark as error
      await ctx.db.patch(pipeline._id, {
        status: "error",
        error: {
          agent: pipeline.currentAgent || "decomposition",
          message: "Pipeline timed out",
          retryable: true,
        },
        updatedAt: now,
      });

      // Also update analysis record
      const analysis = await ctx.db
        .query("horusAnalyses")
        .withIndex("by_session", (q) => q.eq("sessionId", pipeline.sessionId))
        .first();

      if (analysis && analysis.status !== "complete" && analysis.status !== "error") {
        await ctx.db.patch(analysis._id, {
          status: "error",
          error: {
            agent: pipeline.currentAgent || "decomposition",
            message: "Pipeline timed out",
            retryable: true,
          },
        });
      }

      cleaned++;
    }

    return { cleaned };
  },
});

/**
 * Delete all Horus data (for testing/reset).
 */
export const resetAllData = mutation({
  args: {
    confirm: v.literal("DELETE_ALL_HORUS_DATA"),
  },
  handler: async (ctx, { confirm }) => {
    if (confirm !== "DELETE_ALL_HORUS_DATA") {
      throw new Error("Confirmation required");
    }

    let deleted = {
      analyses: 0,
      pipelineStatuses: 0,
      progress: 0,
      cache: 0,
    };

    // Delete all analyses
    const analyses = await ctx.db.query("horusAnalyses").collect();
    for (const a of analyses) {
      await ctx.db.delete(a._id);
      deleted.analyses++;
    }

    // Delete all pipeline statuses
    const statuses = await ctx.db.query("horusPipelineStatus").collect();
    for (const s of statuses) {
      await ctx.db.delete(s._id);
      deleted.pipelineStatuses++;
    }

    // Delete all progress
    const progress = await ctx.db.query("horusProgress").collect();
    for (const p of progress) {
      await ctx.db.delete(p._id);
      deleted.progress++;
    }

    // Delete all cache
    const cache = await ctx.db.query("horusResearchCache").collect();
    for (const c of cache) {
      await ctx.db.delete(c._id);
      deleted.cache++;
    }

    return deleted;
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Update analysis with partial data.
 */
export const updateAnalysis = internalMutation({
  args: {
    sessionId: v.string(),
    updates: v.any(),
  },
  handler: async (ctx, { sessionId, updates }) => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis) {
      await ctx.db.patch(analysis._id, updates);
    }
  },
});
