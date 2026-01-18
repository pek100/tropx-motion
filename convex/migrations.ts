/**
 * Database Migrations
 * Run these via the Convex dashboard or CLI to migrate data.
 */

import { internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { decompressQuaternions, downsampleQuaternions } from "../shared/compression";
import { bilateralQuaternionsToSvgPaths } from "./lib/metrics/quaternionUtils";

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

// ─────────────────────────────────────────────────────────────────
// SVG Path Regeneration Migration
// ─────────────────────────────────────────────────────────────────

const PREVIEW_POINTS = 100;

/**
 * Get session IDs that need SVG path regeneration.
 */
export const getSessionsForSvgRegeneration = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const sessions = await ctx.db
      .query("recordingSessions")
      .order("desc")
      .take(limit);

    return sessions.map((s) => ({
      sessionId: s.sessionId,
      _id: s._id,
      hasLeftPaths: !!s.leftKneePaths,
      hasRightPaths: !!s.rightKneePaths,
    }));
  },
});

/**
 * Get session with chunks for regeneration.
 */
export const getSessionWithChunksForMigration = internalQuery({
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

/**
 * Update session with regenerated SVG paths.
 */
export const updateSessionSvgPaths = internalMutation({
  args: {
    sessionId: v.string(),
    leftKneePaths: v.union(
      v.null(),
      v.object({ x: v.string(), y: v.string(), z: v.string() })
    ),
    rightKneePaths: v.union(
      v.null(),
      v.object({ x: v.string(), y: v.string(), z: v.string() })
    ),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    await ctx.db.patch(session._id, {
      leftKneePaths: args.leftKneePaths ?? undefined,
      rightKneePaths: args.rightKneePaths ?? undefined,
    });

    return { success: true, sessionId: args.sessionId };
  },
});

/**
 * Regenerate SVG paths for a single session.
 * Decompresses chunks, downsamples, and generates bilateral-scaled SVG paths.
 */
export const regenerateSvgPathsForSession = internalAction({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    // Get session with chunks
    const data = await ctx.runQuery(
      internal.migrations.getSessionWithChunksForMigration,
      { sessionId: args.sessionId }
    );

    if (!data || data.chunks.length === 0) {
      return { success: false, error: "Session or chunks not found" };
    }

    // Decompress and accumulate all quaternion data
    const allLeftQ: number[] = [];
    const allRightQ: number[] = [];

    for (const chunk of data.chunks) {
      if (chunk.leftKneeCompressed) {
        const bytes = new Uint8Array(chunk.leftKneeCompressed);
        const decompressed = decompressQuaternions(bytes);
        allLeftQ.push(...Array.from(decompressed));
      }
      if (chunk.rightKneeCompressed) {
        const bytes = new Uint8Array(chunk.rightKneeCompressed);
        const decompressed = decompressQuaternions(bytes);
        allRightQ.push(...Array.from(decompressed));
      }
    }

    // Downsample to preview points
    let leftPreview: number[] | null = null;
    let rightPreview: number[] | null = null;

    if (allLeftQ.length > 0) {
      const downsampled = downsampleQuaternions(allLeftQ, PREVIEW_POINTS);
      leftPreview = Array.from(downsampled);
    }
    if (allRightQ.length > 0) {
      const downsampled = downsampleQuaternions(allRightQ, PREVIEW_POINTS);
      rightPreview = Array.from(downsampled);
    }

    // Generate SVG paths with bilateral scaling
    const { leftPaths, rightPaths } = bilateralQuaternionsToSvgPaths(
      leftPreview,
      rightPreview
    );

    // Update session
    await ctx.runMutation(internal.migrations.updateSessionSvgPaths, {
      sessionId: args.sessionId,
      leftKneePaths: leftPaths,
      rightKneePaths: rightPaths,
    });

    return { success: true, sessionId: args.sessionId };
  },
});

/**
 * Batch regenerate SVG paths for multiple sessions.
 * Call this from the dashboard to migrate existing data.
 */
export const batchRegenerateSvgPaths = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;

    // Get sessions to process
    const sessions = await ctx.runQuery(
      internal.migrations.getSessionsForSvgRegeneration,
      { limit }
    );

    const results: Array<{ sessionId: string; success: boolean; error?: string }> = [];

    for (const session of sessions) {
      try {
        const result = await ctx.runAction(
          internal.migrations.regenerateSvgPathsForSession,
          { sessionId: session.sessionId }
        );
        results.push({
          sessionId: session.sessionId,
          success: result.success,
          error: result.error,
        });
      } catch (error) {
        results.push({
          sessionId: session.sessionId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return {
      processed: results.length,
      success: successCount,
      failed: failCount,
      results,
    };
  },
});

/**
 * Get all session IDs for batch recomputation.
 */
export const getAllSessionIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("recordingSessions").collect();
    return sessions.map((s) => s.sessionId);
  },
});

/**
 * Trigger recomputation for a single session (internal version).
 */
export const triggerRecomputeForSession = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "pending" as const,
        error: undefined,
      });
    } else {
      await ctx.db.insert("recordingMetrics", {
        sessionId: args.sessionId,
        status: "pending" as const,
      });
    }

    // Schedule computation
    await ctx.scheduler.runAfter(0, internal.recordingMetrics.computeMetricsInternal, {
      sessionId: args.sessionId,
    });

    return { success: true };
  },
});

