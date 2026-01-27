/**
 * Cross-Analysis Queries
 *
 * Read operations for building cross-analysis context.
 */

import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import {
  createTagGroupKey,
  METRIC_INDEX_MAP,
  cosineSimilarity,
  denormalizeMetricValue,
} from "../vectordb/metricsVector";
import type { SessionMetrics } from "../types";
import type {
  CrossAnalysisContext,
  CurrentSessionContext,
  BaselineContext,
  HistoricalSessionSummary,
  TrendContext,
  SimilarSession,
  NotableMetric,
  TrendDirection,
} from "./types";

// ─────────────────────────────────────────────────────────────────
// Basic Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get the number of sessions with vectors for a patient.
 * If beforeDate is provided, only counts sessions recorded before that date.
 */
export const getPatientSessionCount = internalQuery({
  args: {
    patientId: v.id("users"),
    beforeDate: v.optional(v.number()), // Filter to sessions recorded before this timestamp
  },
  handler: async (ctx, args) => {
    const vectors = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();

    // If beforeDate is provided, filter to only sessions recorded before that date
    if (args.beforeDate !== undefined) {
      const filtered = vectors.filter((v) => v.recordedAt < args.beforeDate!);
      console.log(`[getPatientSessionCount] Total vectors: ${vectors.length}, Before ${new Date(args.beforeDate).toISOString()}: ${filtered.length}`);
      return filtered.length;
    }

    return vectors.length;
  },
});

/**
 * Diagnostic: Compare vector recordedAt values with session startTime values.
 * Use this to check if vectors have correct recording dates.
 */
export const diagnoseDateMismatch = internalQuery({
  args: {
    patientId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const vectors = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();

    const results: Array<{
      sessionId: string;
      vectorRecordedAt: string;
      sessionStartTime: string;
      diffHours: number;
      needsFix: boolean;
    }> = [];

    for (const vector of vectors) {
      const session = await ctx.db
        .query("recordingSessions")
        .withIndex("by_sessionId", (q) => q.eq("sessionId", vector.sessionId))
        .first();

      const sessionTime = session?.recordedAt ?? session?.startTime ?? 0;
      const diffMs = Math.abs(vector.recordedAt - sessionTime);
      const diffHours = diffMs / (1000 * 60 * 60);

      results.push({
        sessionId: vector.sessionId,
        vectorRecordedAt: new Date(vector.recordedAt).toISOString(),
        sessionStartTime: sessionTime ? new Date(sessionTime).toISOString() : "unknown",
        diffHours: Math.round(diffHours * 10) / 10,
        needsFix: diffHours > 1, // More than 1 hour difference
      });
    }

    const needsFixCount = results.filter((r) => r.needsFix).length;
    console.log(`[diagnoseDateMismatch] Found ${results.length} vectors, ${needsFixCount} need fixing`);

    return { vectors: results, needsFixCount };
  },
});

/**
 * Get patient baseline for a specific tag group.
 */
export const getPatientBaseline = internalQuery({
  args: {
    patientId: v.id("users"),
    tagGroup: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("horusPatientBaselines")
      .withIndex("by_patient_tag", (q) =>
        q.eq("patientId", args.patientId).eq("tagGroup", args.tagGroup)
      )
      .first();
  },
});

/**
 * Get all baselines for a patient.
 */
export const getPatientBaselines = internalQuery({
  args: {
    patientId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("horusPatientBaselines")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();
  },
});

/**
 * Get metrics vector for a session.
 */
export const getSessionVector = internalQuery({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
  },
});

// ─────────────────────────────────────────────────────────────────
// Context Building
// ─────────────────────────────────────────────────────────────────

/**
 * Build the full cross-analysis context for the LLM.
 * Pre-computes summaries and comparisons to stay within token budget.
 *
 * IMPORTANT: This function is "blind" to future data - it only considers
 * sessions recorded BEFORE the current session's recording date.
 */
