/**
 * Horus Pipeline Orchestrator
 *
 * Manages the agent pipeline: Decomposition → Research → Analysis → Validator
 * With validation loop (max 3 revisions) and error handling.
 */

import { action, mutation, internalMutation } from "../_generated/server";
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
  TokenUsage,
} from "./types";
import { VALIDATION_RULES } from "./prompts/validator";

// ─────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────

export const PIPELINE_CONFIG = {
  MAX_VALIDATION_RETRIES: VALIDATION_RULES.MAX_REVISIONS,
  TIMEOUT_MS: 300000, // 5 minutes total pipeline timeout
};

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface PipelineResult {
  success: boolean;
  status: PipelineStatus;
  analysis?: AnalysisOutput;
  error?: {
    agent: AgentName;
    message: string;
    retryable: boolean;
  };
  totalTokens: number;
  totalCost: number;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────
// Main Pipeline Action
// ─────────────────────────────────────────────────────────────────

/**
 * Run the full Horus analysis pipeline.
 */
export const runPipeline = action({
  args: {
    sessionId: v.string(),
    metrics: v.any(), // SessionMetrics
    previousMetrics: v.optional(v.any()), // SessionMetrics
    patientId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<PipelineResult> => {
    const startTime = Date.now();
    const metrics = args.metrics as SessionMetrics;
    const previousMetrics = args.previousMetrics as SessionMetrics | undefined;

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

      // 2. Decomposition Agent
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
          previousMetrics,
        }
      );

      if (!decompResult.success || !decompResult.output) {
        throw new PipelineError("decomposition", decompResult.error || "Unknown error", true);
      }

      addUsage(decompResult.tokenUsage);
      const decomposition = decompResult.output;

      // 3. Research Agent
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

      // 4. Analysis → Validator Loop
      let analysis: AnalysisOutput | undefined;
      let validation: ValidatorOutput | undefined;
      let revisionCount = 0;

      while (revisionCount < PIPELINE_CONFIG.MAX_VALIDATION_RETRIES) {
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

        // Check if validation passed
        if (validation.passed) {
          analysis = validation.validatedAnalysis || analysis;
          break;
        }

        // If max revisions reached, accept with warnings
        if (revisionCount >= PIPELINE_CONFIG.MAX_VALIDATION_RETRIES) {
          console.warn(
            `[Horus] Max revisions reached for session ${args.sessionId}, accepting with ${validation.warningCount} warnings`
          );
          break;
        }
      }

      // 5. Save results
      await ctx.runMutation(internal.horus.orchestrator.savePipelineResults, {
        sessionId: args.sessionId,
        decomposition,
        research,
        analysis: analysis!,
        validation: validation!,
        totalCost,
      });

      // 6. Mark complete
      await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
        sessionId: args.sessionId,
        status: "complete",
      });

      return {
        success: true,
        status: "complete",
        analysis: analysis!,
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

      // Record error
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
// Retry Action
// ─────────────────────────────────────────────────────────────────

/**
 * Retry a specific agent in the pipeline.
 */
export const retryAgent = action({
  args: {
    sessionId: v.string(),
    agent: v.union(
      v.literal("decomposition"),
      v.literal("research"),
      v.literal("analysis"),
      v.literal("validator")
    ),
  },
  handler: async (ctx, { sessionId, agent }): Promise<{ success: boolean; error?: string }> => {
    // Get current pipeline state
    const status = await ctx.runQuery(internal.horus.queries.getPipelineStatus, {
      sessionId,
    });

    if (!status) {
      return { success: false, error: "Pipeline not found" };
    }

    // Get stored analysis data
    const analysis = await ctx.runQuery(internal.horus.queries.getAnalysis, {
      sessionId,
    });

    if (!analysis) {
      return { success: false, error: "Analysis record not found" };
    }

    // Re-run the failed agent
    // Note: This is a simplified retry - a full implementation would
    // need to fetch the original metrics and continue the pipeline

    await ctx.runMutation(internal.horus.orchestrator.updatePipelineStatus, {
      sessionId,
      status: agent as PipelineStatus,
      currentAgent: agent as AgentName,
    });

    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────
// Pipeline Status Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Initialize a new pipeline.
 */
export const initializePipeline = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
  },
  handler: async (ctx, { sessionId, patientId }) => {
    // Check if already exists
    const existing = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    const now = Date.now();

    if (existing) {
      // Reset existing
      await ctx.db.patch(existing._id, {
        status: "pending",
        decomposition: undefined,
        research: undefined,
        analysis: undefined,
        validation: undefined,
        error: undefined,
        startedAt: now,
        completedAt: undefined,
      });
    } else {
      // Create new
      await ctx.db.insert("horusAnalyses", {
        sessionId,
        patientId,
        status: "pending",
        startedAt: now,
      });
    }

    // Also update pipeline status table
    const existingStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existingStatus) {
      await ctx.db.patch(existingStatus._id, {
        status: "pending",
        currentAgent: undefined,
        revisionCount: 0,
        startedAt: now,
        updatedAt: now,
        error: undefined,
      });
    } else {
      await ctx.db.insert("horusPipelineStatus", {
        sessionId,
        status: "pending",
        revisionCount: 0,
        startedAt: now,
        updatedAt: now,
      });
    }
  },
});

/**
 * Update pipeline status.
 */
export const updatePipelineStatus = internalMutation({
  args: {
    sessionId: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("decomposition"),
      v.literal("research"),
      v.literal("analysis"),
      v.literal("validation"),
      v.literal("complete"),
      v.literal("error")
    ),
    currentAgent: v.optional(
      v.union(
        v.literal("decomposition"),
        v.literal("research"),
        v.literal("analysis"),
        v.literal("validator"),
        v.literal("progress")
      )
    ),
    revisionCount: v.optional(v.number()),
  },
  handler: async (ctx, { sessionId, status, currentAgent, revisionCount }) => {
    const now = Date.now();

    // Update analysis record
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis) {
      await ctx.db.patch(analysis._id, {
        status,
        completedAt: status === "complete" ? now : undefined,
      });
    }

    // Update pipeline status
    const pipelineStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (pipelineStatus) {
      await ctx.db.patch(pipelineStatus._id, {
        status,
        currentAgent,
        revisionCount: revisionCount ?? pipelineStatus.revisionCount,
        updatedAt: now,
      });
    }
  },
});

