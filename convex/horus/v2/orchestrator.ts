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
  CrossAnalysisResult,
} from "./types";
import type { CrossAnalysisContext } from "../crossAnalysis/types";
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
        evidenceStrength: { level: "minimal", notes: "No research enrichment needed" },
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

    // ─── Stage 3: Cross-Analysis Agent (Optional) ───
    let crossAnalysis: CrossAnalysisResult | undefined = undefined;
    let crossAnalysisTokenUsage: TokenUsage | undefined = undefined;

    if (args.patientId) {
      try {
        // Update status to cross-analyzing
        await ctx.runMutation(internal.horus.v2.mutations.updatePipelineStatus, {
          sessionId: args.sessionId,
          status: "cross_analyzing",
        });

        console.log("[Orchestrator] Stage 3: Running Cross-Analysis Agent");

        // CRITICAL: Use recording date, not current time, to filter historical sessions
        // This ensures the AI is "blind" to future data relative to this recording
        const currentRecordingDate = metrics.recordedAt;
        console.log("[Orchestrator] Recording date for cross-analysis:", new Date(currentRecordingDate).toISOString());

        // Ensure vector exists and has correct recordedAt (fixes vectors with wrong dates)
        await ctx.runMutation(internal.horus.crossAnalysis.mutations.saveMetricsVector, {
          sessionId: args.sessionId,
          patientId: args.patientId,
          metrics,
          recordedAt: currentRecordingDate,
        });

        // Check if enough history exists BEFORE this recording date
        const historyCount = await ctx.runQuery(
          internal.horus.crossAnalysis.queries.getPatientSessionCount,
          { patientId: args.patientId, beforeDate: currentRecordingDate }
        );

        console.log("[Orchestrator] Patient history count (before recording date):", historyCount);

        // Run cross-analysis with at least 1 prior session (AI will rate confidence based on data amount)
        if (historyCount >= 1) {
          // Build context for cross-analysis
          const context = await ctx.runQuery(
            internal.horus.crossAnalysis.queries.buildCrossAnalysisContext,
            {
              sessionId: args.sessionId,
              patientId: args.patientId,
              currentMetrics: metrics,
              maxHistoricalSessions: 10, // Limit for token budget
            }
          ) as CrossAnalysisContext | null;

          if (context) {
            // Add speculative insights from analysis to cross-analysis context
            const speculativeInsights = analysisOutput.speculativeInsights?.map((si: { label: string; description: string }) => ({
              label: si.label,
              description: si.description,
            })) ?? [];

            const contextWithInsights = {
              ...context,
              speculativeInsights,
            };

            // Run Cross-Analysis Agent
            const result = await ctx.runAction(
              internal.horus.v2.agents.crossAnalysis.analyze,
              { context: contextWithInsights }
            );

            if (result.success && result.output) {
              // Fix the patientId in the output
              crossAnalysis = {
                ...result.output,
                patientId: args.patientId,
              };
              crossAnalysisTokenUsage = result.tokenUsage;
              console.log("[Orchestrator] Cross-Analysis complete:", {
                trends: result.output.trendInsights.length,
                patterns: result.output.recurringPatterns.length,
                confidence: result.output.analysisConfidence,
              });
            } else {
              console.warn("[Orchestrator] Cross-Analysis failed:", result.error);
            }
          } else {
            console.log("[Orchestrator] No baseline available for cross-analysis");
          }
        } else {
          // Return minimal output for insufficient history
          crossAnalysis = {
            sessionId: args.sessionId,
            patientId: args.patientId,
            insufficientHistory: true,
            sessionsAvailable: historyCount,
            sessionsRequired: 2,
            message: historyCount === 0
              ? "This is the patient's first session. Cross-analysis will be available after more sessions."
              : "Cross-analysis requires at least 2 previous sessions with metrics.",
            analyzedAt: Date.now(),
          };
          console.log("[Orchestrator] Insufficient history for cross-analysis:", historyCount);
        }
      } catch (error) {
        // Cross-Analysis failure is NON-FATAL - pipeline continues
        console.error("[Orchestrator] Cross-Analysis failed (non-fatal):", error);
        // Don't set crossAnalysis, it will remain undefined
      }
    }

    // Calculate total token usage (including cross-analysis if available)
    const allTokenUsages = [analysisResult.tokenUsage, ...researchTokenUsages];
    if (crossAnalysisTokenUsage) {
      allTokenUsages.push(crossAnalysisTokenUsage);
    }
    const totalTokenUsage = aggregateTokenUsage(allTokenUsages);

    const completedAt = Date.now();
    const totalDurationMs = completedAt - startTime;

    console.log("[Orchestrator] Pipeline complete:", {
      totalSections: enrichedSections.length,
      failedEnrichments: failedEnrichments.length,
      hasCrossAnalysis: !!crossAnalysis,
      totalDurationMs,
      tokenUsage: totalTokenUsage,
    });

    const output: V2PipelineOutput = {
      sessionId: args.sessionId,
      patientId: args.patientId,
      overallGrade: analysisOutput.overallGrade,
      radarScores: analysisOutput.radarScores,
      keyFindings: analysisOutput.keyFindings,
      clinicalImplications: analysisOutput.clinicalImplications,
      sections: analysisOutput.sections,
      enrichedSections,
      summary: analysisOutput.summary,
      strengths: analysisOutput.strengths,
      weaknesses: analysisOutput.weaknesses,
      recommendations: analysisOutput.recommendations,
      speculativeInsights: analysisOutput.speculativeInsights,
      failedEnrichments,
      crossAnalysis,
      tokenUsage: {
        analysis: analysisResult.tokenUsage,
        research: researchTokenUsages,
        crossAnalysis: crossAnalysisTokenUsage,
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


