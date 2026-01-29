/**
 * Horus Chat History
 *
 * Manages persistent chat conversations for user queries about session analysis.
 * Each session has its own chat history that persists across page refreshes.
 * Chats are owned by the user who created them — only owners can modify.
 * Other users can fork a chat to create their own copy.
 */

import { mutation, query, internalMutation, internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getAuthUserId } from "../lib/auth";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

const chatMessageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  blocks: v.optional(v.any()),
  timestamp: v.number(),
  userId: v.optional(v.id("users")),
});

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: unknown[];
  timestamp: number;
  userId?: Id<"users">;
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

async function assertChatOwner(
  ctx: { db: any; auth: any },
  doc: { ownerId?: Id<"users"> }
) {
  const userId = await getAuthUserId(ctx as any);
  if (doc.ownerId && userId && doc.ownerId !== userId) {
    throw new Error("Cannot modify another user's chat");
  }
}

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get chat history for a session.
 * Returns messages and ownership info.
 */
export const getChatHistory = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
      .first();

    return {
      messages: (doc?.messages ?? []) as ChatMessage[],
      ownerId: (doc?.ownerId ?? null) as Id<"users"> | null,
    };
  },
});

/**
 * List all chats for a motion session.
 * Uses range query on sessionId to find all chats with the `__chat__` prefix.
 */
export const listChats = query({
  args: {
    parentSessionId: v.string(),
  },
  handler: async (ctx, { parentSessionId }) => {
    const prefix = `${parentSessionId}__chat__`;
    const docs = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q: any) =>
        q.gte("sessionId", prefix).lt("sessionId", prefix + "\uffff")
      )
      .collect();

    return docs
      .filter((doc: any) => doc.messages.length > 0)
      .map((doc: any) => {
        const firstUserMsg = doc.messages.find((m: any) => m.role === "user");
        const lastMsg = doc.messages[doc.messages.length - 1];
        return {
          sessionId: doc.sessionId as string,
          ownerId: (doc.ownerId ?? null) as Id<"users"> | null,
          name: (doc.name ?? null) as string | null,
          preview: (firstUserMsg?.content ?? "Empty chat") as string,
          messageCount: doc.messages.length as number,
          lastTimestamp: (lastMsg?.timestamp ?? 0) as number,
        };
      })
      .sort((a: any, b: any) => b.lastTimestamp - a.lastTimestamp);
  },
});

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

/**
 * Add a message to the chat history.
 * Creates the history document if it doesn't exist.
 * Only the owner can add messages to an existing chat.
 */
export const addMessage = mutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    message: chatMessageValidator,
  },
  handler: async (ctx, { sessionId, patientId, message }) => {
    const userId = await getAuthUserId(ctx);

    const existing = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existing) {
      await assertChatOwner(ctx, existing);
      await ctx.db.patch(existing._id, {
        messages: [...existing.messages, message],
      });
      return existing._id;
    }

    return ctx.db.insert("horusChatHistory", {
      sessionId,
      patientId,
      ownerId: userId ?? undefined,
      messages: [message],
    });
  },
});

/**
 * Add multiple messages at once (useful for adding user + assistant pair).
 * Only the owner can add messages to an existing chat.
 */
export const addMessages = mutation({
  args: {
    sessionId: v.string(),
    patientId: v.optional(v.id("users")),
    messages: v.array(chatMessageValidator),
  },
  handler: async (ctx, { sessionId, patientId, messages }) => {
    const userId = await getAuthUserId(ctx);

    const existing = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (existing) {
      await assertChatOwner(ctx, existing);
      await ctx.db.patch(existing._id, {
        messages: [...existing.messages, ...messages],
      });
      return existing._id;
    }

    // Set fallback name from first user message
    const firstUserMsg = messages.find((m) => m.role === "user");
    const fallbackName = firstUserMsg
      ? firstUserMsg.content.slice(0, 60)
      : undefined;

    const docId = await ctx.db.insert("horusChatHistory", {
      sessionId,
      patientId,
      ownerId: userId ?? undefined,
      messages,
      name: fallbackName,
    });

    // Schedule AI-generated name
    if (firstUserMsg) {
      await ctx.scheduler.runAfter(0, internal.horus.chat.generateChatName, {
        chatId: docId,
        firstMessage: firstUserMsg.content,
      });
    }

    return docId;
  },
});

