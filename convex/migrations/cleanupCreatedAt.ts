import { internalMutation } from "../_generated/server";

// Migration: Remove redundant createdAt fields from all tables
// Run once after deploying schema changes via Convex dashboard or CLI:
// npx convex run migrations/cleanupCreatedAt:removeCreatedAtFields

const BATCH_SIZE = 100;

export const removeCreatedAtFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const results = {
      recordings: 0,
      rawRecordings: 0,
      invites: 0,
      notifications: 0,
      users: 0,
    };

    // Clean recordings
    const recordings = await ctx.db.query("recordings").take(BATCH_SIZE * 10);
    for (const doc of recordings) {
      if ("createdAt" in doc) {
        const { createdAt, ...rest } = doc as any;
        await ctx.db.replace(doc._id, rest);
        results.recordings++;
      }
    }

    // Clean rawRecordings
    const rawRecordings = await ctx.db.query("rawRecordings").take(BATCH_SIZE * 10);
    for (const doc of rawRecordings) {
      if ("createdAt" in doc) {
        const { createdAt, ...rest } = doc as any;
        await ctx.db.replace(doc._id, rest);
        results.rawRecordings++;
      }
    }

    // Clean invites
    const invites = await ctx.db.query("invites").take(BATCH_SIZE * 10);
    for (const doc of invites) {
      if ("createdAt" in doc) {
        const { createdAt, ...rest } = doc as any;
        await ctx.db.replace(doc._id, rest);
        results.invites++;
      }
    }

    // Clean notifications
    const notifications = await ctx.db.query("notifications").take(BATCH_SIZE * 10);
    for (const doc of notifications) {
      if ("createdAt" in doc) {
        const { createdAt, ...rest } = doc as any;
        await ctx.db.replace(doc._id, rest);
        results.notifications++;
      }
    }

    // Clean users
    const users = await ctx.db.query("users").take(BATCH_SIZE * 10);
    for (const doc of users) {
      if ("createdAt" in doc) {
        const { createdAt, ...rest } = doc as any;
        await ctx.db.replace(doc._id, rest);
        results.users++;
      }
    }

    const total = Object.values(results).reduce((a, b) => a + b, 0);
    console.log(`Migration complete: ${total} documents updated`, results);

    return {
      ...results,
      total,
      message: total > 0
        ? `Cleaned ${total} documents. Run again if more remain.`
        : "No documents with createdAt found. Migration complete.",
    };
  },
});
