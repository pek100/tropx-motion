/**
 * User Query Handler for Horus AI (V2)
 *
 * Enhanced chat with full context injection from the V2 analysis pipeline.
 * Includes enriched sections, cross-analysis, and all session metrics.
 */

import { action, internalAction, internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { SessionMetrics, TokenUsage } from "./types";
import type {
  V2PipelineOutput,
  EnrichedSection,
  RadarScores,
  KeyFinding,
  QualityLink,
} from "./v2/types";
import type { CrossAnalysisOutput } from "./crossAnalysis/types";
import { hasFullCrossAnalysis } from "./crossAnalysis/types";
import { getValidTagsForPrompt } from "./metricTags";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Link returned in chat response */
interface ResponseLink {
  url: string;
  title: string;
  relevance: string;
}

interface UserQueryResult {
  success: boolean;
  response?: {
    blocks: unknown[];
    textResponse?: string;
    links?: ResponseLink[];
  };
  error?: string;
  tokenUsage?: TokenUsage;
}

interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// ─────────────────────────────────────────────────────────────────
// Main Query Action
// ─────────────────────────────────────────────────────────────────

/**
 * Handle a user's question about their analysis.
 * Returns visualization blocks that answer the question.
 */
export const askAnalysis = action({
  args: {
    sessionId: v.string(),
    userPrompt: v.string(),
    patientId: v.optional(v.id("users")),
    chatHistory: v.optional(v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    }))),
  },
  handler: async (ctx, args): Promise<UserQueryResult> => {
    const { sessionId, userPrompt, patientId, chatHistory } = args;

    try {
      // 1. Validate input
      if (!userPrompt.trim()) {
        return { success: false, error: "Please enter a question" };
      }

      if (userPrompt.length > 1000) {
        return { success: false, error: "Question too long (max 1000 characters)" };
      }

      // 2. Get existing analysis for context
      const analysis = await ctx.runQuery(internal.horus.queries.getAnalysis, {
        sessionId,
      });

      if (!analysis?.analysis) {
        return { success: false, error: "No analysis available for this session yet" };
      }

      // 3. Get session metrics
      const metrics = await ctx.runQuery(internal.horus.userQuery.getSessionMetrics, {
        sessionId,
      });

      if (!metrics) {
        return { success: false, error: "Session metrics not found" };
      }

      // 4. Run the user query agent
      const result = await ctx.runAction(internal.horus.userQuery.runUserQueryAgent, {
        sessionId,
        userPrompt,
        existingAnalysis: analysis.analysis,
        metrics,
        patientId,
        chatHistory: chatHistory || [],
      });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // 5. Save query to history (optional, for future reference)
      if (patientId) {
        await ctx.runMutation(internal.horus.userQuery.saveQueryHistory, {
          sessionId,
          patientId,
          userPrompt,
          response: result.response,
        });
      }

      return {
        success: true,
        response: result.response,
        tokenUsage: result.tokenUsage,
      };
    } catch (error) {
      console.error("[Horus] User query failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to process question",
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// User Query Agent
// ─────────────────────────────────────────────────────────────────

/**
 * Run the LLM to answer the user's question.
 */
export const runUserQueryAgent = internalAction({
  args: {
    sessionId: v.string(),
    userPrompt: v.string(),
    existingAnalysis: v.any(),
    metrics: v.any(),
    patientId: v.optional(v.id("users")),
    chatHistory: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    })),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    response?: { blocks: unknown[]; textResponse?: string; links?: ResponseLink[] };
    error?: string;
    tokenUsage?: TokenUsage;
  }> => {
    const { userPrompt, existingAnalysis, metrics, chatHistory } = args;

    try {
      // Build the prompt with full V2 context
      const systemPrompt = buildUserQuerySystemPrompt();
      const userMessage = buildFullV2ChatContext(userPrompt, existingAnalysis, metrics, chatHistory);

      // Call the LLM with structured output
      const llmResult = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt: userMessage,
        responseSchema: USER_QUERY_RESPONSE_SCHEMA,
        temperature: 0.3,
        maxTokens: 4096, // Increased for richer responses
      });

      if (!llmResult.text) {
        return { success: false, error: "No response from AI" };
      }

      // Parse the JSON response
      let parsedOutput: unknown;
      try {
        parsedOutput = JSON.parse(llmResult.text);
      } catch {
        return { success: false, error: "Failed to parse AI response" };
      }

      // Validate the response and extract relevant links
      const validated = validateUserQueryResponse(parsedOutput, existingAnalysis);

      return {
        success: true,
        response: {
          blocks: validated.blocks,
          textResponse: validated.textResponse,
          links: validated.links,
        },
        tokenUsage: llmResult.tokenUsage,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Agent failed",
      };
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────

function buildUserQuerySystemPrompt(): string {
  return `You are a friendly movement analysis assistant helping patients understand their rehabilitation progress.

YOUR COMMUNICATION STYLE:
- Explain findings in plain language, avoiding medical jargon
- When using technical terms, immediately explain what they mean
- Use analogies to make concepts relatable (e.g., "Think of it like...")
- Be encouraging while being honest about areas that need work
- Keep responses concise but complete

YOU HAVE FULL CONTEXT:
You have access to the complete analysis including:
- All session metrics (flexibility, speed, symmetry, etc.)
- Detailed clinical sections with evidence-backed findings
- Research citations and scientific sources
- Cross-analysis comparing to previous sessions (if available)
- Q&A reasoning explaining why each finding was flagged

USE THIS CONTEXT TO:
- Answer "why" questions by referencing the QA reasoning
- Cite specific evidence when discussing findings
- Compare to baseline/history when relevant
- Reference the userExplanation fields for patient-friendly summaries

RESPONSE FORMAT:
Respond with a JSON object:
{
  "textResponse": "Your friendly, clear answer",
  "blocks": [...visualization blocks if helpful...],
  "citedSections": ["section-id-1", "section-id-2"] // IDs of sections you referenced
}

VISUALIZATION BLOCKS (use sparingly, only when they add value):
- "stat_card": { type: "stat_card", title: "Label", metric: "<TAG>" }
- "comparison_card": { type: "comparison_card", title: "Title", leftMetric: "<LEFT_TAG>", rightMetric: "<RIGHT_TAG>" }
- "alert_card": { type: "alert_card", title: "Title", description: "...", severity: "info"|"warning"|"success" }

Valid metric tags:
${getValidTagsForPrompt()}

IMPORTANT:
- Reference specific findings from the analysis, don't make things up
- If the user asks about something not covered, say so honestly
- When citing research, mention the source naturally (e.g., "Research shows..." or "Studies have found...")`;
}

/**
 * Build full V2 chat context with all pipeline outputs.
 * Structured as markdown for optimal LLM comprehension.
 */
function buildFullV2ChatContext(
  userPrompt: string,
  existingAnalysis: unknown,
  metrics: SessionMetrics,
  chatHistory: ChatHistoryMessage[]
): string {
  const analysis = existingAnalysis as Partial<V2PipelineOutput>;
  const sections: string[] = [];

  // 1. Conversation history
  if (chatHistory.length > 0) {
    sections.push(`## Previous Conversation
${chatHistory.map((msg) => `**${msg.role === "user" ? "Patient" : "Assistant"}:** ${msg.content}`).join("\n\n")}`);
  }

  // 2. Current question
  sections.push(`## Current Question
${userPrompt}`);

  // 3. Overall assessment
  sections.push(`## Overall Assessment
**Grade:** ${analysis.overallGrade || "N/A"}
**Summary:** ${analysis.summary || "No summary available"}

### Performance Radar (1-10 scale)
${formatRadarScores(analysis.radarScores)}

### Key Findings
${formatKeyFindings(analysis.keyFindings)}

### Strengths
${analysis.strengths?.map(s => `- ${s}`).join("\n") || "- None identified"}

### Areas for Improvement
${analysis.weaknesses?.map(w => `- ${w}`).join("\n") || "- None identified"}`);

  // 4. Enriched sections (the meat of the analysis)
  if (analysis.enrichedSections?.length) {
    sections.push(`## Detailed Findings

${analysis.enrichedSections.map(section => formatEnrichedSection(section)).join("\n\n---\n\n")}`);
  }

  // 5. Cross-analysis (if available)
  if (analysis.crossAnalysis && hasFullCrossAnalysis(analysis.crossAnalysis)) {
    sections.push(formatCrossAnalysis(analysis.crossAnalysis));
  }

  // 6. Raw metrics (for precise queries)
  sections.push(`## Session Metrics (Raw Data)

### Left Leg
- Peak Flexion: ${metrics.leftLeg.peakFlexion.toFixed(1)}°
- Peak Extension: ${metrics.leftLeg.peakExtension.toFixed(1)}°
- Average ROM: ${metrics.leftLeg.averageRom.toFixed(1)}°
- Max ROM: ${metrics.leftLeg.overallMaxRom.toFixed(1)}°
- Peak Velocity: ${metrics.leftLeg.peakAngularVelocity.toFixed(0)}°/s
- Concentric Power: ${metrics.leftLeg.explosivenessConcentric.toFixed(1)} W/kg
- Loading Power: ${metrics.leftLeg.explosivenessLoading.toFixed(1)} W/kg
- Movement Smoothness (Jerk): ${metrics.leftLeg.rmsJerk.toFixed(1)}
- Consistency (ROM CoV): ${metrics.leftLeg.romCoV.toFixed(1)}%

### Right Leg
- Peak Flexion: ${metrics.rightLeg.peakFlexion.toFixed(1)}°
- Peak Extension: ${metrics.rightLeg.peakExtension.toFixed(1)}°
- Average ROM: ${metrics.rightLeg.averageRom.toFixed(1)}°
- Max ROM: ${metrics.rightLeg.overallMaxRom.toFixed(1)}°
- Peak Velocity: ${metrics.rightLeg.peakAngularVelocity.toFixed(0)}°/s
- Concentric Power: ${metrics.rightLeg.explosivenessConcentric.toFixed(1)} W/kg
- Loading Power: ${metrics.rightLeg.explosivenessLoading.toFixed(1)} W/kg
- Movement Smoothness (Jerk): ${metrics.rightLeg.rmsJerk.toFixed(1)}
- Consistency (ROM CoV): ${metrics.rightLeg.romCoV.toFixed(1)}%

### Symmetry & Coordination
- ROM Asymmetry: ${metrics.bilateral.romAsymmetry.toFixed(1)}%
- Velocity Asymmetry: ${metrics.bilateral.velocityAsymmetry.toFixed(1)}%
- Cross Correlation: ${metrics.bilateral.crossCorrelation.toFixed(3)}
- Net Global Asymmetry: ${metrics.bilateral.netGlobalAsymmetry.toFixed(1)}%
- Phase Shift: ${metrics.bilateral.phaseShift.toFixed(1)}°
- Temporal Lag: ${metrics.bilateral.temporalLag.toFixed(0)}ms
- Flexion Timing Difference: ${metrics.bilateral.maxFlexionTimingDiff.toFixed(0)}ms

${metrics.opiScore !== undefined ? `### Overall Performance Index\n- OPI Score: ${metrics.opiScore.toFixed(0)}/100 (${metrics.opiGrade || "N/A"})` : ""}`);

  // 7. Recommendations
  if (analysis.recommendations?.length) {
    sections.push(`## Recommendations
${analysis.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`);
  }

  return sections.join("\n\n───────────────────────────────────────\n\n");
}

// ─────────────────────────────────────────────────────────────────
// Context Formatting Helpers
// ─────────────────────────────────────────────────────────────────

function formatRadarScores(radar?: RadarScores): string {
  if (!radar) return "- Not available";
  return `- Flexibility: ${radar.flexibility}/10
- Consistency: ${radar.consistency}/10
- Symmetry: ${radar.symmetry}/10
- Smoothness: ${radar.smoothness}/10
- Control: ${radar.control}/10`;
}

function formatKeyFindings(findings?: KeyFinding[]): string {
  if (!findings?.length) return "- No key findings";
  return findings.map(f => `- [${f.severity.toUpperCase()}] ${f.text}`).join("\n");
}

function formatEnrichedSection(section: EnrichedSection): string {
  const parts: string[] = [];

  // Header with severity
  parts.push(`### ${section.title} [${section.severity}]
**Domain:** ${section.domain} | **Priority:** ${section.priority}/10
**Section ID:** ${section.id}`);

  // Clinical narrative (enriched with evidence)
  parts.push(`**Clinical Finding:**
${section.enrichedNarrative || section.clinicalNarrative}`);

  // Patient-friendly explanation
  if (section.userExplanation) {
    parts.push(`**In Simple Terms:**
${section.userExplanation.summary}

**What This Means:** ${section.userExplanation.whatItMeans}
**Why It Matters:** ${section.userExplanation.whyItMatters}
${section.userExplanation.analogy ? `**Think of it like:** ${section.userExplanation.analogy}` : ""}`);
  }

  // QA Reasoning (why this was flagged)
  if (section.qaReasoning?.length) {
    parts.push(`**Clinical Reasoning:**
${section.qaReasoning.map(qa => `Q: ${qa.question}\nA: ${qa.answer}`).join("\n\n")}`);
  }

  // Metric contributions
  if (section.metricContributions?.length) {
    parts.push(`**Supporting Metrics:**
${section.metricContributions.map(m => `- ${m.metric}: ${m.value}${m.unit} (${m.role})`).join("\n")}`);
  }

  // Citations
  if (section.citations?.length) {
    parts.push(`**Research Evidence:**
${section.citations.map(c => `- [${c.tier}] "${c.text}" — ${c.source}`).join("\n")}`);
  }

  // Links
  if (section.links?.length) {
    const featuredLinks = section.links.filter(l => l.featured);
    const otherLinks = section.links.filter(l => !l.featured);

    if (featuredLinks.length) {
      parts.push(`**Key Sources:**
${featuredLinks.map(l => `- [${l.tier}] ${l.title}: ${l.url}`).join("\n")}`);
    }
    if (otherLinks.length) {
      parts.push(`**Additional Sources:**
${otherLinks.slice(0, 3).map(l => `- ${l.title}: ${l.url}`).join("\n")}`);
    }
  }

  // Recommendation
  if (section.recommendation) {
    parts.push(`**Recommendation:** ${section.recommendation}`);
  }

  return parts.join("\n\n");
}

function formatCrossAnalysis(cross: CrossAnalysisOutput): string {
  const parts: string[] = [];

  parts.push(`## Historical Analysis (${cross.sessionsAnalyzed} sessions over ${cross.dateRangeDays} days)
**Confidence:** ${cross.analysisConfidence}

**Summary:** ${cross.summary}`);

  // Trends
  if (cross.trendInsights?.length) {
    parts.push(`### Trends
${cross.trendInsights.map(t =>
  `- **${t.displayName}:** ${t.direction} (${t.magnitude}) — ${t.changePercent > 0 ? "+" : ""}${t.changePercent.toFixed(1)}% from baseline
  ${t.narrative}`
).join("\n")}`);
  }

  // Patterns
  if (cross.recurringPatterns?.length) {
    parts.push(`### Recurring Patterns
${cross.recurringPatterns.map(p =>
  `- **${p.title}** (${p.patternType}, ${(p.confidence * 100).toFixed(0)}% confidence)
  ${p.description}
  Recommendation: ${p.recommendation}`
).join("\n\n")}`);
  }

  // Baseline comparison
  if (cross.baselineComparison) {
    parts.push(`### Compared to Your Baseline
**Overall:** ${cross.baselineComparison.overallAssessment}
**Performance:** ${cross.baselineComparison.comparedToBaseline} baseline

${cross.baselineComparison.significantDeviations?.length
  ? `Significant changes:\n${cross.baselineComparison.significantDeviations.map(d =>
      `- ${d.displayName}: ${d.currentValue.toFixed(1)} vs baseline ${d.baselineMedian.toFixed(1)} (${d.direction} by ${Math.abs(d.deviationPercent).toFixed(0)}%)`
    ).join("\n")}`
  : "No significant deviations from your baseline."}`);
  }

  // Refined insights
  if (cross.refinedInsights?.length) {
    parts.push(`### Key Insights
${cross.refinedInsights.map(i =>
  `**${i.title}**
${i.summary}
${i.details}`
).join("\n\n")}`);
  }

  return parts.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────
// Response Schema
// ─────────────────────────────────────────────────────────────────

const USER_QUERY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    textResponse: {
      type: "string",
      description: "Clear, friendly answer to the user's question in plain language",
    },
    blocks: {
      type: "array",
      description: "Visualization blocks to display (use sparingly)",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["stat_card", "comparison_card", "alert_card"],
            description: "Block type - must be exact name",
          },
          title: {
            type: "string",
            description: "Title/label for the block",
          },
          metric: {
            type: "string",
            description: "Metric tag for stat_card blocks (e.g. <OPI_SCORE>)",
          },
          leftMetric: {
            type: "string",
            description: "Left leg metric tag for comparison_card blocks",
          },
          rightMetric: {
            type: "string",
            description: "Right leg metric tag for comparison_card blocks",
          },
          leftLabel: {
            type: "string",
            description: "Label for left side in comparison_card (default: Left Leg)",
          },
          rightLabel: {
            type: "string",
            description: "Label for right side in comparison_card (default: Right Leg)",
          },
          showDifference: {
            type: "boolean",
            description: "Show difference in comparison_card",
          },
          description: {
            type: "string",
            description: "Description for alert_card",
          },
          severity: {
            type: "string",
            enum: ["info", "warning", "success"],
            description: "Alert severity for alert_card",
          },
        },
        required: ["type", "title"],
      },
    },
    citedSections: {
      type: "array",
      description: "IDs of enriched sections you referenced in your answer",
      items: {
        type: "string",
      },
    },
  },
  required: ["textResponse", "blocks"],
};