/**
 * Save pipeline results.
 */
export const savePipelineResults = internalMutation({
  args: {
    sessionId: v.string(),
    decomposition: v.any(),
    research: v.any(),
    analysis: v.any(),
    validation: v.any(),
    totalCost: v.number(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (record) {
      await ctx.db.patch(record._id, {
        decomposition: args.decomposition,
        research: args.research,
        analysis: args.analysis,
        validation: args.validation,
        totalCost: args.totalCost,
        completedAt: Date.now(),
      });
    }
  },
});

/**
 * Record pipeline error.
 */
export const recordPipelineError = internalMutation({
  args: {
    sessionId: v.string(),
    agent: v.union(
      v.literal("decomposition"),
      v.literal("research"),
      v.literal("analysis"),
      v.literal("validator"),
      v.literal("progress")
    ),
    message: v.string(),
    retryable: v.boolean(),
  },
  handler: async (ctx, { sessionId, agent, message, retryable }) => {
    const now = Date.now();
    const error = { agent, message, retryable };

    // Update analysis record
    const analysis = await ctx.db
      .query("horusAnalyses")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (analysis) {
      await ctx.db.patch(analysis._id, {
        status: "error",
        error,
      });
    }

    // Update pipeline status
    const pipelineStatus = await ctx.db
      .query("horusPipelineStatus")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (pipelineStatus) {
      await ctx.db.patch(pipelineStatus._id, {
        status: "error",
        error,
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
