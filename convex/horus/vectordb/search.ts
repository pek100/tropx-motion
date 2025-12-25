/**
 * Vector Search Functions
 *
 * Semantic search over the research cache using Convex vector search.
 */

import { action, mutation, query, internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { QualityTier } from "../metrics";
import type { Doc, Id } from "../../_generated/dataModel";
import { EMBEDDING_CONFIG, normalizeText } from "./embeddings";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SearchResult {
  _id: Id<"horusResearchCache">;
  tier: QualityTier;
  citation: string;
  url?: string;
  findings: string[];
  score: number;
}

// ─────────────────────────────────────────────────────────────────
// Search Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Search the research cache using semantic similarity.
 */
export const searchResearchCache = internalAction({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    minTier: v.optional(
      v.union(v.literal("S"), v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D"))
    ),
  },
  handler: async (ctx, { query, limit = 5, minTier }): Promise<SearchResult[]> => {
    // 1. Generate query embedding
    const embeddingResult = await ctx.runAction(
      internal.horus.vectordb.embeddings.generateEmbedding,
      {
        text: normalizeText(query),
        taskType: "RETRIEVAL_QUERY",
      }
    );

    // 2. Run vector search
    const searchResults = await ctx.runQuery(
      internal.horus.vectordb.search.vectorSearch,
      {
        embedding: embeddingResult.embedding,
        limit: limit * 2, // Get more to filter
        minTier,
      }
    );

    // 3. Filter and format results
    return searchResults.slice(0, limit);
  },
});

/**
 * Internal vector search query.
 */
export const vectorSearch = query({
  args: {
    embedding: v.array(v.float64()),
    limit: v.number(),
    minTier: v.optional(
      v.union(v.literal("S"), v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D"))
    ),
  },
  handler: async (ctx, { embedding, limit, minTier }): Promise<SearchResult[]> => {
    // Build filter based on tier
    const tierOrder: QualityTier[] = ["S", "A", "B", "C", "D"];
    const minTierIndex = minTier ? tierOrder.indexOf(minTier) : tierOrder.length - 1;
    const allowedTiers = tierOrder.slice(0, minTierIndex + 1);

    // Vector search with tier filter
    const results = await ctx.db
      .query("horusResearchCache")
      .withIndex("by_embedding", (q) =>
        q.eq("embedding", embedding as unknown as number[])
      )
      .take(limit * 3);

    // Manual filtering since Convex vector search has limited filter support
    const filtered = results
      .filter((r) => allowedTiers.includes(r.tier as QualityTier))
      .slice(0, limit);

    return filtered.map((r) => ({
      _id: r._id,
      tier: r.tier as QualityTier,
      citation: r.citation,
      url: r.url,
      findings: r.findings,
      score: r.relevanceScore,
    }));
  },
});

/**
 * Alternative: Use native vector search (preferred when available).
 */
export const nativeVectorSearch = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query, limit = 5 }): Promise<SearchResult[]> => {
    // Generate embedding
    const embeddingResult = await ctx.runAction(
      internal.horus.vectordb.embeddings.generateEmbedding,
      {
        text: normalizeText(query),
        taskType: "RETRIEVAL_QUERY",
      }
    );

    // Use Convex's native vector search
    const results = await ctx.vectorSearch("horusResearchCache", "by_embedding", {
      vector: embeddingResult.embedding,
      limit,
    });

    // Fetch full documents
    const docs = await Promise.all(
      results.map(async (r) => {
        const doc = await ctx.runQuery(internal.horus.vectordb.search.getById, {
          id: r._id,
        });
        return doc ? { ...doc, score: r._score } : null;
      })
    );

    return docs
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .map((d) => ({
        _id: d._id,
        tier: d.tier as QualityTier,
        citation: d.citation,
        url: d.url,
        findings: d.findings,
        score: d.score,
      }));
  },
});

/**
 * Get cache entry by ID.
 */
export const getById = query({
  args: { id: v.id("horusResearchCache") },
  handler: async (ctx, { id }) => {
    return ctx.db.get(id);
  },
});

// ─────────────────────────────────────────────────────────────────
// Cache Management
// ─────────────────────────────────────────────────────────────────

/**
 * Save a new entry to the research cache.
 */
