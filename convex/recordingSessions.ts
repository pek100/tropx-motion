import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser, getCurrentUser } from "./lib/auth";
import { COMPRESSION, METRIC_STATUS } from "./schema";
import { bilateralQuaternionsToSvgPaths } from "./lib/metrics/quaternionUtils";

// ─────────────────────────────────────────────────────────────────
// Session Creation
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

    // Preview quaternions (downsampled, will be converted to SVG paths server-side)
    leftKneePreview: v.optional(v.array(v.number())),
    rightKneePreview: v.optional(v.array(v.number())),

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
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      throw new Error(`Session ${args.sessionId} already exists`);
    }

    // Convert quaternion previews to SVG paths with bilateral scaling
    const { leftPaths, rightPaths } = bilateralQuaternionsToSvgPaths(
      args.leftKneePreview ?? null,
      args.rightKneePreview ?? null
    );

    // Create session
    const sessionDocId = await ctx.db.insert("recordingSessions", {
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
      leftKneePaths: leftPaths ?? undefined,
      rightKneePaths: rightPaths ?? undefined,
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

// ─────────────────────────────────────────────────────────────────
// Session Queries
// ─────────────────────────────────────────────────────────────────

// Get full session (metadata only - use recordingChunks.getSessionWithChunks for data)
export const getSession = query({
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

    // Get owner/subject info
    const owner = await ctx.db.get(session.ownerId);
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
      sessionId: args.sessionId,
      totalChunks: session.totalChunks,
      owner: owner
        ? { _id: owner._id, name: owner.name, email: owner.email, image: owner.image }
        : null,
      subject,
      subjectAlias: session.subjectAlias,
      notes: session.notes,
      tags: session.tags,
      activeJoints: session.activeJoints,
      sampleRate: session.sampleRate,
      startTime: session.startTime,
      endTime: session.endTime,
      totalSampleCount: session.totalSamples,
      _creationTime: session._creationTime,
      isArchived: session.isArchived,
      activityProfile: session.activityProfile,
      subjectNotes: session.subjectNotes,
    };
  },
});

// List sessions owned by me
export const listMySessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(limit);

    return Promise.all(
      sessions.map(async (session) => {
        let subjectName = session.subjectAlias ?? "Self";
        if (session.subjectId) {
          const subject = await ctx.db.get(session.subjectId);
          if (subject && !subject.isArchived) {
            subjectName = subject.name ?? subjectName;
          }
        }

        return {
          sessionId: session.sessionId,
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
          totalSampleCount: session.totalSamples,
          durationMs: session.endTime - session.startTime,
          _creationTime: session._creationTime,
        };
      })
    );
  },
});

// List sessions where I'm the subject
export const listSessionsOfMe = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
      .filter((q) =>
        q.and(
          q.neq(q.field("isArchived"), true),
          q.neq(q.field("ownerId"), user._id)
        )
      )
      .order("desc")
      .take(limit);

    return Promise.all(
      sessions.map(async (session) => {
        const owner = await ctx.db.get(session.ownerId);
        return {
          sessionId: session.sessionId,
          ownerName: owner?.name ?? "Unknown",
          notes: session.notes,
          tags: session.tags,
          activeJoints: session.activeJoints,
          sampleRate: session.sampleRate,
          totalChunks: session.totalChunks,
          startTime: session.startTime,
          durationMs: session.endTime - session.startTime,
          _creationTime: session._creationTime,
        };
      })
    );
  },
});

// ─────────────────────────────────────────────────────────────────
// Search & Filter Queries
// ─────────────────────────────────────────────────────────────────

