/**
 * Timestamp Queries - Lightweight queries for cache sync
 *
 * The main query is `getAll` which returns ALL timestamps for the current user.
 * This is the ONLY subscription needed for cache synchronization.
 *
 * Individual timestamp queries are kept for specific use cases.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";

// ─────────────────────────────────────────────────────────────────
// Centralized Timestamp Query (THE main sync subscription)
// ─────────────────────────────────────────────────────────────────

/** Get ALL timestamps for current user - single subscription for cache sync */
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return {
        user: null,
        sessions: [],
        notifications: [],
        invites: [],
        userTags: [],
        contacts: [],
      };
    }

    // User's own timestamp
    const userTimestamp = {
      _id: user._id,
      modifiedAt: user.modifiedAt ?? user._creationTime,
    };

    // Sessions owned by user
    const ownedSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Sessions where user is subject
    const subjectSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
      .filter((q) =>
        q.and(
          q.neq(q.field("isArchived"), true),
          q.neq(q.field("ownerId"), user._id)
        )
      )
      .collect();

    // Combine and dedupe sessions
    const allSessions = [...ownedSessions, ...subjectSessions];
    const sessionMap = new Map<string, typeof allSessions[0]>();
    for (const s of allSessions) {
      if (!sessionMap.has(s.sessionId)) {
        sessionMap.set(s.sessionId, s);
      }
    }

    const sessionTimestamps = Array.from(sessionMap.values()).map((s) => ({
      _id: s._id,
      sessionId: s.sessionId,
      modifiedAt: s.modifiedAt ?? s._creationTime,
    }));

    // Notifications for user (limit to recent 100)
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);

    const notificationTimestamps = notifications.map((n) => ({
      _id: n._id,
      modifiedAt: n.modifiedAt ?? n._creationTime,
    }));

    // Invites sent by user
    const sentInvites = await ctx.db
      .query("invites")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", user._id))
      .collect();

    // Invites received by user (pending only)
    const receivedInvites = user.email
      ? await ctx.db
          .query("invites")
          .withIndex("by_to_email", (q) =>
            q.eq("toEmail", user.email!).eq("status", "pending")
          )
          .collect()
      : [];

    // Combine invites
    const allInvites = [...sentInvites, ...receivedInvites];
    const inviteMap = new Map<string, typeof allInvites[0]>();
    for (const i of allInvites) {
      inviteMap.set(i._id, i);
    }

    const inviteTimestamps = Array.from(inviteMap.values()).map((i) => ({
      _id: i._id,
      modifiedAt: i.modifiedAt ?? i._creationTime,
    }));

    // User's tags
    const userTags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const userTagTimestamps = userTags.map((t) => ({
      _id: t._id,
      tag: t.tag,
      modifiedAt: t.modifiedAt ?? t._creationTime,
    }));

    // User's contacts (from user's contacts array)
    const contactTimestamps = await Promise.all(
      (user.contacts ?? []).map(async (contact) => {
        const contactUser = await ctx.db.get(contact.userId);
        if (!contactUser || contactUser.isArchived) return null;
        return {
          _id: contactUser._id,
          modifiedAt: contactUser.modifiedAt ?? contactUser._creationTime,
        };
      })
    );

    return {
      user: userTimestamp,
      sessions: sessionTimestamps,
      notifications: notificationTimestamps,
      invites: inviteTimestamps,
      userTags: userTagTimestamps,
      contacts: contactTimestamps.filter(Boolean),
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────

/** Get timestamp for current user's document */
export const getUserTimestamp = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return {
      _id: user._id,
      modifiedAt: user.modifiedAt ?? user._creationTime,
    };
  },
});

/** Get timestamps for user's contacts */
export const getContactTimestamps = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || !user.contacts) return [];

    const timestamps = await Promise.all(
      user.contacts.map(async (contact) => {
        const contactUser = await ctx.db.get(contact.userId);
        if (!contactUser || contactUser.isArchived) return null;
        return {
          _id: contactUser._id,
          modifiedAt: contactUser.modifiedAt ?? contactUser._creationTime,
        };
      })
    );

    return timestamps.filter(Boolean);
  },
});

// ─────────────────────────────────────────────────────────────────
// Recording Sessions
// ─────────────────────────────────────────────────────────────────

/** Get timestamps for sessions owned by current user */
export const getMySessionTimestamps = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    return sessions.map((s) => ({
      _id: s._id,
      sessionId: s.sessionId,
      modifiedAt: s.modifiedAt ?? s._creationTime,
    }));
  },
});

/** Get timestamps for sessions where user is the subject */
export const getSessionsOfMeTimestamps = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
      .filter((q) =>
        q.and(
          q.neq(q.field("isArchived"), true),
          q.neq(q.field("ownerId"), user._id)
        )
      )
      .collect();

    return sessions.map((s) => ({
      _id: s._id,
      sessionId: s.sessionId,
      modifiedAt: s.modifiedAt ?? s._creationTime,
    }));
  },
});

/** Get timestamp for a specific session */
export const getSessionTimestamp = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;

    // Check access
    const hasAccess =
      session.ownerId === user._id ||
      session.subjectId === user._id ||
      (session.sharedWith ?? []).includes(user._id);

    if (!hasAccess) return null;

    return {
      _id: session._id,
      sessionId: session.sessionId,
      modifiedAt: session.modifiedAt ?? session._creationTime,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Recording Metrics
// ─────────────────────────────────────────────────────────────────

/** Get timestamp for metrics of a specific session */
export const getMetricsTimestamp = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!metrics) return null;

    return {
      _id: metrics._id,
      sessionId: metrics.sessionId,
      modifiedAt: metrics.modifiedAt ?? metrics._creationTime,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────

/** Get timestamps for invites sent by current user */
export const getMyInviteTimestamps = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", user._id))
      .collect();

    return invites.map((i) => ({
      _id: i._id,
      modifiedAt: i.modifiedAt ?? i._creationTime,
    }));
  },
});

/** Get timestamps for pending invites to current user */
export const getPendingInviteTimestamps = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || !user.email) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_to_email", (q) =>
        q.eq("toEmail", user.email!).eq("status", "pending")
      )
      .collect();

    // Filter out expired
    const now = Date.now();
    return invites
      .filter((i) => i.expiresAt > now)
      .map((i) => ({
        _id: i._id,
        modifiedAt: i.modifiedAt ?? i._creationTime,
      }));
  },
});

// ─────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────

/** Get timestamps for user's notifications */
export const getNotificationTimestamps = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = Math.min(args.limit ?? 50, 100);

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return notifications.map((n) => ({
      _id: n._id,
      modifiedAt: n.modifiedAt ?? n._creationTime,
    }));
  },
});

/** Get unread notification count (no timestamp needed, just count) */
export const getUnreadNotificationCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", user._id).eq("read", false)
      )
      .collect();

    return unread.length;
  },
});

// ─────────────────────────────────────────────────────────────────
// User Tags
// ─────────────────────────────────────────────────────────────────

/** Get timestamps for user's tags */
export const getUserTagTimestamps = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const tags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    return tags.map((t) => ({
      _id: t._id,
      tag: t.tag,
      modifiedAt: t.modifiedAt ?? t._creationTime,
    }));
  },
});
