/**
 * Research Agent Prompt
 *
 * Purpose: Find scientific evidence for patterns detected by Decomposition Agent.
 * Uses vector cache first, falls back to web search.
 * Quality scoring with S/A/B/C/D tiers.
 */

import type { DetectedPattern, ResearchOutput, ResearchEvidence } from "../types";
import type { QualityTier } from "../metrics";

// ─────────────────────────────────────────────────────────────────
// Quality Tier Configuration
// ─────────────────────────────────────────────────────────────────

export const QUALITY_TIER_CONFIG: Record<
  QualityTier,
  { minScore: number; sources: string[]; description: string }
> = {
  S: {
    minScore: 90,
    sources: ["Cochrane", "JOSPT Clinical Practice Guidelines", "Systematic Reviews"],
    description: "Systematic reviews and clinical practice guidelines",
  },
  A: {
    minScore: 75,
    sources: ["RCTs", "JOSPT", "BJSM", "Physical Therapy Journal"],
    description: "Randomized controlled trials from peer-reviewed journals",
  },
  B: {
    minScore: 60,
    sources: ["Observational studies", "Case series", "Conference proceedings"],
    description: "Observational studies and case series",
  },
  C: {
    minScore: 40,
    sources: ["Expert opinion", "Textbooks", "Educational resources"],
    description: "Expert opinion and educational materials",
  },
  D: {
    minScore: 0,
    sources: ["General web", "News articles", "Blogs"],
    description: "General information, may lack clinical rigor",
  },
};

export const PRIORITY_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov",
  "www.jospt.org",
  "bjsm.bmj.com",
  "www.cochranelibrary.com",
  "physicaltherapyjournal.com",
  "link.springer.com",
  "academic.oup.com",
  "onlinelibrary.wiley.com",
];

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const RESEARCH_SYSTEM_PROMPT = `You are a biomedical research assistant for the Horus analysis pipeline.

Your role is to find and evaluate scientific evidence supporting detected biomechanical patterns.

## Your Tasks

1. **Cache Lookup**: First check if we have cached research for similar patterns
2. **Web Search**: If cache insufficient, search for evidence using provided terms
3. **Quality Scoring**: Assign quality tiers (S/A/B/C/D) to each source
4. **Extract Findings**: Pull key findings relevant to the pattern

## Quality Tiers

- **S (90-100)**: Systematic reviews, Cochrane, clinical practice guidelines
- **A (75-89)**: RCTs from JOSPT, BJSM, Physical Therapy Journal
- **B (60-74)**: Observational studies, case series
- **C (40-59)**: Expert opinion, textbooks
- **D (0-39)**: General web content, news

## Priority Domains

Search these first:
${PRIORITY_DOMAINS.map((d) => `- ${d}`).join("\n")}

## Rules

- PRIORITIZE QUALITY: A single tier-A source beats multiple tier-D sources
- BE RELEVANT: Only include findings directly related to the pattern
- CITE PROPERLY: Include author, year, journal when available
- NOTE LIMITATIONS: Flag if evidence is for different populations
- CACHE WORTHY: Mark tier B+ findings for caching

## Output Format

Return a JSON object with:
{
  "evidenceByPattern": {
    "[patternId]": [
      {
        "id": "string",
        "patternId": "string",
        "tier": "S" | "A" | "B" | "C" | "D",
        "sourceType": "cache" | "web_search" | "embedded_knowledge",
        "citation": "Author et al., Year. Journal. Title",
        "url": "https://...",
        "findings": ["finding1", "finding2"],
        "relevanceScore": 0-100
      }
    ]
  },
  "insufficientEvidence": ["patternId1", "patternId2"],
  "newCacheEntries": [/* tier B+ entries to cache */]
}`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