export const saveToResearchCache = internalAction({
  args: {
    searchTerms: v.array(v.string()),
    tier: v.union(v.literal("S"), v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D")),
    citation: v.string(),
    url: v.optional(v.string()),
    findings: v.array(v.string()),
    relevanceScore: v.number(),
  },
  handler: async (ctx, args) => {
    // Generate embedding from search terms and citation
    const textToEmbed = normalizeText(
      `${args.searchTerms.join(" ")} ${args.citation} ${args.findings.join(" ")}`
    );

    const embeddingResult = await ctx.runAction(
      internal.horus.vectordb.embeddings.generateEmbedding,
      {
        text: textToEmbed,
        taskType: "RETRIEVAL_DOCUMENT",
      }
    );

    // Check for duplicate
    const existingResults = await ctx.runQuery(
      internal.horus.vectordb.search.findByCitation,
      { citation: args.citation }
    );

    if (existingResults.length > 0) {
      // Update hit count
      await ctx.runMutation(internal.horus.vectordb.search.incrementHitCount, {
        id: existingResults[0]._id,
      });
      return existingResults[0]._id;
    }

    // Save new entry
    return ctx.runMutation(internal.horus.vectordb.search.insertCacheEntry, {
      embedding: embeddingResult.embedding,
      searchTerms: args.searchTerms,
      tier: args.tier,
      citation: args.citation,
      url: args.url,
      findings: args.findings,
      relevanceScore: args.relevanceScore,
    });
  },
});

/**
 * Find cache entries by citation.
 */
export const findByCitation = query({
  args: { citation: v.string() },
  handler: async (ctx, { citation }) => {
    return ctx.db
      .query("horusResearchCache")
      .filter((q) => q.eq(q.field("citation"), citation))
      .take(1);
  },
});

/**
 * Insert new cache entry.
 */
export const insertCacheEntry = mutation({
  args: {
    embedding: v.array(v.float64()),
    searchTerms: v.array(v.string()),
    tier: v.union(v.literal("S"), v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D")),
    citation: v.string(),
    url: v.optional(v.string()),
    findings: v.array(v.string()),
    relevanceScore: v.number(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("horusResearchCache", {
      ...args,
      cachedAt: Date.now(),
      hitCount: 0,
    });
  },
});

/**
 * Increment hit count for a cache entry.
 */
export const incrementHitCount = mutation({
  args: { id: v.id("horusResearchCache") },
  handler: async (ctx, { id }) => {
    const entry = await ctx.db.get(id);
    if (entry) {
      await ctx.db.patch(id, { hitCount: entry.hitCount + 1 });
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Cache Statistics
// ─────────────────────────────────────────────────────────────────

/**
 * Get cache statistics.
 */
export const getCacheStats = query({
  args: {},
  handler: async (ctx) => {
    const allEntries = await ctx.db.query("horusResearchCache").collect();

    const stats = {
      totalEntries: allEntries.length,
      byTier: { S: 0, A: 0, B: 0, C: 0, D: 0 } as Record<QualityTier, number>,
      totalHits: 0,
      avgRelevanceScore: 0,
      oldestEntry: null as number | null,
      newestEntry: null as number | null,
    };

    for (const entry of allEntries) {
      stats.byTier[entry.tier as QualityTier]++;
      stats.totalHits += entry.hitCount;
      stats.avgRelevanceScore += entry.relevanceScore;

      if (stats.oldestEntry === null || entry.cachedAt < stats.oldestEntry) {
        stats.oldestEntry = entry.cachedAt;
      }
      if (stats.newestEntry === null || entry.cachedAt > stats.newestEntry) {
        stats.newestEntry = entry.cachedAt;
      }
    }

    if (allEntries.length > 0) {
      stats.avgRelevanceScore /= allEntries.length;
    }

    return stats;
  },
});

/**
 * Clean up old/unused cache entries.
 */
export const pruneCache = mutation({
  args: {
    maxAge: v.optional(v.number()), // Max age in ms
    minHits: v.optional(v.number()), // Minimum hit count to keep
    maxEntries: v.optional(v.number()), // Max total entries
  },
  handler: async (ctx, { maxAge, minHits = 0, maxEntries }) => {
    const now = Date.now();
    let entries = await ctx.db.query("horusResearchCache").collect();
    let deleted = 0;

    // Filter by age
    if (maxAge) {
      const oldEntries = entries.filter((e) => now - e.cachedAt > maxAge);
      for (const entry of oldEntries) {
        await ctx.db.delete(entry._id);
        deleted++;
      }
      entries = entries.filter((e) => now - e.cachedAt <= maxAge);
    }

    // Filter by hits
    if (minHits > 0) {
      const lowHitEntries = entries.filter((e) => e.hitCount < minHits);
      for (const entry of lowHitEntries) {
        await ctx.db.delete(entry._id);
        deleted++;
      }
      entries = entries.filter((e) => e.hitCount >= minHits);
    }

    // Enforce max entries (keep highest relevance)
    if (maxEntries && entries.length > maxEntries) {
      entries.sort((a, b) => b.relevanceScore - a.relevanceScore);
      const toDelete = entries.slice(maxEntries);
      for (const entry of toDelete) {
        await ctx.db.delete(entry._id);
        deleted++;
      }
    }

    return { deleted, remaining: entries.length - deleted };
  },
});
