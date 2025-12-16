import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireUser, getCurrentUser } from "./lib/auth";
import { JOINTS, RECORDING_SOURCES } from "./schema";

// Quaternion object validator
const quaternionValidator = v.object({
  w: v.float64(),
  x: v.float64(),
  y: v.float64(),
  z: v.float64(),
});

// ─────────────────────────────────────────────────────────────────
// Chunk Creation
// ─────────────────────────────────────────────────────────────────

export const createChunk = mutation({
  args: {
    // Session info
    sessionId: v.string(),
    chunkIndex: v.number(),
    totalChunks: v.number(),

    // Timing
    startTime: v.number(),
    endTime: v.number(),
    sampleRate: v.number(),
    sampleCount: v.number(),

    // Active joints
    activeJoints: v.array(v.string()),

    // Quaternion data (flat arrays)
    leftKneeQ: v.array(v.float64()),
    rightKneeQ: v.array(v.float64()),

    // Sparse flags
    leftKneeInterpolated: v.array(v.number()),
    leftKneeMissing: v.array(v.number()),
    rightKneeInterpolated: v.array(v.number()),
    rightKneeMissing: v.array(v.number()),

    // Optional metadata (only on first chunk)
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),

    // Source tracking (only on first chunk)
    recordedAt: v.optional(v.number()), // Original capture time
    systemTags: v.optional(v.array(v.string())), // source:app, source:csv
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Validate quaternion array lengths
    const leftActive = args.activeJoints.includes(JOINTS.LEFT_KNEE);
    const rightActive = args.activeJoints.includes(JOINTS.RIGHT_KNEE);

    if (leftActive && args.leftKneeQ.length !== args.sampleCount * 4) {
      throw new Error(
        `Left knee quaternion array length mismatch: expected ${args.sampleCount * 4}, got ${args.leftKneeQ.length}`
      );
    }
    if (rightActive && args.rightKneeQ.length !== args.sampleCount * 4) {
      throw new Error(
        `Right knee quaternion array length mismatch: expected ${args.sampleCount * 4}, got ${args.rightKneeQ.length}`
      );
    }

    // Validate subject if provided
    if (args.subjectId) {
      const subject = await ctx.db.get(args.subjectId);
      if (!subject || subject.isArchived) {
        throw new Error("Subject user not found");
      }
      if (args.subjectId !== user._id) {
        const isContact = (user.contacts ?? []).some(
          (c) => c.userId === args.subjectId
        );
        if (!isContact) {
          throw new Error("Subject must be yourself or a contact");
        }
      }
    }

    const now = Date.now();

    const chunkId = await ctx.db.insert("recordings", {
      ownerId: user._id,
      subjectId: args.subjectId,
      subjectAlias: args.subjectAlias,
      sharedWith: [],
      sessionId: args.sessionId,
      chunkIndex: args.chunkIndex,
      totalChunks: args.totalChunks,
      startTime: args.startTime,
      endTime: args.endTime,
      sampleRate: args.sampleRate,
      sampleCount: args.sampleCount,
      activeJoints: args.activeJoints,
      leftKneeQ: leftActive ? args.leftKneeQ : [],
      rightKneeQ: rightActive ? args.rightKneeQ : [],
      leftKneeInterpolated: leftActive ? args.leftKneeInterpolated : [],
      leftKneeMissing: leftActive ? args.leftKneeMissing : [],
      rightKneeInterpolated: rightActive ? args.rightKneeInterpolated : [],
      rightKneeMissing: rightActive ? args.rightKneeMissing : [],
      notes: args.notes,
      tags: args.tags,
      // Source tracking fields
      recordedAt: args.recordedAt ?? args.startTime,
      systemTags: args.systemTags ?? [RECORDING_SOURCES.APP],
      createdAt: now,
    });

    // Notify subject if they are not the owner (only on first chunk)
    if (args.chunkIndex === 0 && args.subjectId && args.subjectId !== user._id) {
      const title = args.tags?.[0] || "Untitled Recording";
      await ctx.db.insert("notifications", {
        userId: args.subjectId,
        type: "added_as_subject",
        title: "You were added to a recording",
        body: `${user.name ?? "Someone"} recorded "${title}" with you as the subject`,
        data: {
          sessionId: args.sessionId,
          ownerId: user._id,
          ownerName: user.name,
          ownerImage: user.image,
          recordingTitle: title,
        },
        read: false,
        createdAt: now,
      });
    }

    return chunkId;
  },
});