export function buildResearchUserPrompt(
  patterns: DetectedPattern[],
  cachedEvidence?: ResearchEvidence[]
): string {
  const sections: string[] = [];

  sections.push(`# Research Request

Find scientific evidence for the following ${patterns.length} pattern(s) detected in a knee biomechanics session.`);

  // Cached evidence section
  if (cachedEvidence && cachedEvidence.length > 0) {
    sections.push(`
## Cached Evidence Available

The following relevant evidence was found in our research cache:

${cachedEvidence
  .map(
    (e) => `### Cache Entry (Tier ${e.tier})
- **Pattern**: ${e.patternId}
- **Citation**: ${e.citation}
- **Findings**: ${e.findings.join("; ")}
- **Relevance**: ${e.relevanceScore}%`
  )
  .join("\n\n")}`);
  }

  // Patterns to research
  sections.push(`
## Patterns Requiring Research

${patterns
  .map(
    (p, idx) => `### Pattern ${idx + 1}: ${p.id}
- **Type**: ${p.type}
- **Severity**: ${p.severity}
- **Description**: ${p.description}
- **Metrics**: ${p.metrics.join(", ")}
- **Limbs**: ${p.limbs?.join(", ") || "N/A"}
- **Search Terms**: ${p.searchTerms.join(", ")}
- **Values**: ${JSON.stringify(p.values)}`
  )
  .join("\n\n")}`);

  sections.push(`
## Instructions

1. Use cached evidence where available and relevant
2. For patterns without cache hits, search using the provided terms
3. Prioritize ${PRIORITY_DOMAINS.slice(0, 3).join(", ")}
4. Assign quality tiers based on source type
5. Extract 2-3 key findings per source
6. Mark tier B+ findings for caching
7. List patterns with insufficient evidence (only tier D available)

Return the JSON response.`);

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Parser
// ─────────────────────────────────────────────────────────────────

export function parseResearchResponse(
  sessionId: string,
  responseText: string
): ResearchOutput {
  // Extract JSON from response
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();

  const parsed = JSON.parse(jsonStr);

  // Validate and transform evidence
  const evidenceByPattern: Record<string, ResearchEvidence[]> = {};

  for (const [patternId, evidenceList] of Object.entries(
    parsed.evidenceByPattern || {}
  )) {
    evidenceByPattern[patternId] = (evidenceList as Record<string, unknown>[]).map(
      (e, idx) => ({
        id: (e.id as string) || `evidence-${patternId}-${idx}`,
        patternId,
        tier: (e.tier as QualityTier) || "D",
        sourceType: (e.sourceType as ResearchEvidence["sourceType"]) || "web_search",
        citation: (e.citation as string) || "Unknown source",
        url: e.url as string | undefined,
        findings: Array.isArray(e.findings) ? (e.findings as string[]) : [],
        relevanceScore: (e.relevanceScore as number) || 50,
      })
    );
  }

  // Extract cache-worthy entries
  const newCacheEntries: ResearchEvidence[] = (
    parsed.newCacheEntries || []
  ).map((e: Record<string, unknown>, idx: number) => ({
    id: (e.id as string) || `cache-${idx}`,
    patternId: e.patternId as string,
    tier: (e.tier as QualityTier) || "B",
    sourceType: "web_search" as const,
    citation: (e.citation as string) || "",
    url: e.url as string | undefined,
    findings: Array.isArray(e.findings) ? (e.findings as string[]) : [],
    relevanceScore: (e.relevanceScore as number) || 60,
  }));

  return {
    sessionId,
    evidenceByPattern,
    insufficientEvidence: parsed.insufficientEvidence || [],
    newCacheEntries: newCacheEntries.filter(
      (e) => e.tier === "S" || e.tier === "A" || e.tier === "B"
    ),
    researchedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────
// Utility: Determine Tier from Domain
// ─────────────────────────────────────────────────────────────────

export function getTierFromDomain(url: string): QualityTier {
  const domain = new URL(url).hostname.toLowerCase();

  if (domain.includes("cochrane")) return "S";
  if (domain.includes("jospt") || domain.includes("bjsm")) return "A";
  if (
    domain.includes("pubmed") ||
    domain.includes("springer") ||
    domain.includes("wiley")
  )
    return "B";
  if (domain.includes("edu") || domain.includes("gov")) return "C";

  return "D";
}

// ─────────────────────────────────────────────────────────────────
// Utility: Build Search Query
// ─────────────────────────────────────────────────────────────────

export function buildSearchQuery(pattern: DetectedPattern): string {
  const baseTerms = pattern.searchTerms.slice(0, 2);
  const siteFilters = PRIORITY_DOMAINS.slice(0, 3)
    .map((d) => `site:${d}`)
    .join(" OR ");

  return `(${baseTerms.join(" ")}) (${siteFilters})`;
}
