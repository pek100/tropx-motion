/**
 * Analysis Vector Search
 *
 * Semantic search over historical analyses for the progress phase.
 * Enables the AI to reference past session insights when analyzing longitudinal progress.
 */

import { action, mutation, query, internalAction, internalMutation } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { normalizeText } from "./embeddings";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type EmbeddingType = "session" | "progress";

export interface AnalysisSearchResult {
  _id: Id<"horusAnalysisEmbeddings">;
  sessionId: string;
  type: EmbeddingType;
  summaryText: string;
  keyFindings: string[];
  opiScore?: number;
  primaryDomain?: string;
  analyzedAt: number;
  score: number;
}

export interface AnalysisEmbeddingInput {
  sessionId: string;
  patientId?: Id<"users">;
  type: EmbeddingType;
  summaryText: string;
  keyFindings: string[];
  opiScore?: number;
  primaryDomain?: string;
  analyzedAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Search Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Search historical analyses for a patient using semantic similarity.
 * Used by the progress phase to find relevant past insights.
 * Can filter by type (session, progress, or both).
 */
export const searchPatientAnalyses = internalAction({
  args: {
    patientId: v.id("users"),
    query: v.string(),
    limit: v.optional(v.number()),
    excludeSessionId: v.optional(v.string()), // Exclude current session
    type: v.optional(v.union(v.literal("session"), v.literal("progress"))), // Filter by type
  },
  handler: async (ctx, { patientId, query, limit = 5, excludeSessionId, type }): Promise<AnalysisSearchResult[]> => {
    // 1. Generate query embedding
    const embeddingResult = await ctx.runAction(
      internal.horus.vectordb.embeddings.generateEmbedding,
      {
        text: normalizeText(query),
        taskType: "RETRIEVAL_QUERY",
      }
    );

    // 2. Run vector search with patient filter
    // Note: Convex vector search only supports single field filters in filter function
    // We filter by patientId in the query and by type in post-processing if needed
    const results = await ctx.vectorSearch("horusAnalysisEmbeddings", "by_embedding", {
      vector: embeddingResult.embedding,
      limit: (limit + (excludeSessionId ? 1 : 0)) * (type ? 2 : 1), // Get extra if filtering by type
      filter: (q) => q.eq("patientId", patientId),
    });

    // 3. Fetch full documents and filter
    const docs = await Promise.all(
      results.map(async (r) => {
        const doc = await ctx.runQuery(internal.horus.vectordb.analysisSearch.getAnalysisEmbeddingById, {
          id: r._id,
        });
        return doc ? { ...doc, score: r._score } : null;
      })
    );

    // 4. Filter by type (if specified), exclude session (if specified), and format
    return docs
      .filter((d): d is NonNullable<typeof d> =>
        d !== null &&
        (excludeSessionId ? d.sessionId !== excludeSessionId : true) &&
        (type ? d.type === type : true)
      )
      .slice(0, limit)
      .map((d) => ({
        _id: d._id,
        sessionId: d.sessionId,
        type: d.type as EmbeddingType,
        summaryText: d.summaryText,
        keyFindings: d.keyFindings,
        opiScore: d.opiScore,
        primaryDomain: d.primaryDomain,
        analyzedAt: d.analyzedAt,
        score: d.score,
      }));
  },
});

/**
 * Get all analyses for a patient (chronological, for trend building).
 * Can optionally filter by type (session or progress).
 */
export const getPatientAnalysisHistory = query({
  args: {
    patientId: v.id("users"),
    limit: v.optional(v.number()),
    type: v.optional(v.union(v.literal("session"), v.literal("progress"))),
  },
  handler: async (ctx, { patientId, limit = 20, type }) => {
    const analyses = await ctx.db
      .query("horusAnalysisEmbeddings")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(limit * (type ? 2 : 1)); // Get more if filtering

    // Filter by type if specified
    const filtered = type
      ? analyses.filter((a) => a.type === type)
      : analyses;

    return filtered.slice(0, limit).map((a) => ({
      sessionId: a.sessionId,
      type: a.type as EmbeddingType,
      summaryText: a.summaryText,
      keyFindings: a.keyFindings,
      opiScore: a.opiScore,
      primaryDomain: a.primaryDomain,
      analyzedAt: a.analyzedAt,
    }));
  },
});

/**
 * Get analysis embedding by ID.
 */
export const getAnalysisEmbeddingById = query({
  args: { id: v.id("horusAnalysisEmbeddings") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

// ─────────────────────────────────────────────────────────────────
// Embedding Creation
// ─────────────────────────────────────────────────────────────────

/**
 * Save analysis or progress to vector DB.
 * Creates embedding from the summary and key findings.
 * Type: "session" for Phase 1 analysis, "progress" for Phase 2 progress report.
 */
export const saveAnalysisEmbedding = internalAction({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    type: v.union(v.literal("session"), v.literal("progress")),
    summaryText: v.string(),
    keyFindings: v.array(v.string()),
    opiScore: v.optional(v.number()),
    primaryDomain: v.optional(v.string()),
    analyzedAt: v.number(),
  },
  handler: async (ctx, args) => {
    // 1. Check if already exists (same session + type combo)
    const existing = await ctx.runQuery(
      internal.horus.vectordb.analysisSearch.getAnalysisEmbeddingBySessionAndType,
      { sessionId: args.sessionId, type: args.type }
    );

    // 2. Generate embedding from summary + key findings
    const textToEmbed = normalizeText(
      `${args.summaryText} ${args.keyFindings.join(" ")}`
    );

    const embeddingResult = await ctx.runAction(
      internal.horus.vectordb.embeddings.generateEmbedding,
      {
        text: textToEmbed,
        taskType: "RETRIEVAL_DOCUMENT",
      }
    );

    // 3. Update or insert
    if (existing) {
      await ctx.runMutation(internal.horus.vectordb.analysisSearch.updateAnalysisEmbedding, {
        id: existing._id,
        embedding: embeddingResult.embedding,
        summaryText: args.summaryText,
        keyFindings: args.keyFindings,
        opiScore: args.opiScore,
        primaryDomain: args.primaryDomain,
        embeddedAt: Date.now(),
      });
      return existing._id;
    }

    // 4. Insert new
    return ctx.runMutation(internal.horus.vectordb.analysisSearch.insertAnalysisEmbedding, {
      sessionId: args.sessionId,
      patientId: args.patientId,
      type: args.type,
      embedding: embeddingResult.embedding,
      summaryText: args.summaryText,
      keyFindings: args.keyFindings,
      opiScore: args.opiScore,
      primaryDomain: args.primaryDomain,
      analyzedAt: args.analyzedAt,
      embeddedAt: Date.now(),
    });
  },
});

/**
 * Get analysis embedding by session ID (returns first match).
 * @deprecated Use getAnalysisEmbeddingBySessionAndType for type-specific lookup.
 */
export const getAnalysisEmbeddingBySession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    return ctx.db
      .query("horusAnalysisEmbeddings")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
  },
});

