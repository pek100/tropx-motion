/**
 * Recording Metrics Convex Functions
 * Handles metric computation, storage, and retrieval.
 */

import { v } from "convex/values";
import { query, mutation, internalMutation, internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { METRIC_STATUS, ACTIVITY_PROFILES } from "./schema";
import { computeAllMetrics, type RecordingChunk, type ActivityProfile } from "./lib/metrics";

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

/** Get metrics for a session. */
export const getMetrics = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    return metrics;
  },
});

/** Get metrics status for a session. */
export const getMetricsStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!metrics) return null;

    return {
      status: metrics.status,
      computedAt: metrics.computedAt,
      error: metrics.error,
    };
  },
});

/** Get asymmetry events and phase alignment for session chart overlay. */
export const getSessionAsymmetryEvents = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!metrics || metrics.status !== "complete") return null;

    // Get session timing info from first chunk
    const firstChunk = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("chunkIndex"), 0))
      .first();

    if (!firstChunk) return null;

    // Extract asymmetry events with time window data
    const advancedAsymmetry = metrics.advancedAsymmetry as {
      asymmetryEvents?: Array<{
        startTimeMs: number;
        endTimeMs: number;
        durationMs: number;
        peakAsymmetry: number;
        avgAsymmetry: number;
        direction: "left_dominant" | "right_dominant";
        area: number;
      }>;
      avgRealAsymmetry?: number;
      maxRealAsymmetry?: number;
      asymmetryPercentage?: number;
    } | null;

    // Extract phase alignment data
    const phaseAlignment = metrics.phaseAlignment as {
      optimalOffsetSamples?: number;
      optimalOffsetMs?: number;
      optimalOffsetDegrees?: number;
      alignedCorrelation?: number;
      unalignedCorrelation?: number;
      correlationImprovement?: number;
    } | null;

    // Return data even if no asymmetry events (phase alignment still useful)
    return {
      sessionId: args.sessionId,
      sessionStartTime: firstChunk.startTime,
      sampleRate: firstChunk.sampleRate,
      events: advancedAsymmetry?.asymmetryEvents ?? [],
      summary: {
        avgRealAsymmetry: advancedAsymmetry?.avgRealAsymmetry ?? 0,
        maxRealAsymmetry: advancedAsymmetry?.maxRealAsymmetry ?? 0,
        asymmetryPercentage: advancedAsymmetry?.asymmetryPercentage ?? 0,
      },
      phaseAlignment: phaseAlignment ? {
        optimalOffsetSamples: phaseAlignment.optimalOffsetSamples ?? 0,
        optimalOffsetMs: phaseAlignment.optimalOffsetMs ?? 0,
        optimalOffsetDegrees: phaseAlignment.optimalOffsetDegrees ?? 0,
        alignedCorrelation: phaseAlignment.alignedCorrelation ?? 0,
        unalignedCorrelation: phaseAlignment.unalignedCorrelation ?? 0,
        correlationImprovement: phaseAlignment.correlationImprovement ?? 0,
      } : null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

/** Manually trigger metric re-computation. */
export const recomputeMetrics = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    // Check if metrics exist
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      // Reset to pending
      await ctx.db.patch(existing._id, {
        status: METRIC_STATUS.PENDING,
        error: undefined,
      });
    } else {
      // Create new pending entry
      await ctx.db.insert("recordingMetrics", {
        sessionId: args.sessionId,
        status: METRIC_STATUS.PENDING,
      });
    }

    // Schedule computation
    await ctx.scheduler.runAfter(0, internal.recordingMetrics.computeMetricsInternal, {
      sessionId: args.sessionId,
    });

    return { success: true, sessionId: args.sessionId };
  },
});

/** Delete metrics for a session. */
export const deleteMetrics = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { success: true, deleted: true };
    }

    return { success: true, deleted: false };
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Functions (called by scheduler)
// ─────────────────────────────────────────────────────────────────

/** Create pending metrics entry and schedule computation. */
export const triggerMetricComputation = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    // Check if already exists
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      // Already exists, don't duplicate
      return existing._id;
    }

    // Create pending entry
    const metricsId = await ctx.db.insert("recordingMetrics", {
      sessionId: args.sessionId,
      status: METRIC_STATUS.PENDING,
    });

    // Schedule async computation
    await ctx.scheduler.runAfter(0, internal.recordingMetrics.computeMetricsInternal, {
      sessionId: args.sessionId,
    });

    return metricsId;
  },
});

