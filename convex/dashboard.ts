/**
 * Dashboard Convex Functions
 * Provides patient metrics history for progress visualization.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./lib/auth";

/**
 * Get metrics history for a patient (subject).
 * Returns all sessions with OPI and key metrics for charting progress over time.
 */
export const getPatientMetricsHistory = query({
  args: {
    subjectId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const limit = args.limit ?? 50;

    // Get all first chunks (session metadata) for this subject
    // owned by current user or where current user is the subject
    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_subject", (q) => q.eq("subjectId", args.subjectId))
      .filter((q) =>
        q.and(
          q.eq(q.field("chunkIndex"), 0),
          q.neq(q.field("isArchived"), true)
        )
      )
      .order("desc")
      .take(limit);

    // Also get sessions where user recorded themselves (subjectId might be undefined)
    const selfChunks = args.subjectId === user._id
      ? await ctx.db
          .query("recordings")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .filter((q) =>
            q.and(
              q.eq(q.field("chunkIndex"), 0),
              q.neq(q.field("isArchived"), true),
              q.or(
                q.eq(q.field("subjectId"), user._id),
                q.eq(q.field("subjectId"), undefined)
              )
            )
          )
          .order("desc")
          .take(limit)
      : [];

    // Combine and deduplicate by sessionId
    const sessionMap = new Map<string, typeof chunks[0]>();
    for (const chunk of [...chunks, ...selfChunks]) {
      if (!sessionMap.has(chunk.sessionId)) {
        sessionMap.set(chunk.sessionId, chunk);
      }
    }

    // Get metrics for each session
    const sessions = await Promise.all(
      Array.from(sessionMap.values()).map(async (chunk) => {
        const metrics = await ctx.db
          .query("recordingMetrics")
          .withIndex("by_session", (q) => q.eq("sessionId", chunk.sessionId))
          .first();

        // Skip sessions without completed metrics
        if (!metrics || metrics.status !== "complete" || !metrics.opiResult) {
          return null;
        }

        // Debug: log movement type sources
        console.log("[Dashboard] Session", chunk.sessionId, {
          opiMovementType: (metrics.opiResult as any).movementType,
          classificationtype: (metrics.movementClassification as any)?.type,
        });

        return {
          sessionId: chunk.sessionId,
          recordedAt: chunk.recordedAt ?? chunk.startTime,
          activityProfile: chunk.activityProfile ?? "general",
          tags: chunk.tags ?? [],
          notes: chunk.notes,

          // OPI
          opiScore: metrics.opiResult.overallScore,
          opiGrade: metrics.opiResult.grade,
          domainScores: metrics.opiResult.domainScores,
          // Movement type from OPI result or movement classification
          movementType: (metrics.opiResult as any).movementType
            ?? (metrics.movementClassification as any)?.type
            ?? "unknown",
          movementConfidence: (metrics.movementClassification as any)?.confidence ?? 0,

          // Key metrics for table/chart
          metrics: {
            // Symmetry
            romAsymmetry: metrics.bilateralAnalysis?.asymmetryIndices?.averageROM,
            velocityAsymmetry: metrics.bilateralAnalysis?.asymmetryIndices?.peakAngularVelocity,
            crossCorrelation: metrics.bilateralAnalysis?.temporalAsymmetry?.crossCorrelation,
            realAsymmetryAvg: metrics.advancedAsymmetry?.avgRealAsymmetry,

            // Power
            rsi: metrics.jumpMetrics?.rsi,
            jumpHeightCm: metrics.jumpMetrics?.jumpHeightCm,
            peakAngularVelocity: metrics.leftLeg && metrics.rightLeg
              ? (metrics.leftLeg.peakAngularVelocity + metrics.rightLeg.peakAngularVelocity) / 2
              : undefined,
            explosivenessConcentric: metrics.leftLeg && metrics.rightLeg
              ? (metrics.leftLeg.explosivenessConcentric + metrics.rightLeg.explosivenessConcentric) / 2
              : undefined,

            // Control
            sparc: metrics.smoothnessMetrics?.sparc,
            ldlj: metrics.smoothnessMetrics?.ldlj,
            nVelocityPeaks: metrics.smoothnessMetrics?.nVelocityPeaks,
            rmsJerk: metrics.leftLeg && metrics.rightLeg
              ? (metrics.leftLeg.rmsJerk + metrics.rightLeg.rmsJerk) / 2
              : undefined,

            // Stability
            romCoV: metrics.leftLeg && metrics.rightLeg
              ? (metrics.leftLeg.romCoV + metrics.rightLeg.romCoV) / 2
              : undefined,
            groundContactTimeMs: metrics.jumpMetrics?.groundContactTimeMs,
          },
        };
      })
    );

    // Filter out nulls and sort by date (oldest first for charting)
    const validSessions = sessions
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort((a, b) => a.recordedAt - b.recordedAt);

    return {
      subjectId: args.subjectId,
      sessions: validSessions,
      totalSessions: validSessions.length,
    };
  },
});

/**
 * Get list of patients (subjects) with recording counts for dashboard selector.
 */
export const getPatientsList = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    // Get distinct subjects from recordings owned by user
    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("chunkIndex"), 0),
          q.neq(q.field("isArchived"), true)
        )
      )
      .collect();

    // Count sessions per subject
    const subjectCounts = new Map<string, number>();
    const subjectIds = new Set<string>();

    for (const chunk of chunks) {
      const key = chunk.subjectId ?? user._id;
      subjectCounts.set(key, (subjectCounts.get(key) ?? 0) + 1);
      if (chunk.subjectId) {
        subjectIds.add(chunk.subjectId);
      }
    }

    // Build patient list
    const patients: Array<{
      id: string;
      name: string;
      image?: string;
      isMe: boolean;
      sessionCount: number;
    }> = [];

    // Add "Me" first
    const meCount = (subjectCounts.get(user._id) ?? 0);
    if (meCount > 0 || subjectIds.size === 0) {
      patients.push({
        id: user._id,
        name: user.name ?? "Me",
        image: user.image,
        isMe: true,
        sessionCount: meCount,
      });
    }

    // Add other subjects
    for (const subjectId of subjectIds) {
      if (subjectId === user._id) continue;

      const subject = await ctx.db.get(subjectId as Id<"users">);
      if (subject && "name" in subject && !("isArchived" in subject && subject.isArchived)) {
        patients.push({
          id: subjectId,
          name: (subject as { name?: string }).name ?? "Unknown",
          image: (subject as { image?: string }).image,
          isMe: false,
          sessionCount: subjectCounts.get(subjectId) ?? 0,
        });
      }
    }

    // Sort by session count
    patients.sort((a, b) => {
      if (a.isMe) return -1;
      if (b.isMe) return 1;
      return b.sessionCount - a.sessionCount;
    });

    return patients;
  },
});
