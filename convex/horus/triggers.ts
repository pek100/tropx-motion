/**
 * Horus Triggers
 *
 * Automatic and on-demand triggers for the Horus pipeline.
 */

import { action, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { SessionMetrics, ProgressOutput } from "./types";

// ─────────────────────────────────────────────────────────────────
// Auto Trigger: On Metrics Complete
// ─────────────────────────────────────────────────────────────────

/**
 * Trigger Horus analysis when metrics computation completes.
 * Called from the metrics computation pipeline.
 */
export const onMetricsComplete = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    // 1. Get the recording session
    const session = await ctx.runQuery(internal.horus.triggers.getRecordingSession, {
      sessionId,
    });

    if (!session) {
      console.warn(`[Horus] Session not found: ${sessionId}`);
      return { triggered: false, reason: "Session not found" };
    }

    // 2. Get metrics
    const metricsDoc = await ctx.runQuery(internal.horus.triggers.getRecordingMetrics, {
      sessionId,
    });

    if (!metricsDoc || metricsDoc.status !== "complete") {
      console.warn(`[Horus] Metrics not complete for session: ${sessionId}`);
      return { triggered: false, reason: "Metrics not complete" };
    }

    // 3. Build SessionMetrics object
    const metrics = buildSessionMetrics(sessionId, session, metricsDoc);

    // 4. Get previous session metrics (if available)
    const previousMetrics = await ctx.runAction(
      internal.horus.triggers.getPreviousSessionMetrics,
      {
        subjectId: session.subjectId || session.ownerId,
        currentSessionId: sessionId,
      }
    );

    // 5. Run the pipeline
    const result = await ctx.runAction(internal.horus.orchestrator.runPipeline, {
      sessionId,
      metrics,
      previousMetrics,
      patientId: session.subjectId || undefined,
    });

    // 6. If successful, also run progress analysis
    if (result.success && session.subjectId) {
      await ctx.scheduler.runAfter(0, internal.horus.triggers.runProgressAnalysis, {
        sessionId,
        patientId: session.subjectId,
      });
    }

    return {
      triggered: true,
      success: result.success,
      error: result.error,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// On-Demand Triggers
// ─────────────────────────────────────────────────────────────────

/**
 * Manually trigger Horus analysis for a session.
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
 * Trigger progress analysis on-demand.
 */
export const triggerProgressAnalysis = action({
  args: {
    patientId: v.id("users"),
  },
  handler: async (ctx, { patientId }) => {
    // Get latest session for this patient
    const latestSession = await ctx.runQuery(
      internal.horus.triggers.getLatestPatientSession,
      { patientId }
    );

    if (!latestSession) {
      return { success: false, error: "No sessions found for patient" };
    }

    return ctx.runAction(internal.horus.triggers.runProgressAnalysis, {
      sessionId: latestSession.sessionId,
      patientId,
    });
  },
});

/**
 * Run progress analysis for a patient.
 */
export const runProgressAnalysis = action({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
  },
  handler: async (ctx, { sessionId, patientId }) => {
    // Get all sessions for patient
    const sessions = await ctx.runQuery(internal.horus.triggers.getPatientSessions, {
      patientId,
    });

    if (sessions.length < 2) {
      return {
        success: false,
        error: "Need at least 2 sessions for progress analysis",
      };
    }

    // Get metrics for all sessions
    const sessionMetrics: SessionMetrics[] = [];

    for (const session of sessions) {
      const metricsDoc = await ctx.runQuery(internal.horus.triggers.getRecordingMetrics, {
        sessionId: session.sessionId,
      });

      if (metricsDoc && metricsDoc.status === "complete") {
        sessionMetrics.push(buildSessionMetrics(session.sessionId, session, metricsDoc));
      }
    }

    if (sessionMetrics.length < 2) {
      return {
        success: false,
        error: "Need at least 2 completed sessions for progress analysis",
      };
    }

    // Sort by date
    sessionMetrics.sort((a, b) => a.recordedAt - b.recordedAt);

    // Current is most recent
    const currentMetrics = sessionMetrics[sessionMetrics.length - 1];
    const historicalSessions = sessionMetrics.slice(0, -1);

    // Run progress agent
    const result = await ctx.runAction(internal.horus.agents.progress.runProgress, {
      sessionId,
      currentMetrics,
      historicalSessions,
      patientId,
    });

    if (result.success && result.output) {
      // Save progress report
      await ctx.runMutation(internal.horus.triggers.saveProgressReport, {
        patientId,
        progress: result.output,
        sessionIds: sessionMetrics.map((s) => s.sessionId),
      });
    }

    return {
      success: result.success,
      error: result.error,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Queries
// ─────────────────────────────────────────────────────────────────

import { internalQuery } from "../_generated/server";

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

/**
 * Get previous session metrics.
 */
export const getPreviousSessionMetrics = action({
  args: {
    subjectId: v.id("users"),
    currentSessionId: v.string(),
  },
  handler: async (ctx, { subjectId, currentSessionId }): Promise<SessionMetrics | null> => {
    // Get sessions for this subject, excluding current
    const sessions = await ctx.runQuery(
      internal.horus.triggers.getPatientSessionsExcluding,
      {
        patientId: subjectId,
        excludeSessionId: currentSessionId,
      }
    );

    if (sessions.length === 0) return null;

    // Get most recent
    const mostRecent = sessions[0];

    const metricsDoc = await ctx.runQuery(internal.horus.triggers.getRecordingMetrics, {
      sessionId: mostRecent.sessionId,
    });

    if (!metricsDoc || metricsDoc.status !== "complete") return null;

    return buildSessionMetrics(mostRecent.sessionId, mostRecent, metricsDoc);
  },
});

/**
 * Get patient sessions excluding one.
 */
export const getPatientSessionsExcluding = internalQuery({
  args: {
    patientId: v.id("users"),
    excludeSessionId: v.string(),
  },
  handler: async (ctx, { patientId, excludeSessionId }) => {
    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", patientId))
      .filter((q) => q.neq(q.field("sessionId"), excludeSessionId))
      .order("desc")
      .take(10);

    return sessions;
  },
});

/**
 * Get all patient sessions.
 */
export const getPatientSessions = internalQuery({
  args: { patientId: v.id("users") },
  handler: async (ctx, { patientId }) => {
    return ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", patientId))
      .order("desc")
      .take(20);
  },
});

/**
 * Get latest session for patient.
 */
export const getLatestPatientSession = internalQuery({
  args: { patientId: v.id("users") },
  handler: async (ctx, { patientId }) => {
    return ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", patientId))
      .order("desc")
      .first();
  },
});

/**
 * Save progress report.
 */
export const saveProgressReport = internalMutation({
  args: {
    patientId: v.id("users"),
    progress: v.any(),
    sessionIds: v.array(v.string()),
  },
  handler: async (ctx, { patientId, progress, sessionIds }) => {
    const existing = await ctx.db
      .query("horusProgress")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        latestProgress: progress,
        sessionIds,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("horusProgress", {
        patientId,
        latestProgress: progress,
        sessionIds,
        updatedAt: now,
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Build SessionMetrics from database documents.
 */
function buildSessionMetrics(
  sessionId: string,
  session: { startTime: number; subjectId?: Id<"users"> | null },
  metricsDoc: {
    leftLeg?: {
      overallMaxROM: number;
      averageROM: number;
      peakFlexion: number;
      peakExtension: number;
      peakAngularVelocity: number;
      explosivenessConcentric: number;
      explosivenessLoading: number;
      rmsJerk: number;
      romCoV: number;
    } | null;
    rightLeg?: {
      overallMaxROM: number;
      averageROM: number;
      peakFlexion: number;
      peakExtension: number;
      peakAngularVelocity: number;
      explosivenessConcentric: number;
      explosivenessLoading: number;
      rmsJerk: number;
      romCoV: number;
    } | null;
    bilateralAnalysis?: {
      asymmetryIndices: {
        overallMaxROM: number;
        averageROM: number;
        peakAngularVelocity: number;
      };
      netGlobalAsymmetry: number;
      temporalAsymmetry: {
        phaseShift: number;
        crossCorrelation: number;
        temporalLag: number;
      };
    } | null;
    advancedAsymmetry?: {
      avgRealAsymmetry: number;
    } | null;
    temporalCoordination?: {
      maxFlexionTimingDiff: number;
    } | null;
    movementClassification?: {
      type: string;
    } | null;
    opiResult?: {
      overallScore: number;
      grade: string;
    } | null;
  }
): SessionMetrics {
  const left = metricsDoc.leftLeg;
  const right = metricsDoc.rightLeg;
  const bilateral = metricsDoc.bilateralAnalysis;
  const advanced = metricsDoc.advancedAsymmetry;
  const temporal = metricsDoc.temporalCoordination;

  return {
    sessionId,
    leftLeg: {
      overallMaxRom: left?.overallMaxROM ?? 0,
      averageRom: left?.averageROM ?? 0,
      peakFlexion: left?.peakFlexion ?? 0,
      peakExtension: left?.peakExtension ?? 0,
      peakAngularVelocity: left?.peakAngularVelocity ?? 0,
      explosivenessConcentric: left?.explosivenessConcentric ?? 0,
      explosivenessLoading: left?.explosivenessLoading ?? 0,
      rmsJerk: left?.rmsJerk ?? 0,
      romCoV: left?.romCoV ?? 0,
    },
    rightLeg: {
      overallMaxRom: right?.overallMaxROM ?? 0,
      averageRom: right?.averageROM ?? 0,
      peakFlexion: right?.peakFlexion ?? 0,
      peakExtension: right?.peakExtension ?? 0,
      peakAngularVelocity: right?.peakAngularVelocity ?? 0,
      explosivenessConcentric: right?.explosivenessConcentric ?? 0,
      explosivenessLoading: right?.explosivenessLoading ?? 0,
      rmsJerk: right?.rmsJerk ?? 0,
      romCoV: right?.romCoV ?? 0,
    },
    bilateral: {
      romAsymmetry: bilateral?.asymmetryIndices?.overallMaxROM ?? 0,
      velocityAsymmetry: bilateral?.asymmetryIndices?.peakAngularVelocity ?? 0,
      crossCorrelation: bilateral?.temporalAsymmetry?.crossCorrelation ?? 0,
      realAsymmetryAvg: advanced?.avgRealAsymmetry ?? 0,
      netGlobalAsymmetry: bilateral?.netGlobalAsymmetry ?? 0,
      phaseShift: bilateral?.temporalAsymmetry?.phaseShift ?? 0,
      temporalLag: bilateral?.temporalAsymmetry?.temporalLag ?? 0,
      maxFlexionTimingDiff: temporal?.maxFlexionTimingDiff ?? 0,
    },
    opiScore: metricsDoc.opiResult?.overallScore,
    opiGrade: metricsDoc.opiResult?.grade,
    movementType: metricsDoc.movementClassification?.type === "bilateral" ? "bilateral" : "unilateral",
    recordedAt: session.startTime,
  };
}
