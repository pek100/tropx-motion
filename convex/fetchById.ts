/**
 * Fetch-by-ID Queries - Get full documents by ID for cache updates
 *
 * These queries fetch complete documents when the client detects
 * a timestamp mismatch and needs fresh data.
 */

import { v } from "convex/values";
import { query } from "./_generated/server";
import { getCurrentUser, requireAuth } from "./lib/auth";
import { Id } from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────────

/** Get current user's full document */
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    return {
      ...user,
      modifiedAt: user.modifiedAt ?? user._creationTime,
    };
  },
});

/** Get user by ID (for contacts) - returns limited public info */
export const getUserById = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user || user.isArchived) return null;

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      modifiedAt: user.modifiedAt ?? user._creationTime,
    };
  },
});

/** Get multiple users by IDs (batch fetch for contacts) */
export const getUsersByIds = query({
  args: { userIds: v.array(v.id("users")) },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const users = await Promise.all(
      args.userIds.map(async (userId) => {
        const user = await ctx.db.get(userId);
        if (!user || user.isArchived) return null;

        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
          modifiedAt: user.modifiedAt ?? user._creationTime,
        };
      })
    );

    return users.filter(Boolean);
  },
});

// ─────────────────────────────────────────────────────────────────
// Recording Sessions
// ─────────────────────────────────────────────────────────────────

/** Get session by sessionId */
export const getSessionBySessionId = query({
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

    // Get owner info
    const owner = await ctx.db.get(session.ownerId);

    // Get subject info
    let subject = null;
    if (session.subjectId) {
      const subjectUser = await ctx.db.get(session.subjectId);
      if (subjectUser && !subjectUser.isArchived) {
        subject = {
          _id: subjectUser._id,
          name: subjectUser.name,
          email: subjectUser.email,
          image: subjectUser.image,
        };
      }
    }

    return {
      ...session,
      modifiedAt: session.modifiedAt ?? session._creationTime,
      owner: owner
        ? { _id: owner._id, name: owner.name, email: owner.email, image: owner.image }
        : null,
      subject,
    };
  },
});

/** Get multiple sessions by sessionIds (batch fetch) */
export const getSessionsBySessionIds = query({
  args: { sessionIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const sessions = await Promise.all(
      args.sessionIds.map(async (sessionId) => {
        const session = await ctx.db
          .query("recordingSessions")
          .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
          .first();

        if (!session) return null;

        // Check access
        const hasAccess =
          session.ownerId === user._id ||
          session.subjectId === user._id ||
          (session.sharedWith ?? []).includes(user._id);

        if (!hasAccess) return null;

        // Get subject name
        let subjectName = session.subjectAlias ?? "Self";
        if (session.subjectId) {
          const subjectUser = await ctx.db.get(session.subjectId);
          if (subjectUser && !subjectUser.isArchived) {
            subjectName = subjectUser.name ?? subjectName;
          }
        }

        return {
          _id: session._id,
          sessionId: session.sessionId,
          ownerId: session.ownerId,
          subjectId: session.subjectId,
          subjectName,
          subjectAlias: session.subjectAlias,
          notes: session.notes,
          tags: session.tags,
          activeJoints: session.activeJoints,
          sampleRate: session.sampleRate,
          totalChunks: session.totalChunks,
          startTime: session.startTime,
          endTime: session.endTime,
          totalSamples: session.totalSamples,
          durationMs: session.endTime - session.startTime,
          _creationTime: session._creationTime,
          modifiedAt: session.modifiedAt ?? session._creationTime,
          isArchived: session.isArchived,
          activityProfile: session.activityProfile,
        };
      })
    );

    return sessions.filter(Boolean);
  },
});

// ─────────────────────────────────────────────────────────────────
// Recording Metrics
// ─────────────────────────────────────────────────────────────────

/** Get metrics by sessionId */
export const getMetricsBySessionId = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const metrics = await ctx.db
      .query("recordingMetrics")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!metrics) return null;

    return {
      ...metrics,
      modifiedAt: metrics.modifiedAt ?? metrics._creationTime,
    };
  },
});

// ─────────────────────────────────────────────────────────────────
// Invites
// ─────────────────────────────────────────────────────────────────

/** Get invite by ID */
export const getInviteById = query({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) return null;

    // Check access - must be sender or recipient
    const isSender = invite.fromUserId === user._id;
    const isRecipient = invite.toEmail.toLowerCase() === user.email?.toLowerCase();

    if (!isSender && !isRecipient) return null;

    // Get inviter info
    const inviter = await ctx.db.get(invite.fromUserId);

    return {
      ...invite,
      modifiedAt: invite.modifiedAt ?? invite._creationTime,
      inviter: inviter
        ? { _id: inviter._id, name: inviter.name, email: inviter.email, image: inviter.image }
        : null,
    };
  },
});

/** Get multiple invites by IDs (batch fetch) */
export const getInvitesByIds = query({
  args: { inviteIds: v.array(v.id("invites")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const invites = await Promise.all(
      args.inviteIds.map(async (inviteId) => {
        const invite = await ctx.db.get(inviteId);
        if (!invite) return null;

        // Check access
        const isSender = invite.fromUserId === user._id;
        const isRecipient = invite.toEmail.toLowerCase() === user.email?.toLowerCase();

        if (!isSender && !isRecipient) return null;

        return {
          _id: invite._id,
          toEmail: invite.toEmail,
          alias: invite.alias,
          status: invite.status,
          expiresAt: invite.expiresAt,
          _creationTime: invite._creationTime,
          modifiedAt: invite.modifiedAt ?? invite._creationTime,
          isExpired: invite.expiresAt < Date.now() && invite.status === "pending",
        };
      })
    );

    return invites.filter(Boolean);
  },
});

// ─────────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────────

/** Get notification by ID */
export const getNotificationById = query({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) return null;

    // Check ownership
    if (notification.userId !== user._id) return null;

    return {
      ...notification,
      modifiedAt: notification.modifiedAt ?? notification._creationTime,
      createdAt: notification._creationTime,
    };
  },
});

/** Get multiple notifications by IDs (batch fetch) */
export const getNotificationsByIds = query({
  args: { notificationIds: v.array(v.id("notifications")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const notifications = await Promise.all(
      args.notificationIds.map(async (notificationId) => {
        const notification = await ctx.db.get(notificationId);
        if (!notification) return null;

        // Check ownership
        if (notification.userId !== user._id) return null;

        return {
          ...notification,
          modifiedAt: notification.modifiedAt ?? notification._creationTime,
          createdAt: notification._creationTime,
        };
      })
    );

    return notifications.filter(Boolean);
  },
});

// ─────────────────────────────────────────────────────────────────
// User Tags
// ─────────────────────────────────────────────────────────────────

/** Get user tag by ID */
export const getUserTagById = query({
  args: { tagId: v.id("userTags") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const tag = await ctx.db.get(args.tagId);
    if (!tag) return null;

    // Check ownership
    if (tag.userId !== user._id) return null;

    return {
      ...tag,
      modifiedAt: tag.modifiedAt ?? tag._creationTime,
    };
  },
});

/** Get multiple user tags by IDs (batch fetch) */
export const getUserTagsByIds = query({
  args: { tagIds: v.array(v.id("userTags")) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const tags = await Promise.all(
      args.tagIds.map(async (tagId) => {
        const tag = await ctx.db.get(tagId);
        if (!tag) return null;

        // Check ownership
        if (tag.userId !== user._id) return null;

        return {
          ...tag,
          modifiedAt: tag.modifiedAt ?? tag._creationTime,
        };
      })
    );

    return tags.filter(Boolean);
  },
});
