/**
 * Recording Chunks Convex Functions
 * Handles compressed quaternion data storage and retrieval.
 */

import { v } from "convex/values";
import { mutation, query, internalQuery, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { getCurrentUser } from "./lib/auth";
import { COMPRESSION } from "./schema";

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

/** Create a new recording chunk with compressed data. */
export const createChunk = mutation({
  args: {
    sessionId: v.string(),
    chunkIndex: v.number(),
    startTime: v.number(),
    endTime: v.number(),
    sampleCount: v.number(),

    // Compressed quaternion data (bytes)
    leftKneeCompressed: v.optional(v.bytes()),
    rightKneeCompressed: v.optional(v.bytes()),

    // Sparse flags
    leftKneeInterpolated: v.array(v.number()),
    leftKneeMissing: v.array(v.number()),
    rightKneeInterpolated: v.array(v.number()),
    rightKneeMissing: v.array(v.number()),

    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Verify session exists and is owned by user
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found. Create session first.`);
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to add chunks to this session");
    }

    // Check for duplicate chunk
    const existing = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) =>
        q.eq("sessionId", args.sessionId).eq("chunkIndex", args.chunkIndex)
      )
      .first();

    if (existing) {
      throw new Error(`Chunk ${args.chunkIndex} already exists for session ${args.sessionId}`);
    }

    // Create chunk
    const chunkId = await ctx.db.insert("recordingChunks", {
      sessionId: args.sessionId,
      chunkIndex: args.chunkIndex,
      startTime: args.startTime,
      endTime: args.endTime,
      sampleCount: args.sampleCount,
      leftKneeCompressed: args.leftKneeCompressed,
      rightKneeCompressed: args.rightKneeCompressed,
      leftKneeInterpolated: args.leftKneeInterpolated,
      leftKneeMissing: args.leftKneeMissing,
      rightKneeInterpolated: args.rightKneeInterpolated,
      rightKneeMissing: args.rightKneeMissing,
      compressionVersion: COMPRESSION.VERSION,
    });

    // Check if all chunks are uploaded
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === session.totalChunks) {
      // All chunks uploaded, trigger metrics computation
      await ctx.scheduler.runAfter(0, internal.recordingMetrics.triggerMetricComputation, {
        sessionId: args.sessionId,
      });
    }

    return {
      success: true,
      chunkId,
      chunkIndex: args.chunkIndex,
      chunksUploaded: chunks.length,
      totalChunks: session.totalChunks,
    };
  },
});

/** Delete all chunks for a session. */
export const deleteSessionChunks = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    for (const chunk of chunks) {
      await ctx.db.delete(chunk._id);
    }

    return { deleted: chunks.length };
  },
});

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

/** Get all chunks for a session (compressed). */
export const getSessionChunks = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  },
});

/** Get a specific chunk. */
export const getChunk = query({
  args: {
    sessionId: v.string(),
    chunkIndex: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) =>
        q.eq("sessionId", args.sessionId).eq("chunkIndex", args.chunkIndex)
      )
      .first();
  },
});

/** Get chunk count for a session. */
export const getChunkCount = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return chunks.length;
  },
});

/** Internal query to get chunks for metrics computation. */
export const getChunksInternal = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  },
});

/** Get session with chunks for full data loading. */
export const getSessionWithChunks = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;

    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return {
      session,
      chunks: chunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
    };
  },
});

/** Get total compressed size for a session. */
export const getSessionSize = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    let totalBytes = 0;
    for (const chunk of chunks) {
      if (chunk.leftKneeCompressed) {
        totalBytes += chunk.leftKneeCompressed.byteLength;
      }
      if (chunk.rightKneeCompressed) {
        totalBytes += chunk.rightKneeCompressed.byteLength;
      }
    }

    return {
      chunkCount: chunks.length,
      totalCompressedBytes: totalBytes,
      totalCompressedKB: Math.round(totalBytes / 1024 * 10) / 10,
    };
  },
});
