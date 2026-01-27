/**
 * Horus Pipeline Status Mutations
 *
 * Manages pipeline status for both v1 (deprecated) and v2 analysis.
 * The actual pipeline orchestration is now in v2/orchestrator.ts.
 */

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { PipelineStatus, AgentName } from "./types";

// ─────────────────────────────────────────────────────────────────
// Pipeline Status Mutations (Shared)
// ─────────────────────────────────────────────────────────────────

/**
 * Reset pipeline status before starting a new analysis.
 * Call this BEFORE triggering Horus to clear any old error state.
 */
export const resetPipelineStatus = internalMutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const now = Date.now();

    // Reset pipeline status to pending (clears any error)
    const pipelineStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (pipelineStatus) {
      await ctx.db.patch(pipelineStatus._id, {
        status: "pending",
        currentAgent: undefined,
        error: undefined,
        updatedAt: now,
      });
    } else {
      // Create new status record if it doesn't exist
      await ctx.db.insert("horusPipelineStatus", {
        sessionId,
        status: "pending",
        revisionCount: 0,
        startedAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Initialize a new pipeline.
 */
export const initializePipeline = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
  },
  handler: async (ctx, { sessionId, patientId }) => {
    // Check if already exists
    const existing = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    const now = Date.now();

    if (existing) {
      // Reset existing
      await ctx.db.patch(existing._id, {
        status: "pending",
        decomposition: undefined,
        research: undefined,
        analysis: undefined,
        validation: undefined,
        error: undefined,
        startedAt: now,
        completedAt: undefined,
      });
    } else {
      // Create new
      await ctx.db.insert("horusAnalyses", {
        sessionId,
        patientId,
        status: "pending",
        startedAt: now,
      });
    }

    // Also update pipeline status table
    const existingStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existingStatus) {
      await ctx.db.patch(existingStatus._id, {
        status: "pending",
        currentAgent: undefined,
        revisionCount: 0,
        startedAt: now,
        updatedAt: now,
        error: undefined,
      });
    } else {
      await ctx.db.insert("horusPipelineStatus", {
        sessionId,
        status: "pending",
        revisionCount: 0,
        startedAt: now,
        updatedAt: now,
      });
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
      v.literal("decomposition"),
      v.literal("research"),
      v.literal("analysis"),
      v.literal("validation"),
      v.literal("progress"),
      v.literal("complete"),
      v.literal("error")
    ),
    currentAgent: v.optional(
      v.union(
        v.literal("decomposition"),
        v.literal("research"),
        v.literal("analysis"),
        v.literal("validator"),
        v.literal("progress")
      )
    ),
    revisionCount: v.optional(v.number()),
  },
  handler: async (ctx, { sessionId, status, currentAgent, revisionCount }) => {
    const now = Date.now();

    // Update analysis record
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis) {
      await ctx.db.patch(analysis._id, {
        status,
        completedAt: status === "complete" ? now : undefined,
      });
    }

    // Update pipeline status
    const pipelineStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (pipelineStatus) {
      await ctx.db.patch(pipelineStatus._id, {
        status,
        currentAgent,
        revisionCount: revisionCount ?? pipelineStatus.revisionCount,
        updatedAt: now,
      });
    }
  },
});

/**
 * Record pipeline error.
 */
export const recordPipelineError = internalMutation({
  args: {
    sessionId: v.string(),
    agent: v.union(
      v.literal("decomposition"),
      v.literal("research"),
      v.literal("analysis"),
      v.literal("validator"),
      v.literal("progress")
    ),
    message: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, { sessionId, agent, message, retryable }) => {
    console.error("[recordPipelineError] Recording error:", {
      sessionId,
      agent,
      message,
      retryable,
    });

    const now = Date.now();
    const error = { agent, message, retryable };

    // Update analysis record
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis) {
      await ctx.db.patch(analysis._id, {
        status: "error",
        error,
      });
    }

    // Update pipeline status
    const pipelineStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (pipelineStatus) {
      await ctx.db.patch(pipelineStatus._id, {
        status: "error",
        error,
        updatedAt: now,
      });
    }
  },
});