// ─────────────────────────────────────────────────────────────────
// Session Queries
// ─────────────────────────────────────────────────────────────────

// Get full session (all chunks)
export const getSession = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === 0) return null;

    // Check access (use first chunk for ownership check)
    const firstChunk = chunks.find((c) => c.chunkIndex === 0) ?? chunks[0];
    const hasAccess =
      firstChunk.ownerId === user._id ||
      firstChunk.subjectId === user._id ||
      (firstChunk.sharedWith ?? []).includes(user._id);

    if (!hasAccess) return null;

    // Sort by chunk index
    const sortedChunks = chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

    // Get owner/subject info
    const owner = await ctx.db.get(firstChunk.ownerId);
    let subject = null;
    if (firstChunk.subjectId) {
      const subjectUser = await ctx.db.get(firstChunk.subjectId);
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
      chunks: sortedChunks,
      totalChunks: firstChunk.totalChunks,
      owner: owner
        ? { _id: owner._id, name: owner.name, email: owner.email, image: owner.image }
        : null,
      subject,
      // Aggregate metadata from first chunk
      subjectAlias: firstChunk.subjectAlias,
      notes: firstChunk.notes,
      tags: firstChunk.tags,
      activeJoints: firstChunk.activeJoints,
      sampleRate: firstChunk.sampleRate,
      // Aggregate timing from all chunks
      startTime: sortedChunks[0].startTime,
      endTime: sortedChunks[sortedChunks.length - 1].endTime,
      totalSampleCount: sortedChunks.reduce((sum, c) => sum + c.sampleCount, 0),
      createdAt: firstChunk.createdAt,
      isArchived: firstChunk.isArchived,
    };
  },
});

// List sessions owned by me (returns session summaries, not full data)
export const listMySessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    // Get first chunk of each session (chunkIndex === 0)
    const firstChunks = await ctx.db
      .query("recordings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("chunkIndex"), 0),
          q.neq(q.field("isArchived"), true)
        )
      )
      .order("desc")
      .take(limit);

    return Promise.all(
      firstChunks.map(async (chunk) => {
        let subjectName = chunk.subjectAlias ?? "Self";
        if (chunk.subjectId) {
          const subject = await ctx.db.get(chunk.subjectId);
          if (subject && !subject.isArchived) {
            subjectName = subject.name ?? subjectName;
          }
        }

        // Get all chunks to calculate total duration and samples
        const allChunks = await ctx.db
          .query("recordings")
          .withIndex("by_session", (q) => q.eq("sessionId", chunk.sessionId))
          .collect();

        const sortedChunks = allChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        const lastChunk = sortedChunks[sortedChunks.length - 1];

        return {
          sessionId: chunk.sessionId,
          subjectId: chunk.subjectId,
          subjectName,
          subjectAlias: chunk.subjectAlias,
          notes: chunk.notes,
          tags: chunk.tags,
          activeJoints: chunk.activeJoints,
          sampleRate: chunk.sampleRate,
          totalChunks: chunk.totalChunks,
          startTime: chunk.startTime,
          endTime: lastChunk?.endTime ?? chunk.endTime,
          totalSampleCount: sortedChunks.reduce((sum, c) => sum + c.sampleCount, 0),
          durationMs: (lastChunk?.endTime ?? chunk.endTime) - chunk.startTime,
          createdAt: chunk.createdAt,
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

    const firstChunks = await ctx.db
      .query("recordings")
      .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("chunkIndex"), 0),
          q.neq(q.field("isArchived"), true)
        )
      )
      .order("desc")
      .take(limit);

    return Promise.all(
      firstChunks.map(async (chunk) => {
        const owner = await ctx.db.get(chunk.ownerId);
        return {
          sessionId: chunk.sessionId,
          ownerName: owner?.name ?? "Unknown",
          notes: chunk.notes,
          tags: chunk.tags,
          activeJoints: chunk.activeJoints,
          sampleRate: chunk.sampleRate,
          totalChunks: chunk.totalChunks,
          startTime: chunk.startTime,
          durationMs: chunk.endTime - chunk.startTime,
          createdAt: chunk.createdAt,
        };
      })
    );
  },
});

