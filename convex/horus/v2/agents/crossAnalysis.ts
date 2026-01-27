/**
 * Horus v2 Cross-Analysis Agent
 *
 * Analyzes patterns across a patient's historical sessions
 * to identify trends, recurring patterns, and baseline comparisons.
 */

import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import type {
  CrossAnalysisContextWithClusters,
  CrossAnalysisOutput,
  CrossAnalysisAgentResult,
  TrendInsight,
  RecurringPattern,
  BaselineComparison,
  NotableSession,
  RefinedInsight,
} from "../../crossAnalysis/types";
import {
  CROSS_ANALYSIS_SYSTEM_PROMPT,
  buildCrossAnalysisUserPrompt,
  CROSS_ANALYSIS_RESPONSE_SCHEMA,
} from "../prompts/crossAnalysis";
import { safeJSONParse, extractJSON } from "../validation";

// ─────────────────────────────────────────────────────────────────
// Cross-Analysis Agent Action
// ─────────────────────────────────────────────────────────────────

/**
 * Run the Cross-Analysis Agent to analyze patient history.
 */
export const analyze = internalAction({
  args: {
    context: v.any(), // CrossAnalysisContext
  },
  handler: async (ctx, args): Promise<CrossAnalysisAgentResult> => {
    const startTime = Date.now();
    const context = args.context as CrossAnalysisContextWithClusters;

    try {
      // Build prompts
      const systemPrompt = CROSS_ANALYSIS_SYSTEM_PROMPT;
      const userPrompt = buildCrossAnalysisUserPrompt(context);

      console.log("[Cross-Analysis Agent] Starting analysis for session:", context.currentSession.sessionId);
      console.log("[Cross-Analysis Agent] Historical sessions:", context.recentHistory.length);
      console.log("[Cross-Analysis Agent] Baseline sessions:", context.baseline.sessionCount);
      if (context.clusterAnalysis) {
        console.log("[Cross-Analysis Agent] Cluster analysis:", {
          clusters: context.clusterAnalysis.clusters.length,
          dataQuality: context.clusterAnalysis.dataQuality,
          currentCluster: context.clusterAnalysis.currentSessionCluster?.label,
        });
      }

      // Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt,
        temperature: 0.2, // Lower temperature for more consistent analysis
        maxTokens: 8192, // Reasonable limit for cross-analysis output
        responseSchema: CROSS_ANALYSIS_RESPONSE_SCHEMA,
      });

      console.log("[Cross-Analysis Agent] LLM response received:", {
        tokenUsage: llmResponse.tokenUsage,
        finishReason: llmResponse.finishReason,
        responseLength: llmResponse.text.length,
      });

      // Parse JSON response
      const jsonText = extractJSON(llmResponse.text);
      const parseResult = safeJSONParse<{
        trendInsights: TrendInsight[];
        recurringPatterns: RecurringPattern[];
        baselineComparison: BaselineComparison;
        notableSessions: NotableSession[];
        refinedInsights: RefinedInsight[];
        summary: string;
        analysisConfidence: "high" | "moderate" | "low";
      }>(jsonText);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.errors.join(", ")}`);
      }

      const parsed = parseResult.data!;

      // Build output
      const output: CrossAnalysisOutput = {
        sessionId: context.currentSession.sessionId,
        patientId: context.currentSession.sessionId as any, // Will be set correctly in orchestrator
        trendInsights: parsed.trendInsights,
        recurringPatterns: parsed.recurringPatterns,
        baselineComparison: parsed.baselineComparison,
        notableSessions: parsed.notableSessions,
        refinedInsights: parsed.refinedInsights || [],
        summary: parsed.summary,
        analysisConfidence: parsed.analysisConfidence,
        sessionsAnalyzed: context.baseline.sessionCount,
        dateRangeDays: calculateDateRangeDays(context.recentHistory),
        analyzedAt: Date.now(),
      };

      console.log("[Cross-Analysis Agent] Analysis complete:", {
        trendCount: output.trendInsights.length,
        patternCount: output.recurringPatterns.length,
        refinedInsightsCount: output.refinedInsights.length,
        confidence: output.analysisConfidence,
      });

      return {
        success: true,
        output,
        tokenUsage: llmResponse.tokenUsage,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error("[Cross-Analysis Agent] Error:", error);

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
 * Calculate date range in days from historical sessions.
 */
function calculateDateRangeDays(
  history: Array<{ date: number }>
): number {
  if (history.length === 0) return 0;

  const dates = history.map((h) => h.date);
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);

  return Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
}
