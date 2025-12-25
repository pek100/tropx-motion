/**
 * Token Usage Tracking
 *
 * Tracks and aggregates LLM usage per session and per agent.
 */

import { mutation, query } from "../../_generated/server";
import { v } from "convex/values";
import type { AgentName, TokenUsage } from "../types";
import { VERTEX_CONFIG } from "./vertex";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SessionUsage {
  sessionId: string;
  byAgent: Partial<Record<AgentName, TokenUsage>>;
  total: TokenUsage;
  startedAt: number;
  completedAt?: number;
}

// ─────────────────────────────────────────────────────────────────
// Token Usage Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Record token usage for an agent in a session.
 */
export const recordAgentUsage = mutation({
  args: {
    sessionId: v.string(),
    agent: v.union(
      v.literal("decomposition"),
      v.literal("research"),
      v.literal("analysis"),
      v.literal("validator"),
      v.literal("progress")
    ),
    usage: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      totalTokens: v.number(),
      estimatedCost: v.float64(),
    }),
  },
  handler: async (ctx, { sessionId, agent, usage }) => {
    // Find existing analysis record
    const existing = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!existing) {
      throw new Error(`No Horus analysis found for session ${sessionId}`);
    }

    // Update token usage for this agent
    const currentTokenUsage = existing.tokenUsage || {};
    const updatedTokenUsage = {
      ...currentTokenUsage,
      [agent]: usage,
    };

    // Calculate new total
    let totalCost = 0;
    for (const agentUsage of Object.values(updatedTokenUsage)) {
      if (agentUsage) {
        totalCost += agentUsage.estimatedCost;
      }
    }

    await ctx.db.patch(existing._id, {
      tokenUsage: updatedTokenUsage,
      totalCost,
    });

    return { success: true, totalCost };
  },
});

// ─────────────────────────────────────────────────────────────────
// Token Usage Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get token usage for a session.
 */
export const getSessionUsage = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<SessionUsage | null> => {
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!analysis) return null;

    const byAgent = analysis.tokenUsage || {};

    // Calculate total
    let inputTokens = 0;
    let outputTokens = 0;

    for (const usage of Object.values(byAgent)) {
      if (usage) {
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
      }
    }

    return {
      sessionId,
      byAgent,
      total: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimatedCost: analysis.totalCost || 0,
      },
      startedAt: analysis.startedAt,
      completedAt: analysis.completedAt,
    };
  },
});

/**
 * Get aggregated usage statistics.
 */
export const getUsageStats = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, { startDate, endDate }) => {
    let analyses = await ctx.db.query("horusAnalyses").collect();

    // Filter by date range if provided
    if (startDate) {
      analyses = analyses.filter((a) => a.startedAt >= startDate);
    }
    if (endDate) {
      analyses = analyses.filter((a) => a.startedAt <= endDate);
    }

    // Aggregate stats
    const stats = {
      totalSessions: analyses.length,
      completedSessions: analyses.filter((a) => a.status === "complete").length,
      erroredSessions: analyses.filter((a) => a.status === "error").length,
      byAgent: {
        decomposition: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        research: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        analysis: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        validator: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
        progress: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      } as Record<AgentName, { calls: number; inputTokens: number; outputTokens: number; cost: number }>,
      totalTokens: 0,
      totalCost: 0,
      avgCostPerSession: 0,
    };

    for (const analysis of analyses) {
      if (analysis.tokenUsage) {
        for (const [agent, usage] of Object.entries(analysis.tokenUsage)) {
          if (usage) {
            const agentStats = stats.byAgent[agent as AgentName];
            agentStats.calls++;
            agentStats.inputTokens += usage.inputTokens;
            agentStats.outputTokens += usage.outputTokens;
            agentStats.cost += usage.estimatedCost;
            stats.totalTokens += usage.totalTokens;
          }
        }
      }
      stats.totalCost += analysis.totalCost || 0;
    }

    stats.avgCostPerSession =
      stats.totalSessions > 0 ? stats.totalCost / stats.totalSessions : 0;

    return stats;
  },
});

// ─────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Create empty token usage object.
 */
export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
  };
}

/**
 * Add two token usage objects.
 */
export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

/**
 * Estimate tokens from text (rough approximation).
 * ~4 characters per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate cost from text lengths.
 */
export function estimateCost(inputText: string, expectedOutputTokens: number): number {
  const inputTokens = estimateTokens(inputText);
  return (
    (inputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.INPUT_PER_1M +
    (expectedOutputTokens / 1_000_000) * VERTEX_CONFIG.PRICING.OUTPUT_PER_1M
  );
}

/**
 * Format cost for display.
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 1000).toFixed(2)}m`; // millicents
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Format token count for display.
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}