// Paginated search across sessions
export const searchSessions = query({
  args: {
    search: v.optional(v.string()),
    subjectId: v.optional(v.id("users")),
    includeMe: v.optional(v.boolean()),
    cursor: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { sessions: [], nextCursor: null };

    const limit = Math.min(args.limit ?? 20, 50);
    const searchTerm = args.search?.toLowerCase().trim();
    const cursor = args.cursor;

    // Query sessions owned by user
    let ownedQuery = ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true));

    if (cursor !== undefined) {
      ownedQuery = ownedQuery.filter((q) => q.lt(q.field("_creationTime"), cursor));
    }

    const ownedSessions = await ownedQuery.order("desc").take(limit + 10);

    // If includeMe, also get sessions where I'm the subject
    let subjectSessions: typeof ownedSessions = [];
    if (args.includeMe) {
      let subjectQuery = ctx.db
        .query("recordingSessions")
        .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
        .filter((q) =>
          q.and(
            q.neq(q.field("isArchived"), true),
            q.neq(q.field("ownerId"), user._id)
          )
        );

      if (cursor !== undefined) {
        subjectQuery = subjectQuery.filter((q) =>
          q.lt(q.field("_creationTime"), cursor)
        );
      }

      subjectSessions = await subjectQuery.order("desc").take(limit + 10);
    }

    // Combine and sort by _creationTime
    let allSessions = [...ownedSessions, ...subjectSessions].sort(
      (a, b) => b._creationTime - a._creationTime
    );

    // Deduplicate by sessionId
    const seenSessionIds = new Set<string>();
    allSessions = allSessions.filter((session) => {
      if (seenSessionIds.has(session.sessionId)) return false;
      seenSessionIds.add(session.sessionId);
      return true;
    });

    // Apply subject filter
    if (args.subjectId) {
      allSessions = allSessions.filter((s) => s.subjectId === args.subjectId);
    }

    // Apply search filter
    if (searchTerm) {
      allSessions = allSessions.filter((session) => {
        const searchFields = [
          session.notes,
          session.subjectAlias,
          ...(session.tags ?? []),
        ]
          .filter(Boolean)
          .map((s) => s!.toLowerCase());

        return searchFields.some((field) => field.includes(searchTerm));
      });
    }

    // Limit results
    const limited = allSessions.slice(0, limit);

    // Build session summaries
    const sessions = await Promise.all(
      limited.map(async (session) => {
        // Get subject info
        let subjectName = session.subjectAlias ?? "Self";
        let subjectImage: string | undefined;
        const isMe = session.subjectId === user._id;

        if (session.subjectId) {
          const subject = await ctx.db.get(session.subjectId);
          if (subject && !subject.isArchived) {
            subjectName = subject.name ?? subjectName;
            subjectImage = subject.image;
          }
        }

        // Get owner info
        const owner = await ctx.db.get(session.ownerId);
        const ownerName = session.ownerId === user._id ? "Me" : (owner?.name ?? "Unknown");
        const ownerImage = owner?.image;

        return {
          sessionId: session.sessionId,
          ownerId: session.ownerId,
          ownerName,
          ownerImage,
          isOwner: session.ownerId === user._id,
          subjectId: session.subjectId,
          subjectName,
          subjectImage,
          subjectAlias: session.subjectAlias,
          isSubjectMe: isMe,
          notes: session.notes,
          tags: session.tags ?? [],
          systemTags: session.systemTags ?? [],
          activeJoints: session.activeJoints,
          sampleRate: session.sampleRate,
          totalChunks: session.totalChunks,
          startTime: session.startTime,
          endTime: session.endTime,
          recordedAt: session.recordedAt ?? session.startTime,
          totalSampleCount: session.totalSamples,
          durationMs: session.endTime - session.startTime,
          createdAt: session._creationTime,
          modifiedAt: session.modifiedAt,
          subjectNotes: session.subjectNotes ?? [],
        };
      })
    );

    // Determine next cursor
    const nextCursor =
      limited.length === limit ? limited[limited.length - 1]._creationTime : null;

    return { sessions, nextCursor };
  },
});

// Get session SVG preview paths for chart rendering
export const getSessionPreviewPaths = query({
  args: {
    sessionId: v.string(),
  },
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
      sessionId: args.sessionId,
      startTime: session.startTime,
      endTime: session.endTime,
      sampleRate: session.sampleRate,
      activeJoints: session.activeJoints,
      leftKneePaths: session.leftKneePaths ?? null,
      rightKneePaths: session.rightKneePaths ?? null,
    };
  },
});

// Get distinct subjects for filter dropdown
export const getDistinctSubjects = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    // Get all sessions owned by user
    const sessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Count recordings per subject
    const subjectCounts = new Map<string, number>();
    const subjectIds = new Set<string>();

    for (const session of sessions) {
      const key = session.subjectId ?? "self";
      subjectCounts.set(key, (subjectCounts.get(key) ?? 0) + 1);
      if (session.subjectId) {
        subjectIds.add(session.subjectId);
      }
    }

    // Fetch subject user info
    const subjects: Array<{
      id: string | null;
      name: string;
      image?: string;
      isMe: boolean;
      recordingCount: number;
    }> = [];

    // Always add "Me" option at the top
    const selfCount = subjectCounts.get("self") ?? 0;
    const meRecordingCount = selfCount + (subjectCounts.get(user._id) ?? 0);
    subjects.push({
      id: user._id,
      name: user.name ?? "Me",
      image: user.image,
      isMe: true,
      recordingCount: meRecordingCount,
    });

    // Add other subjects
    for (const subjectId of subjectIds) {
      if (subjectId === user._id) continue;

      const subject = await ctx.db.get(subjectId as Id<"users">);
      if (subject && !subject.isArchived) {
        subjects.push({
          id: subjectId,
          name: subject.name ?? "Unknown",
          image: subject.image,
          isMe: false,
          recordingCount: subjectCounts.get(subjectId) ?? 0,
        });
      }
    }

    // Sort: Me first, then by recording count
    subjects.sort((a, b) => {
      if (a.isMe) return -1;
      if (b.isMe) return 1;
      return b.recordingCount - a.recordingCount;
    });

    return subjects;
  },
});

// ─────────────────────────────────────────────────────────────────
// Session Updates
// ─────────────────────────────────────────────────────────────────

