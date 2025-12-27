/**
 * Horus Queries
 *
 * Read endpoints for analysis results, progress, and pipeline status.
 */

import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import type {
  AnalysisOutput,
  ProgressOutput,
  PipelineStatus,
  AgentName,
  TokenUsage,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Analysis Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get analysis for a session.
 * The optional _cacheKey arg is ignored but changes the cache key for customConvex.
 */
export const getAnalysis = query({
  args: {
    sessionId: v.string(),
    _cacheKey: v.optional(v.number()), // For cache invalidation with customConvex
  },
  handler: async (ctx, { sessionId }) => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!analysis) {
      console.log("[getAnalysis] No analysis record found for session:", sessionId);
      return null;
    }

    // Get pipeline status for modifiedAt
    const pipelineStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    // Debug logging
    console.log("[getAnalysis] Found analysis:", {
      sessionId,
      status: analysis.status,
      hasAnalysisData: !!analysis.analysis,
      hasVisualization: !!(analysis.analysis as any)?.visualization,
      overallBlockCount: (analysis.analysis as any)?.visualization?.overallBlocks?.length ?? 0,
      sessionBlockCount: (analysis.analysis as any)?.visualization?.sessionBlocks?.length ?? 0,
    });

    return {
      sessionId: analysis.sessionId,
      status: analysis.status as PipelineStatus,
      analysis: analysis.analysis as AnalysisOutput | undefined,
      decomposition: analysis.decomposition,
      research: analysis.research,
      validation: analysis.validation,
      tokenUsage: analysis.tokenUsage as Partial<Record<AgentName, TokenUsage>> | undefined,
      totalCost: analysis.totalCost,
      startedAt: analysis.startedAt,
      completedAt: analysis.completedAt,
      error: analysis.error,
      modifiedAt: pipelineStatus?.updatedAt ?? analysis.startedAt, // For cache invalidation
    };
  },
});

/**
 * Get analysis insights only (for UI display).
 */
export const getAnalysisInsights = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const record = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!record || record.status !== "complete" || !record.analysis) {
      return null;
    }

    const analysis = record.analysis as AnalysisOutput;

    return {
      sessionId,
      insights: analysis.insights,
      correlativeInsights: analysis.correlativeInsights,
      benchmarks: analysis.benchmarks,
      summary: analysis.summary,
      strengths: analysis.strengths,
      weaknesses: analysis.weaknesses,
      analyzedAt: analysis.analyzedAt,
    };
  },
});

/**
 * Check if analysis exists and is complete.
 */
export const hasCompleteAnalysis = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<boolean> => {
    const record = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    return record?.status === "complete";
  },
});

/**
 * Internal query for getting analysis.
 */
export const getAnalysisInternal = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
  },
});

// ─────────────────────────────────────────────────────────────────
// Progress Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get progress report for a patient.
 */
export const getProgressReport = query({
  args: { patientId: v.id("users") },
  handler: async (ctx, { patientId }) => {
    const progress = await ctx.db
      .query("horusProgress")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .first();

    if (!progress) return null;

    return {
      patientId,
      progress: progress.latestProgress as ProgressOutput,
      sessionIds: progress.sessionIds,
      updatedAt: progress.updatedAt,
    };
  },
});

/**
 * Get progress trends for a specific metric.
 */
export const getMetricTrends = query({
  args: {
    patientId: v.id("users"),
    metricName: v.string(),
    limb: v.optional(v.union(v.literal("Left Leg"), v.literal("Right Leg"))),
  },
  handler: async (ctx, { patientId, metricName, limb }) => {
    const progress = await ctx.db
      .query("horusProgress")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .first();

    if (!progress) return null;

    const progressData = progress.latestProgress as ProgressOutput;

    // Find matching trend
    const trend = progressData.trends.find(
      (t) =>
        t.metricName === metricName &&
        (limb ? t.limb === limb : !t.limb)
    );

    return trend || null;
  },
});

/**
 * Get milestones for a patient.
 */
export const getMilestones = query({
  args: { patientId: v.id("users") },
  handler: async (ctx, { patientId }) => {
    const progress = await ctx.db
      .query("horusProgress")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .first();

    if (!progress) return [];

    const progressData = progress.latestProgress as ProgressOutput;
    return progressData.milestones || [];
  },
});

// ─────────────────────────────────────────────────────────────────
// Pipeline Status Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get pipeline status for a session.
 */
export const getPipelineStatus = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const status = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!status) return null;

    return {
      sessionId,
      status: status.status as PipelineStatus,
      currentAgent: status.currentAgent as AgentName | undefined,
      revisionCount: status.revisionCount,
      startedAt: status.startedAt,
      updatedAt: status.updatedAt,
      error: status.error,
    };
  },
});

/**
 * Internal pipeline status query.
 */
export const getPipelineStatusInternal = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
  },
});

/**
 * Get all active pipelines.
 */
export const getActivePipelines = query({
  args: {},
  handler: async (ctx) => {
    const activeStatuses: PipelineStatus[] = [
      "pending",
      "decomposition",
      "research",
      "analysis",
      "validation",
      "progress",
    ];

    const pipelines = await ctx.db
      .query("horusPipelineStatus")
      .filter((q) =>
        q.or(
          ...activeStatuses.map((s) => q.eq(q.field("status"), s))
        )
      )
      .take(20);

    return pipelines.map((p) => ({
      sessionId: p.sessionId,
      status: p.status as PipelineStatus,
      currentAgent: p.currentAgent as AgentName | undefined,
      startedAt: p.startedAt,
      updatedAt: p.updatedAt,
    }));
  },
});

/**
 * Get failed pipelines.
 */
export const getFailedPipelines = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    const pipelines = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_status", (q) => q.eq("status", "error"))
      .order("desc")
      .take(limit);

    return pipelines.map((p) => ({
      sessionId: p.sessionId,
      error: p.error,
      startedAt: p.startedAt,
      updatedAt: p.updatedAt,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────
// Batch Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get analyses for multiple sessions.
 */
export const getAnalysesBatch = query({
  args: { sessionIds: v.array(v.string()) },
  handler: async (ctx, { sessionIds }) => {
    const results: Record<string, { status: PipelineStatus; hasAnalysis: boolean }> = {};

    for (const sessionId of sessionIds) {
      const record = await ctx.db
        .query("horusAnalyses")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .first();

      results[sessionId] = {
        status: (record?.status as PipelineStatus) || "pending",
        hasAnalysis: record?.status === "complete",
      };
    }

    return results;
  },
});

/**
 * Get recent analyses for a patient.
 */
export const getPatientAnalyses = query({
  args: {
    patientId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { patientId, limit = 10 }) => {
    const analyses = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit);

    return analyses.map((a) => ({
      sessionId: a.sessionId,
      status: a.status as PipelineStatus,
      summary: (a.analysis as AnalysisOutput | undefined)?.summary,
      strengths: (a.analysis as AnalysisOutput | undefined)?.strengths?.slice(0, 2),
      weaknesses: (a.analysis as AnalysisOutput | undefined)?.weaknesses?.slice(0, 2),
      analyzedAt: a.completedAt,
    }));
  },
});
