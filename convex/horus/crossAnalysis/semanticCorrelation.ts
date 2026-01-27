/**
 * Semantic Correlation Utilities
 *
 * Links 32-dim metrics vectors to 768-dim semantic vectors.
 * Builds rich context for each cluster's percentile bands.
 */

import type { QueryCtx } from "../../_generated/server";
import type { Id, Doc } from "../../_generated/dataModel";
import type {
  SessionVector,
  PerformanceCluster,
  ClusterWithSemantics,
  ClusterPercentileBand,
  SemanticContext,
} from "./types";
import {
  cosineSimilarity,
  METRIC_INDEX_MAP,
  denormalizeMetricValue,
} from "../vectordb/metricsVector";

// ─────────────────────────────────────────────────────────────────
// Main Builder Function
// ─────────────────────────────────────────────────────────────────

/**
 * Build full semantic context for a cluster's percentile bands.
 * Partitions sessions by similarity to centroid, then gathers
 * semantic context (768-dim embeddings + tags + notes + AI findings).
 */
export async function buildClusterWithSemantics(
  ctx: QueryCtx,
  cluster: PerformanceCluster,
  allSessions: SessionVector[],
  patientId: Id<"users">
): Promise<ClusterWithSemantics> {
  // Get sessions in this cluster
  const memberSessions = allSessions.filter((s) =>
    cluster.sessionIds.includes(s.sessionId)
  );

  // Partition by similarity to cluster centroid
  const { p10Sessions, p50Sessions, p90Sessions } = partitionBySimilarity(
    cluster,
    memberSessions
  );

  // Get semantic context for each band
  const [p10Semantics, p50Semantics, p90Semantics] = await Promise.all([
    getSemanticContext(ctx, p10Sessions, patientId),
    getSemanticContext(ctx, p50Sessions, patientId),
    getSemanticContext(ctx, p90Sessions, patientId),
  ]);

  // Calculate median metrics for each band
  const p10Metrics = calculateMedianMetrics(p10Sessions.map((s) => s.vector));
  const p50Metrics = calculateMedianMetrics(p50Sessions.map((s) => s.vector));
  const p90Metrics = calculateMedianMetrics(p90Sessions.map((s) => s.vector));

  // Find distinguishing features
  const distinguishingFeatures = findDistinguishingFeatures(
    p90Semantics,
    p10Semantics
  );

  // Calculate semantic distance between typical and outlier
  const typicalVsOutlierSemanticDistance =
    p90Semantics.semanticCentroid.length > 0 &&
    p10Semantics.semanticCentroid.length > 0
      ? cosineSimilarity(p90Semantics.semanticCentroid, p10Semantics.semanticCentroid)
      : 1.0; // If no embeddings, assume similar

  return {
    clusterId: cluster.clusterId,
    label: cluster.label,
    centroid: cluster.centroid,
    bands: {
      p10: {
        percentile: "p10",
        similarityToCluster: "outlier",
        sessionIds: p10Sessions.map((s) => s.sessionId),
        sessionCount: p10Sessions.length,
        medianMetrics: p10Metrics,
        semantics: p10Semantics,
      },
      p50: {
        percentile: "p50",
        similarityToCluster: "median",
        sessionIds: p50Sessions.map((s) => s.sessionId),
        sessionCount: p50Sessions.length,
        medianMetrics: p50Metrics,
        semantics: p50Semantics,
      },
      p90: {
        percentile: "p90",
        similarityToCluster: "typical",
        sessionIds: p90Sessions.map((s) => s.sessionId),
        sessionCount: p90Sessions.length,
        medianMetrics: p90Metrics,
        semantics: p90Semantics,
      },
    },
    typicalVsOutlierSemanticDistance,
    distinguishingFeatures,
  };
}

// ─────────────────────────────────────────────────────────────────
// Similarity-Based Partitioning
// ─────────────────────────────────────────────────────────────────

/**
 * Partition cluster sessions by similarity to centroid.
 * - p90: Most similar (typical sessions)
 * - p50: Median similarity
 * - p10: Least similar (outliers within cluster)
 *
 * IMPORTANT: Each session is assigned to exactly ONE band to avoid double-counting.
 * With small clusters, we use simplified partitioning.
 */
