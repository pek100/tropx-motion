/**
 * Timestamp queries for cache sync
 *
 * These queries return lightweight [{ _id, updatedAt }] arrays
 * that the client uses to diff against local cache and fetch
 * only changed items.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// ─────────────────────────────────────────────────────────────────
// Timestamp Response Type
// ─────────────────────────────────────────────────────────────────

export type TimestampEntry = {
  _id: string;
  updatedAt: number;
};

// ─────────────────────────────────────────────────────────────────
// User/Contacts Timestamps
// ─────────────────────────────────────────────────────────────────

/**
 * Get current user's updatedAt timestamp.
 * Used for syncing user profile and contacts.
 */
export const getUserTimestamp = query({
  args: {},
  handler: async (ctx): Promise<TimestampEntry | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    return {
      _id: user._id,
      updatedAt: user.modifiedAt ?? user._creationTime,
    };
  },
});

/**
 * Get timestamps for user's contacts.
 * Returns the user doc timestamp since contacts are embedded.
 * When user.contacts changes, user.updatedAt changes.
 */
export const getContactsTimestamp = query({
  args: {},
  handler: async (ctx): Promise<TimestampEntry | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    // Contacts are embedded in user, so return user's timestamp
    return {
      _id: user._id,
      updatedAt: user.modifiedAt ?? user._creationTime,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Session Timestamps
// ─────────────────────────────────────────────────────────────────

/**
 * Get timestamps for user's recording sessions.
 * Returns sessions owned by or shared with user.
 */
export const getSessionTimestamps = query({
  args: {},
  handler: async (ctx): Promise<TimestampEntry[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get owned sessions
    const ownedSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Get sessions where user is subject
    const subjectSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", userId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Combine and dedupe
    const allSessions = [...ownedSessions, ...subjectSessions];
    const seen = new Set<string>();
    const unique = allSessions.filter((s) => {
      if (seen.has(s._id)) return false;
      seen.add(s._id);
      return true;
    });

    return unique.map((s) => ({
      _id: s._id,
      updatedAt: s.modifiedAt ?? s._creationTime,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────
// Notification Timestamps
// ─────────────────────────────────────────────────────────────────

/**
 * Get timestamps for user's notifications.
 */
export const getNotificationTimestamps = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<TimestampEntry[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 50;

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    return notifications.map((n) => ({
      _id: n._id,
      updatedAt: n.modifiedAt ?? n._creationTime,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────
// Invite Timestamps
// ─────────────────────────────────────────────────────────────────

/**
 * Get timestamps for user's pending invitations.
 */
export const getInviteTimestamps = query({
  args: {},
  handler: async (ctx): Promise<TimestampEntry[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const user = await ctx.db.get(userId);
    if (!user?.email) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_to_email", (q) =>
        q.eq("toEmail", user.email!).eq("status", "pending")
      )
      .collect();

    return invites.map((i) => ({
      _id: i._id,
      updatedAt: i.modifiedAt ?? i._creationTime,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────
// Tag Timestamps
// ─────────────────────────────────────────────────────────────────

/**
 * Get timestamps for user's tags.
 */
export const getTagTimestamps = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<TimestampEntry[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const limit = args.limit ?? 20;

    // Get user tags
    const userTags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    // Get default tags
    const defaultTags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", "default" as any))
      .order("desc")
      .take(limit);

    const allTags = [...userTags, ...defaultTags];

    return allTags.map((t) => ({
      _id: t._id,
      updatedAt: t.lastUsedAt ?? t._creationTime,
    }));
  },
});
