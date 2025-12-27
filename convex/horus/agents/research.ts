/**
 * Research Agent Execution
 *
 * Runs the research agent to find scientific evidence for patterns.
 */

import { action } from "../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type {
  DetectedPattern,
  ResearchOutput,
  ResearchEvidence,
  AgentExecutionResult,
} from "../types";
import {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchUserPrompt,
  parseResearchResponse,
} from "../prompts/research";
import { safeJSONParse, validateResearchOutput } from "../llm/parser";
import { RESEARCH_RESPONSE_SCHEMA } from "../llm/schemas";

// ─────────────────────────────────────────────────────────────────
// Agent Execution
// ─────────────────────────────────────────────────────────────────

/**
 * Run the research agent.
 * Finds scientific evidence for detected patterns.
 */
export const runResearch = action({
  args: {
    sessionId: v.string(),
    patterns: v.any(), // DetectedPattern[]
  },
  handler: async (ctx, args): Promise<AgentExecutionResult<ResearchOutput>> => {
    const startTime = Date.now();
    const patterns = args.patterns as DetectedPattern[];

    try {
      // 1. Search vector cache for existing research
      const cachedEvidence: ResearchEvidence[] = [];

      for (const pattern of patterns) {
        // Search cache using pattern search terms
        const searchQuery = pattern.searchTerms.join(" ");

        try {
          const cacheResults = await ctx.runAction(
            internal.horus.vectordb.search.searchResearchCache,
            {
              query: searchQuery,
              limit: 3,
              minTier: "C",
            }
          );

          // Map cache results to evidence
          for (const result of cacheResults) {
            cachedEvidence.push({
              id: `cache-${result._id}`,
              patternId: pattern.id,
              tier: result.tier,
              sourceType: "cache",
              citation: result.citation,
              url: result.url,
              findings: result.findings,
              relevanceScore: result.score * 100,
            });
          }
        } catch {
          // Cache search failed, continue without cache
        }
      }

      // 2. Build prompts
      const systemPrompt = RESEARCH_SYSTEM_PROMPT;
      const userPrompt = buildResearchUserPrompt(patterns, cachedEvidence);

      // 3. Call Vertex AI with structured output
      const llmResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt,
        temperature: 0.3,
        maxTokens: 32768, // Research needs more tokens for evidence
        responseSchema: RESEARCH_RESPONSE_SCHEMA,
      });

      // 4. Parse response (structured output is already JSON)
      const parseResult = safeJSONParse<unknown>(llmResponse.text);

      if (!parseResult.success) {
        throw new Error(`Failed to parse LLM response: ${parseResult.error}`);
      }

      const validationResult = validateResearchOutput(parseResult.data, args.sessionId);

      if (!validationResult.success) {
        throw new Error(`Validation failed: ${validationResult.error}`);
      }

      const output = validationResult.data!;

      // 5. Merge cached evidence with LLM evidence
      for (const evidence of cachedEvidence) {
        const patternEvidence = output.evidenceByPattern[evidence.patternId] || [];
        // Check if already exists
        const exists = patternEvidence.some(
          (e) => e.citation === evidence.citation
        );
        if (!exists) {
          patternEvidence.unshift(evidence); // Cache evidence first
          output.evidenceByPattern[evidence.patternId] = patternEvidence;
        }
      }

      // 6. Save new high-quality findings to cache
      const newCacheEntries = extractNewCacheEntries(output);
      for (const entry of newCacheEntries) {
        try {
          await ctx.runAction(internal.horus.vectordb.search.saveToResearchCache, {
            searchTerms: entry.patternId.split("-").concat(entry.findings.slice(0, 2)),
            tier: entry.tier,
            citation: entry.citation,
            url: entry.url,
            findings: entry.findings,
            relevanceScore: entry.relevanceScore,
          });
        } catch {
          // Cache save failed, continue
        }
      }
      output.newCacheEntries = newCacheEntries;

      // 7. Record token usage
      await ctx.runMutation(internal.horus.llm.usage.recordAgentUsage, {
        sessionId: args.sessionId,
        agent: "research",
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
 * Extract tier B+ evidence entries for caching.
 */
function extractNewCacheEntries(output: ResearchOutput): ResearchEvidence[] {
  const entries: ResearchEvidence[] = [];
  const cacheTiers = new Set(["S", "A", "B"]);

  for (const [patternId, evidenceList] of Object.entries(output.evidenceByPattern)) {
    for (const evidence of evidenceList) {
      // Only cache non-cached, high-quality evidence
      if (
        evidence.sourceType !== "cache" &&
        cacheTiers.has(evidence.tier) &&
        evidence.findings.length > 0
      ) {
        entries.push(evidence);
      }
    }
  }

  return entries;
}
