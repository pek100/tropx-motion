/**
 * Database Migrations
 * Run these via the Convex dashboard or CLI to migrate data.
 */

import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Count sessions with and without SVG preview paths.
 */
export const countPreviewStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("recordingSessions").collect();

    let withPaths = 0;
    let withoutPaths = 0;

    for (const session of sessions) {
      if (session.leftKneePaths || session.rightKneePaths) {
        withPaths++;
      } else {
        withoutPaths++;
      }
    }

    return {
      total: sessions.length,
      withPaths,
      withoutPaths,
    };
  },
});

/**
 * Get storage usage for SVG paths.
 */
export const getStorageStats = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("recordingSessions").collect();

    let totalPathBytes = 0;
    let sessionsWithPaths = 0;

    for (const session of sessions) {
      if (session.leftKneePaths) {
        totalPathBytes += session.leftKneePaths.x.length;
        totalPathBytes += session.leftKneePaths.y.length;
        totalPathBytes += session.leftKneePaths.z.length;
        sessionsWithPaths++;
      }
      if (session.rightKneePaths) {
        totalPathBytes += session.rightKneePaths.x.length;
        totalPathBytes += session.rightKneePaths.y.length;
        totalPathBytes += session.rightKneePaths.z.length;
      }
    }

    return {
      totalSessions: sessions.length,
      sessionsWithPaths,
      totalPathBytes,
      totalPathKB: Math.round(totalPathBytes / 1024),
      avgBytesPerSession: sessionsWithPaths > 0
        ? Math.round(totalPathBytes / sessionsWithPaths)
        : 0,
    };
  },
});
