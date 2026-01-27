/**
 * Horus v2 Analysis Agent
 *
 * Expert clinical analyst that generates clinical sections from metrics.
 */

import { action } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import type { SessionMetrics } from "../../types";
import type { AnalysisAgentOutput, AgentResult, Section, KeyFinding, SpeculativeInsight } from "../types";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  ANALYSIS_RESPONSE_SCHEMA,
} from "../prompts/analysis";
import { safeJSONParse, extractJSON } from "../validation";

// ─────────────────────────────────────────────────────────────────
// Analysis Agent Action
// ─────────────────────────────────────────────────────────────────

/**
 * Run the Analysis Agent to generate clinical sections.
 */
export const runAnalysis = action({
  args: {
    sessionId: v.string(),
    metrics: v.any(), // SessionMetrics
  },
  handler: async (ctx, args): Promise<AgentResult<AnalysisAgentOutput>> => {
    const startTime = Date.now();
    const metrics = args.metrics as SessionMetrics;

    try {
      // Build prompts
      const systemPrompt = ANALYSIS_SYSTEM_PROMPT;
      const userPrompt = buildAnalysisUserPrompt(metrics);

      console.log("[Analysis Agent] Starting analysis for session:", args.sessionId);
      console.log("[Analysis Agent] Prompt length:", userPrompt.length);

      // Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt,
        temperature: 0.3, // Slightly creative for clinical reasoning
        maxTokens: 65535, // Gemini 2.5 Flash max - no truncation risk
        responseSchema: ANALYSIS_RESPONSE_SCHEMA,
      });

      console.log("[Analysis Agent] LLM response received:", {
        tokenUsage: llmResponse.tokenUsage,
        finishReason: llmResponse.finishReason,
        responseLength: llmResponse.text.length,
      });

      // Parse JSON response (Gemini's structured output already validates schema)
      const jsonText = extractJSON(llmResponse.text);
      const parseResult = safeJSONParse<{
        overallGrade: "A" | "B" | "C" | "D" | "F";
        radarScores: {
          flexibility: number;
          consistency: number;
          symmetry: number;
          smoothness: number;
          control: number;
        };
        keyFindings: KeyFinding[];
        clinicalImplications: string;
        sections: Section[];
        summary: string;
        strengths: string[];
        weaknesses: string[];
        recommendations: string[];
        speculativeInsights: SpeculativeInsight[];
      }>(jsonText);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.errors.join(", ")}`);
      }

      const output: AnalysisAgentOutput = {
        sessionId: args.sessionId,
        overallGrade: parseResult.data!.overallGrade,
        radarScores: parseResult.data!.radarScores,
        keyFindings: parseResult.data!.keyFindings,
        clinicalImplications: parseResult.data!.clinicalImplications,
        sections: parseResult.data!.sections,
        summary: parseResult.data!.summary,
        strengths: parseResult.data!.strengths,
        weaknesses: parseResult.data!.weaknesses,
        recommendations: parseResult.data!.recommendations,
        speculativeInsights: parseResult.data!.speculativeInsights,
        analyzedAt: Date.now(),
      };

      console.log("[Analysis Agent] Analysis complete:", {
        sectionCount: output.sections.length,
        needsResearchCount: output.sections.filter((s) => s.needsResearch).length,
        strengthsCount: output.strengths.length,
        weaknessesCount: output.weaknesses.length,
        speculativeInsightsCount: output.speculativeInsights.length,
        speculativeInsights: output.speculativeInsights,
      });

      return {
        success: true,
        output,
        tokenUsage: llmResponse.tokenUsage,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error("[Analysis Agent] Error:", error);

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
 * Get sections that need research enrichment.
 */
export function getSectionsNeedingResearch(sections: Section[]): Section[] {
  return sections.filter((section) => section.needsResearch);
}

/**
 * Get sections that don't need research (factual observations).
 */
export function getSectionsNotNeedingResearch(sections: Section[]): Section[] {
  return sections.filter((section) => !section.needsResearch);
}