export function partitionBySimilarity(
  cluster: PerformanceCluster,
  sessions: SessionVector[]
): {
  p10Sessions: SessionVector[];
  p50Sessions: SessionVector[];
  p90Sessions: SessionVector[];
} {
  if (sessions.length === 0) {
    return { p10Sessions: [], p50Sessions: [], p90Sessions: [] };
  }

  if (sessions.length === 1) {
    // Single session goes to p90 (typical)
    return { p10Sessions: [], p50Sessions: [], p90Sessions: sessions };
  }

  // Calculate similarity to cluster centroid for each session
  const withSimilarity = sessions.map((s) => ({
    ...s,
    similarity: cosineSimilarity(s.vector, cluster.centroid),
  }));

  // Sort by similarity (ascending: outliers first, typical last)
  withSimilarity.sort((a, b) => a.similarity - b.similarity);

  const n = withSimilarity.length;

  // Extract sessions (strip similarity field)
  const stripSimilarity = (arr: typeof withSimilarity): SessionVector[] =>
    arr.map(({ similarity, ...s }) => s);

  // For small clusters, use simplified partitioning to avoid overlap
  if (n === 2) {
    // 2 sessions: first is outlier (p10), second is typical (p90)
    return {
      p10Sessions: stripSimilarity([withSimilarity[0]]),
      p50Sessions: [],
      p90Sessions: stripSimilarity([withSimilarity[1]]),
    };
  }

  if (n === 3) {
    // 3 sessions: one in each band
    return {
      p10Sessions: stripSimilarity([withSimilarity[0]]),
      p50Sessions: stripSimilarity([withSimilarity[1]]),
      p90Sessions: stripSimilarity([withSimilarity[2]]),
    };
  }

  if (n <= 5) {
    // 4-5 sessions: split into thirds (non-overlapping)
    const third = Math.ceil(n / 3);
    return {
      p10Sessions: stripSimilarity(withSimilarity.slice(0, third)),
      p50Sessions: stripSimilarity(withSimilarity.slice(third, n - third)),
      p90Sessions: stripSimilarity(withSimilarity.slice(n - third)),
    };
  }

  // For larger clusters, use non-overlapping percentile ranges
  // p10: bottom 10%, p50: middle 10% (45-55%), p90: top 10%
  const p10Count = Math.max(1, Math.round(n * 0.1));
  const p90Count = Math.max(1, Math.round(n * 0.1));
  const p50Start = Math.floor(n * 0.45);
  const p50End = Math.ceil(n * 0.55);

  return {
    p10Sessions: stripSimilarity(withSimilarity.slice(0, p10Count)),
    p50Sessions: stripSimilarity(withSimilarity.slice(p50Start, p50End)),
    p90Sessions: stripSimilarity(withSimilarity.slice(n - p90Count)),
  };
}

// ─────────────────────────────────────────────────────────────────
// Semantic Context Retrieval
// ─────────────────────────────────────────────────────────────────

/**
 * Get semantic context for a set of sessions.
 * Combines 768-dim embeddings, tags, notes, and AI findings.
 */
