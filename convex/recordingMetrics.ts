/**
 * Recording Metrics Convex Functions
 * Handles metric computation, storage, and retrieval.
 */

import { v } from "convex/values";
import { query, internalAction, internalQuery } from "./_generated/server";
import { mutation, internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { METRIC_STATUS, ACTIVITY_PROFILES } from "./schema";
import { computeAllMetrics, type RecordingChunk, type ActivityProfile } from "./lib/metrics";
import { recalculateWithCustomPhaseOffset, quaternionArrayToAngles } from "./lib/metrics/compute";
import { decompressQuaternions } from "../shared/compression";

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

    // Get session timing info from sessions table
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;

    const sessionStartTime = session.startTime;
    const sampleRate = session.sampleRate;

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

    // Extract default phase alignment data (calculated optimal)
    const defaultPhaseAlignment = metrics.defaultPhaseAlignment as {
      optimalOffsetSamples?: number;
      optimalOffsetMs?: number;
      optimalOffsetDegrees?: number;
      alignedCorrelation?: number;
      unalignedCorrelation?: number;
      correlationImprovement?: number;
    } | null;

    // Get the currently applied phase offset (may differ from default if manually adjusted)
    const phaseOffsetMs = metrics.phaseOffsetMs as number | undefined;

    // Return data even if no asymmetry events (phase alignment still useful)
    return {
      sessionId: args.sessionId,
      sessionStartTime,
      sampleRate,
      events: advancedAsymmetry?.asymmetryEvents ?? [],
      summary: {
        avgRealAsymmetry: advancedAsymmetry?.avgRealAsymmetry ?? 0,
        maxRealAsymmetry: advancedAsymmetry?.maxRealAsymmetry ?? 0,
        asymmetryPercentage: advancedAsymmetry?.asymmetryPercentage ?? 0,
      },
      // Currently applied phase offset (for chart rendering)
      phaseOffsetMs: phaseOffsetMs ?? defaultPhaseAlignment?.optimalOffsetMs ?? 0,
      // Default (calculated) phase alignment data (for reset functionality)
      defaultPhaseAlignment: defaultPhaseAlignment ? {
        optimalOffsetSamples: defaultPhaseAlignment.optimalOffsetSamples ?? 0,
        optimalOffsetMs: defaultPhaseAlignment.optimalOffsetMs ?? 0,
        optimalOffsetDegrees: defaultPhaseAlignment.optimalOffsetDegrees ?? 0,
        alignedCorrelation: defaultPhaseAlignment.alignedCorrelation ?? 0,
        unalignedCorrelation: defaultPhaseAlignment.unalignedCorrelation ?? 0,
        correlationImprovement: defaultPhaseAlignment.correlationImprovement ?? 0,
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

/** Recalculate phase-dependent metrics with a custom offset. */
export const applyCustomPhaseOffset = mutation({
  args: {
    sessionId: v.string(),
    customOffsetMs: v.number(),
  },
  handler: async (ctx, args) => {
    // Schedule the internal action
    await ctx.scheduler.runAfter(0, internal.recordingMetrics.recalculatePhaseMetricsInternal, {
      sessionId: args.sessionId,
      customOffsetMs: args.customOffsetMs,
    });

    return { success: true, sessionId: args.sessionId };
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
    // Check if already computing (prevent race conditions from duplicate triggers)
    const canStart = await ctx.runMutation(internal.recordingMetrics.tryStartComputation, {
      sessionId: args.sessionId,
    });

    if (!canStart) {
      console.log(`Computation already in progress for session ${args.sessionId}, skipping`);
      return;
    }

    try {
      let recordingChunks: RecordingChunk[] = [];
      let activityProfile: ActivityProfile = ACTIVITY_PROFILES.GENERAL;

      // First, try new compressed format (sessions + recordingChunks tables)
      const compressedData = await ctx.runQuery(
        internal.recordingMetrics.getCompressedSessionData,
        { sessionId: args.sessionId }
      );

      if (!compressedData || compressedData.chunks.length === 0) {
        throw new Error("No chunks found for session");
      }

      // Decompress chunks
      const { session, chunks } = compressedData;

      activityProfile =
        (session.activityProfile as ActivityProfile) || ACTIVITY_PROFILES.GENERAL;

      // Decompress each chunk
      recordingChunks = chunks.map((chunk) => {
        // Decompress quaternion data
        let leftKneeQ: number[] = [];
        let rightKneeQ: number[] = [];

        if (chunk.leftKneeCompressed) {
          const bytes = new Uint8Array(chunk.leftKneeCompressed);
          const decompressed = decompressQuaternions(bytes);
          leftKneeQ = Array.from(decompressed);
        }

        if (chunk.rightKneeCompressed) {
          const bytes = new Uint8Array(chunk.rightKneeCompressed);
          const decompressed = decompressQuaternions(bytes);
          rightKneeQ = Array.from(decompressed);
        }

        return {
          sessionId: chunk.sessionId,
          chunkIndex: chunk.chunkIndex,
          totalChunks: session.totalChunks,
          sampleRate: session.sampleRate,
          sampleCount: chunk.sampleCount,
          leftKneeQ,
          rightKneeQ,
          leftKneeInterpolated: chunk.leftKneeInterpolated,
          leftKneeMissing: chunk.leftKneeMissing,
          rightKneeInterpolated: chunk.rightKneeInterpolated,
          rightKneeMissing: chunk.rightKneeMissing,
        };
      });

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

/** Get session and compressed chunks (internal query). */
export const getCompressedSessionData = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    // Check if session exists in new sessions table
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      return null;
    }

    // Get compressed chunks
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return {
      session,
      chunks: chunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
    };
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

/** Atomically try to start computation - returns true if we got the lock. */
export const tryStartComputation = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!existing) {
      // No metrics entry - shouldn't happen, but create one
      await ctx.db.insert("recordingMetrics", {
        sessionId: args.sessionId,
        status: METRIC_STATUS.COMPUTING,
      });
      return true;
    }

    // If already computing, don't start another computation
    if (existing.status === METRIC_STATUS.COMPUTING) {
      return false;
    }

    // Set to computing and return true
    await ctx.db.patch(existing._id, {
      status: METRIC_STATUS.COMPUTING,
    });
    return true;
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
      // rollingAsymmetry: m.rollingAsymmetry, // ❌ DISABLED - conceptually flawed (see compute.ts)

      // Phase alignment: store calculated as default, set initial phaseOffsetMs
      defaultPhaseAlignment: m.phaseAlignment,
      phaseOffsetMs: m.phaseAlignment?.optimalOffsetMs ?? 0,

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

// ─────────────────────────────────────────────────────────────────
// Partial Recalculation (Phase-dependent metrics only)
// ─────────────────────────────────────────────────────────────────

/** Internal action to recalculate only phase-dependent metrics with custom offset. */
export const recalculatePhaseMetricsInternal = internalAction({
  args: {
    sessionId: v.string(),
    customOffsetMs: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      // Get compressed session data
      const compressedData = await ctx.runQuery(
        internal.recordingMetrics.getCompressedSessionData,
        { sessionId: args.sessionId }
      );

      if (!compressedData || compressedData.chunks.length === 0) {
        throw new Error("No chunks found for session");
      }

      const { session, chunks } = compressedData;
      const timeStep = 1 / session.sampleRate;

      // Decompress and combine all chunks into angle arrays
      const leftAngles: number[] = [];
      const rightAngles: number[] = [];

      // Sort chunks by index
      const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

      for (const chunk of sortedChunks) {
        // Decompress quaternion data
        let leftKneeQ: number[] = [];
        let rightKneeQ: number[] = [];

        if (chunk.leftKneeCompressed) {
          const bytes = new Uint8Array(chunk.leftKneeCompressed);
          const decompressed = decompressQuaternions(bytes);
          leftKneeQ = Array.from(decompressed);
        }

        if (chunk.rightKneeCompressed) {
          const bytes = new Uint8Array(chunk.rightKneeCompressed);
          const decompressed = decompressQuaternions(bytes);
          rightKneeQ = Array.from(decompressed);
        }

        // Convert quaternions to angles and append
        const chunkLeftAngles = quaternionArrayToAngles(leftKneeQ, "y");
        const chunkRightAngles = quaternionArrayToAngles(rightKneeQ, "y");

        leftAngles.push(...chunkLeftAngles);
        rightAngles.push(...chunkRightAngles);
      }

      if (leftAngles.length === 0 || rightAngles.length === 0) {
        throw new Error("No angle data available");
      }

      // Recalculate only phase-dependent metrics
      const result = recalculateWithCustomPhaseOffset(
        leftAngles,
        rightAngles,
        timeStep,
        args.customOffsetMs
      );

      // Store partial results
      await ctx.runMutation(internal.recordingMetrics.storePhaseMetricsResult, {
        sessionId: args.sessionId,
        advancedAsymmetry: result.advancedAsymmetry,
        phaseAlignment: result.phaseAlignment,
      });
    } catch (error) {
      // Log error but don't update status (partial recalc shouldn't mark as failed)
      console.error(
        `Phase metrics recalculation failed for session ${args.sessionId}:`,
        error instanceof Error ? error.message : "Unknown error"
      );
    }
  },
});

/** Store only phase-dependent metrics (partial update).
 * Updates advancedAsymmetry and phaseOffsetMs (the applied offset).
 * defaultPhaseAlignment is preserved so user can always reset to it.
 */
export const storePhaseMetricsResult = internalMutation({
  args: {
    sessionId: v.string(),
    advancedAsymmetry: v.any(),
    phaseAlignment: v.any(), // Contains the new offset being applied
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        // Update asymmetry metrics
        advancedAsymmetry: args.advancedAsymmetry,
        // Update the applied phase offset (not the default)
        phaseOffsetMs: args.phaseAlignment?.optimalOffsetMs ?? 0,
        // Update computedAt to indicate metrics were modified
        computedAt: Date.now(),
      });
    }
  },
});