// Editable fields for diff tracking
const EDITABLE_FIELDS = ["notes", "tags", "subjectId", "subjectAlias"] as const;

// Helper to compute diffs between old and new values
function computeDiffs(
  oldData: Record<string, unknown>,
  newData: Record<string, unknown>,
  fields: readonly string[]
): Array<{ field: string; old: unknown; new: unknown }> {
  const diffs: Array<{ field: string; old: unknown; new: unknown }> = [];

  for (const field of fields) {
    if (!(field in newData)) continue;

    const oldVal = oldData[field];
    const newVal = newData[field];

    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);

    if (oldStr !== newStr) {
      diffs.push({
        field,
        old: oldVal === undefined ? null : oldVal,
        new: newVal === undefined ? null : newVal
      });
    }
  }

  return diffs;
}

// Update session metadata with diff tracking
export const updateSession = mutation({
  args: {
    sessionId: v.string(),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to update this session");
    }

    // Build updates object
    const updates: Record<string, unknown> = {};
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.subjectId !== undefined) updates.subjectId = args.subjectId;
    if (args.subjectAlias !== undefined) updates.subjectAlias = args.subjectAlias;

    if (Object.keys(updates).length === 0) {
      return args.sessionId;
    }

    // Compute diffs for modification history
    const oldData: Record<string, unknown> = {
      notes: session.notes,
      tags: session.tags,
      subjectId: session.subjectId,
      subjectAlias: session.subjectAlias,
    };

    const diffs = computeDiffs(oldData, updates, EDITABLE_FIELDS);

    // Only record history if there are actual changes
    if (diffs.length > 0) {
      const now = Date.now();
      const historyEntry = {
        modifiedAt: now,
        modifiedBy: user._id,
        diffs,
      };

      const currentHistory = session.modificationHistory ?? [];
      updates.modificationHistory = [...currentHistory, historyEntry];
      updates.modifiedAt = now;

      // Check if subject was changed to a different user (not the owner)
      const subjectDiff = diffs.find(d => d.field === "subjectId");
      if (subjectDiff && args.subjectId && args.subjectId !== user._id && args.subjectId !== session.subjectId) {
        const title = args.tags?.[0] || session.tags?.[0] || "Untitled Recording";
        await ctx.db.insert("notifications", {
          userId: args.subjectId,
          type: "added_as_subject",
          title: "You were added to a recording",
          body: `${user.name ?? "Someone"} added you as the subject of "${title}"`,
          data: {
            sessionId: args.sessionId,
            ownerId: user._id,
            ownerName: user.name,
            ownerImage: user.image,
            recordingTitle: title,
          },
          read: false,
        });
      }
    }

    await ctx.db.patch(session._id, updates);

    return args.sessionId;
  },
});

// Add a note from subject (not owner)
export const addSubjectNote = mutation({
  args: {
    sessionId: v.string(),
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    if (!args.note.trim()) {
      throw new Error("Note cannot be empty");
    }

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    // User must be the subject (not owner) to add subject notes
    if (session.subjectId !== user._id) {
      throw new Error("Only the subject can add notes");
    }

    // Don't allow owner to add subject notes to their own recording
    if (session.ownerId === user._id) {
      throw new Error("Owner should edit notes directly");
    }

    const now = Date.now();
    const newNote = {
      userId: user._id,
      note: args.note.trim(),
      createdAt: now,
    };

    const currentNotes = session.subjectNotes ?? [];
    await ctx.db.patch(session._id, {
      subjectNotes: [...currentNotes, newNote],
    });

    // Create notification for owner
    await ctx.db.insert("notifications", {
      userId: session.ownerId,
      type: "subject_note",
      title: "New note on recording",
      body: `${user.name ?? "A subject"} added a note to a recording`,
      data: {
        sessionId: args.sessionId,
        noteBy: user._id,
        noteName: user.name,
        notePreview: args.note.slice(0, 100),
      },
      read: false,
    });

    return { success: true, sessionId: args.sessionId };
  },
});

// Share session with user
export const shareSession = mutation({
  args: {
    sessionId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to share this session");
    }

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser || targetUser.isArchived) {
      throw new Error("User not found");
    }

    const currentShared = session.sharedWith ?? [];
    if (!currentShared.includes(args.userId)) {
      await ctx.db.patch(session._id, {
        sharedWith: [...currentShared, args.userId],
      });
    }

    return args.sessionId;
  },
});

// Archive session
export const archiveSession = mutation({
  args: {
    sessionId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to archive this session");
    }

    await ctx.db.patch(session._id, {
      isArchived: true,
      archivedAt: Date.now(),
      archiveReason: args.reason ?? "User deleted session",
    });

    return args.sessionId;
  },
});

// Restore archived session
export const restoreSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const session = await ctx.db
      .query("recordingSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.ownerId !== user._id) {
      throw new Error("Not authorized to restore this session");
    }

    await ctx.db.patch(session._id, {
      isArchived: false,
      archivedAt: undefined,
      archiveReason: undefined,
    });

    return args.sessionId;
  },
});