// ─────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────

interface QueryBlock {
  type: string;
  title?: string;
  metric?: string;
  leftMetric?: string;
  rightMetric?: string;
  leftLabel?: string;
  rightLabel?: string;
  showDifference?: boolean;
  description?: string;
  severity?: string;
}

interface LLMResponse {
  textResponse?: string;
  blocks?: unknown[];
  citedSections?: string[];
}

function validateUserQueryResponse(
  response: unknown,
  existingAnalysis?: unknown
): {
  blocks: unknown[];
  textResponse: string;
  links: ResponseLink[];
} {
  const resp = response as LLMResponse;
  const analysis = existingAnalysis as Partial<V2PipelineOutput> | undefined;

  // Normalize and validate blocks
  const normalizedBlocks = Array.isArray(resp.blocks)
    ? resp.blocks
        .filter((b): b is QueryBlock => b !== null && typeof b === "object" && "type" in b)
        .map((block) => {
          // Add default values for comparison_card
          if (block.type === "comparison_card") {
            return {
              ...block,
              leftLabel: block.leftLabel || "Left Leg",
              rightLabel: block.rightLabel || "Right Leg",
              showDifference: block.showDifference ?? true,
            };
          }
          // Add default severity for alert_card
          if (block.type === "alert_card") {
            return {
              ...block,
              severity: block.severity || "info",
            };
          }
          return block;
        })
    : [];

  // Extract relevant links from cited sections
  const links = extractRelevantLinks(resp.citedSections, analysis);

  return {
    textResponse: resp.textResponse || "I couldn't generate a response.",
    blocks: normalizedBlocks,
    links,
  };
}

