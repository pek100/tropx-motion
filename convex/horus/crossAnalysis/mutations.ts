/**
 * Cross-Analysis Mutations
 *
 * Database operations for saving metrics vectors and patient baselines.
 */

import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  metricsToVector,
  createTagGroupKey,
  medianVector,
  stdVector,
  VECTOR_DIMENSIONS,
} from "../vectordb/metricsVector";
import type { SessionMetrics } from "../types";

// ─────────────────────────────────────────────────────────────────
// Metrics Vector Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Save metrics vector for a session.
 * Called after metrics are computed (from recordingMetrics.ts).
 */
export const saveMetricsVector = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
    metrics: v.any(), // SessionMetrics
    recordedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const metrics = args.metrics as SessionMetrics;

    // Check if vector already exists for this session
    const existing = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      // Vector exists - check if recordedAt needs fixing
      const timeDiff = Math.abs(existing.recordedAt - args.recordedAt);
      const oneHour = 60 * 60 * 1000;

      if (timeDiff > oneHour) {
        // recordedAt is significantly different - update it
        await ctx.db.patch(existing._id, { recordedAt: args.recordedAt });
        console.log(`[CrossAnalysis] Fixed recordedAt for session ${args.sessionId}: ${new Date(existing.recordedAt).toISOString()} → ${new Date(args.recordedAt).toISOString()}`);
      } else {
        console.log(`[CrossAnalysis] Vector already exists for session ${args.sessionId}`);
      }
      return existing._id;
    }

    // Convert metrics to vector
    const { vector, rawMetrics } = metricsToVector(metrics);

    // Create canonical tag group key
    const tagGroup = createTagGroupKey(metrics.tags);

    // Save vector
    const vectorId = await ctx.db.insert("horusMetricsVectors", {
      sessionId: args.sessionId,
      patientId: args.patientId,
      metricsVector: vector,
      tagGroup,
      rawMetrics: {
        opiScore: rawMetrics.opiScore,
        avgMaxROM: rawMetrics.avgMaxROM,
        avgPeakFlexion: rawMetrics.avgPeakFlexion,
        avgPeakExtension: rawMetrics.avgPeakExtension,
        romAsymmetry: rawMetrics.romAsymmetry,
        velocityAsymmetry: rawMetrics.velocityAsymmetry,
        crossCorrelation: rawMetrics.crossCorrelation,
        realAsymmetryAvg: rawMetrics.realAsymmetryAvg,
        netGlobalAsymmetry: rawMetrics.netGlobalAsymmetry,
        phaseShift: rawMetrics.phaseShift,
        temporalLag: rawMetrics.temporalLag,
        maxFlexionTimingDiff: rawMetrics.maxFlexionTimingDiff,
        peakAngularVelocity: rawMetrics.peakAngularVelocity,
        explosivenessConcentric: rawMetrics.explosivenessConcentric,
        explosivenessLoading: rawMetrics.explosivenessLoading,
        leftMaxROM: rawMetrics.leftMaxROM,
        rightMaxROM: rawMetrics.rightMaxROM,
        leftPeakVelocity: rawMetrics.leftPeakVelocity,
        rightPeakVelocity: rawMetrics.rightPeakVelocity,
        sparc: rawMetrics.sparc,
        ldlj: rawMetrics.ldlj,
        nVelocityPeaks: rawMetrics.nVelocityPeaks,
        rmsJerk: rawMetrics.rmsJerk,
      },
      recordedAt: args.recordedAt,
      embeddedAt: Date.now(),
    });

    console.log(`[CrossAnalysis] Saved metrics vector for session ${args.sessionId}`);

    // Schedule baseline update (fire-and-forget)
    await ctx.scheduler.runAfter(0, internal.horus.crossAnalysis.mutations.updatePatientBaseline, {
      patientId: args.patientId,
      tagGroup,
    });

    return vectorId;
  },
});

/**
 * Update patient baseline for a tag group.
 * Recalculates median and std from all sessions in the group.
 */