export const buildCrossAnalysisContext = internalQuery({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
    currentMetrics: v.any(), // SessionMetrics
    maxHistoricalSessions: v.optional(v.number()), // Default: 10
  },
  handler: async (ctx, args): Promise<CrossAnalysisContext | null> => {
    const metrics = args.currentMetrics as SessionMetrics;
    const maxHistory = args.maxHistoricalSessions ?? 10;

    // CRITICAL: Use the session's recording date, NOT the current time
    const currentRecordingDate = metrics.recordedAt;
    if (!currentRecordingDate) {
      console.warn("[Cross-Analysis] Missing recordedAt in metrics, skipping cross-analysis");
      return null;
    }

    // Get current session's tag group
    const tagGroup = createTagGroupKey(metrics.tags);

    // 1. Build current session context (using recording date)
    const currentSession: CurrentSessionContext = {
      sessionId: args.sessionId,
      date: currentRecordingDate,
      tags: metrics.tags ?? [],
      opiScore: metrics.opiScore ?? 0,
      opiGrade: metrics.opiGrade,
      metrics: buildMetricsDisplay(metrics),
    };

    // 2. Get patient baseline
    let baseline = await ctx.db
      .query("horusPatientBaselines")
      .withIndex("by_patient_tag", (q) =>
        q.eq("patientId", args.patientId).eq("tagGroup", tagGroup)
      )
      .first();

    // Fallback to default baseline if no tag-specific baseline exists
    if (!baseline) {
      baseline = await ctx.db
        .query("horusPatientBaselines")
        .withIndex("by_patient_tag", (q) =>
          q.eq("patientId", args.patientId).eq("tagGroup", "_default")
        )
        .first();
    }

    // If still no baseline, we can't do cross-analysis
    if (!baseline) {
      return null;
    }

    // 3. Build baseline context
    const baselineContext: BaselineContext = {
      tagGroup: baseline.tagGroup,
      sessionCount: baseline.sessionCount,
      metrics: buildBaselineMetrics(baseline.medianVector, baseline.stdVector, baseline.trends),
    };

    // 4. Get historical sessions - ONLY those recorded BEFORE the current session
    // This ensures the AI is "blind" to future data relative to this recording
    const allVectors = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();

    // Filter to only sessions recorded BEFORE the current recording date
    // (exclude current session AND any sessions recorded after it)
    const historicalVectors = allVectors
      .filter((v) => v.sessionId !== args.sessionId && v.recordedAt < currentRecordingDate)
      .sort((a, b) => b.recordedAt - a.recordedAt) // Most recent first (but still before current)
      .slice(0, maxHistory);

    // 5. Build historical session summaries
    const recentHistory: HistoricalSessionSummary[] = historicalVectors.map((v) => ({
      sessionId: v.sessionId,
      date: v.recordedAt,
      tags: [], // Tags not stored in vector table, would need session lookup
      opiScore: v.rawMetrics.opiScore ?? 0,
      notableMetrics: findNotableMetrics(v.metricsVector, baseline!.medianVector),
    }));

    // 6. Build trend context from baseline trends
    const trends: TrendContext[] = baseline.trends.map((t) => ({
      metricName: t.metricName,
      displayName: getMetricDisplayNameForIndex(t.metricIndex),
      direction: t.direction as TrendDirection,
      slopePerSession: t.slopePerSession,
      isClinicallyMeaningful: Math.abs(t.slopePerSession) > 0.02, // 2% per session threshold
    }));

    // 7. Find similar sessions using cosine similarity
    const currentVector = await ctx.db
      .query("horusMetricsVectors")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    let similarSessions: SimilarSession[] = [];
    if (currentVector) {
      similarSessions = historicalVectors
        .map((v) => ({
          sessionId: v.sessionId,
          date: v.recordedAt,
          similarity: cosineSimilarity(currentVector.metricsVector, v.metricsVector),
          tags: [], // Would need session lookup
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);
    }

    return {
      currentSession,
      baseline: baselineContext,
      recentHistory,
      trends,
      similarSessions,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Build metrics display object from SessionMetrics.
 */
function buildMetricsDisplay(
  metrics: SessionMetrics
): Record<string, { value: number; displayName: string; unit: string }> {
  const result: Record<string, { value: number; displayName: string; unit: string }> = {};

  // Range metrics
  result["avgMaxROM"] = {
    value: (metrics.leftLeg.overallMaxRom + metrics.rightLeg.overallMaxRom) / 2,
    displayName: "Average Max ROM",
    unit: "°",
  };
  result["avgPeakFlexion"] = {
    value: (metrics.leftLeg.peakFlexion + metrics.rightLeg.peakFlexion) / 2,
    displayName: "Average Peak Flexion",
    unit: "°",
  };

  // Symmetry metrics
  result["romAsymmetry"] = {
    value: metrics.bilateral.romAsymmetry,
    displayName: "ROM Asymmetry",
    unit: "%",
  };
  result["velocityAsymmetry"] = {
    value: metrics.bilateral.velocityAsymmetry,
    displayName: "Velocity Asymmetry",
    unit: "%",
  };
  result["netGlobalAsymmetry"] = {
    value: metrics.bilateral.netGlobalAsymmetry,
    displayName: "Global Asymmetry",
    unit: "%",
  };
  result["crossCorrelation"] = {
    value: metrics.bilateral.crossCorrelation,
    displayName: "Movement Sync",
    unit: "",
  };

  // Power metrics
  result["avgPeakVelocity"] = {
    value: (metrics.leftLeg.peakAngularVelocity + metrics.rightLeg.peakAngularVelocity) / 2,
    displayName: "Average Peak Velocity",
    unit: "°/s",
  };

  // Timing metrics
  result["temporalLag"] = {
    value: metrics.bilateral.temporalLag,
    displayName: "Temporal Lag",
    unit: "ms",
  };

  return result;
}

/**
 * Build baseline metrics from vectors.
 */
function buildBaselineMetrics(
  medianVector: number[],
  stdVector: number[],
  trends: Array<{ metricIndex: number; metricName: string; direction: string; slopePerSession: number }>
): Record<string, { median: number; std: number; trend: TrendDirection }> {
  const result: Record<string, { median: number; std: number; trend: TrendDirection }> = {};

  // Map key metrics from vector indices
  const keyMetrics = [
    { name: "avgMaxROM", index: 0 },
    { name: "avgPeakFlexion", index: 1 },
    { name: "romAsymmetry", index: 7 },
    { name: "velocityAsymmetry", index: 8 },
    { name: "crossCorrelation", index: 9 },
    { name: "netGlobalAsymmetry", index: 11 },
    { name: "avgPeakVelocity", index: 15 },
    { name: "temporalLag", index: 13 },
  ];

  for (const metric of keyMetrics) {
    const config = METRIC_INDEX_MAP[metric.index];
    const trend = trends.find((t) => t.metricIndex === metric.index);

    // Denormalize the median value back to original scale
    const medianDenorm = denormalizeMetricValue(
      medianVector[metric.index],
      config.minValue,
      config.maxValue,
      config.direction
    );
    const stdDenorm = stdVector[metric.index] * (config.maxValue - config.minValue);

    result[metric.name] = {
      median: medianDenorm,
      std: stdDenorm,
      trend: (trend?.direction as TrendDirection) ?? "stable",
    };
  }

  return result;
}

/**
 * Find metrics that deviate significantly from baseline.
 */
function findNotableMetrics(
  sessionVector: number[],
  baselineMedian: number[]
): NotableMetric[] {
  const notable: NotableMetric[] = [];
  const deviationThreshold = 0.15; // 15% deviation

  // Check key metrics
  const keyIndices = [0, 1, 7, 8, 9, 11, 15]; // Key metric indices

  for (const index of keyIndices) {
    const sessionValue = sessionVector[index];
    const baselineValue = baselineMedian[index];
    const config = METRIC_INDEX_MAP[index];

    if (baselineValue === 0) continue;

    const deviation = (sessionValue - baselineValue) / baselineValue;

    if (Math.abs(deviation) >= deviationThreshold) {
      // Denormalize for display
      const displayValue = denormalizeMetricValue(
        sessionValue,
        config.minValue,
        config.maxValue,
        config.direction
      );

      notable.push({
        name: config.name,
        displayName: config.displayName,
        value: displayValue,
        unit: getUnitForMetric(config.name),
        deviationFromBaseline: deviation * 100,
        deviationDirection: deviation > 0 ? "above" : "below",
      });
    }
  }

  // Sort by absolute deviation
  notable.sort((a, b) => Math.abs(b.deviationFromBaseline) - Math.abs(a.deviationFromBaseline));

  return notable.slice(0, 3); // Top 3 notable metrics
}

/**
 * Get display name for a metric index.
 */
function getMetricDisplayNameForIndex(index: number): string {
  return METRIC_INDEX_MAP[index]?.displayName ?? `Metric ${index}`;
}

/**
 * Get unit for a metric name.
 */
function getUnitForMetric(metricName: string): string {
  const units: Record<string, string> = {
    avgMaxROM: "°",
    avgPeakFlexion: "°",
    avgPeakExtension: "°",
    romAsymmetry: "%",
    velocityAsymmetry: "%",
    crossCorrelation: "",
    realAsymmetryAvg: "°",
    netGlobalAsymmetry: "%",
    phaseShift: "°",
    temporalLag: "ms",
    maxFlexionTimingDiff: "ms",
    avgPeakVelocity: "°/s",
    avgExplosivenessConcentric: "°/s²",
    avgExplosivenessLoading: "°/s²",
    sparc: "",
    ldlj: "",
    nVelocityPeaks: "",
    rmsJerk: "°/s³",
  };

  return units[metricName] ?? "";
}