/**
 * Batch recompute metrics for all sessions.
 * This will recalculate all metrics fresh, ensuring new schema fields are populated.
 *
 * Usage: npx convex run migrations:batchRecomputeAllMetrics
 */
export const batchRecomputeAllMetrics = internalAction({
  args: {
    delayBetweenMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delayMs = args.delayBetweenMs ?? 500; // Default 500ms between each to avoid overload

    // Get all session IDs
    const sessionIds = await ctx.runQuery(internal.migrations.getAllSessionIds, {});

    console.log(`Starting batch recomputation for ${sessionIds.length} sessions`);

    const results: Array<{ sessionId: string; success: boolean; error?: string }> = [];

    for (let i = 0; i < sessionIds.length; i++) {
      const sessionId = sessionIds[i];

      try {
        await ctx.runMutation(internal.migrations.triggerRecomputeForSession, { sessionId });
        results.push({ sessionId, success: true });
        console.log(`[${i + 1}/${sessionIds.length}] Triggered: ${sessionId}`);
      } catch (error) {
        results.push({
          sessionId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
        console.error(`[${i + 1}/${sessionIds.length}] Failed: ${sessionId}`, error);
      }

      // Add delay between sessions to avoid overwhelming the system
      if (i < sessionIds.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    console.log(`Batch recomputation complete: ${successCount} triggered, ${failCount} failed`);

    return {
      total: sessionIds.length,
      triggered: successCount,
      failed: failCount,
      results,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Timestamp Field Stats
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Title Field Migration (move tags[0] to title)
// ─────────────────────────────────────────────────────────────────

/**
 * Count sessions with/without title field.
 *
 * Usage: npx convex run migrations:countTitleStatus
 */
export const countTitleStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("recordingSessions").collect();

    let withTitle = 0;
    let withoutTitle = 0;
    let withTags = 0;

    for (const session of sessions) {
      if (session.title) {
        withTitle++;
      } else {
        withoutTitle++;
      }
      if (session.tags && session.tags.length > 0) {
        withTags++;
      }
    }

    return {
      total: sessions.length,
      withTitle,
      withoutTitle,
      withTags,
    };
  },
});

/**
 * Migrate a single session: move tags[0] to title, keep remaining tags.
 */
export const migrateTitleForSession = internalMutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      return { success: false, error: "Session not found" };
    }

    // Skip if title already exists
    if (session.title) {
      return { success: true, skipped: true, reason: "Title already exists" };
    }

    const tags = session.tags ?? [];
    if (tags.length === 0) {
      return { success: true, skipped: true, reason: "No tags to migrate" };
    }

    // Extract title from tags[0], keep remaining tags
    const title = tags[0];
    const remainingTags = tags.slice(1);

    await ctx.db.patch(session._id, {
      title,
      tags: remainingTags,
    });

    return { success: true, title, remainingTags: remainingTags.length };
  },
});

/**
 * Batch migrate all sessions: move tags[0] to title field.
 *
 * Usage: npx convex run migrations:batchMigrateTitle
 */
export const batchMigrateTitle = internalAction({
  args: {
    delayBetweenMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const delayMs = args.delayBetweenMs ?? 100;

    // Get all session IDs
    const sessionIds = await ctx.runQuery(internal.migrations.getAllSessionIds, {});

    console.log(`Starting title migration for ${sessionIds.length} sessions`);

    const results: Array<{ sessionId: string; success: boolean; skipped?: boolean; error?: string }> = [];

    for (let i = 0; i < sessionIds.length; i++) {
      const sessionId = sessionIds[i];

      try {
        const result = await ctx.runMutation(internal.migrations.migrateTitleForSession, { sessionId });
        results.push({ sessionId, ...result });
        if (!result.skipped) {
          console.log(`[${i + 1}/${sessionIds.length}] Migrated: ${sessionId}`);
        }
      } catch (error) {
        results.push({
          sessionId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
        console.error(`[${i + 1}/${sessionIds.length}] Failed: ${sessionId}`, error);
      }

      // Add delay between sessions
      if (i < sessionIds.length - 1 && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const migrated = results.filter((r) => r.success && !r.skipped).length;
    const skipped = results.filter((r) => r.success && r.skipped).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`Title migration complete: ${migrated} migrated, ${skipped} skipped, ${failed} failed`);

    return {
      total: sessionIds.length,
      migrated,
      skipped,
      failed,
      results,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Timestamp Field Stats
// ─────────────────────────────────────────────────────────────────

/**
 * Count documents with/without modifiedAt field.
 *
 * Usage: npx convex run migrations:countTimestampStatus
 */
export const countTimestampStatus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("recordingSessions").collect();

    let withTimestamp = 0;
    let withoutTimestamp = 0;

    for (const session of sessions) {
      if (session.modifiedAt !== undefined) {
        withTimestamp++;
      } else {
        withoutTimestamp++;
      }
    }

    return {
      total: sessions.length,
      withTimestamp,
      withoutTimestamp,
    };
  },
});
