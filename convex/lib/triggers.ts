/**
 * Database Triggers - Auto-set modifiedAt on all mutations
 *
 * Uses convex-helpers Triggers to automatically update modifiedAt
 * timestamp on every insert/update operation.
 *
 * Note: Cannot use _modifiedAt (underscore prefix reserved for system fields)
 *
 * @see https://stack.convex.dev/triggers
 */

import { Triggers } from "convex-helpers/server/triggers";
import { DataModel } from "../_generated/dataModel";

export const triggers = new Triggers<DataModel>();

// Register modifiedAt trigger for tracked tables
// The trigger fires after the mutation, so we can safely patch
triggers.register("users", async (ctx, change) => {
  if (change.newDoc) {
    await ctx.db.patch(change.id, { modifiedAt: Date.now() } as any);
  }
});

triggers.register("recordingSessions", async (ctx, change) => {
  if (change.newDoc) {
    await ctx.db.patch(change.id, { modifiedAt: Date.now() } as any);
  }
});

triggers.register("recordingMetrics", async (ctx, change) => {
  if (change.newDoc) {
    await ctx.db.patch(change.id, { modifiedAt: Date.now() } as any);
  }
});

triggers.register("invites", async (ctx, change) => {
  if (change.newDoc) {
    await ctx.db.patch(change.id, { modifiedAt: Date.now() } as any);
  }
});

triggers.register("notifications", async (ctx, change) => {
  if (change.newDoc) {
    await ctx.db.patch(change.id, { modifiedAt: Date.now() } as any);
  }
});

triggers.register("userTags", async (ctx, change) => {
  if (change.newDoc) {
    await ctx.db.patch(change.id, { modifiedAt: Date.now() } as any);
  }
});