/**
 * Extract links from the sections that were cited in the response.
 */
function extractRelevantLinks(
  citedSectionIds?: string[],
  analysis?: Partial<V2PipelineOutput>
): ResponseLink[] {
  if (!citedSectionIds?.length || !analysis?.enrichedSections?.length) {
    return [];
  }

  const links: ResponseLink[] = [];
  const seenUrls = new Set<string>();

  for (const sectionId of citedSectionIds) {
    const section = analysis.enrichedSections.find(s => s.id === sectionId);
    if (!section?.links?.length) continue;

    // Prioritize featured links, then take top 2 from each section
    const sectionLinks = [...section.links]
      .sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0))
      .slice(0, 2);

    for (const link of sectionLinks) {
      if (seenUrls.has(link.url)) continue;
      seenUrls.add(link.url);

      links.push({
        url: link.url,
        title: link.title,
        relevance: link.relevance || section.title,
      });
    }
  }

  // Limit total links to avoid overwhelming the user
  return links.slice(0, 5);
}

// ─────────────────────────────────────────────────────────────────
// Helper Queries & Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Get session metrics for user query context.
 */
export const getSessionMetrics = query({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<SessionMetrics | null> => {
    const metricsDoc = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!metricsDoc || metricsDoc.status !== "complete") {
      return null;
    }

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!session) {
      return null;
    }

    const left = metricsDoc.leftLeg;
    const right = metricsDoc.rightLeg;
    const bilateral = metricsDoc.bilateralAnalysis;
    const advanced = metricsDoc.advancedAsymmetry;
    const temporal = metricsDoc.temporalCoordination;

    return {
      sessionId,
      leftLeg: {
        overallMaxRom: left?.overallMaxROM ?? 0,
        averageRom: left?.averageROM ?? 0,
        peakFlexion: left?.peakFlexion ?? 0,
        peakExtension: left?.peakExtension ?? 0,
        peakAngularVelocity: left?.peakAngularVelocity ?? 0,
        explosivenessConcentric: left?.explosivenessConcentric ?? 0,
        explosivenessLoading: left?.explosivenessLoading ?? 0,
        rmsJerk: left?.rmsJerk ?? 0,
        romCoV: left?.romCoV ?? 0,
      },
      rightLeg: {
        overallMaxRom: right?.overallMaxROM ?? 0,
        averageRom: right?.averageROM ?? 0,
        peakFlexion: right?.peakFlexion ?? 0,
        peakExtension: right?.peakExtension ?? 0,
        peakAngularVelocity: right?.peakAngularVelocity ?? 0,
        explosivenessConcentric: right?.explosivenessConcentric ?? 0,
        explosivenessLoading: right?.explosivenessLoading ?? 0,
        rmsJerk: right?.rmsJerk ?? 0,
        romCoV: right?.romCoV ?? 0,
      },
      bilateral: {
        romAsymmetry: bilateral?.asymmetryIndices?.overallMaxROM ?? 0,
        velocityAsymmetry: bilateral?.asymmetryIndices?.peakAngularVelocity ?? 0,
        crossCorrelation: bilateral?.temporalAsymmetry?.crossCorrelation ?? 0,
        realAsymmetryAvg: advanced?.avgRealAsymmetry ?? 0,
        netGlobalAsymmetry: bilateral?.netGlobalAsymmetry ?? 0,
        phaseShift: bilateral?.temporalAsymmetry?.phaseShift ?? 0,
        temporalLag: bilateral?.temporalAsymmetry?.temporalLag ?? 0,
        maxFlexionTimingDiff: temporal?.maxFlexionTimingDiff ?? 0,
      },
      opiScore: metricsDoc.opiResult?.overallScore,
      opiGrade: metricsDoc.opiResult?.grade,
      movementType: metricsDoc.movementClassification?.type === "bilateral" ? "bilateral" : "unilateral",
      recordedAt: session.startTime,
    };
  },
});

/**
 * Save query to history for future reference.
 */
export const saveQueryHistory = internalMutation({
  args: {
    sessionId: v.string(),
    patientId: v.id("users"),
    userPrompt: v.string(),
    response: v.any(),
  },
  handler: async (ctx, args) => {
    // For now, we just log it. Could store in a table for chat history.
    console.log(`[Horus] User query saved: ${args.userPrompt.slice(0, 50)}...`);
  },
});

// ─────────────────────────────────────────────────────────────────
// Get Recent Queries (for chat history UI)
// ─────────────────────────────────────────────────────────────────

export const getRecentQueries = query({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (_ctx, { limit = 10 }) => {
    // Placeholder - would query from a chat history table
    return [];
  },
});
