/**
 * Horus v2 Research Agent
 *
 * Enriches a single clinical section with evidence from cache and web.
 */

import { action, internalAction } from "../../../_generated/server";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import type {
  Section,
  EnrichedSection,
  ResearchAgentOutput,
  CacheEntry,
  AgentResult,
  EvidenceTier,
  TokenUsage,
} from "../types";
import {
  RESEARCH_SYSTEM_PROMPT,
  buildResearchUserPrompt,
  RESEARCH_RESPONSE_SCHEMA,
} from "../prompts/research";
import { safeJSONParse, extractJSON } from "../validation";
import { getTierForUrl } from "../search/web";
import type { GroundingMetadata } from "../../llm/vertex";

// ─────────────────────────────────────────────────────────────────
// Research Agent Action
// ─────────────────────────────────────────────────────────────────

/**
 * Enrich a single section with research evidence.
 */
export const enrichSection = internalAction({
  args: {
    sessionId: v.string(),
    section: v.any(), // Section
  },
  handler: async (ctx, args): Promise<ResearchAgentOutput> => {
    const startTime = Date.now();
    const section = args.section as Section;

    console.log("[Research Agent] Enriching section:", section.id, section.title);

    try {
      // 1. Search cache first
      const cacheResults = await searchCache(ctx, section.searchQueries);
      console.log("[Research Agent] Cache results:", cacheResults.length);

      // 2. Call LLM with Gemini grounding (built-in Google Search, no external API needed)
      // Web search happens automatically via Gemini's googleSearchRetrieval tool
      const { enrichment, tokenUsage } = await enrichWithLLM(ctx, section, cacheResults, []);

      // 3. Merge original section with enrichment
      const enrichedSection: EnrichedSection = {
        ...section,
        ...enrichment,
      };

      // 4. Extract cache entries from high-quality citations
      const newCacheEntries = extractCacheEntries(section, enrichedSection);

      // 5. Save new cache entries (B+ tier)
      for (const entry of newCacheEntries) {
        try {
          await ctx.runAction(internal.horus.vectordb.search.saveToResearchCache, {
            searchTerms: entry.searchTerms,
            tier: entry.tier,
            citation: entry.citation,
            url: entry.url,
            findings: entry.findings,
            relevanceScore: entry.relevanceScore,
          });
        } catch (error) {
          console.warn("[Research Agent] Failed to save cache entry:", error);
        }
      }

      console.log("[Research Agent] Section enriched:", {
        sectionId: section.id,
        citationsCount: enrichedSection.citations.length,
        linksCount: enrichedSection.links.length,
        wasContradicted: enrichedSection.wasContradicted,
        newCacheEntries: newCacheEntries.length,
        tokenUsage,
      });

      return {
        sectionId: section.id,
        enrichedSection,
        newCacheEntries,
        tokenUsage,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      console.error("[Research Agent] Error enriching section:", section.id, error);

      // Return section with failed enrichment flag
      const failedSection: EnrichedSection = {
        ...section,
        enrichedNarrative: section.clinicalNarrative,
        userExplanation: {
          summary: section.clinicalNarrative.slice(0, 200),
          whatItMeans: "Unable to retrieve additional context.",
          whyItMatters: "This finding is still clinically relevant based on the metrics.",
        },
        citations: [],
        links: [],
        evidenceStrength: { level: "limited", notes: "Enrichment failed" },
        wasContradicted: false,
        recommendation: section.recommendations?.[0] || "Consult a healthcare professional for personalized guidance.",
        enrichmentFailed: true,
        enrichmentError: error instanceof Error ? error.message : "Unknown error",
      };

      return {
        sectionId: section.id,
        enrichedSection: failedSection,
        newCacheEntries: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
        durationMs: Date.now() - startTime,
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

interface CacheResult {
  citation: string;
  url?: string;
  findings: string[];
  tier: EvidenceTier;
  relevanceScore: number;
}

// WebResult type kept for backward compatibility with prompt builder
interface WebResult {
  title: string;
  link: string;
  snippet: string;
  tier: EvidenceTier;
}

/**
 * Search the vector cache for relevant evidence.
 */
async function searchCache(
  ctx: any,
  queries: string[]
): Promise<CacheResult[]> {
  const results: CacheResult[] = [];
  const seen = new Set<string>();

  for (const query of queries.slice(0, 3)) {
    try {
      const searchResults = await ctx.runAction(
        internal.horus.vectordb.search.searchResearchCache,
        {
          query,
          limit: 3,
          minTier: "C" as const,
        }
      );

      for (const result of searchResults) {
        // Deduplicate by citation
        if (!seen.has(result.citation)) {
          seen.add(result.citation);
          results.push({
            citation: result.citation,
            url: result.url,
            findings: result.findings,
            tier: result.tier as EvidenceTier,
            relevanceScore: result.score * 100,
          });
        }
      }
    } catch (error) {
      console.warn("[Research Agent] Cache search failed for query:", query, error);
    }
  }

  return results;
}

// Note: Web search is now handled by Gemini's built-in Google Search grounding
// via callVertexAIGrounded. No external API (like Serper) is needed.
// The grounding results are extracted from the response metadata.

interface EnrichmentResult {
  enrichment: Omit<EnrichedSection, keyof Section>;
  tokenUsage: TokenUsage;
}

/**
 * Call LLM to enrich the section with evidence.
 * Two-step approach:
 * 1. Grounded search call (no schema) - get web citations
 * 2. Structured call (with schema) - format the response
 */
async function enrichWithLLM(
  ctx: any,
  section: Section,
  cacheResults: CacheResult[],
  webResults: WebResult[]
): Promise<EnrichmentResult> {
  // Step 1: Grounded search to find relevant research
  const searchPrompt = `You are a clinical research assistant. Search for peer-reviewed evidence about this clinical finding:

**Finding:** ${section.title}
**Clinical Context:** ${section.clinicalNarrative}

Search for:
${section.searchQueries.map((q) => `- ${q}`).join("\n")}

Provide a brief research summary with key findings and citations. Focus on:
- Peer-reviewed studies (PubMed, journals)
- Clinical guidelines
- Systematic reviews or meta-analyses

Be factual and cite specific sources.`;

  const searchResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAIGrounded, {
    systemPrompt: "You are a clinical research assistant that finds evidence-based information.",
    userPrompt: searchPrompt,
    temperature: 0.2,
    maxTokens: 4096,
    // No responseSchema - grounding doesn't support it
  });

  console.log("[Research Agent] Step 1 - Grounded search:", {
    groundingSources: searchResponse.groundingMetadata?.groundingChunks?.length || 0,
    responseLength: searchResponse.text.length,
  });

  // Extract links from grounding metadata
  const groundedLinks = extractLinksFromGrounding(searchResponse.groundingMetadata);

  // Step 2: Structured call to format the enrichment
  const formatPrompt = buildResearchUserPrompt(section, cacheResults, webResults);

  // Add search results to the prompt
  const enrichedPrompt = `${formatPrompt}

## Web Search Results
The following research was found via web search:

${searchResponse.text}

### Source Links Found:
${groundedLinks.map((l) => `- [${l.tier}] ${l.title}: ${l.url}`).join("\n") || "No links found"}

Use these search results to enrich your response with citations and evidence.`;

  const formatResponse = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
    systemPrompt: RESEARCH_SYSTEM_PROMPT,
    userPrompt: enrichedPrompt,
    temperature: 0.2,
    maxTokens: 8192,
    responseSchema: RESEARCH_RESPONSE_SCHEMA,
  });

  console.log("[Research Agent] Step 2 - Structured format:", {
    tokenUsage: formatResponse.tokenUsage,
    finishReason: formatResponse.finishReason,
  });

  // Parse JSON response
  const jsonText = extractJSON(formatResponse.text);
  const parseResult = safeJSONParse<any>(jsonText);

  if (!parseResult.success) {
    throw new Error(`Failed to parse LLM response: ${parseResult.errors.join(", ")}`);
  }

  const enrichmentData = parseResult.data;

  // Validate required fields
  if (!enrichmentData.enrichedNarrative || !enrichmentData.userExplanation) {
    throw new Error("LLM response missing required enrichment fields");
  }

  // Merge LLM-generated links with grounding links (deduplicated)
  const allLinks = mergeLinks(enrichmentData.links || [], groundedLinks);

  // Combine token usage from both calls
  const totalTokenUsage: TokenUsage = {
    inputTokens: searchResponse.tokenUsage.inputTokens + formatResponse.tokenUsage.inputTokens,
    outputTokens: searchResponse.tokenUsage.outputTokens + formatResponse.tokenUsage.outputTokens,
    totalTokens: searchResponse.tokenUsage.totalTokens + formatResponse.tokenUsage.totalTokens,
    estimatedCost: searchResponse.tokenUsage.estimatedCost + formatResponse.tokenUsage.estimatedCost,
  };

  return {
    enrichment: {
      enrichedNarrative: enrichmentData.enrichedNarrative,
      userExplanation: enrichmentData.userExplanation,
      citations: enrichmentData.citations || [],
      links: allLinks,
      evidenceStrength: enrichmentData.evidenceStrength || { level: "limited" },
      wasContradicted: enrichmentData.wasContradicted || false,
      recommendation: enrichmentData.recommendation || section.recommendations[0] || "",
    },
    tokenUsage: totalTokenUsage,
  };
}

/**
 * Extract quality links from Gemini grounding metadata.
 */
function extractLinksFromGrounding(grounding?: GroundingMetadata): Array<{
  url: string;
  title: string;
  tier: EvidenceTier;
  domain: string;
  relevance: string;
}> {
  if (!grounding?.groundingChunks) {
    return [];
  }

  return grounding.groundingChunks
    .filter((chunk) => chunk.web?.uri)
    .map((chunk) => {
      const url = chunk.web!.uri;
      const title = chunk.web!.title || "Unknown";
      const domain = extractDomain(url);
      const tier = getTierForUrl(url);

      return {
        url,
        title,
        tier,
        domain,
        relevance: "Google Search grounding result",
      };
    });
}

/**
 * Extract domain from URL.
 */
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "unknown";
  }
}

/**
 * Merge links, removing duplicates by URL.
 */
function mergeLinks(
  llmLinks: Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string }>,
  groundedLinks: Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string }>
): Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string }> {
  const seen = new Set<string>();
  const merged: Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string }> = [];

  // Add LLM links first (usually more relevant)
  for (const link of llmLinks) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      merged.push(link);
    }
  }

  // Add grounded links
  for (const link of groundedLinks) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      merged.push(link);
    }
  }

  // Sort by tier
  const tierOrder: EvidenceTier[] = ["S", "A", "B", "C", "D"];
  merged.sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));

  return merged;
}

/**
 * Extract cache entries from enriched section (B+ tier citations).
 */
function extractCacheEntries(
  section: Section,
  enrichedSection: EnrichedSection
): CacheEntry[] {
  const entries: CacheEntry[] = [];
  const highQualityTiers: EvidenceTier[] = ["S", "A", "B"];

  for (const citation of enrichedSection.citations) {
    if (highQualityTiers.includes(citation.tier)) {
      // Find matching link if available
      const matchingLink = enrichedSection.links.find(
        (l) => l.title.toLowerCase().includes(citation.source.toLowerCase().slice(0, 20))
      );

      entries.push({
        searchTerms: section.searchQueries.slice(0, 3),
        tier: citation.tier,
        citation: `${citation.source}: ${citation.text}`,
        url: matchingLink?.url,
        findings: [citation.text],
        relevanceScore: citation.tier === "S" ? 95 : citation.tier === "A" ? 85 : 75,
      });
    }
  }

  return entries;
}
