/**
 * Validator Agent Execution
 *
 * Runs the validator agent to verify analysis accuracy.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type {
  AnalysisOutput,
  SessionMetrics,
  DetectedPattern,
  ValidatorOutput,
  AgentExecutionResult,
} from "../types";
import {
  VALIDATOR_SYSTEM_PROMPT,
  buildValidatorUserPrompt,
  parseValidatorResponse,
  programmaticValidation,
  VALIDATION_RULES,
} from "../prompts/validator";
import { safeJSONParse, validateValidatorOutput } from "../llm/parser";
import { VALIDATOR_RESPONSE_SCHEMA } from "../llm/schemas";

// ─────────────────────────────────────────────────────────────────
// Agent Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Run the validator agent.
 * Verifies accuracy of analysis output before saving.
 */
export const runValidator = action({
  args: {
    sessionId: v.string(),
    analysis: v.any(), // AnalysisOutput
    metrics: v.any(), // SessionMetrics
    patterns: v.any(), // DetectedPattern[]
    revisionNumber: v.number(),
  },
  handler: async (ctx, args): Promise<AgentExecutionResult<ValidatorOutput>> => {
    const startTime = Date.now();
    const analysis = args.analysis as AnalysisOutput;
    const metrics = args.metrics as SessionMetrics;
    const patterns = args.patterns as DetectedPattern[];
    const revisionNumber = args.revisionNumber;

    try {
      // 1. Run programmatic validation first (catches obvious issues)
      const programmaticIssues = programmaticValidation(analysis, metrics);

      // If there are critical programmatic errors, fail fast
      const criticalErrors = programmaticIssues.filter((i) => i.severity === "error");
      if (criticalErrors.length > 0 && revisionNumber < VALIDATION_RULES.MAX_REVISIONS) {
        // Return immediately without LLM call
        const output: ValidatorOutput = {
          sessionId: args.sessionId,
          passed: false,
          issues: programmaticIssues,
          errorCount: criticalErrors.length,
          warningCount: programmaticIssues.length - criticalErrors.length,
          revisionNumber,
          validatedAt: Date.now(),
        };

        return {
          success: true,
          output,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          durationMs: Date.now() - startTime,
        };
      }

      // 2. Build prompts for LLM validation
      const systemPrompt = VALIDATOR_SYSTEM_PROMPT;
      const userPrompt = buildValidatorUserPrompt(
        analysis,
        metrics,
        patterns,
        revisionNumber
      );

      // 3. Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt,
        temperature: 0.1, // Low temperature for consistent validation
        maxTokens: 16384, // Gemini 2.5 Flash supports up to 65536
        responseSchema: VALIDATOR_RESPONSE_SCHEMA,
      });

      // 4. Parse response (structured output is already JSON)
      const parseResult = safeJSONParse<unknown>(llmResponse.text);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.error}`);
      }

      const validationResult = validateValidatorOutput(
        parseResult.data,
        args.sessionId,
        revisionNumber
      );

      if (!validationResult.success) {
        throw new Error(`Validation failed: ${validationResult.error}`);
      }

      // 5. Merge programmatic and LLM issues
      const llmOutput = validationResult.data!;
      const allIssues = mergeValidationIssues(programmaticIssues, llmOutput.issues);

      const errorCount = allIssues.filter((i) => i.severity === "error").length;
      const warningCount = allIssues.filter((i) => i.severity === "warning").length;

      // 6. Determine if validation passes
      // Pass if no errors, OR if max revisions reached (accept with warnings)
      const passed = errorCount === 0 || revisionNumber >= VALIDATION_RULES.MAX_REVISIONS;

      const output: ValidatorOutput = {
        sessionId: args.sessionId,
        passed,
        issues: allIssues,
        errorCount,
        warningCount,
        revisionNumber,
        validatedAnalysis: passed ? analysis : undefined,
        validatedAt: Date.now(),
      };

      // 7. Record token usage
      await ctx.runMutation(internal.horus.llm.usage.recordAgentUsage, {
        sessionId: args.sessionId,
        agent: "validator",
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
 * Merge programmatic and LLM validation issues.
 * Avoids duplicates based on rule type and insight IDs.
 */
function mergeValidationIssues(
  programmatic: ValidatorOutput["issues"],
  llm: ValidatorOutput["issues"]
): ValidatorOutput["issues"] {
  const result: ValidatorOutput["issues"] = [];
  const seen = new Set<string>();

  // Helper to create dedup key
  const getKey = (i: ValidatorOutput["issues"][0]) =>
    `${i.ruleType}:${i.insightIds.sort().join(",")}:${i.description.slice(0, 50)}`;

  // Programmatic issues first (more reliable)
  for (const issue of programmatic) {
    const key = getKey(issue);
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ ...issue });
    }
  }

  // Add LLM issues that aren't duplicates
  for (const issue of llm) {
    const key = getKey(issue);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }

  // Sort by severity (errors first)
  result.sort((a, b) => {
    if (a.severity === "error" && b.severity !== "error") return -1;
    if (a.severity !== "error" && b.severity === "error") return 1;
    return 0;
  });

  return result;
}
