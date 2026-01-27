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
      console.error("[Research Agent] Error enriching section:", section.id, {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        sectionTitle: section.title,
      });

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
        evidenceStrength: { level: "none", notes: "Enrichment failed" },
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
    searchQueries: searchResponse.groundingMetadata?.webSearchQueries || [],
    hasGroundingSupports: (searchResponse.groundingMetadata?.groundingSupports?.length || 0) > 0,
  });

  // Log the actual grounding chunks for debugging
  if (searchResponse.groundingMetadata?.groundingChunks) {
    console.log("[Research Agent] Grounding chunks:", searchResponse.groundingMetadata.groundingChunks.map(c => ({
      uri: c.web?.uri?.substring(0, 100),
      title: c.web?.title?.substring(0, 50),
    })));
  }

  // Extract links from grounding metadata with citation counts (resolves redirect URLs)
  const { links: groundedLinks, citationCounts } = await extractLinksFromGrounding(searchResponse.groundingMetadata);

  console.log("[Research Agent] Grounded links extracted:", {
    count: groundedLinks.length,
    domains: groundedLinks.map(l => l.domain),
    featuredCount: groundedLinks.filter(l => l.featured).length,
  });

  // Clean citation markers from the grounded text (e.g., [1], [2,3], [websearch])
  const cleanedSearchText = cleanCitationMarkers(searchResponse.text);

  // Step 2: Structured call to format the enrichment
  const formatPrompt = buildResearchUserPrompt(section, cacheResults, webResults);

  // Add search results to the prompt (using cleaned text without citation markers)
  const enrichedPrompt = `${formatPrompt}

## Web Search Results
The following research was found via web search:

${cleanedSearchText}

### Source Links Found:
${groundedLinks.map((l) => `- [${l.tier}]${l.featured ? " ⭐" : ""} ${l.title}: ${l.url}`).join("\n") || "No links found"}

Use these search results to enrich your response with citations and evidence. Do NOT include citation markers like [1], [2,3] in your output.`;

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

  console.log("[Research Agent] Links merged:", {
    llmLinksCount: enrichmentData.links?.length || 0,
    groundedLinksCount: groundedLinks.length,
    totalLinksCount: allLinks.length,
    featuredCount: allLinks.filter(l => l.featured).length,
  });

  // Combine token usage from both calls
  const totalTokenUsage: TokenUsage = {
    inputTokens: searchResponse.tokenUsage.inputTokens + formatResponse.tokenUsage.inputTokens,
    outputTokens: searchResponse.tokenUsage.outputTokens + formatResponse.tokenUsage.outputTokens,
    totalTokens: searchResponse.tokenUsage.totalTokens + formatResponse.tokenUsage.totalTokens,
    estimatedCost: searchResponse.tokenUsage.estimatedCost + formatResponse.tokenUsage.estimatedCost,
  };

  return {
    enrichment: {
      // Clean any remaining citation markers from narratives
      enrichedNarrative: cleanCitationMarkers(enrichmentData.enrichedNarrative),
      userExplanation: {
        ...enrichmentData.userExplanation,
        summary: cleanCitationMarkers(enrichmentData.userExplanation.summary),
        whatItMeans: cleanCitationMarkers(enrichmentData.userExplanation.whatItMeans),
        whyItMatters: cleanCitationMarkers(enrichmentData.userExplanation.whyItMatters),
        analogy: enrichmentData.userExplanation.analogy
          ? cleanCitationMarkers(enrichmentData.userExplanation.analogy)
          : undefined,
      },
      citations: enrichmentData.citations || [],
      links: allLinks,
      evidenceStrength: enrichmentData.evidenceStrength || { level: "minimal" },
      wasContradicted: enrichmentData.wasContradicted || false,
      recommendation: cleanCitationMarkers(enrichmentData.recommendation || section.recommendations[0] || ""),
    },
    tokenUsage: totalTokenUsage,
  };
}

/**
 * Clean citation markers from grounded text (e.g., [1], [2,3], [websearch]).
 */
function cleanCitationMarkers(text: string): string {
  // Remove patterns like [1], [2,3], [1, 2], [websearch], etc.
  return text
    .replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "") // [1], [2,3], [1, 2, 3]
    .replace(/\s*\[websearch\]/gi, "") // [websearch]
    .replace(/\s*\[\d+,\s*websearch\]/gi, "") // [1, websearch]
    .replace(/\s+([.,;:])/g, "$1") // Clean up spaces before punctuation
    .replace(/\s{2,}/g, " ") // Clean up double spaces
    .trim();
}

/**
 * Extract quality links from Gemini grounding metadata with citation counts.
 * Resolves Vertex AI redirect URLs to get actual destination URLs.
 */
