/**
 * Horus Triggers
 *
 * Automatic and on-demand triggers for the Horus V2 pipeline.
 * V2 uses a two-stage agentic flow: Analysis Agent → Parallel Research Agents.
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalQuery } from "../_generated/server";

// ─────────────────────────────────────────────────────────────────
// Auto Trigger: On Metrics Complete
// ─────────────────────────────────────────────────────────────────

/**
 * Trigger Horus V2 analysis when metrics computation completes.
 * Called from the metrics computation pipeline.
 *
 * V2 Pipeline:
 * - Stage 1: Analysis Agent generates clinical sections
 * - Stage 2: Parallel Research Agents enrich sections with evidence
 */
export const onMetricsComplete = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    // 1. Verify session exists
    const session = await ctx.runQuery(internal.horus.triggers.getRecordingSession, {
      sessionId,
    });

    if (!session) {
      console.warn(`[Horus V2] Session not found: ${sessionId}`);
      return { triggered: false, reason: "Session not found" };
    }

    // 2. Verify metrics are complete
    const metricsDoc = await ctx.runQuery(internal.horus.triggers.getRecordingMetrics, {
      sessionId,
    });

    if (!metricsDoc || metricsDoc.status !== "complete") {
      console.warn(`[Horus V2] Metrics not complete for session: ${sessionId}`);
      return { triggered: false, reason: "Metrics not complete" };
    }

    // 3. Run V2 analysis pipeline
    try {
      console.log(`[Horus V2] Triggering analysis for session: ${sessionId}`);
      const result = await ctx.runAction(internal.horus.v2.actions.analyzeSession, {
        sessionId,
      });

      return {
        triggered: true,
        success: true,
        sectionCount: result.enrichedSections?.length ?? 0,
      };
    } catch (error) {
      console.error(`[Horus V2] Analysis failed for session ${sessionId}:`, error);
      return {
        triggered: true,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// On-Demand Triggers
// ─────────────────────────────────────────────────────────────────

/**
 * Manually trigger Horus V2 analysis for a session.
 */
export const triggerAnalysis = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    return ctx.runAction(internal.horus.triggers.onMetricsComplete, { sessionId });
  },
});

/**
 * Trigger V2 analysis after phase offset recalculation.
 * Called from recalculatePhaseMetricsInternal after metrics update.
 */
export const onPhaseRecalculated = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    console.log(`[Horus V2] Phase recalculated, re-running analysis for session: ${sessionId}`);
    return ctx.runAction(internal.horus.triggers.onMetricsComplete, { sessionId });
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get recording session by ID.
 */
export const getRecordingSession = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .first();
  },
});

/**
 * Get recording metrics by session ID.
 */
export const getRecordingMetrics = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
  },
});