export async function getSemanticContext(
  ctx: QueryCtx,
  sessions: SessionVector[],
  patientId: Id<"users">
): Promise<SemanticContext> {
  if (sessions.length === 0) {
    return {
      semanticCentroid: [],
      tags: [],
      noteExcerpts: [],
      keyFindings: [],
      summaryExcerpts: [],
    };
  }

  const sessionIds = sessions.map((s) => s.sessionId);

  // Get embeddings and session data in parallel
  const [embeddings, recordingSessions] = await Promise.all([
    getAnalysisEmbeddings(ctx, sessionIds),
    getRecordingSessions(ctx, sessionIds),
  ]);

  // Calculate 768-dim semantic centroid
  const semanticCentroid = calculateSemanticCentroid(embeddings);

  // Aggregate tags with frequency
  // Use recordingSessions as authoritative source (sessions may have stale/incomplete tags)
  const tagFrequencies = new Map<string, number>();
  const tagSources = recordingSessions.length > 0 ? recordingSessions : sessions;
  for (const session of tagSources) {
    const tags = session.tags || [];
    for (const tag of tags) {
      tagFrequencies.set(tag, (tagFrequencies.get(tag) || 0) + 1);
    }
  }
  const totalSessions = tagSources.length || 1;
  const tags = [...tagFrequencies.entries()]
    .map(([tag, count]) => ({ tag, frequency: count / totalSessions }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10);

  // Aggregate notes
  const noteExcerpts: string[] = [];
  for (const session of sessions) {
    if (session.notes && session.notes.trim()) {
      noteExcerpts.push(session.notes.trim().slice(0, 200));
    }
  }
  for (const rs of recordingSessions) {
    if (rs.notes && rs.notes.trim() && noteExcerpts.length < 5) {
      noteExcerpts.push(rs.notes.trim().slice(0, 200));
    }
  }

  // Aggregate key findings and summaries from embeddings
  const keyFindings: string[] = [];
  const summaryExcerpts: string[] = [];

  for (const emb of embeddings) {
    if (emb.keyFindings) {
      keyFindings.push(...emb.keyFindings.slice(0, 3));
    }
    if (emb.summaryText) {
      summaryExcerpts.push(emb.summaryText.slice(0, 300));
    }
  }

  return {
    semanticCentroid,
    tags,
    noteExcerpts: noteExcerpts.slice(0, 5),
    keyFindings: [...new Set(keyFindings)].slice(0, 10), // Deduplicate
    summaryExcerpts: summaryExcerpts.slice(0, 3),
  };
}

/**
 * Get analysis embeddings for session IDs.
 */
async function getAnalysisEmbeddings(
  ctx: QueryCtx,
  sessionIds: string[]
): Promise<Doc<"horusAnalysisEmbeddings">[]> {
  const embeddings: Doc<"horusAnalysisEmbeddings">[] = [];

  for (const sessionId of sessionIds) {
    const emb = await ctx.db
      .query("horusAnalysisEmbeddings")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (emb) {
      embeddings.push(emb);
    }
  }

  return embeddings;
}

/**
 * Get recording sessions for session IDs.
 */
async function getRecordingSessions(
  ctx: QueryCtx,
  sessionIds: string[]
): Promise<Doc<"recordingSessions">[]> {
  const sessions: Doc<"recordingSessions">[] = [];

  for (const sessionId of sessionIds) {
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .first();

    if (session) {
      sessions.push(session);
    }
  }

  return sessions;
}

/**
 * Calculate semantic centroid (average of 768-dim embeddings).
 */
function calculateSemanticCentroid(
  embeddings: Doc<"horusAnalysisEmbeddings">[]
): number[] {
  if (embeddings.length === 0) return [];

  const validEmbeddings = embeddings.filter(
    (e) => e.embedding && e.embedding.length === 768
  );

  if (validEmbeddings.length === 0) return [];

  const dimensions = 768;
  const centroid = new Array(dimensions).fill(0);

  for (const emb of validEmbeddings) {
    for (let i = 0; i < dimensions; i++) {
      centroid[i] += emb.embedding[i];
    }
  }

  for (let i = 0; i < dimensions; i++) {
    centroid[i] /= validEmbeddings.length;
  }

  return centroid;
}

// ─────────────────────────────────────────────────────────────────
// Metric Calculation
// ─────────────────────────────────────────────────────────────────

/**
 * Calculate median metrics from 32-dim vectors.
 * Denormalizes back to original units.
 */
export function calculateMedianMetrics(
  vectors: number[][]
): Record<string, { value: number; displayName: string; unit: string }> {
  const metrics: Record<
    string,
    { value: number; displayName: string; unit: string }
  > = {};

  if (vectors.length === 0) return metrics;

  // For each active metric dimension
  for (const [indexStr, config] of Object.entries(METRIC_INDEX_MAP)) {
    const index = Number(indexStr);
    if (config.name.startsWith("reserved")) continue;

    // Get values at this dimension
    const values = vectors.map((v) => v[index]).filter((v) => !isNaN(v));
    if (values.length === 0) continue;

    // Calculate median
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianNormalized =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];

    // Denormalize back to original units
    const value = denormalizeMetricValue(
      medianNormalized,
      config.minValue,
      config.maxValue,
      config.direction
    );

    // Get unit based on metric type
    const unit = getMetricUnit(config.name);

    metrics[config.name] = {
      value: Math.round(value * 100) / 100, // Round to 2 decimal places
      displayName: config.displayName,
      unit,
    };
  }

  return metrics;
}

/**
 * Get unit for a metric.
 */
