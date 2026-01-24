/**
 * Horus v2 Public Actions
 *
 * External API entry points for v2 analysis pipeline.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { SessionMetrics, V2PipelineOutput } from "./types";
import { buildSessionMetrics } from "./utils";

// ─────────────────────────────────────────────────────────────────
// Analysis Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Run v2 analysis for a session (main entry point).
 */
export const analyzeSession = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }): Promise<V2PipelineOutput> => {
    // Update status to analyzing
    await ctx.runMutation(internal.horus.v2.mutations.updatePipelineStatus, {
      sessionId,
      status: "analyzing",
    });

    try {
      // Fetch session metrics
      const metricsDoc = await ctx.runQuery(internal.horus.queries.getMetricsForSession, {
        sessionId,
      });

      if (!metricsDoc) {
        throw new Error(`No metrics found for session: ${sessionId}`);
      }

      // Fetch session for patient info
      const session = await ctx.runQuery(internal.horus.queries.getSessionForAnalysis, {
        sessionId,
      });

      // Build SessionMetrics from recordingMetrics and session context
      const metrics = buildSessionMetrics(sessionId, metricsDoc, session);

      // Run the pipeline
      const result = await ctx.runAction(internal.horus.v2.orchestrator.runPipeline, {
        sessionId,
        metrics,
        patientId: session?.subjectId,
      });

      // Save result to database
      await ctx.runMutation(internal.horus.v2.mutations.saveAnalysisResult, {
        sessionId,
        patientId: session?.subjectId,
        output: result,
      });

      // Update status to complete
      await ctx.runMutation(internal.horus.v2.mutations.updatePipelineStatus, {
        sessionId,
        status: "complete",
      });

      return result;
    } catch (error) {
      // Update status to error
      await ctx.runMutation(internal.horus.v2.mutations.updatePipelineStatus, {
        sessionId,
        status: "error",
        error: {
          agent: "analysis",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  },
});

/**
 * Retry a failed v2 analysis.
 */
export const retryAnalysis = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    // Clear error first
    await ctx.runMutation(internal.horus.v2.mutations.clearError, { sessionId });

    // Re-run analysis
    return ctx.runAction(internal.horus.v2.actions.analyzeSession, { sessionId });
  },
});

// ─────────────────────────────────────────────────────────────────
// Test Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Test v2 pipeline with mock metrics (for development).
 */
export const testPipeline = action({
  args: {
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId = "test-session-v2" }) => {
    // Create mock metrics with session context
    const mockMetrics: SessionMetrics = {
      sessionId,
      leftLeg: {
        overallMaxRom: 95.2,
        averageRom: 82.5,
        peakFlexion: 95.2,
        peakExtension: -5.3,
        peakAngularVelocity: 425.8,
        explosivenessConcentric: 312.5,
        explosivenessLoading: 285.3,
        rmsJerk: 1250.4,
        romCoV: 8.2,
      },
      rightLeg: {
        overallMaxRom: 88.7,
        averageRom: 75.3,
        peakFlexion: 88.7,
        peakExtension: -4.8,
        peakAngularVelocity: 385.2,
        explosivenessConcentric: 278.4,
        explosivenessLoading: 252.1,
        rmsJerk: 1485.6,
        romCoV: 12.5,
      },
      bilateral: {
        romAsymmetry: 18.5,
        velocityAsymmetry: 10.2,
        crossCorrelation: 0.85,
        realAsymmetryAvg: 15.3,
        netGlobalAsymmetry: 14.8,
        phaseShift: 12.5,
        temporalLag: 45.2,
        maxFlexionTimingDiff: 38.5,
      },
      opiScore: 72.5,
      opiGrade: "B",
      movementType: "bilateral",
      recordedAt: Date.now(),

      // Session context (mock data for testing)
      title: "Seated Knee Extension",
      activityProfile: "rehabilitation",
      tags: ["ACL reconstruction", "post-op week 8", "left knee"],
      sets: 3,
      reps: 12,
      notes: "Patient reported mild discomfort at end range flexion. Good effort throughout.",
    };

    console.log("[Test] Running v2 pipeline with mock metrics");

    // Run the pipeline
    const result = await ctx.runAction(internal.horus.v2.orchestrator.runPipeline, {
      sessionId,
      metrics: mockMetrics,
    });

    return {
      success: true,
      sessionId,
      result: {
        sectionCount: result.sections.length,
        enrichedSectionCount: result.enrichedSections.length,
        failedEnrichments: result.failedEnrichments,
        summary: result.summary,
        strengths: result.strengths,
        weaknesses: result.weaknesses,
        totalDurationMs: result.totalDurationMs,
        tokenUsage: result.tokenUsage.total,
      },
    };
  },
});