/** Internal action to compute metrics (runs async). */
export const computeMetricsInternal = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    // Mark as computing
    await ctx.runMutation(internal.recordingMetrics.updateMetricsStatus, {
      sessionId: args.sessionId,
      status: METRIC_STATUS.COMPUTING,
    });

    try {
      // Fetch all chunks for the session
      const chunks = await ctx.runQuery(internal.recordingMetrics.getSessionChunks, {
        sessionId: args.sessionId,
      });

      if (!chunks || chunks.length === 0) {
        throw new Error("No chunks found for session");
      }

      // Get activity profile from recording (stored in first chunk)
      const activityProfile: ActivityProfile =
        (chunks[0].activityProfile as ActivityProfile) || ACTIVITY_PROFILES.GENERAL;

      // Convert to RecordingChunk format
      const recordingChunks: RecordingChunk[] = chunks.map((chunk) => ({
        sessionId: chunk.sessionId,
        chunkIndex: chunk.chunkIndex,
        totalChunks: chunk.totalChunks,
        sampleRate: chunk.sampleRate,
        sampleCount: chunk.sampleCount,
        leftKneeQ: chunk.leftKneeQ,
        rightKneeQ: chunk.rightKneeQ,
        leftKneeInterpolated: chunk.leftKneeInterpolated,
        leftKneeMissing: chunk.leftKneeMissing,
        rightKneeInterpolated: chunk.rightKneeInterpolated,
        rightKneeMissing: chunk.rightKneeMissing,
      }));

      // Compute all metrics with activity profile
      const result = computeAllMetrics(recordingChunks, args.sessionId, activityProfile);

      if (!result.success || !result.metrics) {
        throw new Error(result.error || "Metrics computation failed");
      }

      // Store results
      await ctx.runMutation(internal.recordingMetrics.storeMetricsResult, {
        sessionId: args.sessionId,
        metrics: result.metrics,
        computedAt: result.computedAt,
      });
    } catch (error) {
      // Mark as failed
      await ctx.runMutation(internal.recordingMetrics.updateMetricsStatus, {
        sessionId: args.sessionId,
        status: METRIC_STATUS.FAILED,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});

/** Get session chunks (internal query). */
export const getSessionChunks = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  },
});

/** Update metrics status. */
export const updateMetricsStatus = internalMutation({
  args: {
    sessionId: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      const update: Record<string, unknown> = {
        status: args.status as typeof METRIC_STATUS[keyof typeof METRIC_STATUS],
      };
      if (args.error !== undefined) {
        update.error = args.error;
      }
      await ctx.db.patch(existing._id, update);
    }
  },
});

/** Store computed metrics result. */
export const storeMetricsResult = internalMutation({
  args: {
    sessionId: v.string(),
    metrics: v.any(), // FullAnalysisResult
    computedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    const m = args.metrics;

    const update = {
      status: METRIC_STATUS.COMPLETE as typeof METRIC_STATUS[keyof typeof METRIC_STATUS],
      computedAt: args.computedAt,
      error: undefined,

      // Per-leg metrics
      leftLeg: m.leftLeg,
      rightLeg: m.rightLeg,

      // Bilateral analysis
      bilateralAnalysis: m.bilateralAnalysis,

      // Unilateral analysis
      unilateralAnalysis: m.unilateralAnalysis,

      // Jump metrics
      jumpMetrics: m.jumpMetrics,

      // Force/power metrics
      forcePowerMetrics: m.forcePowerMetrics,

      // Stiffness metrics
      stiffnessMetrics: m.stiffnessMetrics,

      // Smoothness metrics
      smoothnessMetrics: m.smoothnessMetrics,

      // Temporal coordination
      temporalCoordination: m.temporalCoordination,

      // Gait cycle metrics
      gaitCycleMetrics: m.gaitCycleMetrics,

      // Movement classification
      movementClassification: m.movementClassification,
      rollingPhase: m.rollingPhase,

      // Advanced asymmetry
      advancedAsymmetry: m.advancedAsymmetry,
      rollingAsymmetry: m.rollingAsymmetry,
      phaseAlignment: m.phaseAlignment,

      // Overall Performance Index
      opiResult: m.opiResult,
    };

    if (existing) {
      await ctx.db.patch(existing._id, update);
    } else {
      await ctx.db.insert("recordingMetrics", {
        sessionId: args.sessionId,
        ...update,
      });
    }
  },
});
