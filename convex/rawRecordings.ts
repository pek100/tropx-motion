import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { requireAuth } from "./lib/auth";
import { RECORDING_CONSTANTS } from "./schema";

// Quaternion validator
const quaternionValidator = v.object({
  w: v.float64(),
  x: v.float64(),
  y: v.float64(),
  z: v.float64(),
});

// Raw sample validator
const rawSampleValidator = v.object({
  t: v.number(),
  lq: v.optional(quaternionValidator),
  rq: v.optional(quaternionValidator),
});

// ─────────────────────────────────────────────────────────────────
// Raw Recording Chunk Creation
// ─────────────────────────────────────────────────────────────────

export const createChunk = mutation({
  args: {
    sessionId: v.string(),
    chunkIndex: v.number(),
    totalChunks: v.number(),
    samples: v.array(rawSampleValidator),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const now = Date.now();
    const expiresAt = now + RECORDING_CONSTANTS.RAW_RECORDING_TTL_MS;

    const chunkId = await ctx.db.insert("rawRecordings", {
      sessionId: args.sessionId,
      chunkIndex: args.chunkIndex,
      totalChunks: args.totalChunks,
      samples: args.samples,
      expiresAt,
    });

    return chunkId;
  },
});

// ─────────────────────────────────────────────────────────────────
// TTL Cleanup (called by cron)
// ─────────────────────────────────────────────────────────────────

export const deleteExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const expiredChunks = await ctx.db
      .query("rawRecordings")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .collect();

    let deletedCount = 0;
    for (const chunk of expiredChunks) {
      await ctx.db.delete(chunk._id);
      deletedCount++;
    }

    return { deletedCount };
  },
});