export const updatePatientBaseline = internalMutation({
  args: {
    patientId: v.id("users"),
    tagGroup: v.string(),
  },
  handler: async (ctx, args) => {
    // Get all vectors for this patient and tag group
    const vectors = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_patient_tag", (q) =>
        q.eq("patientId", args.patientId).eq("tagGroup", args.tagGroup)
      )
      .collect();

    if (vectors.length === 0) {
      console.log(`[CrossAnalysis] No vectors for patient ${args.patientId} tag ${args.tagGroup}`);
      return;
    }

    // Extract vector arrays
    const vectorArrays = vectors.map((v) => v.metricsVector);

    // Calculate median and std vectors
    const median = medianVector(vectorArrays);
    const std = stdVector(vectorArrays);

    // Calculate trends if enough sessions (at least 3)
    const trends: Array<{
      metricIndex: number;
      metricName: string;
      direction: "improving" | "stable" | "declining";
      slopePerSession: number;
    }> = [];

    if (vectors.length >= 3) {
      // Sort by recordedAt
      const sorted = [...vectors].sort((a, b) => a.recordedAt - b.recordedAt);

      // Calculate simple linear regression for each dimension
      for (let dim = 0; dim < VECTOR_DIMENSIONS; dim++) {
        const values = sorted.map((v, i) => ({ x: i, y: v.metricsVector[dim] }));

        // Simple linear regression
        const n = values.length;
        const sumX = values.reduce((acc, v) => acc + v.x, 0);
        const sumY = values.reduce((acc, v) => acc + v.y, 0);
        const sumXY = values.reduce((acc, v) => acc + v.x * v.y, 0);
        const sumXX = values.reduce((acc, v) => acc + v.x * v.x, 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

        // Determine direction (slope threshold: 0.01 per session)
        let direction: "improving" | "stable" | "declining";
        if (slope > 0.01) {
          direction = "improving"; // Higher normalized value = better
        } else if (slope < -0.01) {
          direction = "declining";
        } else {
          direction = "stable";
        }

        // Only include non-reserved metrics with meaningful trends
        const metricName = `dim_${dim}`;
        if (Math.abs(slope) > 0.005) {
          trends.push({
            metricIndex: dim,
            metricName,
            direction,
            slopePerSession: slope,
          });
        }
      }
    }

    // Check if baseline exists
    const existing = await ctx.db
      .query("horusPatientBaselines")
      .withIndex("by_patient_tag", (q) =>
        q.eq("patientId", args.patientId).eq("tagGroup", args.tagGroup)
      )
      .first();

    if (existing) {
      // Update existing baseline
      await ctx.db.patch(existing._id, {
        medianVector: median,
        stdVector: std,
        sessionCount: vectors.length,
        trends,
        updatedAt: Date.now(),
      });
    } else {
      // Create new baseline
      await ctx.db.insert("horusPatientBaselines", {
        patientId: args.patientId,
        tagGroup: args.tagGroup,
        medianVector: median,
        stdVector: std,
        sessionCount: vectors.length,
        trends,
        updatedAt: Date.now(),
      });
    }

    console.log(
      `[CrossAnalysis] Updated baseline for patient ${args.patientId} tag ${args.tagGroup}: ${vectors.length} sessions, ${trends.length} trends`
    );
  },
});

/**
 * Delete metrics vector for a session (cleanup).
 */
export const deleteMetricsVector = internalMutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      console.log(`[CrossAnalysis] Deleted metrics vector for session ${args.sessionId}`);
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Backfill Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Get sessions that need vectorization (have metrics but no vector).
 * Returns up to `limit` sessions for batch processing.
 */
export const getSessionsNeedingVectors = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    // Get all sessions with a subjectId (patient) and complete metrics
    const sessions = await ctx.db
      .query("recordingSessions")
      .filter((q) => q.neq(q.field("subjectId"), undefined))
      .collect();

    const needsVector: Array<{
      sessionId: string;
      patientId: string;
    }> = [];

    for (const session of sessions) {
      if (!session.subjectId || needsVector.length >= limit) continue;

      // Check if metrics exist and are complete
      const metrics = await ctx.db
        .query("recordingMetrics")
        .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
        .first();

      if (!metrics || metrics.status !== "complete") continue;

      // Check if vector already exists
      const existingVector = await ctx.db
        .query("horusMetricsVectors")
        .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
        .first();

      if (!existingVector) {
        needsVector.push({
          sessionId: session.sessionId,
          patientId: session.subjectId,
        });
      }
    }

    return {
      sessions: needsVector,
      hasMore: needsVector.length >= limit,
    };
  },
});