/**
 * Get analysis embedding by session ID and type.
 */
export const getAnalysisEmbeddingBySessionAndType = query({
  args: {
    sessionId: v.string(),
    type: v.union(v.literal("session"), v.literal("progress")),
  },
  handler: async (ctx, { sessionId, type }) => {
    // Get all for session and filter by type
    const results = await ctx.db
      .query("horusAnalysisEmbeddings")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return results.find((r) => r.type === type) || null;
  },
});

/**
 * Insert new analysis embedding.
 */
export const insertAnalysisEmbedding = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    type: v.union(v.literal("session"), v.literal("progress")),
    embedding: v.array(v.float64()),
    summaryText: v.string(),
    keyFindings: v.array(v.string()),
    opiScore: v.optional(v.number()),
    primaryDomain: v.optional(v.string()),
    analyzedAt: v.number(),
    embeddedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("horusAnalysisEmbeddings", args);
  },
});

/**
 * Update existing analysis embedding.
 */
export const updateAnalysisEmbedding = internalMutation({
  args: {
    id: v.id("horusAnalysisEmbeddings"),
    embedding: v.array(v.float64()),
    summaryText: v.string(),
    keyFindings: v.array(v.string()),
    opiScore: v.optional(v.number()),
    primaryDomain: v.optional(v.string()),
    embeddedAt: v.number(),
  },
  handler: async (ctx, { id, ...updates }) => {
    await ctx.db.patch(id, updates);
    return id;
  },
});

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

/**
 * Extract key information from analysis output for embedding.
 * Called by the orchestrator after Phase 1 completes.
 *
 * Maps to actual AnalysisOutput type fields:
 * - insights[].title, insights[].content, insights[].domain
 * - correlativeInsights[].explanation
 * - benchmarks[].metricName, benchmarks[].percentile
 * - summary, strengths, weaknesses
 */
