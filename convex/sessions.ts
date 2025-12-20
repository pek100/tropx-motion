/**
 * Sessions Convex Functions
 * Handles session metadata and preview data.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getCurrentUser } from "./lib/auth";
import { COMPRESSION, ACTIVITY_PROFILES, METRIC_STATUS } from "./schema";

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

/** Create a new session with metadata and preview. */
export const createSession = mutation({
  args: {
    sessionId: v.string(),
    sampleRate: v.number(),
    totalSamples: v.number(),
    totalChunks: v.number(),
    activeJoints: v.array(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    recordedAt: v.optional(v.number()),

    // Preview quaternions (downsampled)
    leftKneePreview: v.optional(v.array(v.float64())),
    rightKneePreview: v.optional(v.array(v.float64())),

    // User metadata
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),
    activityProfile: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Check if session already exists
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      throw new Error(`Session ${args.sessionId} already exists`);
    }

    // Create session
    const sessionDocId = await ctx.db.insert("sessions", {
      sessionId: args.sessionId,
      ownerId: user._id,
      subjectId: args.subjectId,
      subjectAlias: args.subjectAlias,
      sampleRate: args.sampleRate,
      totalSamples: args.totalSamples,
      totalChunks: args.totalChunks,
      activeJoints: args.activeJoints,
      startTime: args.startTime,
      endTime: args.endTime,
      recordedAt: args.recordedAt ?? Date.now(),
      leftKneePreview: args.leftKneePreview,
      rightKneePreview: args.rightKneePreview,
      compressionVersion: COMPRESSION.VERSION,
      notes: args.notes,
      tags: args.tags,
      activityProfile: args.activityProfile as any,
      metricsStatus: METRIC_STATUS.PENDING,
    });

    return {
      success: true,
      sessionDocId,
      sessionId: args.sessionId,
    };
  },
});

/** Update session metadata. */
export const updateSession = mutation({
  args: {
    sessionId: v.string(),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),
    activityProfile: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to update this session");
    }

    // Build update object
    const updates: Record<string, any> = {
      modifiedAt: Date.now(),
    };

    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.subjectId !== undefined) updates.subjectId = args.subjectId;
    if (args.subjectAlias !== undefined) updates.subjectAlias = args.subjectAlias;
    if (args.activityProfile !== undefined) updates.activityProfile = args.activityProfile;

    await ctx.db.patch(session._id, updates);

    return { success: true };
  },
});

/** Archive a session (soft delete). */
export const archiveSession = mutation({
  args: {
    sessionId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to archive this session");
    }

    await ctx.db.patch(session._id, {
      isArchived: true,
      archivedAt: Date.now(),
      archiveReason: args.reason,
    });

    return { success: true };
  },
});

/** Restore an archived session. */
export const restoreSession = mutation({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to restore this session");
    }

    await ctx.db.patch(session._id, {
      isArchived: false,
      archivedAt: undefined,
      archiveReason: undefined,
    });

    return { success: true };
  },
});

/** Share a session with another user. */
export const shareSession = mutation({
  args: {
    sessionId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to share this session");
    }

    const sharedWith = session.sharedWith || [];
    if (!sharedWith.includes(args.userId)) {
      sharedWith.push(args.userId);
      await ctx.db.patch(session._id, { sharedWith });
    }

    return { success: true };
  },
});

/** Add a subject note to a session. */
export const addSubjectNote = mutation({
  args: {
    sessionId: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error(`Session ${args.sessionId} not found`);
    }

    // Check access (owner or shared with or subject)
    const hasAccess =
      session.ownerId === user._id ||
      session.subjectId === user._id ||
      (session.sharedWith || []).includes(user._id);

    if (!hasAccess) {
      throw new Error("Not authorized to add notes to this session");
    }

    const subjectNotes = session.subjectNotes || [];
    subjectNotes.push({
      userId: user._id,
      note: args.note,
      createdAt: Date.now(),
    });

    await ctx.db.patch(session._id, { subjectNotes });

    return { success: true };
  },
});

/** Update metrics status for a session. */
export const updateMetricsStatus = internalMutation({
  args: {
    sessionId: v.string(),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (session) {
      await ctx.db.patch(session._id, {
        metricsStatus: args.status as any,
      });
    }
  },
});

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

/** Get a session by ID. */
export const getSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    return session;
  },
});

/** Get session preview for chart display. */
export const getSessionPreview = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) return null;

    return {
      sessionId: session.sessionId,
      leftKneePreview: session.leftKneePreview,
      rightKneePreview: session.rightKneePreview,
      sampleRate: session.sampleRate,
      totalSamples: session.totalSamples,
      startTime: session.startTime,
      endTime: session.endTime,
    };
  },
});

/** List sessions for current user. */
export const listMySessions = query({
  args: {
    limit: v.optional(v.number()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    let query = ctx.db
      .query("sessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id));

    if (!args.includeArchived) {
      query = query.filter((q) => q.neq(q.field("isArchived"), true));
    }

    const sessions = await query.order("desc").take(limit);

    return sessions.map((s) => ({
      sessionId: s.sessionId,
      recordedAt: s.recordedAt ?? s.startTime,
      totalSamples: s.totalSamples,
      notes: s.notes,
      tags: s.tags,
      activityProfile: s.activityProfile,
      metricsStatus: s.metricsStatus,
      subjectId: s.subjectId,
      subjectAlias: s.subjectAlias,
      isArchived: s.isArchived,
    }));
  },
});

/** List sessions for a specific subject. */
export const listSubjectSessions = query({
  args: {
    subjectId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", args.subjectId))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(limit);

    // Filter to only sessions the user can access
    return sessions
      .filter(
        (s) =>
          s.ownerId === user._id ||
          s.subjectId === user._id ||
          (s.sharedWith || []).includes(user._id)
      )
      .map((s) => ({
        sessionId: s.sessionId,
        recordedAt: s.recordedAt ?? s.startTime,
        totalSamples: s.totalSamples,
        notes: s.notes,
        tags: s.tags,
        activityProfile: s.activityProfile,
        metricsStatus: s.metricsStatus,
      }));
  },
});

/** Get distinct subjects from sessions. */
export const getDistinctSubjects = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Get distinct subject IDs
    const subjectMap = new Map<string, { id: Id<"users">; count: number; alias?: string }>();

    for (const session of sessions) {
      const key = session.subjectId ?? user._id;
      const existing = subjectMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        subjectMap.set(key, {
          id: key as Id<"users">,
          count: 1,
          alias: session.subjectAlias,
        });
      }
    }

    // Fetch user info for each subject
    const subjects = await Promise.all(
      Array.from(subjectMap.values()).map(async (s) => {
        const subjectUser = await ctx.db.get(s.id);
        return {
          id: s.id,
          name: subjectUser?.name ?? s.alias ?? "Unknown",
          image: subjectUser?.image,
          isMe: s.id === user._id,
          sessionCount: s.count,
        };
      })
    );

    return subjects.sort((a, b) => {
      if (a.isMe) return -1;
      if (b.isMe) return 1;
      return b.sessionCount - a.sessionCount;
    });
  },
});
