/**
 * Horus Chat History
 *
 * Manages persistent chat conversations for user queries about session analysis.
 * Each session has its own chat history that persists across page refreshes.
 */

import { mutation, query, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

const chatMessageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  blocks: v.optional(v.any()),
  timestamp: v.number(),
});

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: unknown[];
  timestamp: number;
};

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get chat history for a session.
 */
export const getChatHistory = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }): Promise<ChatMessage[]> => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    return doc?.messages ?? [];
  },
});

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Add a message to the chat history.
 * Creates the history document if it doesn't exist.
 */
export const addMessage = mutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    message: chatMessageValidator,
  },
  handler: async (ctx, { sessionId, patientId, message }) => {
    const existing = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        messages: [...existing.messages, message],
      });
      return existing._id;
    }

    return ctx.db.insert("horusChatHistory", {
      sessionId,
      patientId,
      messages: [message],
    });
  },
});

/**
 * Add multiple messages at once (useful for adding user + assistant pair).
 */
export const addMessages = mutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    messages: v.array(chatMessageValidator),
  },
  handler: async (ctx, { sessionId, patientId, messages }) => {
    const existing = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        messages: [...existing.messages, ...messages],
      });
      return existing._id;
    }

    return ctx.db.insert("horusChatHistory", {
      sessionId,
      patientId,
      messages,
    });
  },
});

/**
 * Delete a message and optionally its response.
 * If deleting a user message, also removes the following assistant message.
 */
export const deleteMessage = mutation({
  args: {
    sessionId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, { sessionId, messageId }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!doc) return false;

    const messages = doc.messages;
    const idx = messages.findIndex((m) => m.id === messageId);

    if (idx === -1) return false;

    // If it's a user message and followed by assistant, remove both
    const isUserMessage = messages[idx].role === "user";
    const hasFollowingAssistant =
      idx + 1 < messages.length && messages[idx + 1].role === "assistant";

    const newMessages = messages.filter((_, i) => {
      if (i === idx) return false;
      if (isUserMessage && hasFollowingAssistant && i === idx + 1) return false;
      return true;
    });

    await ctx.db.patch(doc._id, { messages: newMessages });
    return true;
  },
});

/**
 * Clear all chat history for a session.
 */
export const clearHistory = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (doc) {
      await ctx.db.delete(doc._id);
    }

    return true;
  },
});

/**
 * Internal mutation to clear chat history (called when new analysis is generated).
 */
export const clearHistoryInternal = internalMutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (doc) {
      await ctx.db.delete(doc._id);
      console.log(`[Horus] Cleared chat history for session: ${sessionId}`);
    }
  },
});
