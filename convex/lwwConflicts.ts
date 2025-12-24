/**
 * LWW Conflict Logging
 *
 * Logs when mutations are rejected due to Last-Write-Wins conflict resolution.
 * This is for observability only - helps debug sync issues without blocking.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ConflictInfo {
  userId: Id<"users">;
  mutationPath: string;
  recordId: string;
  clientTimestamp: number;
  serverTimestamp: number;
  rejectedArgs?: unknown;
}

// ─────────────────────────────────────────────────────────────────
// Logging
// ─────────────────────────────────────────────────────────────────

/**
 * Log a LWW conflict (fire and forget, doesn't block the mutation).
 * Call this from mutations when rejecting stale updates.
 */
export const logConflict = internalMutation({
  args: {
    userId: v.id("users"),
    mutationPath: v.string(),
    recordId: v.string(),
    clientTimestamp: v.number(),
    serverTimestamp: v.number(),
    rejectedArgs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("lwwConflicts", {
      userId: args.userId,
      mutationPath: args.mutationPath,
      recordId: args.recordId,
      clientTimestamp: args.clientTimestamp,
      serverTimestamp: args.serverTimestamp,
      rejectedArgs: args.rejectedArgs,
    });
  },
});

// ─────────────────────────────────────────────────────────────────
// Cleanup (called by cron)
// ─────────────────────────────────────────────────────────────────

/** Delete conflicts older than 7 days */
export const cleanupOldConflicts = internalMutation({
  args: {},
  handler: async (ctx) => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    // Get old conflicts
    const oldConflicts = await ctx.db
      .query("lwwConflicts")
      .withIndex("by_created")
      .filter((q) => q.lt(q.field("_creationTime"), oneWeekAgo))
      .collect();

    // Delete them
    let deleted = 0;
    for (const conflict of oldConflicts) {
      await ctx.db.delete(conflict._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[lwwConflicts] Cleaned up ${deleted} old conflicts`);
    }

    return { deleted };
  },
});