/**
 * Delete a message and optionally its response.
 * Only the chat owner can delete messages.
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
    await assertChatOwner(ctx, doc);

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
 * Truncate messages from a specific message (inclusive or exclusive).
 * Only the chat owner can truncate.
 */
export const truncateFrom = mutation({
  args: {
    sessionId: v.string(),
    messageId: v.string(),
    inclusive: v.boolean(),
  },
  handler: async (ctx, { sessionId, messageId, inclusive }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!doc) return { success: false, error: "Chat not found" };
    await assertChatOwner(ctx, doc);

    const messages = doc.messages;
    const idx = messages.findIndex((m) => m.id === messageId);

    if (idx === -1) return { success: false, error: "Message not found" };

    const keepUntil = inclusive ? idx : idx + 1;
    const newMessages = messages.slice(0, keepUntil);

    await ctx.db.patch(doc._id, { messages: newMessages });
    return { success: true, remainingCount: newMessages.length };
  },
});

/**
 * Fork/branch a chat - anyone can fork.
 * Creates a new chat owned by the forking user with messages up to the fork point.
 */
export const forkChat = mutation({
  args: {
    sessionId: v.string(),
    messageId: v.string(),
    patientId: v.optional(v.id("users")),
  },
  handler: async (ctx, { sessionId, messageId, patientId }) => {
    const userId = await getAuthUserId(ctx);

    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!doc) return { success: false, error: "Chat not found" };

    const messages = doc.messages;
    const idx = messages.findIndex((m) => m.id === messageId);

    if (idx === -1) return { success: false, error: "Message not found" };

    const forkedMessages = messages.slice(0, idx + 1);

    const forkSuffix = `_fork_${Date.now()}`;
    const newSessionId = `${sessionId}${forkSuffix}`;

    // Fork is owned by the forking user, not the original owner
    await ctx.db.insert("horusChatHistory", {
      sessionId: newSessionId,
      patientId: patientId ?? doc.patientId,
      ownerId: userId ?? undefined,
      messages: forkedMessages,
    });

    return { success: true, newSessionId, messageCount: forkedMessages.length };
  },
});

/**
 * Clear all chat history for a session.
 * Only the owner can clear.
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
      await assertChatOwner(ctx, doc);
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

/**
 * Rename a chat. Owner-only.
 */
export const renameChat = mutation({
  args: {
    sessionId: v.string(),
    name: v.string(),
  },
  handler: async (ctx, { sessionId, name }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!doc) throw new Error("Chat not found");
    await assertChatOwner(ctx, doc);

    await ctx.db.patch(doc._id, { name: name.slice(0, 100) });
    return true;
  },
});

/**
 * Delete an entire chat conversation. Owner-only.
 */
export const deleteChat = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, { sessionId }) => {
    const doc = await ctx.db
      .query("horusChatHistory")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!doc) throw new Error("Chat not found");
    await assertChatOwner(ctx, doc);

    await ctx.db.delete(doc._id);
    return true;
  },
});

/**
 * Internal mutation to set the AI-generated chat name.
 */
export const setChatName = internalMutation({
  args: {
    chatId: v.id("horusChatHistory"),
    name: v.string(),
  },
  handler: async (ctx, { chatId, name }) => {
    const doc = await ctx.db.get(chatId);
    if (!doc) return;
    await ctx.db.patch(chatId, { name: name.slice(0, 100) });
  },
});

/**
 * Internal action to generate an AI chat name from the first message.
 */
export const generateChatName = internalAction({
  args: {
    chatId: v.id("horusChatHistory"),
    firstMessage: v.string(),
  },
  handler: async (ctx, { chatId, firstMessage }) => {
    try {
      const result = await ctx.runAction(internal.horus.llm.vertex.callVertexAI, {
        systemPrompt:
          "Generate a concise 3-5 word title for this chat conversation. " +
          "Return ONLY the title text, no quotes, no punctuation at the end.",
        userPrompt: firstMessage,
        temperature: 0.7,
        maxTokens: 30,
      });

      const name = (result.text ?? "").trim().slice(0, 100);
      if (name) {
        await ctx.runMutation(internal.horus.chat.setChatName, {
          chatId,
          name,
        });
      }
    } catch (err) {
      console.error("[Horus] Failed to generate chat name:", err);
      // Fallback name already set during insert, so this is non-fatal
    }
  },
});