export function extractAnalysisSummaryForEmbedding(analysis: {
  insights?: Array<{ title: string; content: string; domain?: string; recommendations?: string[] }>;
  correlativeInsights?: Array<{ explanation: string }>;
  benchmarks?: Array<{ metricName: string; percentile: number }>;
  summary?: string;
  strengths?: string[];
  weaknesses?: string[];
}): { summaryText: string; keyFindings: string[]; primaryDomain?: string } {
  const keyFindings: string[] = [];
  const domains = new Map<string, number>();

  // Extract findings from insights (using actual field names)
  if (analysis.insights) {
    for (const insight of analysis.insights) {
      // Use title + content for richer context
      keyFindings.push(`${insight.title}: ${insight.content}`);
      // Track domain frequency
      if (insight.domain) {
        domains.set(insight.domain, (domains.get(insight.domain) || 0) + 1);
      }
      // Also extract recommendations if present
      if (insight.recommendations) {
        for (const rec of insight.recommendations) {
          keyFindings.push(rec);
        }
      }
    }
  }

  // Extract correlative insights
  if (analysis.correlativeInsights) {
    for (const corr of analysis.correlativeInsights) {
      keyFindings.push(corr.explanation);
    }
  }

  // Build summary text
  const summaryParts: string[] = [];

  // Use the analysis summary if available
  if (analysis.summary) {
    summaryParts.push(analysis.summary);
  }

  // Add strengths and weaknesses
  if (analysis.strengths?.length) {
    summaryParts.push(`Strengths: ${analysis.strengths.join(", ")}`);
  }
  if (analysis.weaknesses?.length) {
    summaryParts.push(`Weaknesses: ${analysis.weaknesses.join(", ")}`);
  }

  // Add benchmark summary
  if (analysis.benchmarks?.length) {
    const highPerformers = analysis.benchmarks
      .filter((b) => b.percentile >= 75)
      .map((b) => b.metricName);
    const lowPerformers = analysis.benchmarks
      .filter((b) => b.percentile <= 25)
      .map((b) => b.metricName);

    if (highPerformers.length) {
      summaryParts.push(`Strong metrics: ${highPerformers.join(", ")}`);
    }
    if (lowPerformers.length) {
      summaryParts.push(`Weak metrics: ${lowPerformers.join(", ")}`);
    }
  }

  // Find primary domain
  let primaryDomain: string | undefined;
  if (domains.size > 0) {
    primaryDomain = [...domains.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  // Ensure we have at least some text for embedding
  const finalSummary = summaryParts.length > 0
    ? summaryParts.join(". ")
    : "Session analysis completed";

  return {
    summaryText: finalSummary,
    keyFindings: keyFindings.slice(0, 10), // Limit to 10
    primaryDomain,
  };
}

/**
 * Extract key information from progress output for embedding.
 * Called by the orchestrator after Phase 2 completes.
 */
export function extractProgressSummaryForEmbedding(progress: {
  summary?: string;
  trends?: Array<{
    metricName: string;
    displayName: string;
    trend: "improving" | "stable" | "declining";
    isClinicallyMeaningful: boolean;
  }>;
  milestones?: Array<{
    title: string;
    description: string;
    type: string;
  }>;
  regressions?: Array<{
    metricName: string;
    declinePercentage: number;
    recommendations: string[];
  }>;
  correlations?: Array<{
    type: string;
    explanation: string;
  }>;
  asymmetryTrends?: Array<{
    displayName: string;
    isResolving: boolean;
  }>;
}): { summaryText: string; keyFindings: string[] } {
  const keyFindings: string[] = [];
  const summaryParts: string[] = [];

  // Add main summary
  if (progress.summary) {
    summaryParts.push(progress.summary);
  }

  // Extract clinically meaningful trends
  if (progress.trends) {
    const improving = progress.trends
      .filter((t) => t.trend === "improving" && t.isClinicallyMeaningful)
      .map((t) => t.displayName);
    const declining = progress.trends
      .filter((t) => t.trend === "declining" && t.isClinicallyMeaningful)
      .map((t) => t.displayName);

    if (improving.length) {
      const finding = `Improving: ${improving.join(", ")}`;
      keyFindings.push(finding);
      summaryParts.push(finding);
    }
    if (declining.length) {
      const finding = `Declining: ${declining.join(", ")}`;
      keyFindings.push(finding);
      summaryParts.push(finding);
    }
  }

  // Extract milestones
  if (progress.milestones) {
    for (const milestone of progress.milestones) {
      keyFindings.push(`${milestone.type}: ${milestone.title}`);
    }
  }

  // Extract regressions
  if (progress.regressions) {
    for (const regression of progress.regressions) {
      keyFindings.push(`Regression in ${regression.metricName}: ${regression.declinePercentage.toFixed(1)}% decline`);
    }
  }

  // Extract correlations
  if (progress.correlations) {
    for (const corr of progress.correlations) {
      keyFindings.push(`${corr.type}: ${corr.explanation}`);
    }
  }

  // Extract asymmetry resolution
  if (progress.asymmetryTrends) {
    const resolving = progress.asymmetryTrends
      .filter((a) => a.isResolving)
      .map((a) => a.displayName);
    if (resolving.length) {
      keyFindings.push(`Asymmetry resolving in: ${resolving.join(", ")}`);
    }
  }

  return {
    summaryText: summaryParts.join(". "),
    keyFindings: keyFindings.slice(0, 15), // Limit to 15 for progress (more data)
  };
}