// ─────────────────────────────────────────────────────────────────
// Search & Filter Queries
// ─────────────────────────────────────────────────────────────────

// Paginated search across recordings
export const searchSessions = query({
  args: {
    search: v.optional(v.string()),
    subjectId: v.optional(v.id("users")),
    includeMe: v.optional(v.boolean()), // Include recordings where I'm the subject
    cursor: v.optional(v.number()), // Timestamp cursor for pagination
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { sessions: [], nextCursor: null };

    const limit = Math.min(args.limit ?? 20, 50);
    const searchTerm = args.search?.toLowerCase().trim();

    // Build base query for owned sessions
    let query = ctx.db
      .query("recordings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("chunkIndex"), 0),
          q.neq(q.field("isArchived"), true)
        )
      );

    // Apply cursor
    if (args.cursor) {
      query = query.filter((q) => q.lt(q.field("createdAt"), args.cursor));
    }

    // Get sessions
    const ownedChunks = await query.order("desc").take(limit + 10);

    // If includeMe, also get sessions where I'm the subject
    let subjectChunks: typeof ownedChunks = [];
    if (args.includeMe) {
      let subjectQuery = ctx.db
        .query("recordings")
        .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("chunkIndex"), 0),
            q.neq(q.field("isArchived"), true),
            q.neq(q.field("ownerId"), user._id) // Don't duplicate owned
          )
        );

      if (args.cursor) {
        subjectQuery = subjectQuery.filter((q) =>
          q.lt(q.field("createdAt"), args.cursor)
        );
      }

      subjectChunks = await subjectQuery.order("desc").take(limit + 10);
    }

    // Combine and sort by createdAt
    let allChunks = [...ownedChunks, ...subjectChunks].sort(
      (a, b) => b.createdAt - a.createdAt
    );

    // Apply subject filter
    if (args.subjectId) {
      allChunks = allChunks.filter((c) => c.subjectId === args.subjectId);
    }

    // Apply search filter (client-side for flexibility)
    if (searchTerm) {
      allChunks = allChunks.filter((chunk) => {
        const searchFields = [
          chunk.notes,
          chunk.subjectAlias,
          ...(chunk.tags ?? []),
        ]
          .filter(Boolean)
          .map((s) => s!.toLowerCase());

        return searchFields.some((field) => field.includes(searchTerm));
      });
    }

    // Limit results
    const limited = allChunks.slice(0, limit);

    // Build session summaries
    const sessions = await Promise.all(
      limited.map(async (chunk) => {
        // Get subject info
        let subjectName = chunk.subjectAlias ?? "Self";
        let subjectImage: string | undefined;
        const isMe = chunk.subjectId === user._id;

        if (chunk.subjectId) {
          const subject = await ctx.db.get(chunk.subjectId);
          if (subject && !subject.isArchived) {
            subjectName = subject.name ?? subjectName;
            subjectImage = subject.image;
          }
        }

        // Get owner info
        const owner = await ctx.db.get(chunk.ownerId);
        const ownerName = chunk.ownerId === user._id ? "Me" : (owner?.name ?? "Unknown");
        const ownerImage = owner?.image;

        // Get all chunks to calculate totals
        const allSessionChunks = await ctx.db
          .query("recordings")
          .withIndex("by_session", (q) => q.eq("sessionId", chunk.sessionId))
          .collect();

        const sortedChunks = allSessionChunks.sort(
          (a, b) => a.chunkIndex - b.chunkIndex
        );
        const lastChunk = sortedChunks[sortedChunks.length - 1];

        return {
          sessionId: chunk.sessionId,
          ownerId: chunk.ownerId,
          ownerName,
          ownerImage,
          isOwner: chunk.ownerId === user._id,
          subjectId: chunk.subjectId,
          subjectName,
          subjectImage,
          subjectAlias: chunk.subjectAlias,
          isSubjectMe: isMe,
          notes: chunk.notes,
          tags: chunk.tags ?? [],
          systemTags: chunk.systemTags ?? [],
          activeJoints: chunk.activeJoints,
          sampleRate: chunk.sampleRate,
          totalChunks: chunk.totalChunks,
          startTime: chunk.startTime,
          endTime: lastChunk?.endTime ?? chunk.endTime,
          recordedAt: chunk.recordedAt ?? chunk.startTime,
          totalSampleCount: sortedChunks.reduce((sum, c) => sum + c.sampleCount, 0),
          durationMs: (lastChunk?.endTime ?? chunk.endTime) - chunk.startTime,
          createdAt: chunk.createdAt,
          modifiedAt: chunk.modifiedAt,
        };
      })
    );

    // Determine next cursor
    const nextCursor =
      limited.length === limit ? limited[limited.length - 1].createdAt : null;

    return { sessions, nextCursor };
  },
});