/**
 * Backfill a single session's metrics vector.
 * Reads metrics from recordingMetrics and creates the vector.
 */
export const backfillSingleSession = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Check if vector already exists
    const existingVector = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existingVector) {
      return { skipped: true, reason: "vector_exists" };
    }

    // Get metrics
    const metrics = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!metrics || metrics.status !== "complete") {
      return { skipped: true, reason: "no_complete_metrics" };
    }

    // Get session for tags and timing
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      return { skipped: true, reason: "no_session" };
    }

    // Build SessionMetrics from stored metrics
    const m = metrics;
    const bilateral = m.bilateralAnalysis as {
      asymmetryIndices?: {
        overallMaxROM?: number;
        peakAngularVelocity?: number;
      };
      temporalAsymmetry?: {
        crossCorrelation?: number;
        phaseShift?: number;
        temporalLag?: number;
      };
      netGlobalAsymmetry?: number;
    } | null;
    const asymmetries = bilateral?.asymmetryIndices || {};
    const temporal = bilateral?.temporalAsymmetry || {};
    const advanced = m.advancedAsymmetry as { avgRealAsymmetry?: number } | null;
    const classification = m.movementClassification as { type?: string } | null;
    const opiResult = m.opiResult as { overallScore?: number; grade?: string } | null;
    const smoothnessDoc = m.smoothnessMetrics as {
      sparc?: number;
      ldlj?: number;
      nVelocityPeaks?: number;
    } | null;
    const temporalCoord = m.temporalCoordination as { maxFlexionTimingDiff?: number } | null;
    const leftLeg = m.leftLeg as {
      overallMaxROM?: number;
      averageROM?: number;
      peakFlexion?: number;
      peakExtension?: number;
      peakAngularVelocity?: number;
      explosivenessConcentric?: number;
      explosivenessLoading?: number;
      rmsJerk?: number;
      romCoV?: number;
    } | null;
    const rightLeg = m.rightLeg as {
      overallMaxROM?: number;
      averageROM?: number;
      peakFlexion?: number;
      peakExtension?: number;
      peakAngularVelocity?: number;
      explosivenessConcentric?: number;
      explosivenessLoading?: number;
      rmsJerk?: number;
      romCoV?: number;
    } | null;

    const sessionMetrics = {
      sessionId: args.sessionId,
      leftLeg: {
        overallMaxRom: leftLeg?.overallMaxROM || 0,
        averageRom: leftLeg?.averageROM || 0,
        peakFlexion: leftLeg?.peakFlexion || 0,
        peakExtension: leftLeg?.peakExtension || 0,
        peakAngularVelocity: leftLeg?.peakAngularVelocity || 0,
        explosivenessConcentric: leftLeg?.explosivenessConcentric || 0,
        explosivenessLoading: leftLeg?.explosivenessLoading || 0,
        rmsJerk: leftLeg?.rmsJerk || 0,
        romCoV: leftLeg?.romCoV || 0,
      },
      rightLeg: {
        overallMaxRom: rightLeg?.overallMaxROM || 0,
        averageRom: rightLeg?.averageROM || 0,
        peakFlexion: rightLeg?.peakFlexion || 0,
        peakExtension: rightLeg?.peakExtension || 0,
        peakAngularVelocity: rightLeg?.peakAngularVelocity || 0,
        explosivenessConcentric: rightLeg?.explosivenessConcentric || 0,
        explosivenessLoading: rightLeg?.explosivenessLoading || 0,
        rmsJerk: rightLeg?.rmsJerk || 0,
        romCoV: rightLeg?.romCoV || 0,
      },
      bilateral: {
        romAsymmetry: asymmetries?.overallMaxROM || 0,
        velocityAsymmetry: asymmetries?.peakAngularVelocity || 0,
        crossCorrelation: temporal?.crossCorrelation || 0,
        realAsymmetryAvg: advanced?.avgRealAsymmetry || 0,
        netGlobalAsymmetry: bilateral?.netGlobalAsymmetry || 0,
        phaseShift: temporal?.phaseShift || 0,
        temporalLag: temporal?.temporalLag || 0,
        maxFlexionTimingDiff: temporalCoord?.maxFlexionTimingDiff || 0,
      },
      smoothness: smoothnessDoc?.sparc !== undefined ? {
        sparc: smoothnessDoc.sparc || 0,
        ldlj: smoothnessDoc.ldlj || 0,
        nVelocityPeaks: smoothnessDoc.nVelocityPeaks || 0,
      } : undefined,
      opiScore: opiResult?.overallScore,
      opiGrade: opiResult?.grade as "A" | "B" | "C" | "D" | "F" | undefined,
      movementType: classification?.type === "unilateral" ? "unilateral" as const : "bilateral" as const,
      recordedAt: session.startTime || metrics.computedAt || Date.now(),
      tags: session.tags,
    };

    // Convert to vector and save
    const { vector, rawMetrics } = metricsToVector(sessionMetrics);
    const tagGroup = createTagGroupKey(sessionMetrics.tags);

    await ctx.db.insert("horusMetricsVectors", {
      sessionId: args.sessionId,
      patientId: args.patientId,
      metricsVector: vector,
      tagGroup,
      rawMetrics: {
        opiScore: rawMetrics.opiScore,
        avgMaxROM: rawMetrics.avgMaxROM,
        avgPeakFlexion: rawMetrics.avgPeakFlexion,
        avgPeakExtension: rawMetrics.avgPeakExtension,
        romAsymmetry: rawMetrics.romAsymmetry,
        velocityAsymmetry: rawMetrics.velocityAsymmetry,
        crossCorrelation: rawMetrics.crossCorrelation,
        realAsymmetryAvg: rawMetrics.realAsymmetryAvg,
        netGlobalAsymmetry: rawMetrics.netGlobalAsymmetry,
        phaseShift: rawMetrics.phaseShift,
        temporalLag: rawMetrics.temporalLag,
        maxFlexionTimingDiff: rawMetrics.maxFlexionTimingDiff,
        peakAngularVelocity: rawMetrics.peakAngularVelocity,
        explosivenessConcentric: rawMetrics.explosivenessConcentric,
        explosivenessLoading: rawMetrics.explosivenessLoading,
        leftMaxROM: rawMetrics.leftMaxROM,
        rightMaxROM: rawMetrics.rightMaxROM,
        leftPeakVelocity: rawMetrics.leftPeakVelocity,
        rightPeakVelocity: rawMetrics.rightPeakVelocity,
        sparc: rawMetrics.sparc,
        ldlj: rawMetrics.ldlj,
        nVelocityPeaks: rawMetrics.nVelocityPeaks,
        rmsJerk: rawMetrics.rmsJerk,
      },
      recordedAt: sessionMetrics.recordedAt,
      embeddedAt: Date.now(),
    });

    // Schedule baseline update
    await ctx.scheduler.runAfter(0, internal.horus.crossAnalysis.mutations.updatePatientBaseline, {
      patientId: args.patientId,
      tagGroup,
    });

    return { success: true, sessionId: args.sessionId };
  },
});

