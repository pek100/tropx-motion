/**
 * Decomposition Agent Execution
 *
 * Runs the decomposition agent to extract patterns from metrics.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { SessionMetrics, DecompositionOutput, AgentExecutionResult } from "../types";
import {
  DECOMPOSITION_SYSTEM_PROMPT,
  buildDecompositionUserPrompt,
  parseDecompositionResponse,
  preDetectPatterns,
} from "../prompts/decomposition";
import { safeJSONParse, validateDecompositionOutput } from "../llm/parser";
import { DECOMPOSITION_RESPONSE_SCHEMA } from "../llm/schemas";

// ─────────────────────────────────────────────────────────────────
// Agent Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Run the decomposition agent.
 * Extracts patterns from session metrics.
 */
export const runDecomposition = action({
  args: {
    sessionId: v.string(),
    metrics: v.any(), // SessionMetrics
    previousMetrics: v.optional(v.any()), // SessionMetrics
  },
  handler: async (ctx, args): Promise<AgentExecutionResult<DecompositionOutput>> => {
    const startTime = Date.now();
    const metrics = args.metrics as SessionMetrics;
    const previousMetrics = args.previousMetrics as SessionMetrics | undefined;

    try {
      console.log("[runDecomposition] Starting for session:", args.sessionId);

      // 1. Pre-detect obvious patterns programmatically
      const preDetectedPatterns = preDetectPatterns(metrics, previousMetrics);
      console.log("[runDecomposition] Pre-detected patterns:", preDetectedPatterns.length);

      // 2. Build prompts
      const systemPrompt = DECOMPOSITION_SYSTEM_PROMPT;
      const userPrompt = buildDecompositionUserPrompt(metrics, previousMetrics);

      // 3. Add pre-detected patterns hint to prompt
      const enhancedUserPrompt = preDetectedPatterns.length > 0
        ? `${userPrompt}\n\n## Pre-detected Patterns (for reference)\n${JSON.stringify(preDetectedPatterns, null, 2)}\n\nYou may use, refine, or add to these patterns.`
        : userPrompt;

      // 4. Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt: enhancedUserPrompt,
        temperature: 0.2,
        maxTokens: 16384, // Gemini 2.5 Flash supports up to 65536
        responseSchema: DECOMPOSITION_RESPONSE_SCHEMA,
      });

      // 5. Parse response (structured output is already JSON)
      const parseResult = safeJSONParse<unknown>(llmResponse.text);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.error}`);
      }

      const validationResult = validateDecompositionOutput(
        parseResult.data,
        args.sessionId
      );

      if (!validationResult.success) {
        throw new Error(`Validation failed: ${validationResult.error}`);
      }

      // 6. Merge pre-detected patterns with LLM patterns
      const output = validationResult.data!;
      const mergedPatterns = mergePatterns(preDetectedPatterns, output.patterns);
      output.patterns = mergedPatterns;

      // Update pattern counts
      output.patternCounts = {
        threshold_violation: 0,
        asymmetry: 0,
        cross_metric_correlation: 0,
        temporal_pattern: 0,
        quality_flag: 0,
      };
      for (const p of output.patterns) {
        output.patternCounts[p.type]++;
      }

      // 7. Record token usage
      await ctx.runMutation(internal.horus.llm.usage.recordAgentUsage, {
        sessionId: args.sessionId,
        agent: "decomposition",
        usage: llmResponse.tokenUsage,
      });

      return {
        success: true,
        output,
        tokenUsage: llmResponse.tokenUsage,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[runDecomposition] Error:", {
        sessionId: args.sessionId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        error: errorMessage,
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
 * Merge pre-detected patterns with LLM patterns.
 * Avoids duplicates based on type + metrics combination.
 */
function mergePatterns(
  preDetected: DecompositionOutput["patterns"],
  llmPatterns: DecompositionOutput["patterns"]
): DecompositionOutput["patterns"] {
  const seen = new Set<string>();
  const result: DecompositionOutput["patterns"] = [];

  // Helper to create a dedup key
  const getKey = (p: DecompositionOutput["patterns"][0]) =>
    `${p.type}:${p.metrics.sort().join(",")}:${p.limbs?.sort().join(",") || ""}`;

  // Add pre-detected patterns first (they have programmatic accuracy)
  for (const p of preDetected) {
    const key = getKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }

  // Add LLM patterns that aren't duplicates
  for (const p of llmPatterns) {
    const key = getKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }

  return result;
}
