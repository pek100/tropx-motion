/**
 * Horus v2 Pipeline Orchestrator
 *
 * Two-stage pipeline: Analysis Agent → Parallel Research Agents
 */

import { internalAction } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type {
  SessionMetrics,
  Section,
  EnrichedSection,
  V2PipelineOutput,
  TokenUsage,
  ResearchAgentOutput,
} from "./types";
import { aggregateTokenUsage } from "../llm/vertex";

// ─────────────────────────────────────────────────────────────────
// Main Pipeline Action
// ─────────────────────────────────────────────────────────────────

/**
 * Run the full v2 analysis pipeline.
 */
export const runPipeline = internalAction({
  args: {
    sessionId: v.string(),
    metrics: v.any(), // SessionMetrics
    patientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<V2PipelineOutput> => {
    const startTime = Date.now();
    const metrics = args.metrics as SessionMetrics;

    console.log("[Orchestrator] Starting v2 pipeline for session:", args.sessionId);

    // ─── Stage 1: Analysis Agent ───
    console.log("[Orchestrator] Stage 1: Running Analysis Agent");

    const analysisResult = await ctx.runAction(
      internal.horus.v2.agents.analysis.runAnalysis,
      {
        sessionId: args.sessionId,
        metrics,
      }
    );

    if (!analysisResult.success || !analysisResult.output) {
      throw new Error(`Analysis Agent failed: ${analysisResult.error}`);
    }

    const analysisOutput = analysisResult.output;
    console.log("[Orchestrator] Analysis complete:", {
      sections: analysisOutput.sections.length,
      needsResearch: analysisOutput.sections.filter((s: Section) => s.needsResearch).length,
      durationMs: analysisResult.durationMs,
    });

    // ─── Stage 2: Parallel Research Agents ───
    console.log("[Orchestrator] Stage 2: Running Research Agents in parallel");

    // Update status to researching
    await ctx.runMutation(internal.horus.v2.mutations.updatePipelineStatus, {
      sessionId: args.sessionId,
      status: "researching",
    });

    const sectionsNeedingResearch = analysisOutput.sections.filter((s: Section) => s.needsResearch);
    const sectionsNotNeedingResearch = analysisOutput.sections.filter((s: Section) => !s.needsResearch);

    // Run research agents in parallel with timeout
    const researchResults = await runResearchAgentsParallel(
      ctx,
      args.sessionId,
      sectionsNeedingResearch
    );

    // Collect results
    const enrichedSections: EnrichedSection[] = [];
    const failedEnrichments: string[] = [];
    const researchTokenUsages: TokenUsage[] = [];

    // Process research results
    for (const result of researchResults) {
      if (result.enrichedSection.enrichmentFailed) {
        failedEnrichments.push(result.sectionId);
      }
      enrichedSections.push(result.enrichedSection);
      researchTokenUsages.push(result.tokenUsage);
    }

    // Add sections that didn't need research (as-is, with minimal enrichment)
    for (const section of sectionsNotNeedingResearch) {
      const minimalEnrichment: EnrichedSection = {
        ...section,
        enrichedNarrative: section.clinicalNarrative,
        userExplanation: {
          summary: section.clinicalNarrative.slice(0, 200),
          whatItMeans: "This is a straightforward observation from the patient's movement data.",
          whyItMatters: "Understanding this helps track the patient's progress.",
        },
        citations: [],
        links: [],
        evidenceStrength: { level: "limited", notes: "No research enrichment needed" },
        wasContradicted: false,
        recommendation: section.recommendations[0] || "",
      };
      enrichedSections.push(minimalEnrichment);
    }

    // Sort enriched sections by original order
    const sectionOrder = new Map<string, number>(
      analysisOutput.sections.map((s: Section, i: number): [string, number] => [s.id, i])
    );
    enrichedSections.sort((a, b) => (sectionOrder.get(a.id) ?? 0) - (sectionOrder.get(b.id) ?? 0));

    // Calculate total token usage
    const totalTokenUsage = aggregateTokenUsage([
      analysisResult.tokenUsage,
      ...researchTokenUsages,
    ]);

    const completedAt = Date.now();
    const totalDurationMs = completedAt - startTime;

    console.log("[Orchestrator] Pipeline complete:", {
      totalSections: enrichedSections.length,
      failedEnrichments: failedEnrichments.length,
      totalDurationMs,
      tokenUsage: totalTokenUsage,
    });

    const output: V2PipelineOutput = {
      sessionId: args.sessionId,
      patientId: args.patientId,
      radarScores: analysisOutput.radarScores,
      keyFindings: analysisOutput.keyFindings,
      clinicalImplications: analysisOutput.clinicalImplications,
      sections: analysisOutput.sections,
      enrichedSections,
      summary: analysisOutput.summary,
      strengths: analysisOutput.strengths,
      weaknesses: analysisOutput.weaknesses,
      recommendations: analysisOutput.recommendations,
      failedEnrichments,
      tokenUsage: {
        analysis: analysisResult.tokenUsage,
        research: researchTokenUsages,
        total: totalTokenUsage,
      },
      totalDurationMs,
      startedAt: startTime,
      completedAt,
    };

    return output;
  },
});

// ─────────────────────────────────────────────────────────────────
// Parallel Research Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Run research agents in parallel.
 * Each agent handles its own errors and returns fallback content on failure.
 * No artificial timeout - let Convex's action timeout handle extreme cases.
 */
async function runResearchAgentsParallel(
  ctx: any,
  sessionId: string,
  sections: Section[]
): Promise<ResearchAgentOutput[]> {
  if (sections.length === 0) {
    return [];
  }

  console.log("[Orchestrator] Spawning", sections.length, "research agents");

  // Run all research agents in parallel - each handles its own errors
  const researchPromises = sections.map((section) =>
    ctx.runAction(internal.horus.v2.agents.research.enrichSection, {
      sessionId,
      section,
    })
  );

  // Wait for all to complete
  const results = await Promise.all(researchPromises);

  return results;
}


