/**
 * Progress Agent Execution
 *
 * Runs the progress agent for longitudinal analysis.
 * Enhanced with Phase 1 context and historical analysis embeddings.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { SessionMetrics, ProgressOutput, AgentExecutionResult } from "../types";
import {
  PROGRESS_SYSTEM_PROMPT,
  buildProgressUserPrompt,
  buildEnhancedProgressUserPrompt,
  parseProgressResponse,
  preComputeTrends,
  PROGRESS_CONFIG,
} from "../prompts/progress";
import { safeJSONParse, validateProgressOutput } from "../llm/parser";
import { PROGRESS_RESPONSE_SCHEMA } from "../llm/schemas";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface HistoricalAnalysis {
  sessionId: string;
  summaryText: string;
  keyFindings: string[];
  opiScore?: number;
}

// ─────────────────────────────────────────────────────────────────
// Agent Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Run the progress agent.
 * Analyzes longitudinal trends across sessions.
 * Now enhanced with Phase 1 context and vector DB historical analyses.
 */
export const runProgress = action({
  args: {
    sessionId: v.string(),
    currentMetrics: v.any(), // SessionMetrics
    historicalSessions: v.any(), // SessionMetrics[]
    patientId: v.id("users"),
    // Enhanced context from Phase 1 (optional for backward compatibility)
    phase1Summary: v.optional(v.string()),
    phase1Strengths: v.optional(v.array(v.string())),
    phase1Weaknesses: v.optional(v.array(v.string())),
    historicalAnalyses: v.optional(v.any()), // HistoricalAnalysis[]
  },
  handler: async (ctx, args): Promise<AgentExecutionResult<ProgressOutput>> => {
    const startTime = Date.now();
    const currentMetrics = args.currentMetrics as SessionMetrics;
    const historicalSessions = args.historicalSessions as SessionMetrics[];
    const patientId = args.patientId as Id<"users">;
    const historicalAnalyses = (args.historicalAnalyses as HistoricalAnalysis[]) || [];

    try {
      // Check minimum sessions
      if (historicalSessions.length < PROGRESS_CONFIG.MIN_SESSIONS_FOR_TREND - 1) {
        // Not enough history for meaningful analysis
        const emptyOutput: ProgressOutput = {
          sessionId: args.sessionId,
          patientId,
          trends: [],
          milestones: [],
          regressions: [],
          projections: [],
          summary: "Insufficient session history for progress analysis. Continue tracking to build baseline.",
          sessionsAnalyzed: 1,
          dateRange: {
            start: currentMetrics.recordedAt,
            end: currentMetrics.recordedAt,
          },
          analyzedAt: Date.now(),
        };

        return {
          success: true,
          output: emptyOutput,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          durationMs: Date.now() - startTime,
        };
      }

      // 1. Pre-compute trends programmatically
      const preComputedTrends = preComputeTrends(currentMetrics, historicalSessions);

      // 2. Build prompts (use enhanced prompt if we have Phase 1 context)
      const systemPrompt = PROGRESS_SYSTEM_PROMPT;
      const hasPhase1Context = args.phase1Summary || historicalAnalyses.length > 0;

      const userPrompt = hasPhase1Context
        ? buildEnhancedProgressUserPrompt(
            currentMetrics,
            historicalSessions,
            patientId,
            {
              summary: args.phase1Summary,
              strengths: args.phase1Strengths,
              weaknesses: args.phase1Weaknesses,
            },
            historicalAnalyses
          )
        : buildProgressUserPrompt(
            currentMetrics,
            historicalSessions,
            patientId
          );

      // 3. Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        maxTokens: 16384, // Gemini 2.5 Flash supports up to 65536
        responseSchema: PROGRESS_RESPONSE_SCHEMA,
      });

      // 4. Parse response (structured output is already JSON)
      const parseResult = safeJSONParse<unknown>(llmResponse.text);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.error}`);
      }

      const validationResult = validateProgressOutput(parseResult.data, args.sessionId);

      if (!validationResult.success) {
        throw new Error(`Validation failed: ${validationResult.error}`);
      }

      // 5. Add patientId to output
      const output: ProgressOutput = {
        ...validationResult.data!,
        patientId,
      };

      // 6. Merge pre-computed trends with LLM trends
      output.trends = mergeTrends(preComputedTrends, output.trends);

      // 7. Auto-detect milestones from trends
      const autoMilestones = detectMilestones(output.trends, currentMetrics);
      output.milestones = mergeMilestones(autoMilestones, output.milestones);

      // 8. Record token usage
      await ctx.runMutation(internal.horus.llm.usage.recordAgentUsage, {
        sessionId: args.sessionId,
        agent: "progress",
        usage: llmResponse.tokenUsage,
      });

      return {
        success: true,
        output,
        tokenUsage: llmResponse.tokenUsage,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
        durationMs: Date.now() - startTime,
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Merge pre-computed trends with LLM trends.
 * Pre-computed values take precedence for numerical accuracy.
 */
function mergeTrends(
  preComputed: ProgressOutput["trends"],
  llmTrends: ProgressOutput["trends"]
): ProgressOutput["trends"] {
  const result: ProgressOutput["trends"] = [];
  const seen = new Set<string>();

  const getKey = (t: ProgressOutput["trends"][0]) =>
    `${t.metricName}:${t.limb || "bilateral"}`;

  // Pre-computed first
  for (const t of preComputed) {
    const key = getKey(t);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }

  // LLM trends for any we missed
  for (const t of llmTrends) {
    const key = getKey(t);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(t);
    }
  }

  return result;
}

/**
 * Auto-detect milestones from trend data.
 */
function detectMilestones(
  trends: ProgressOutput["trends"],
  currentMetrics: SessionMetrics
): ProgressOutput["milestones"] {
  const milestones: ProgressOutput["milestones"] = [];
  let milestoneId = 0;

  for (const trend of trends) {
    // Personal best detection
    if (
      trend.trend === "improving" &&
      trend.isClinicallyMeaningful &&
      trend.currentValue > trend.baselineValue
    ) {
      // Check if this is likely a personal best
      const improvement = Math.abs(trend.changeFromBaseline);
      if (improvement >= 20) {
        milestones.push({
          id: `auto-milestone-${milestoneId++}`,
          type: "personal_best",
          title: `${trend.displayName} Personal Best`,
          description: `${trend.limb ? `${trend.limb}: ` : ""}${trend.displayName} reached ${trend.currentValue.toFixed(1)}, a ${improvement.toFixed(0)}% improvement from baseline.`,
          achievedAt: currentMetrics.recordedAt,
          metrics: [trend.metricName],
          celebrationLevel: improvement >= 30 ? "major" : "minor",
        });
      }
    }

    // MCID improvement milestone
    if (trend.isClinicallyMeaningful && trend.trend === "improving") {
      milestones.push({
        id: `auto-milestone-${milestoneId++}`,
        type: "mcid_improvement",
        title: `Clinically Meaningful ${trend.displayName} Improvement`,
        description: `${trend.limb ? `${trend.limb}: ` : ""}${trend.displayName} showed clinically significant improvement of ${Math.abs(trend.changeFromPrevious).toFixed(1)}%.`,
        achievedAt: currentMetrics.recordedAt,
        metrics: [trend.metricName],
        celebrationLevel: "minor",
      });
    }
  }

  return milestones;
}

/**
 * Merge auto-detected milestones with LLM milestones.
 */
function mergeMilestones(
  auto: ProgressOutput["milestones"],
  llm: ProgressOutput["milestones"]
): ProgressOutput["milestones"] {
  const result: ProgressOutput["milestones"] = [];
  const seen = new Set<string>();

  const getKey = (m: ProgressOutput["milestones"][0]) =>
    `${m.type}:${m.metrics.sort().join(",")}`;

  // Auto first
  for (const m of auto) {
    const key = getKey(m);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(m);
    }
  }

  // LLM milestones
  for (const m of llm) {
    const key = getKey(m);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(m);
    }
  }

  // Sort by celebration level (major first)
  result.sort((a, b) => {
    if (a.celebrationLevel === "major" && b.celebrationLevel !== "major") return -1;
    if (a.celebrationLevel !== "major" && b.celebrationLevel === "major") return 1;
    return 0;
  });

  return result;
}
