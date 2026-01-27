/**
 * Horus Actions
 *
 * External API call endpoints.
 */

import { action } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// ─────────────────────────────────────────────────────────────────
// Analysis Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Run analysis for a session (main entry point).
 */
export const analyzeSession = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    // Trigger the analysis pipeline
    return ctx.runAction(internal.horus.triggers.triggerAnalysis, { sessionId });
  },
});

/**
 * Retry a failed analysis.
 */
export const retryAnalysis = action({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    // Clear error first
    await ctx.runMutation(internal.horus.mutations.clearError, { sessionId });

    // Re-run full v2 pipeline
    return ctx.runAction(internal.horus.triggers.triggerAnalysis, { sessionId });
  },
});

// ─────────────────────────────────────────────────────────────────
// Research Cache Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Search the research cache.
 */
export const searchCache = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    minTier: v.optional(
      v.union(v.literal("S"), v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D"))
    ),
  },
  handler: async (ctx, { query, limit, minTier }) => {
    return ctx.runAction(internal.horus.vectordb.search.searchResearchCache, {
      query,
      limit,
      minTier,
    });
  },
});

/**
 * Pre-warm the research cache with common patterns.
 */
export const prewarmCache = action({
  args: {},
  handler: async (ctx) => {
    const commonPatterns = [
      "knee flexion deficit rehabilitation",
      "bilateral asymmetry lower extremity",
      "quadriceps strength imbalance",
      "range of motion limitation knee",
      "velocity deficit post-injury",
      "movement quality assessment",
      "neuromuscular control knee",
      "eccentric strength deficit",
      "jump landing mechanics",
      "bilateral coordination training",
    ];

    const results: { pattern: string; cached: boolean; error?: string }[] = [];

    for (const pattern of commonPatterns) {
      try {
        // Search to trigger potential caching
        await ctx.runAction(internal.horus.vectordb.search.searchResearchCache, {
          query: pattern,
          limit: 3,
        });
        results.push({ pattern, cached: true });
      } catch (error) {
        results.push({
          pattern,
          cached: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return results;
  },
});

// ─────────────────────────────────────────────────────────────────
// Utility Actions
// ─────────────────────────────────────────────────────────────────

/**
 * Test the Vertex AI connection.
 */
export const testVertexConnection = action({
  args: {},
  handler: async (ctx) => {
    try {
      const result = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt: "You are a test assistant.",
        userPrompt: "Say 'Hello from Horus!' and nothing else.",
        temperature: 0,
        maxTokens: 50,
      });

      return {
        success: true,
        response: result.text.trim(),
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Test embedding generation.
 */
export const testEmbedding = action({
  args: {
    text: v.optional(v.string()),
  },
  handler: async (ctx, { text = "Test embedding for Horus system" }) => {
    try {
      const result = await ctx.runAction(
        internal.horus.vectordb.embeddings.generateEmbedding,
        { text }
      );

      return {
        success: true,
        dimensions: result.embedding.length,
        textLength: result.textLength,
        sample: result.embedding.slice(0, 5),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});

/**
 * Get system health status.
 */
export const getSystemHealth = action({
  args: {},
  handler: async (ctx) => {
    const health = {
      vertexAI: false,
      embeddings: false,
      database: false,
      vectorSearch: false,
    };

    // Test Vertex AI
    try {
      const vertexTest = await ctx.runAction(internal.horus.actions.testVertexConnection, {});
      health.vertexAI = vertexTest.success;
    } catch {
      health.vertexAI = false;
    }

    // Test Embeddings
    try {
      const embeddingTest = await ctx.runAction(internal.horus.actions.testEmbedding, {});
      health.embeddings = embeddingTest.success;
    } catch {
      health.embeddings = false;
    }

    // Test Database (via cache stats)
    try {
      const cacheStats = await ctx.runQuery(
        internal.horus.vectordb.search.getCacheStats,
        {}
      );
      health.database = true;
      health.vectorSearch = cacheStats.totalEntries >= 0;
    } catch {
      health.database = false;
      health.vectorSearch = false;
    }

    return {
      healthy: Object.values(health).every(Boolean),
      components: health,
      timestamp: Date.now(),
    };
  },
});