/**
 * Backfill all sessions that have metrics but no vectors.
 * Processes in batches to avoid timeouts.
 * Call this from the Convex dashboard to backfill existing data.
 */
export const backfillAllVectors = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 20;

    // Get sessions needing vectors
    const { sessions, hasMore } = await ctx.db
      .query("recordingSessions")
      .filter((q) => q.neq(q.field("subjectId"), undefined))
      .collect()
      .then(async (allSessions) => {
        const needsVector: Array<{ sessionId: string; patientId: Id<"users"> }> = [];

        for (const session of allSessions) {
          if (!session.subjectId || needsVector.length >= batchSize) continue;

          const metrics = await ctx.db
            .query("recordingMetrics")
            .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
            .first();

          if (!metrics || metrics.status !== "complete") continue;

          const existingVector = await ctx.db
            .query("horusMetricsVectors")
            .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
            .first();

          if (!existingVector) {
            needsVector.push({
              sessionId: session.sessionId,
              patientId: session.subjectId,
            });
          }
        }

        return {
          sessions: needsVector,
          hasMore: needsVector.length >= batchSize,
        };
      });

    let processed = 0;
    let skipped = 0;

    for (const { sessionId, patientId } of sessions) {
      // Process inline (already in mutation context)
      const existingVector = await ctx.db
        .query("horusMetricsVectors")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .first();

      if (existingVector) {
        skipped++;
        continue;
      }

      const metrics = await ctx.db
        .query("recordingMetrics")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .first();

      const session = await ctx.db
        .query("recordingSessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
        .first();

      if (!metrics || !session || metrics.status !== "complete") {
        skipped++;
        continue;
      }

      // Build SessionMetrics (same as backfillSingleSession)
      const m = metrics;
      const bilateral = m.bilateralAnalysis as {
        asymmetryIndices?: { overallMaxROM?: number; peakAngularVelocity?: number };
        temporalAsymmetry?: { crossCorrelation?: number; phaseShift?: number; temporalLag?: number };
        netGlobalAsymmetry?: number;
      } | null;
      const asymmetries = bilateral?.asymmetryIndices || {};
      const temporal = bilateral?.temporalAsymmetry || {};
      const advanced = m.advancedAsymmetry as { avgRealAsymmetry?: number } | null;
      const classification = m.movementClassification as { type?: string } | null;
      const opiResult = m.opiResult as { overallScore?: number; grade?: string } | null;
      const smoothnessDoc = m.smoothnessMetrics as { sparc?: number; ldlj?: number; nVelocityPeaks?: number } | null;
      const temporalCoord = m.temporalCoordination as { maxFlexionTimingDiff?: number } | null;
      const leftLeg = m.leftLeg as {
        overallMaxROM?: number; averageROM?: number; peakFlexion?: number; peakExtension?: number;
        peakAngularVelocity?: number; explosivenessConcentric?: number; explosivenessLoading?: number;
        rmsJerk?: number; romCoV?: number;
      } | null;
      const rightLeg = m.rightLeg as {
        overallMaxROM?: number; averageROM?: number; peakFlexion?: number; peakExtension?: number;
        peakAngularVelocity?: number; explosivenessConcentric?: number; explosivenessLoading?: number;
        rmsJerk?: number; romCoV?: number;
      } | null;

      const sessionMetrics = {
        sessionId,
        leftLeg: {
          overallMaxRom: leftLeg?.overallMaxROM || 0, averageRom: leftLeg?.averageROM || 0,
          peakFlexion: leftLeg?.peakFlexion || 0, peakExtension: leftLeg?.peakExtension || 0,
          peakAngularVelocity: leftLeg?.peakAngularVelocity || 0, explosivenessConcentric: leftLeg?.explosivenessConcentric || 0,
          explosivenessLoading: leftLeg?.explosivenessLoading || 0, rmsJerk: leftLeg?.rmsJerk || 0, romCoV: leftLeg?.romCoV || 0,
        },
        rightLeg: {
          overallMaxRom: rightLeg?.overallMaxROM || 0, averageRom: rightLeg?.averageROM || 0,
          peakFlexion: rightLeg?.peakFlexion || 0, peakExtension: rightLeg?.peakExtension || 0,
          peakAngularVelocity: rightLeg?.peakAngularVelocity || 0, explosivenessConcentric: rightLeg?.explosivenessConcentric || 0,
          explosivenessLoading: rightLeg?.explosivenessLoading || 0, rmsJerk: rightLeg?.rmsJerk || 0, romCoV: rightLeg?.romCoV || 0,
        },
        bilateral: {
          romAsymmetry: asymmetries?.overallMaxROM || 0, velocityAsymmetry: asymmetries?.peakAngularVelocity || 0,
          crossCorrelation: temporal?.crossCorrelation || 0, realAsymmetryAvg: advanced?.avgRealAsymmetry || 0,
          netGlobalAsymmetry: bilateral?.netGlobalAsymmetry || 0, phaseShift: temporal?.phaseShift || 0,
          temporalLag: temporal?.temporalLag || 0, maxFlexionTimingDiff: temporalCoord?.maxFlexionTimingDiff || 0,
        },
        smoothness: smoothnessDoc?.sparc !== undefined ? {
          sparc: smoothnessDoc.sparc || 0, ldlj: smoothnessDoc.ldlj || 0, nVelocityPeaks: smoothnessDoc.nVelocityPeaks || 0,
        } : undefined,
        opiScore: opiResult?.overallScore,
        opiGrade: opiResult?.grade as "A" | "B" | "C" | "D" | "F" | undefined,
        movementType: classification?.type === "unilateral" ? "unilateral" as const : "bilateral" as const,
        recordedAt: session.startTime || metrics.computedAt || Date.now(),
        tags: session.tags,
      };

      const { vector, rawMetrics } = metricsToVector(sessionMetrics);
      const tagGroup = createTagGroupKey(sessionMetrics.tags);

      await ctx.db.insert("horusMetricsVectors", {
        sessionId, patientId,
        metricsVector: vector,
        tagGroup,
        rawMetrics: {
          opiScore: rawMetrics.opiScore, avgMaxROM: rawMetrics.avgMaxROM, avgPeakFlexion: rawMetrics.avgPeakFlexion,
          avgPeakExtension: rawMetrics.avgPeakExtension, romAsymmetry: rawMetrics.romAsymmetry,
          velocityAsymmetry: rawMetrics.velocityAsymmetry, crossCorrelation: rawMetrics.crossCorrelation,
          realAsymmetryAvg: rawMetrics.realAsymmetryAvg, netGlobalAsymmetry: rawMetrics.netGlobalAsymmetry,
          phaseShift: rawMetrics.phaseShift, temporalLag: rawMetrics.temporalLag,
          maxFlexionTimingDiff: rawMetrics.maxFlexionTimingDiff, peakAngularVelocity: rawMetrics.peakAngularVelocity,
          explosivenessConcentric: rawMetrics.explosivenessConcentric, explosivenessLoading: rawMetrics.explosivenessLoading,
          leftMaxROM: rawMetrics.leftMaxROM, rightMaxROM: rawMetrics.rightMaxROM,
          leftPeakVelocity: rawMetrics.leftPeakVelocity, rightPeakVelocity: rawMetrics.rightPeakVelocity,
          sparc: rawMetrics.sparc, ldlj: rawMetrics.ldlj, nVelocityPeaks: rawMetrics.nVelocityPeaks, rmsJerk: rawMetrics.rmsJerk,
        },
        recordedAt: sessionMetrics.recordedAt,
        embeddedAt: Date.now(),
      });

      processed++;
    }

    // Schedule next batch if more sessions remain
    if (hasMore) {
      await ctx.scheduler.runAfter(100, internal.horus.crossAnalysis.mutations.backfillAllVectors, {
        batchSize,
      });
    }

    console.log(`[CrossAnalysis Backfill] Processed: ${processed}, Skipped: ${skipped}, HasMore: ${hasMore}`);

    return { processed, skipped, hasMore };
  },
});