// Get session preview (all chunks - for LoadModal chart, with server-side downsampling)
export const getSessionPreview = query({
  args: {
    sessionId: v.string(),
    downsampleFactor: v.optional(v.number()), // Only include every Nth sample (default: 10)
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const downsample = Math.max(1, args.downsampleFactor ?? 10);

    // Get all chunks for this session
    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === 0) return null;

    // Sort by chunk index
    const sortedChunks = chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const firstChunk = sortedChunks[0];
    const lastChunk = sortedChunks[sortedChunks.length - 1];

    // Check access
    const hasAccess =
      firstChunk.ownerId === user._id ||
      firstChunk.subjectId === user._id ||
      (firstChunk.sharedWith ?? []).includes(user._id);

    if (!hasAccess) return null;

    // Merge and downsample quaternion data
    const mergedLeftKneeQ: number[] = [];
    const mergedRightKneeQ: number[] = [];
    const mergedLeftKneeInterpolated: number[] = [];
    const mergedLeftKneeMissing: number[] = [];
    const mergedRightKneeInterpolated: number[] = [];
    const mergedRightKneeMissing: number[] = [];

    let globalSampleIndex = 0; // Tracks position across all chunks
    let downsampledIndex = 0;  // Tracks position in downsampled output

    for (const chunk of sortedChunks) {
      // Build sets for O(1) flag lookup within this chunk
      const leftInterpSet = new Set(chunk.leftKneeInterpolated);
      const leftMissingSet = new Set(chunk.leftKneeMissing);
      const rightInterpSet = new Set(chunk.rightKneeInterpolated);
      const rightMissingSet = new Set(chunk.rightKneeMissing);

      for (let i = 0; i < chunk.sampleCount; i++) {
        // Only include every Nth sample (based on global position)
        if (globalSampleIndex % downsample === 0) {
          const qIdx = i * 4;

          // Push quaternion (4 floats per sample)
          if (chunk.leftKneeQ.length >= qIdx + 4) {
            mergedLeftKneeQ.push(
              chunk.leftKneeQ[qIdx],
              chunk.leftKneeQ[qIdx + 1],
              chunk.leftKneeQ[qIdx + 2],
              chunk.leftKneeQ[qIdx + 3]
            );
          }
          if (chunk.rightKneeQ.length >= qIdx + 4) {
            mergedRightKneeQ.push(
              chunk.rightKneeQ[qIdx],
              chunk.rightKneeQ[qIdx + 1],
              chunk.rightKneeQ[qIdx + 2],
              chunk.rightKneeQ[qIdx + 3]
            );
          }

          // Map flags to downsampled index
          if (leftInterpSet.has(i)) mergedLeftKneeInterpolated.push(downsampledIndex);
          if (leftMissingSet.has(i)) mergedLeftKneeMissing.push(downsampledIndex);
          if (rightInterpSet.has(i)) mergedRightKneeInterpolated.push(downsampledIndex);
          if (rightMissingSet.has(i)) mergedRightKneeMissing.push(downsampledIndex);

          downsampledIndex++;
        }
        globalSampleIndex++;
      }
    }

    // Return downsampled packed chunk data
    return {
      sessionId: args.sessionId,
      startTime: firstChunk.startTime,
      endTime: lastChunk.endTime,
      sampleRate: Math.round(firstChunk.sampleRate / downsample),
      sampleCount: downsampledIndex,
      activeJoints: firstChunk.activeJoints,
      leftKneeQ: mergedLeftKneeQ,
      rightKneeQ: mergedRightKneeQ,
      leftKneeInterpolated: mergedLeftKneeInterpolated,
      leftKneeMissing: mergedLeftKneeMissing,
      rightKneeInterpolated: mergedRightKneeInterpolated,
      rightKneeMissing: mergedRightKneeMissing,
    };
  },
});

