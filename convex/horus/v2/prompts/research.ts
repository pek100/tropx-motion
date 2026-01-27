/**
 * Horus v2 Research Agent Prompts
 *
 * Evidence enrichment with cache-first search and web fallback.
 */

import type { Section, EvidenceTier } from "../types";

// ─────────────────────────────────────────────────────────────────
// System Prompt
// ─────────────────────────────────────────────────────────────────

export const RESEARCH_SYSTEM_PROMPT = `You are a medical research specialist with expertise in evidence-based practice and clinical biomechanics.

Your role is to enrich clinical findings with research evidence and make them accessible.

=== IMPORTANT: PATIENT FRAMING ===
ALWAYS refer to the subject as "the patient" - NEVER use "you" or "your".
Example: "The patient shows significant asymmetry..." NOT "You show significant asymmetry..."
This applies to ALL text outputs including explanations and recommendations.

=== YOUR CAPABILITIES ===
1. Evaluate evidence quality using standard tiers (S-D)
2. Synthesize multiple sources into coherent narratives
3. Identify when evidence contradicts clinical findings
4. Create patient-friendly explanations without medical jargon
5. Generate a single, actionable evidence-based recommendation

=== EVIDENCE TIER SYSTEM ===
- S: Systematic reviews, meta-analyses (Cochrane, high-quality syntheses)
- A: RCTs, high-quality primary research (PubMed, major journals)
- B: Observational studies, clinical guidelines, expert consensus
- C: Case studies, textbooks, professional resources
- D: General health information, educational content

=== WHEN EVIDENCE CONTRADICTS ===
If the research evidence contradicts the original clinical finding:
1. Set wasContradicted: true
2. Rewrite the enrichedNarrative to reflect the evidence-supported interpretation
3. Explain the discrepancy in your reasoning
4. Adjust recommendation based on evidence

=== USER-FRIENDLY EXPLANATIONS ===
Write about the patient (not TO the patient):
- summary: 1-2 sentences explaining the finding (e.g., "The patient shows a significant difference...")
- whatItMeans: Practical implications (e.g., "Because the patient's left leg has less movement...")
- whyItMatters: Why this matters for recovery (e.g., "Addressing this will help the patient...")
- analogy: Optional relatable comparison (e.g., "Think of it like a car with misaligned wheels...")

=== OUTPUT FORMAT ===
You MUST respond with valid JSON matching the enriched section schema.
Include ONE unified recommendation (not an array) that synthesizes the evidence.`;

// ─────────────────────────────────────────────────────────────────
// User Prompt Builder
// ─────────────────────────────────────────────────────────────────

interface CacheResult {
  citation: string;
  url?: string;
  findings: string[];
  tier: EvidenceTier;
  relevanceScore: number;
}

interface WebResult {
  title: string;
  link: string;
  snippet: string;
  tier: EvidenceTier;
}

/**
 * Build the user prompt for the Research Agent.
 */
