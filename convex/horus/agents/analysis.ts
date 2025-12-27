/**
 * Analysis Agent Execution
 *
 * Runs the analysis agent to generate clinical insights.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type {
  DetectedPattern,
  ResearchEvidence,
  SessionMetrics,
  AnalysisOutput,
  AgentExecutionResult,
} from "../types";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  parseAnalysisResponse,
  preComputeBenchmarks,
} from "../prompts/analysis";
import { safeJSONParse, validateAnalysisOutput } from "../llm/parser";
import { ANALYSIS_RESPONSE_SCHEMA } from "../llm/schemas";

// ─────────────────────────────────────────────────────────────────
// Agent Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Run the analysis agent.
 * Generates clinical insights from patterns and evidence.
 */
export const runAnalysis = action({
  args: {
    sessionId: v.string(),
    patterns: v.any(), // DetectedPattern[]
    evidenceByPattern: v.any(), // Record<string, ResearchEvidence[]>
    metrics: v.any(), // SessionMetrics
  },
  handler: async (ctx, args): Promise<AgentExecutionResult<AnalysisOutput>> => {
    const startTime = Date.now();
    const patterns = args.patterns as DetectedPattern[];
    const evidenceByPattern = args.evidenceByPattern as Record<string, ResearchEvidence[]>;
    const metrics = args.metrics as SessionMetrics;

    try {
      // 1. Pre-compute benchmarks for consistency
      const preComputedBenchmarks = preComputeBenchmarks(metrics);

      // 2. Build prompts
      const systemPrompt = ANALYSIS_SYSTEM_PROMPT;
      const userPrompt = buildAnalysisUserPrompt(patterns, evidenceByPattern, metrics);

      // 3. Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        maxTokens: 32768, // Analysis + visualization blocks need more tokens
        responseSchema: ANALYSIS_RESPONSE_SCHEMA,
      });

      // 4. Parse response (structured output is already JSON)
      const parseResult = safeJSONParse<unknown>(llmResponse.text);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.error}`);
      }

      // Debug logging for parsed data
      console.log("[runAnalysis] Parsed LLM response:", {
        sessionId: args.sessionId,
        hasVisualization: !!(parseResult.data as any)?.visualization,
        overallBlockCount: (parseResult.data as any)?.visualization?.overallBlocks?.length ?? 0,
        sessionBlockCount: (parseResult.data as any)?.visualization?.sessionBlocks?.length ?? 0,
        rawVisualizationKeys: Object.keys((parseResult.data as any)?.visualization || {}),
      });

      const validationResult = validateAnalysisOutput(parseResult.data, args.sessionId);

      if (!validationResult.success) {
        throw new Error(`Validation failed: ${validationResult.error}`);
      }

      const output = validationResult.data!;

      // Debug logging for validated output
      console.log("[runAnalysis] Validated output:", {
        sessionId: args.sessionId,
        hasVisualization: !!output.visualization,
        overallBlockCount: output.visualization?.overallBlocks?.length ?? 0,
        sessionBlockCount: output.visualization?.sessionBlocks?.length ?? 0,
        insightCount: output.insights?.length ?? 0,
      });

      // 5. Merge/validate benchmarks with pre-computed
      output.benchmarks = mergeBenchmarks(output.benchmarks, preComputedBenchmarks);

      // 6. Ensure minimum correlative insights
      if (output.correlativeInsights.length < 2) {
        // Auto-generate correlative insights if needed
        output.correlativeInsights = ensureMinCorrelativeInsights(
          output.insights,
          output.correlativeInsights
        );
      }

      // 7. Record token usage
      await ctx.runMutation(internal.horus.llm.usage.recordAgentUsage, {
        sessionId: args.sessionId,
        agent: "analysis",
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
 * Merge LLM benchmarks with pre-computed benchmarks.
 * Pre-computed values take precedence for numerical accuracy.
 */
function mergeBenchmarks(
  llmBenchmarks: AnalysisOutput["benchmarks"],
  preComputed: AnalysisOutput["benchmarks"]
): AnalysisOutput["benchmarks"] {
  const result: AnalysisOutput["benchmarks"] = [];
  const seen = new Set<string>();

  // Helper to create key
  const getKey = (b: AnalysisOutput["benchmarks"][0]) =>
    `${b.metricName}:${b.limb || "bilateral"}`;

  // Use pre-computed first (more accurate)
  for (const b of preComputed) {
    const key = getKey(b);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(b);
    }
  }

  // Add any LLM benchmarks for metrics we missed
  for (const b of llmBenchmarks) {
    const key = getKey(b);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(b);
    }
  }

  return result;
}

/**
 * Ensure minimum correlative insights exist.
 * Auto-generates if needed based on insight domains.
 */
function ensureMinCorrelativeInsights(
  insights: AnalysisOutput["insights"],
  existing: AnalysisOutput["correlativeInsights"]
): AnalysisOutput["correlativeInsights"] {
  if (existing.length >= 2) return existing;
  if (insights.length < 2) return existing;

  const result = [...existing];
  let autoId = 0;

  // Group insights by domain
  const byDomain = new Map<string, string[]>();
  for (const ins of insights) {
    const ids = byDomain.get(ins.domain) || [];
    ids.push(ins.id);
    byDomain.set(ins.domain, ids);
  }

  // Find related domains that commonly correlate
  const domainPairs: [string, string, string][] = [
    ["power", "range", "Power output typically correlates with range of motion capability"],
    ["symmetry", "power", "Asymmetry often affects power generation differently between limbs"],
    ["control", "power", "Movement control quality influences power efficiency"],
    ["range", "symmetry", "ROM differences between limbs contribute to asymmetry patterns"],
    ["timing", "symmetry", "Temporal coordination affects bilateral symmetry"],
  ];

  for (const [domain1, domain2, explanation] of domainPairs) {
    if (result.length >= 2) break;

    const ids1 = byDomain.get(domain1);
    const ids2 = byDomain.get(domain2);

    if (ids1?.length && ids2?.length) {
      // Check if this pair already exists
      const exists = result.some(
        (c) =>
          (c.primaryInsightId === ids1[0] && c.relatedInsightIds.includes(ids2[0])) ||
          (c.primaryInsightId === ids2[0] && c.relatedInsightIds.includes(ids1[0]))
      );

      if (!exists) {
        result.push({
          id: `auto-corr-${autoId++}`,
          primaryInsightId: ids1[0],
          relatedInsightIds: [ids2[0]],
          explanation,
          significance: "moderate",
        });
      }
    }
  }

  return result;
}