// Get session preview optimized for chart rendering (adaptive downsampling)
export const getSessionPreviewForChart = query({
  args: {
    sessionId: v.string(),
    maxPoints: v.optional(v.number()), // Target max points for chart (default: 100)
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const maxPoints = args.maxPoints ?? 100;

    // Get all chunks for this session
    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === 0) return null;

    // Sort by chunk index
    const sortedChunks = chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const firstChunk = sortedChunks[0];
    const lastChunk = sortedChunks[sortedChunks.length - 1];

    // Check access
    const hasAccess =
      firstChunk.ownerId === user._id ||
      firstChunk.subjectId === user._id ||
      (firstChunk.sharedWith ?? []).includes(user._id);

    if (!hasAccess) return null;

    // Calculate total samples to determine downsample factor
    const totalSamples = sortedChunks.reduce((sum, c) => sum + c.sampleCount, 0);
    const downsample = Math.max(1, Math.ceil(totalSamples / maxPoints));

    // Merge and downsample quaternion data
    const mergedLeftKneeQ: number[] = [];
    const mergedRightKneeQ: number[] = [];

    let globalSampleIndex = 0;

    for (const chunk of sortedChunks) {
      for (let i = 0; i < chunk.sampleCount; i++) {
        if (globalSampleIndex % downsample === 0) {
          const qIdx = i * 4;

          if (chunk.leftKneeQ.length >= qIdx + 4) {
            mergedLeftKneeQ.push(
              chunk.leftKneeQ[qIdx],
              chunk.leftKneeQ[qIdx + 1],
              chunk.leftKneeQ[qIdx + 2],
              chunk.leftKneeQ[qIdx + 3]
            );
          }
          if (chunk.rightKneeQ.length >= qIdx + 4) {
            mergedRightKneeQ.push(
              chunk.rightKneeQ[qIdx],
              chunk.rightKneeQ[qIdx + 1],
              chunk.rightKneeQ[qIdx + 2],
              chunk.rightKneeQ[qIdx + 3]
            );
          }
        }
        globalSampleIndex++;
      }
    }

    // Return minimal data for chart rendering (no flags needed for preview)
    return {
      sessionId: args.sessionId,
      startTime: firstChunk.startTime,
      endTime: lastChunk.endTime,
      sampleRate: Math.round(firstChunk.sampleRate / downsample),
      sampleCount: Math.floor(mergedLeftKneeQ.length / 4),
      activeJoints: firstChunk.activeJoints,
      leftKneeQ: mergedLeftKneeQ,
      rightKneeQ: mergedRightKneeQ,
    };
  },
});

// Get distinct subjects for filter dropdown
export const getDistinctSubjects = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    // Get all first chunks owned by user
    const firstChunks = await ctx.db
      .query("recordings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) =>
        q.and(
          q.eq(q.field("chunkIndex"), 0),
          q.neq(q.field("isArchived"), true)
        )
      )
      .collect();

    // Count recordings per subject
    const subjectCounts = new Map<string, number>();
    const subjectIds = new Set<string>();

    for (const chunk of firstChunks) {
      const key = chunk.subjectId ?? "self";
      subjectCounts.set(key, (subjectCounts.get(key) ?? 0) + 1);
      if (chunk.subjectId) {
        subjectIds.add(chunk.subjectId);
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
      if (subjectId === user._id) continue; // Already added as "Me"

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

    // Compare arrays by JSON stringification
    const oldStr = JSON.stringify(oldVal);
    const newStr = JSON.stringify(newVal);

    if (oldStr !== newStr) {
      // Convert undefined to null to satisfy schema (old field is required)
      diffs.push({
        field,
        old: oldVal === undefined ? null : oldVal,
        new: newVal === undefined ? null : newVal
      });
    }
  }

  return diffs;
}