/**
 * Fix vector recordedAt values to use actual session recording times.
 * Run this if vectors were created with incorrect recordedAt values.
 */
export const fixVectorRecordedAt = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 50;
    let fixed = 0;
    let skipped = 0;
    let alreadyCorrect = 0;

    // Get all vectors
    const vectors = await ctx.db.query("horusMetricsVectors").take(batchSize);

    for (const vector of vectors) {
      // Get the session for this vector
      const session = await ctx.db
        .query("recordingSessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", vector.sessionId))
        .first();

      if (!session) {
        skipped++;
        continue;
      }

      // Get the correct recording date from the session
      const correctRecordedAt = session.recordedAt ?? session.startTime;

      if (!correctRecordedAt) {
        skipped++;
        continue;
      }

      // Check if it needs fixing (more than 1 hour difference indicates wrong value)
      const diff = Math.abs(vector.recordedAt - correctRecordedAt);
      const oneHour = 60 * 60 * 1000;

      if (diff < oneHour) {
        alreadyCorrect++;
        continue;
      }

      // Fix the recordedAt value
      await ctx.db.patch(vector._id, {
        recordedAt: correctRecordedAt,
      });

      fixed++;
    }

    // Schedule next batch if we processed a full batch
    const hasMore = vectors.length === batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(100, internal.horus.crossAnalysis.mutations.fixVectorRecordedAt, {
        batchSize,
      });
    }

    console.log(`[Fix Vector RecordedAt] Fixed: ${fixed}, Already correct: ${alreadyCorrect}, Skipped: ${skipped}, HasMore: ${hasMore}`);

    return { fixed, alreadyCorrect, skipped, hasMore };
  },
});