async function extractLinksFromGrounding(grounding?: GroundingMetadata): Promise<{
  links: Array<{
    url: string;
    title: string;
    tier: EvidenceTier;
    domain: string;
    relevance: string;
    featured: boolean;
  }>;
  citationCounts: Map<number, number>;
}> {
  if (!grounding?.groundingChunks) {
    return { links: [], citationCounts: new Map() };
  }

  // Count how many times each source index is cited in groundingSupports
  const citationCounts = new Map<number, number>();
  if (grounding.groundingSupports) {
    for (const support of grounding.groundingSupports) {
      if (support.groundingChunkIndices) {
        for (const idx of support.groundingChunkIndices) {
          citationCounts.set(idx, (citationCounts.get(idx) || 0) + 1);
        }
      }
    }
  }

  // Find the max citation count to determine "featured" threshold
  const maxCitations = Math.max(...Array.from(citationCounts.values()), 0);
  const featuredThreshold = Math.max(2, Math.floor(maxCitations * 0.5)); // At least 2 citations or 50% of max

  // Extract raw link data first
  const rawLinks = grounding.groundingChunks
    .filter((chunk) => chunk.web?.uri)
    .map((chunk, index) => ({
      rawUrl: chunk.web!.uri,
      title: chunk.web!.title || "Unknown",
      index,
      citations: citationCounts.get(index) || 0,
    }));

  // Resolve all Vertex AI redirect URLs in parallel
  let resolvedUrls: Array<{ rawUrl: string; title: string; index: number; citations: number; url: string }>;
  try {
    resolvedUrls = await Promise.all(
      rawLinks.map(async (link) => {
        const url = await resolveRedirectUrl(link.rawUrl);
        return { ...link, url };
      })
    );
  } catch (resolveError) {
    console.warn("[Research Agent] Error resolving redirect URLs, using original URLs:", resolveError);
    // Fall back to using original URLs if resolution fails
    resolvedUrls = rawLinks.map((link) => ({ ...link, url: link.rawUrl }));
  }

  // Build final link objects
  const links = resolvedUrls.map((link) => {
    const domain = extractDomain(link.url);
    const tier = getTierForUrl(link.url);
    const featured = link.citations >= featuredThreshold;

    return {
      url: link.url,
      title: link.title,
      tier,
      domain,
      relevance: featured ? `Primary source (cited ${link.citations}x)` : "Google Search grounding result",
      featured,
    };
  });

  // Sort by featured first, then by tier
  const tierOrder: EvidenceTier[] = ["S", "A", "B", "C", "D"];
  links.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
  });

  return { links, citationCounts };
}

/**
 * Resolve Vertex AI grounding redirect URLs to get actual destination URLs.
 * Makes HTTP HEAD request to follow the redirect chain.
 * Falls back to original URL if resolution fails.
 */
async function resolveRedirectUrl(url: string): Promise<string> {
  try {
    const parsed = new URL(url);

    // Only resolve if it's a Vertex AI redirect URL
    if (!parsed.hostname.includes("vertexaisearch.cloud.google.com") &&
        !parsed.hostname.includes("vertexai")) {
      return url;
    }

    // Make HEAD request with redirect: "manual" to capture redirect location
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "manual", // Don't follow redirects automatically
        signal: controller.signal,
        headers: {
          "User-Agent": "TropX-Research-Agent/1.0",
        },
      });

      clearTimeout(timeoutId);

      // Check for redirect (3xx status codes)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) {
          // Location might be relative, resolve against original URL
          const resolvedUrl = new URL(location, url).href;
          console.log(`[Research Agent] Resolved redirect: ${parsed.hostname} → ${new URL(resolvedUrl).hostname}`);
          return resolvedUrl;
        }
      }

      // If no redirect, try GET request as some servers don't redirect HEAD
      if (response.status === 200 || response.status === 405) {
        const getResponse = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "TropX-Research-Agent/1.0",
          },
        });

        if (getResponse.status >= 300 && getResponse.status < 400) {
          const location = getResponse.headers.get("location");
          if (location) {
            const resolvedUrl = new URL(location, url).href;
            console.log(`[Research Agent] Resolved redirect (GET): ${parsed.hostname} → ${new URL(resolvedUrl).hostname}`);
            return resolvedUrl;
          }
        }
      }

      return url;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      // Fetch failed (timeout, network error, etc.)
      console.warn(`Failed to resolve redirect URL: ${url}`, fetchError);
      return url;
    }
  } catch {
    return url;
  }
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
 * Featured (most-cited) links are sorted first.
 */
function mergeLinks(
  llmLinks: Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string; featured?: boolean }>,
  groundedLinks: Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string; featured?: boolean }>
): Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string; featured?: boolean }> {
  const seen = new Set<string>();
  const merged: Array<{ url: string; title: string; tier: EvidenceTier; domain: string; relevance: string; featured?: boolean }> = [];

  // Add grounded links first (they have featured flag from citation counts)
  for (const link of groundedLinks) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      merged.push(link);
    }
  }

  // Add LLM links (without featured flag)
  for (const link of llmLinks) {
    if (!seen.has(link.url)) {
      seen.add(link.url);
      merged.push({ ...link, featured: false });
    }
  }

  // Sort: featured first, then by tier
  const tierOrder: EvidenceTier[] = ["S", "A", "B", "C", "D"];
  merged.sort((a, b) => {
    if (a.featured !== b.featured) return a.featured ? -1 : 1;
    return tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier);
  });

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