function getMetricUnit(metricName: string): string {
  // Angle metrics
  if (
    metricName.includes("ROM") ||
    metricName.includes("Flexion") ||
    metricName.includes("Extension") ||
    metricName.includes("phaseShift") ||
    metricName.includes("realAsymmetry")
  ) {
    return "°";
  }

  // Velocity metrics
  if (metricName.includes("Velocity")) {
    return "°/s";
  }

  // Explosiveness metrics
  if (metricName.includes("Explosiveness") || metricName.includes("explosive")) {
    return "°/s²";
  }

  // Asymmetry percentages
  if (
    metricName.includes("Asymmetry") &&
    !metricName.includes("realAsymmetry")
  ) {
    return "%";
  }

  // Time metrics
  if (metricName.includes("Lag") || metricName.includes("Timing")) {
    return "ms";
  }

  // Jerk
  if (metricName.includes("Jerk")) {
    return "°/s³";
  }

  // Smoothness scores (unitless)
  if (metricName === "sparc" || metricName === "ldlj") {
    return "";
  }

  // Count
  if (metricName === "nVelocityPeaks") {
    return "";
  }

  // Correlation (unitless ratio)
  if (metricName === "crossCorrelation") {
    return "";
  }

  return "";
}

// ─────────────────────────────────────────────────────────────────
// Distinguishing Features
// ─────────────────────────────────────────────────────────────────

/**
 * Find features that distinguish typical (p90) from outlier (p10) sessions.
 */
export function findDistinguishingFeatures(
  typicalSemantics: SemanticContext,
  outlierSemantics: SemanticContext
): Array<{ feature: string; typicalFrequency: number; outlierFrequency: number }> {
  const features: Array<{
    feature: string;
    typicalFrequency: number;
    outlierFrequency: number;
  }> = [];

  // Create tag frequency maps
  const typicalTags = new Map(typicalSemantics.tags.map((t) => [t.tag, t.frequency]));
  const outlierTags = new Map(outlierSemantics.tags.map((t) => [t.tag, t.frequency]));

  // Find all tags
  const allTags = new Set([...typicalTags.keys(), ...outlierTags.keys()]);

  for (const tag of allTags) {
    const typicalFreq = typicalTags.get(tag) || 0;
    const outlierFreq = outlierTags.get(tag) || 0;

    // Only include if there's a meaningful difference (> 20%)
    if (Math.abs(typicalFreq - outlierFreq) > 0.2) {
      features.push({
        feature: tag,
        typicalFrequency: typicalFreq,
        outlierFrequency: outlierFreq,
      });
    }
  }

  // Extract distinguishing words from key findings
  const typicalKeywords = extractKeywords(typicalSemantics.keyFindings);
  const outlierKeywords = extractKeywords(outlierSemantics.keyFindings);

  // Find words that appear significantly more in one group
  const allKeywords = new Set([...typicalKeywords.keys(), ...outlierKeywords.keys()]);

  for (const keyword of allKeywords) {
    const typicalFreq = typicalKeywords.get(keyword) || 0;
    const outlierFreq = outlierKeywords.get(keyword) || 0;

    // Only include meaningful differences
    if (Math.abs(typicalFreq - outlierFreq) > 0.3 && !features.some((f) => f.feature === keyword)) {
      features.push({
        feature: keyword,
        typicalFrequency: typicalFreq,
        outlierFrequency: outlierFreq,
      });
    }
  }

  // Sort by difference magnitude and take top 5
  features.sort(
    (a, b) =>
      Math.abs(b.typicalFrequency - b.outlierFrequency) -
      Math.abs(a.typicalFrequency - a.outlierFrequency)
  );

  return features.slice(0, 5);
}

/**
 * Extract keywords from findings with frequency.
 */
function extractKeywords(findings: string[]): Map<string, number> {
  const keywords = new Map<string, number>();

  // Clinical terms to look for
  const clinicalTerms = [
    "asymmetry",
    "symmetric",
    "smooth",
    "jerky",
    "strong",
    "weak",
    "improving",
    "declining",
    "stable",
    "compensation",
    "bilateral",
    "fatigue",
    "stiffness",
    "range",
    "velocity",
    "control",
    "balance",
    "coordination",
    "morning",
    "afternoon",
    "evening",
    "warmup",
    "post-warmup",
    "tired",
    "rested",
  ];

  const totalFindings = findings.length || 1;

  for (const finding of findings) {
    const lowerFinding = finding.toLowerCase();

    for (const term of clinicalTerms) {
      if (lowerFinding.includes(term)) {
        const current = keywords.get(term) || 0;
        keywords.set(term, current + 1 / totalFindings);
      }
    }
  }

  return keywords;
}