// Update session metadata with diff tracking (updates first chunk only)
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

    const firstChunk = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("chunkIndex"), 0))
      .first();

    if (!firstChunk) {
      throw new Error("Session not found");
    }

    if (firstChunk.ownerId !== user._id) {
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
      notes: firstChunk.notes,
      tags: firstChunk.tags,
      subjectId: firstChunk.subjectId,
      subjectAlias: firstChunk.subjectAlias,
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

      const currentHistory = firstChunk.modificationHistory ?? [];
      updates.modificationHistory = [...currentHistory, historyEntry];
      updates.modifiedAt = now;

      // Check if subject was changed to a different user (not the owner)
      const subjectDiff = diffs.find(d => d.field === "subjectId");
      if (subjectDiff && args.subjectId && args.subjectId !== user._id && args.subjectId !== firstChunk.subjectId) {
        const title = args.tags?.[0] || firstChunk.tags?.[0] || "Untitled Recording";
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
          createdAt: now,
        });
      }
    }

    await ctx.db.patch(firstChunk._id, updates);

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

    const firstChunk = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .filter((q) => q.eq(q.field("chunkIndex"), 0))
      .first();

    if (!firstChunk) {
      throw new Error("Session not found");
    }

    // User must be the subject (not owner) to add subject notes
    if (firstChunk.subjectId !== user._id) {
      throw new Error("Only the subject can add notes");
    }

    // Don't allow owner to add subject notes to their own recording
    if (firstChunk.ownerId === user._id) {
      throw new Error("Owner should edit notes directly");
    }

    const now = Date.now();
    const newNote = {
      userId: user._id,
      note: args.note.trim(),
      createdAt: now,
    };

    const currentNotes = firstChunk.subjectNotes ?? [];
    await ctx.db.patch(firstChunk._id, {
      subjectNotes: [...currentNotes, newNote],
    });

    // Create notification for owner
    await ctx.db.insert("notifications", {
      userId: firstChunk.ownerId,
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
      createdAt: now,
    });

    return { success: true, sessionId: args.sessionId };
  },
});

// Share session with user (updates all chunks)
export const shareSession = mutation({
  args: {
    sessionId: v.string(),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === 0) {
      throw new Error("Session not found");
    }

    if (chunks[0].ownerId !== user._id) {
      throw new Error("Not authorized to share this session");
    }

    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser || targetUser.isArchived) {
      throw new Error("User not found");
    }

    for (const chunk of chunks) {
      const currentShared = chunk.sharedWith ?? [];
      if (!currentShared.includes(args.userId)) {
        await ctx.db.patch(chunk._id, {
          sharedWith: [...currentShared, args.userId],
        });
      }
    }

    return args.sessionId;
  },
});

// Archive session (all chunks)
export const archiveSession = mutation({
  args: {
    sessionId: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === 0) {
      throw new Error("Session not found");
    }

    if (chunks[0].ownerId !== user._id) {
      throw new Error("Not authorized to archive this session");
    }

    const archiveData = {
      isArchived: true,
      archivedAt: Date.now(),
      archiveReason: args.reason ?? "User deleted session",
    };

    for (const chunk of chunks) {
      await ctx.db.patch(chunk._id, archiveData);
    }

    return args.sessionId;
  },
});

// Restore archived session
export const restoreSession = mutation({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const chunks = await ctx.db
      .query("recordings")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    if (chunks.length === 0) {
      throw new Error("Session not found");
    }

    if (chunks[0].ownerId !== user._id) {
      throw new Error("Not authorized to restore this session");
    }

    const restoreData = {
      isArchived: false,
      archivedAt: undefined,
      archiveReason: undefined,
    };

    for (const chunk of chunks) {
      await ctx.db.patch(chunk._id, restoreData);
    }

    return args.sessionId;
  },
});
