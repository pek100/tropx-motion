/**
 * Unified Horus Pipeline Orchestrator
 *
 * Two-phase analysis architecture:
 * Phase 1: Session Analysis (no vector DB access)
 *   - Decomposition → Research → Analysis → Validator
 *   - Generates insights, visualization blocks, benchmarks
 *   - Saves analysis embedding to vector DB after completion
 *
 * Phase 2: Progress Analysis (WITH vector DB access + Phase 1 context)
 *   - Searches historical analyses via vector DB
 *   - Analyzes longitudinal trends
 *   - Has full context from Phase 1
 */

import { action, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type {
  SessionMetrics,
  PipelineStatus,
  AgentName,
  DecompositionOutput,
  ResearchOutput,
  AnalysisOutput,
  ValidatorOutput,
  ProgressOutput,
  TokenUsage,
} from "./types";
import { VALIDATION_RULES } from "./prompts/validator";
import {
  extractAnalysisSummaryForEmbedding,
  extractProgressSummaryForEmbedding,
} from "./vectordb/analysisSearch";

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

export const UNIFIED_PIPELINE_CONFIG = {
  MAX_VALIDATION_RETRIES: VALIDATION_RULES.MAX_REVISIONS,
  TIMEOUT_MS: 300000,
  MIN_SESSIONS_FOR_PROGRESS: 2,
};

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface UnifiedPipelineResult {
  success: boolean;
  status: PipelineStatus;
  analysis?: AnalysisOutput;
  progress?: ProgressOutput;
  error?: {
    agent: AgentName;
    message: string;
    retryable: boolean;
  };
  totalTokens: number;
  totalCost: number;
  durationMs: number;
}

interface Phase1Context {
  decomposition: DecompositionOutput;
  research: ResearchOutput;
  analysis: AnalysisOutput;
  validation: ValidatorOutput;
  metrics: SessionMetrics;
}

// ─────────────────────────────────────────────────────────────────
// Main Unified Pipeline
// ─────────────────────────────────────────────────────────────────

/**
 * Run the unified Horus analysis pipeline with two phases.
 */
export const runUnifiedPipeline = action({
  args: {
    sessionId: v.string(),
    metrics: v.any(), // SessionMetrics
    historicalSessions: v.optional(v.any()), // SessionMetrics[]
    patientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<UnifiedPipelineResult> => {
    const startTime = Date.now();
    const metrics = args.metrics as SessionMetrics;
    const historicalSessions = (args.historicalSessions as SessionMetrics[]) || [];

    let totalTokens = 0;
    let totalCost = 0;

    const addUsage = (usage: TokenUsage) => {
      totalTokens += usage.totalTokens;
      totalCost += usage.estimatedCost;
    };

    try {
      // 1. Initialize pipeline status
      await ctx.runMutation(internal.horus.orchestrator.initializePipeline, {
        sessionId: args.sessionId,
        patientId: args.patientId,
      });

      // 1.1 Clear any existing chat history (new analysis invalidates old chat context)
      await ctx.runMutation(internal.horus.chat.clearHistoryInternal, {
        sessionId: args.sessionId,
      });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1: Session Analysis (No Vector DB)
      // ═══════════════════════════════════════════════════════════════

      // Phase 1.1: Decomposition Agent
      await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
        sessionId: args.sessionId,
        status: "decomposition",
        currentAgent: "decomposition",
      });

      const decompResult = await ctx.runAction(
        internal.horus.agents.decomposition.runDecomposition,
        {
          sessionId: args.sessionId,
          metrics,
          previousMetrics: historicalSessions.length > 0
            ? historicalSessions[historicalSessions.length - 1]
            : undefined,
        }
      );

      if (!decompResult.success || !decompResult.output) {
        throw new PipelineError("decomposition", decompResult.error || "Unknown error", true);
      }
      addUsage(decompResult.tokenUsage);
      const decomposition = decompResult.output;

      // Phase 1.2: Research Agent
      await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
        sessionId: args.sessionId,
        status: "research",
        currentAgent: "research",
      });

      const researchResult = await ctx.runAction(
        internal.horus.agents.research.runResearch,
        {
          sessionId: args.sessionId,
          patterns: decomposition.patterns,
        }
      );

      if (!researchResult.success || !researchResult.output) {
        throw new PipelineError("research", researchResult.error || "Unknown error", true);
      }
      addUsage(researchResult.tokenUsage);
      const research = researchResult.output;

      // Phase 1.3: Analysis → Validator Loop
      let analysis: AnalysisOutput | undefined;
      let validation: ValidatorOutput | undefined;
      let revisionCount = 0;

      while (revisionCount < UNIFIED_PIPELINE_CONFIG.MAX_VALIDATION_RETRIES) {
        revisionCount++;

        // Analysis Agent
        await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
          sessionId: args.sessionId,
          status: "analysis",
          currentAgent: "analysis",
          revisionCount,
        });

        const analysisResult = await ctx.runAction(
          internal.horus.agents.analysis.runAnalysis,
          {
            sessionId: args.sessionId,
            patterns: decomposition.patterns,
            evidenceByPattern: research.evidenceByPattern,
            metrics,
          }
        );

        if (!analysisResult.success || !analysisResult.output) {
          throw new PipelineError("analysis", analysisResult.error || "Unknown error", true);
        }
        addUsage(analysisResult.tokenUsage);
        analysis = analysisResult.output;

        // Validator Agent
        await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
          sessionId: args.sessionId,
          status: "validation",
          currentAgent: "validator",
          revisionCount,
        });

        const validatorResult = await ctx.runAction(
          internal.horus.agents.validator.runValidator,
          {
            sessionId: args.sessionId,
            analysis,
            metrics,
            patterns: decomposition.patterns,
            revisionNumber: revisionCount,
          }
        );

        if (!validatorResult.success || !validatorResult.output) {
          throw new PipelineError("validator", validatorResult.error || "Unknown error", true);
        }
        addUsage(validatorResult.tokenUsage);
        validation = validatorResult.output;

        if (validation!.passed) {
          analysis = validation!.validatedAnalysis || analysis;
          break;
        }

        if (revisionCount >= UNIFIED_PIPELINE_CONFIG.MAX_VALIDATION_RETRIES) {
          console.warn(
            `[Horus] Max revisions reached for session ${args.sessionId}, accepting with ${validation!.warningCount} warnings`
          );
          break;
        }
      }

      // Ensure we have validation (always true after loop, but TypeScript needs help)
      if (!validation) {
        throw new PipelineError("validator", "Validation never completed", false);
      }

      // Phase 1 Complete: Save analysis results
      await ctx.runMutation(internal.horus.orchestrator.savePipelineResults, {
        sessionId: args.sessionId,
        decomposition,
        research,
        analysis: analysis!,
        validation,
        totalCost,
      });

      // ═══════════════════════════════════════════════════════════════
      // PHASE 1.5: Save Analysis to Vector DB for Future Progress Queries
      // ═══════════════════════════════════════════════════════════════

      if (args.patientId && analysis) {
        try {
          // Cast analysis to the shape expected by extractAnalysisSummaryForEmbedding
          // Maps to actual AnalysisOutput fields
          const analysisForEmbedding = analysis as unknown as {
            insights?: Array<{ title: string; content: string; domain?: string; recommendations?: string[] }>;
            correlativeInsights?: Array<{ explanation: string }>;
            benchmarks?: Array<{ metricName: string; percentile: number }>;
            summary?: string;
            strengths?: string[];
            weaknesses?: string[];
          };
          const embeddingData = extractAnalysisSummaryForEmbedding(analysisForEmbedding);

          await ctx.runAction(internal.horus.vectordb.analysisSearch.saveAnalysisEmbedding, {
            sessionId: args.sessionId,
            patientId: args.patientId,
            type: "session", // Phase 1 analysis
            summaryText: embeddingData.summaryText,
            keyFindings: embeddingData.keyFindings,
            opiScore: metrics.opiScore,
            primaryDomain: embeddingData.primaryDomain,
            analyzedAt: Date.now(),
          });

          console.log(`[Horus] Session analysis embedding saved for ${args.sessionId}`);
        } catch (embeddingError) {
          // Non-fatal: log and continue
          console.error("[Horus] Failed to save analysis embedding:", embeddingError);
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // PHASE 2: Progress Analysis (WITH Vector DB + Phase 1 Context)
      // ═══════════════════════════════════════════════════════════════

      let progress: ProgressOutput | undefined;

      // Only run progress phase if we have a patient and enough historical data
      const shouldRunProgress =
        args.patientId &&
        historicalSessions.length >= UNIFIED_PIPELINE_CONFIG.MIN_SESSIONS_FOR_PROGRESS - 1;

      if (shouldRunProgress) {
        await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
          sessionId: args.sessionId,
          status: "progress",
          currentAgent: "progress",
        });

        // Build Phase 1 context for the progress agent
        const phase1Context: Phase1Context = {
          decomposition,
          research,
          analysis: analysis!,
          validation: validation!,
          metrics,
        };

        const progressResult = await ctx.runAction(
          internal.horus.unifiedOrchestrator.runProgressPhase,
          {
            sessionId: args.sessionId,
            patientId: args.patientId!,
            currentMetrics: metrics,
            historicalSessions,
            phase1Context,
          }
        );

        if (progressResult.success && progressResult.output) {
          addUsage(progressResult.tokenUsage);
          progress = progressResult.output;

          // Save progress results
          await ctx.runMutation(internal.horus.unifiedOrchestrator.saveProgressResults, {
            sessionId: args.sessionId,
            patientId: args.patientId!,
            progress,
            sessionIds: [
              ...historicalSessions.map((s) => s.sessionId),
              args.sessionId,
            ],
          });

          // ═══════════════════════════════════════════════════════════════
          // PHASE 2.5: Save Progress to Vector DB for Future Reference
          // ═══════════════════════════════════════════════════════════════
          try {
            const progressForEmbedding = progress as unknown as {
              summary?: string;
              trends?: Array<{
                metricName: string;
                displayName: string;
                trend: "improving" | "stable" | "declining";
                isClinicallyMeaningful: boolean;
              }>;
              milestones?: Array<{ title: string; description: string; type: string }>;
              regressions?: Array<{ metricName: string; declinePercentage: number; recommendations: string[] }>;
              correlations?: Array<{ type: string; explanation: string }>;
              asymmetryTrends?: Array<{ displayName: string; isResolving: boolean }>;
            };
            const progressEmbeddingData = extractProgressSummaryForEmbedding(progressForEmbedding);

            await ctx.runAction(internal.horus.vectordb.analysisSearch.saveAnalysisEmbedding, {
              sessionId: args.sessionId,
              patientId: args.patientId!,
              type: "progress", // Phase 2 progress report
              summaryText: progressEmbeddingData.summaryText,
              keyFindings: progressEmbeddingData.keyFindings,
              opiScore: metrics.opiScore,
              analyzedAt: Date.now(),
            });

            console.log(`[Horus] Progress embedding saved for ${args.sessionId}`);
          } catch (progressEmbeddingError) {
            // Non-fatal: log and continue
            console.error("[Horus] Failed to save progress embedding:", progressEmbeddingError);
          }
        } else {
          console.warn(`[Horus] Progress phase failed: ${progressResult.error}`);
          // Continue without progress - non-fatal
        }
      }

      // Mark complete
      await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
        sessionId: args.sessionId,
        status: "complete",
      });

      return {
        success: true,
        status: "complete",
        analysis: analysis!,
        progress,
        totalTokens,
        totalCost,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const pipelineError =
        error instanceof PipelineError
          ? error
          : new PipelineError(
              "decomposition",
              error instanceof Error ? error.message : "Unknown error",
              false
            );

      await ctx.runMutation(internal.horus.orchestrator.recordPipelineError, {
        sessionId: args.sessionId,
        agent: pipelineError.agent,
        message: pipelineError.message,
        retryable: pipelineError.retryable,
      });

      return {
        success: false,
        status: "error",
        error: {
          agent: pipelineError.agent,
          message: pipelineError.message,
          retryable: pipelineError.retryable,
        },
        totalTokens,
        totalCost,
        durationMs: Date.now() - startTime,
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Phase 2: Progress Analysis Action
// ─────────────────────────────────────────────────────────────────

/**
 * Run the progress phase with vector DB access and Phase 1 context.
 * This is a separate action to allow for vector search capabilities.
 */
export const runProgressPhase = action({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
    currentMetrics: v.any(),
    historicalSessions: v.any(),
    phase1Context: v.any(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    output?: ProgressOutput;
    error?: string;
    tokenUsage: TokenUsage;
  }> => {
    const startTime = Date.now();
    const currentMetrics = args.currentMetrics as SessionMetrics;
    const historicalSessions = args.historicalSessions as SessionMetrics[];
    const phase1Context = args.phase1Context as Phase1Context;

    try {
      // 1. Search vector DB for relevant historical analyses
      let historicalAnalyses: Array<{
        sessionId: string;
        summaryText: string;
        keyFindings: string[];
        opiScore?: number;
      }> = [];

      try {
        // Build search query from Phase 1 insights
        const searchQuery = buildProgressSearchQuery(phase1Context);

        const searchResults = await ctx.runAction(
          internal.horus.vectordb.analysisSearch.searchPatientAnalyses,
          {
            patientId: args.patientId,
            query: searchQuery,
            limit: 5,
            excludeSessionId: args.sessionId, // Don't include current session
          }
        ) as Array<{
          sessionId: string;
          summaryText: string;
          keyFindings: string[];
          opiScore?: number;
        }>;

        historicalAnalyses = searchResults.map((r: {
          sessionId: string;
          summaryText: string;
          keyFindings: string[];
          opiScore?: number;
        }) => ({
          sessionId: r.sessionId,
          summaryText: r.summaryText,
          keyFindings: r.keyFindings,
          opiScore: r.opiScore,
        }));
      } catch (searchError) {
        console.warn("[Horus] Vector search failed, continuing without historical context:", searchError);
      }

      // 2. Run progress agent with enhanced context
      const progressResult = await ctx.runAction(
        internal.horus.agents.progress.runProgress,
        {
          sessionId: args.sessionId,
          currentMetrics,
          historicalSessions,
          patientId: args.patientId,
          // Enhanced context for progress analysis
          phase1Summary: phase1Context.analysis.summary,
          phase1Strengths: phase1Context.analysis.strengths,
          phase1Weaknesses: phase1Context.analysis.weaknesses,
          historicalAnalyses,
        }
      );

      return progressResult;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Build a search query for vector DB from Phase 1 context.
 * Ensures we always return a meaningful query string.
 */
function buildProgressSearchQuery(context: Phase1Context): string {
  const queryParts: string[] = [];

  // Add key weaknesses (most important for progress tracking)
  if (context.analysis.weaknesses?.length) {
    queryParts.push(`Areas of concern: ${context.analysis.weaknesses.join(", ")}`);
  }

  // Add strengths too for balanced search
  if (context.analysis.strengths?.length) {
    queryParts.push(`Strengths: ${context.analysis.strengths.join(", ")}`);
  }

  // Add primary domains from patterns
  if (context.decomposition.patterns?.length) {
    const domains = [...new Set(context.decomposition.patterns.map((p) => p.type))];
    queryParts.push(`Movement domains: ${domains.join(", ")}`);
  }

  // Add summary
  if (context.analysis.summary) {
    queryParts.push(context.analysis.summary);
  }

  // Ensure we have a meaningful query (fallback to generic if empty)
  if (queryParts.length === 0) {
    return "rehabilitation progress biomechanics movement analysis";
  }

  return queryParts.join(". ");
}

// ─────────────────────────────────────────────────────────────────
// Progress Results Mutation
// ─────────────────────────────────────────────────────────────────

/**
 * Save progress analysis results.
 */
export const saveProgressResults = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
    progress: v.any(),
    sessionIds: v.array(v.string()),
  },
  handler: async (ctx, { patientId, progress, sessionIds }) => {
    const now = Date.now();

    // Check if progress record exists
    const existing = await ctx.db
      .query("horusProgress")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        latestProgress: progress,
        sessionIds,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("horusProgress", {
        patientId,
        latestProgress: progress,
        sessionIds,
        updatedAt: now,
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Error Class
// ─────────────────────────────────────────────────────────────────

class PipelineError extends Error {
  constructor(
    public agent: AgentName,
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = "PipelineError";
  }
}
