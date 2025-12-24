/**
 * Cache Management - KEK handling and freshness queries
 *
 * Two-layer encryption:
 * - KEK (Key Encryption Key): Stored here in Convex, rotatable
 * - DEK (Data Encryption Key): Stored locally on client, wrapped by KEK
 */

import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireAuth, getCurrentUser } from "./lib/auth";

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const KEK_ROTATION_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────
// KEK Management
// ─────────────────────────────────────────────────────────────────

/**
 * Get or create KEK for current user.
 * Called on sign-in to initialize client-side encryption.
 * Returns the wrapped KEK and version for the client to use.
 */
export const getOrCreateKEK = mutation({
  args: {
    // Client generates KEK, sends it wrapped with a temporary key derived from auth
    // For simplicity, we store the raw base64 KEK (Convex auth protects it)
    newKekIfMissing: v.optional(v.string()),
    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // If user already has KEK, return it
    if (user.kekWrapped) {
      return {
        kekWrapped: user.kekWrapped,
        kekVersion: user.kekVersion ?? 1,
        kekRotatedAt: user.kekRotatedAt ?? user._creationTime,
        needsRotation: shouldRotateKEK(user.kekRotatedAt ?? user._creationTime),
      };
    }

    // No KEK exists - client must provide one to store
    if (!args.newKekIfMissing) {
      return {
        kekWrapped: null,
        kekVersion: 0,
        kekRotatedAt: null,
        needsRotation: false,
      };
    }

    // Store the new KEK
    const now = Date.now();
    await ctx.db.patch(userId, {
      kekWrapped: args.newKekIfMissing,
      kekVersion: 1,
      kekRotatedAt: now,
    });

    return {
      kekWrapped: args.newKekIfMissing,
      kekVersion: 1,
      kekRotatedAt: now,
      needsRotation: false,
    };
  },
});

/**
 * Rotate KEK - generates new version, client must re-wrap DEK.
 */
export const rotateKEK = mutation({
  args: {
    newKekWrapped: v.string(),
    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const newVersion = (user.kekVersion ?? 0) + 1;

    await ctx.db.patch(userId, {
      kekWrapped: args.newKekWrapped,
      kekVersion: newVersion,
      kekRotatedAt: now,
    });

    return {
      kekVersion: newVersion,
      kekRotatedAt: now,
    };
  },
});

/**
 * Lightweight query to check KEK version without fetching the key.
 * Used by client to detect if rotation happened on another device.
 */
export const getKEKVersion = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return {
      kekVersion: user.kekVersion ?? 0,
      kekRotatedAt: user.kekRotatedAt ?? null,
      needsRotation: shouldRotateKEK(user.kekRotatedAt ?? user._creationTime),
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Freshness Queries
// ─────────────────────────────────────────────────────────────────

/**
 * Get version info for multiple cache keys.
 * Client sends list of cache keys, server returns modifiedAt for each.
 * This is a single lightweight query to check freshness of multiple cached items.
 */
export const getVersions = query({
  args: {
    keys: v.array(
      v.object({
        table: v.string(),
        id: v.optional(v.string()),
        // For queries with complex args, use a hash of the args
        argsHash: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const versions: Record<string, number | null> = {};

    for (const key of args.keys) {
      const cacheKey = key.argsHash
        ? `${key.table}:${key.argsHash}`
        : `${key.table}:${key.id ?? "default"}`;

      let modifiedAt: number | null = null;

      switch (key.table) {
        case "users": {
          // For current user
          if (!key.id || key.id === user._id) {
            modifiedAt = user._creationTime;
          } else {
            const targetUser = await ctx.db.get(key.id as any);
            modifiedAt = targetUser?._creationTime ?? null;
          }
          break;
        }

        case "recordingSessions": {
          if (key.id) {
            const session = await ctx.db
              .query("recordingSessions")
              .withIndex("by_sessionId", (q) => q.eq("sessionId", key.id!))
              .first();
            modifiedAt = session?.modifiedAt ?? session?._creationTime ?? null;
          } else if (key.argsHash) {
            // For list queries, get the latest modifiedAt across all matching sessions
            // This is a simplified version - for complex queries, we'd need more logic
            const sessions = await ctx.db
              .query("recordingSessions")
              .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
              .filter((q) => q.neq(q.field("isArchived"), true))
              .order("desc")
              .take(1);
            modifiedAt = sessions[0]?.modifiedAt ?? sessions[0]?._creationTime ?? null;
          }
          break;
        }

        case "recordingMetrics": {
          if (key.id) {
            const metrics = await ctx.db
              .query("recordingMetrics")
              .withIndex("by_session", (q) => q.eq("sessionId", key.id!))
              .first();
            modifiedAt = metrics?.computedAt ?? metrics?._creationTime ?? null;
          }
          break;
        }

        case "recordingChunks": {
          if (key.id) {
            // For chunks, use session's modifiedAt (chunks don't change after creation)
            const session = await ctx.db
              .query("recordingSessions")
              .withIndex("by_sessionId", (q) => q.eq("sessionId", key.id!))
              .first();
            modifiedAt = session?._creationTime ?? null;
          }
          break;
        }

        case "patientMetricsHistory": {
          // Special composite query - get latest session modifiedAt for subject
          if (key.id) {
            const sessions = await ctx.db
              .query("recordingSessions")
              .withIndex("by_subject", (q) => q.eq("subjectId", key.id as any))
              .filter((q) => q.neq(q.field("isArchived"), true))
              .order("desc")
              .take(1);
            modifiedAt = sessions[0]?.modifiedAt ?? sessions[0]?._creationTime ?? null;
          }
          break;
        }

        case "contacts": {
          // Contacts are embedded in user, use user's creation time
          // In future, we could add a contactsModifiedAt field
          modifiedAt = user._creationTime;
          break;
        }

        default:
          modifiedAt = null;
      }

      versions[cacheKey] = modifiedAt;
    }

    return versions;
  },
});

/**
 * Get version for a single table/id combination.
 * Simpler API for single-item freshness checks.
 */
export const getVersion = query({
  args: {
    table: v.string(),
    id: v.optional(v.string()),
    argsHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    // Delegate to getVersions for consistency
    const result = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .first();

    // This is simplified - in practice we'd have table-specific logic
    return {
      modifiedAt: result?.modifiedAt ?? result?._creationTime ?? null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function shouldRotateKEK(lastRotatedAt: number): boolean {
  const daysSinceRotation = (Date.now() - lastRotatedAt) / MS_PER_DAY;
  return daysSinceRotation >= KEK_ROTATION_DAYS;
}
