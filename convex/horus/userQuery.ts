/**
 * User Query Handler for Horus AI
 *
 * Allows users to ask questions about their analysis directly.
 * The AI responds with validated visualization blocks.
 */

import { action, internalAction, internalMutation, query } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { SessionMetrics, TokenUsage } from "./types";
import { getValidTagsForPrompt } from "./metricTags";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface UserQueryResult {
  success: boolean;
  response?: {
    blocks: unknown[];
    textResponse?: string;
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
    response?: { blocks: unknown[]; textResponse?: string };
    error?: string;
    tokenUsage?: TokenUsage;
  }> => {
    const { userPrompt, existingAnalysis, metrics, chatHistory } = args;

    try {
      // Build the prompt
      const systemPrompt = buildUserQuerySystemPrompt();
      const userMessage = buildUserQueryMessage(userPrompt, existingAnalysis, metrics, chatHistory);

      // Call the LLM with structured output
      const llmResult = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt,
        userPrompt: userMessage,
        responseSchema: USER_QUERY_RESPONSE_SCHEMA,
        temperature: 0.3, // Lower temperature for more focused responses
        maxTokens: 2048,
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

      // Validate the response
      const validated = validateUserQueryResponse(parsedOutput);

      return {
        success: true,
        response: {
          blocks: validated.blocks,
          textResponse: validated.textResponse,
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
  return `You are a clinical movement analysis AI assistant. Users will ask questions about their rehabilitation session analysis.

Your role is to:
1. Answer questions clearly and concisely
2. Reference specific metrics from the session data
3. Provide visualization blocks when helpful
4. Maintain clinical accuracy

IMPORTANT RULES:
- Only use metrics that exist in the provided data
- Use ONLY these valid metric tags for visualization blocks:
${getValidTagsForPrompt()}

- Be helpful but don't make claims beyond what the data supports
- If asked about something not in the data, say so clearly
- Keep responses focused and actionable

RESPONSE FORMAT:
You must respond with a JSON object containing:
1. "textResponse": A clear, conversational answer to the user's question
2. "blocks": An array of visualization blocks (can be empty if just text is needed)

Block types you can use:
- "stat_card": Show a single metric value
  { type: "stat_card", title: "Label for metric", metric: "<TAG>" }

- "comparison_card": Compare left vs right leg
  { type: "comparison_card", title: "Comparison title", leftMetric: "<LEFT_TAG>", rightMetric: "<RIGHT_TAG>", leftLabel: "Left Leg", rightLabel: "Right Leg", showDifference: true }

- "alert_card": Highlight important info
  { type: "alert_card", title: "Alert title", description: "Details...", severity: "info"|"warning"|"success" }

IMPORTANT: Use EXACT block type names (stat_card, comparison_card, alert_card). Do not use abbreviated names.`;
}

function buildUserQueryMessage(
  userPrompt: string,
  existingAnalysis: unknown,
  metrics: SessionMetrics,
  chatHistory: ChatHistoryMessage[]
): string {
  const analysis = existingAnalysis as {
    summary?: string;
    insights?: Array<{ title: string; content: string }>;
    strengths?: string[];
    weaknesses?: string[];
  };

  // Build conversation history section
  let conversationContext = "";
  if (chatHistory.length > 0) {
    conversationContext = `## Previous Conversation
${chatHistory.map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`).join("\n\n")}

---

`;
  }

  return `${conversationContext}## Current Question
${userPrompt}

## Session Analysis Summary
${analysis.summary || "No summary available"}

## Key Strengths
${analysis.strengths?.join("\n- ") || "None identified"}

## Key Weaknesses
${analysis.weaknesses?.join("\n- ") || "None identified"}

## Session Metrics

### Left Leg
- Peak Flexion: ${metrics.leftLeg.peakFlexion.toFixed(1)}°
- Peak Extension: ${metrics.leftLeg.peakExtension.toFixed(1)}°
- Average ROM: ${metrics.leftLeg.averageRom.toFixed(1)}°
- Max ROM: ${metrics.leftLeg.overallMaxRom.toFixed(1)}°
- Velocity: ${metrics.leftLeg.peakAngularVelocity.toFixed(0)}°/s
- Power: ${metrics.leftLeg.explosivenessConcentric.toFixed(0)} W/kg
- Jerk: ${metrics.leftLeg.rmsJerk.toFixed(1)}

### Right Leg
- Peak Flexion: ${metrics.rightLeg.peakFlexion.toFixed(1)}°
- Peak Extension: ${metrics.rightLeg.peakExtension.toFixed(1)}°
- Average ROM: ${metrics.rightLeg.averageRom.toFixed(1)}°
- Max ROM: ${metrics.rightLeg.overallMaxRom.toFixed(1)}°
- Velocity: ${metrics.rightLeg.peakAngularVelocity.toFixed(0)}°/s
- Power: ${metrics.rightLeg.explosivenessConcentric.toFixed(0)} W/kg
- Jerk: ${metrics.rightLeg.rmsJerk.toFixed(1)}

### Bilateral/Symmetry
- ROM Asymmetry: ${metrics.bilateral.romAsymmetry.toFixed(1)}%
- Velocity Asymmetry: ${metrics.bilateral.velocityAsymmetry.toFixed(1)}%
- Cross Correlation: ${metrics.bilateral.crossCorrelation.toFixed(2)}
- Net Asymmetry: ${metrics.bilateral.netGlobalAsymmetry.toFixed(1)}%

${metrics.opiScore !== undefined ? `### Performance Score\n- OPI Score: ${metrics.opiScore.toFixed(0)}/100` : ""}

Please answer the user's question based on this data. Provide visualization blocks if they would help illustrate the answer.`;
}

// ─────────────────────────────────────────────────────────────────
// Response Schema
// ─────────────────────────────────────────────────────────────────

const USER_QUERY_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    textResponse: {
      type: "string",
      description: "Clear, conversational answer to the user's question",
    },
    blocks: {
      type: "array",
      description: "Visualization blocks to display (can be empty)",
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

function validateUserQueryResponse(response: unknown): {
  blocks: unknown[];
  textResponse: string;
} {
  const resp = response as { textResponse?: string; blocks?: unknown[] };

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

  return {
    textResponse: resp.textResponse || "I couldn't generate a response.",
    blocks: normalizedBlocks,
  };
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