export function buildResearchUserPrompt(
  section: Section,
  cacheResults: CacheResult[],
  webResults: WebResult[]
): string {
  // Format cache results
  const cacheSection = cacheResults.length > 0
    ? `=== CACHED EVIDENCE (High Relevance) ===
${cacheResults.map((r, i) => `
[${i + 1}] Tier ${r.tier} | Relevance: ${r.relevanceScore.toFixed(0)}%
Citation: ${r.citation}
${r.url ? `URL: ${r.url}` : ""}
Findings:
${r.findings.map(f => `  - ${f}`).join("\n")}
`).join("\n")}`
    : "=== CACHED EVIDENCE ===\nNo relevant cached evidence found.";

  // Format web results
  const webSection = webResults.length > 0
    ? `=== WEB SEARCH RESULTS ===
${webResults.map((r, i) => `
[${i + 1}] Tier ${r.tier}
Title: ${r.title}
URL: ${r.link}
Snippet: ${r.snippet}
`).join("\n")}`
    : "=== WEB SEARCH RESULTS ===\nNo web results available.";

  return `=== SECTION TO ENRICH ===
ID: ${section.id}
Title: ${section.title}
Domain: ${section.domain}

Clinical Narrative:
${section.clinicalNarrative}

Q&A Reasoning:
${section.qaReasoning.map(qa => `[Q] ${qa.question}\n[A] ${qa.answer}`).join("\n\n")}

Joint Contributions:
${Object.entries(section.jointContributions).map(([joint, contrib]) => `- ${joint}: ${contrib}`).join("\n")}

Metric Contributions:
${section.metricContributions.map(m => `- ${m.metric}: ${m.value}${m.unit} (${m.role})`).join("\n")}

Initial Recommendations:
${section.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}

${cacheSection}

${webSection}

=== YOUR TASK ===
Enrich this section using the provided evidence.

REMEMBER: Always use "the patient" - never "you" or "your".

1. **Enriched Narrative**: Rewrite the clinical narrative incorporating citations from the evidence.
   - Use inline citations like [1], [2] referencing your citations array
   - If evidence contradicts the finding, rewrite to reflect the evidence-supported view
   - Keep the clinical expertise tone
   - Use "the patient" framing throughout

2. **Citations**: List all sources used with their tier ratings
   - Include the most relevant quote/finding from each source
   - Rate each by tier (S/A/B/C/D)

3. **Links**: Collect quality URLs from the evidence
   - Include tier rating and relevance explanation for each
   - Prioritize higher-tier sources

4. **User Explanation**: Create accessible explanation (using "the patient" framing)
   - summary: Brief overview (e.g., "The patient shows a significant difference...")
   - whatItMeans: Practical implications (e.g., "Because the patient's left leg...")
   - whyItMatters: Why this matters for recovery (e.g., "Addressing this will help the patient...")
   - analogy: Optional relatable comparison

5. **Evidence Strength**: Assess overall evidence quality
   - very-high: Multiple S tier (systematic reviews/meta-analyses) sources agree
   - high: Multiple A tier sources or S tier with supporting evidence
   - moderate: B tier sources or mixed A/B tier agreement
   - minimal: Mostly C/D tier or sparse evidence
   - none: No relevant evidence found

6. **Recommendation**: ONE unified, actionable recommendation based on evidence
   - Synthesize the key action from all evidence
   - Be specific and clinically actionable
   - Use "the patient" framing

=== OUTPUT JSON SCHEMA ===
{
  "enrichedNarrative": "The patient demonstrates... [1], [2] style citations...",
  "userExplanation": {
    "summary": "The patient shows a significant difference in...",
    "whatItMeans": "Because the patient's left leg has less movement, the patient may experience...",
    "whyItMatters": "Addressing this will help the patient reduce injury risk and improve...",
    "analogy": "Think of it like a car with misaligned wheels..."
  },
  "citations": [
    {
      "text": "Relevant quote or finding",
      "source": "Source name or journal",
      "tier": "A"
    }
  ],
  "links": [
    {
      "url": "https://...",
      "title": "Page title",
      "tier": "A",
      "domain": "pubmed.ncbi.nlm.nih.gov",
      "relevance": "Why this link is valuable"
    }
  ],
  "evidenceStrength": {
    "level": "high",
    "notes": "Optional notes about evidence quality"
  },
  "wasContradicted": false,
  "recommendation": "The patient should focus on targeted mobility exercises for the deficit limb, incorporating evidence-based protocols [1,2]."
}

IMPORTANT:
- ALWAYS use "the patient" framing, NEVER "you" or "your"
- Preserve all original section fields (id, title, domain, etc.)
- Only output the enrichment fields listed above
- If evidence contradicts the finding, set wasContradicted: true and adjust narrative
- Include at least 2-3 citations if evidence is available
- recommendation is a SINGLE STRING, not an array

Respond with ONLY the JSON object, no additional text.`;
}

// ─────────────────────────────────────────────────────────────────
// Response Schema for Vertex AI
// ─────────────────────────────────────────────────────────────────

/**
 * JSON Schema for Research Agent structured output.
 */
export const RESEARCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    enrichedNarrative: { type: "string" },
    userExplanation: {
      type: "object",
      properties: {
        summary: { type: "string" },
        whatItMeans: { type: "string" },
        whyItMatters: { type: "string" },
        analogy: { type: "string" },
      },
      required: ["summary", "whatItMeans", "whyItMatters"],
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          source: { type: "string" },
          tier: { type: "string", enum: ["S", "A", "B", "C", "D"] },
        },
        required: ["text", "source", "tier"],
      },
    },
    links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
          tier: { type: "string", enum: ["S", "A", "B", "C", "D"] },
          domain: { type: "string" },
          relevance: { type: "string" },
        },
        required: ["url", "title", "tier", "domain", "relevance"],
      },
    },
    evidenceStrength: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["none", "minimal", "moderate", "high", "very-high"] },
        notes: { type: "string" },
      },
      required: ["level"],
    },
    wasContradicted: { type: "boolean" },
    recommendation: { type: "string" },
  },
  required: [
    "enrichedNarrative",
    "userExplanation",
    "citations",
    "links",
    "evidenceStrength",
    "wasContradicted",
    "recommendation",
  ],
};
