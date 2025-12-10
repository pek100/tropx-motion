import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  requireUser,
  getCurrentUser,
  canAccessRecording,
} from "./lib/auth";

// Get single recording (with access check)
export const get = query({
  args: { recordingId: v.id("recordings") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;

    const recording = await ctx.db.get(args.recordingId);
    if (!recording || recording.isArchived) return null;

    // Check access
    const hasAccess = await canAccessRecording(ctx, args.recordingId, user._id);
    if (!hasAccess) return null;

    // Get subject info if exists
    let subject = null;
    if (recording.subjectId) {
      const subjectUser = await ctx.db.get(recording.subjectId);
      if (subjectUser && !subjectUser.isArchived) {
        subject = {
          _id: subjectUser._id,
          name: subjectUser.name,
          email: subjectUser.email,
          image: subjectUser.image,
        };
      }
    }

    // Get owner info
    const owner = await ctx.db.get(recording.ownerId);

    return {
      ...recording,
      subject,
      owner: owner
        ? {
            _id: owner._id,
            name: owner.name,
            email: owner.email,
            image: owner.image,
          }
        : null,
    };
  },
});

// List recordings owned by me
export const listMyRecordings = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(limit);

    // Enrich with subject info
    return Promise.all(
      recordings.map(async (recording) => {
        let subjectName = recording.subjectAlias ?? "Unknown";
        if (recording.subjectId) {
          const subject = await ctx.db.get(recording.subjectId);
          if (subject && !subject.isArchived) {
            subjectName = subject.name;
          }
        }
        return {
          ...recording,
          subjectName,
          // Don't include angle arrays in list view
          leftKnee: undefined,
          rightKnee: undefined,
        };
      })
    );
  },
});

// List recordings where I'm the subject
export const listRecordingsOfMe = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_subject", (q) => q.eq("subjectId", user._id))
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .take(limit);

    // Enrich with owner info
    return Promise.all(
      recordings.map(async (recording) => {
        const owner = await ctx.db.get(recording.ownerId);
        return {
          ...recording,
          ownerName: owner?.name ?? "Unknown",
          leftKnee: undefined,
          rightKnee: undefined,
        };
      })
    );
  },
});

// List recordings shared with me
export const listSharedWithMe = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    // Need to scan all recordings and filter by sharedWith
    // In production, consider a separate table for shares
    const allRecordings = await ctx.db
      .query("recordings")
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .collect();

    const sharedRecordings = allRecordings
      .filter((r) => r.sharedWith?.includes(user._id))
      .slice(0, limit);

    return Promise.all(
      sharedRecordings.map(async (recording) => {
        const owner = await ctx.db.get(recording.ownerId);
        let subjectName = recording.subjectAlias ?? "Unknown";
        if (recording.subjectId) {
          const subject = await ctx.db.get(recording.subjectId);
          if (subject) subjectName = subject.name;
        }
        return {
          ...recording,
          ownerName: owner?.name ?? "Unknown",
          subjectName,
          leftKnee: undefined,
          rightKnee: undefined,
        };
      })
    );
  },
});

// List recordings for a specific subject (contact)
export const listBySubject = query({
  args: {
    subjectId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = args.limit ?? 50;

    // Only show recordings where I'm the owner
    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_subject", (q) => q.eq("subjectId", args.subjectId))
      .filter((q) =>
        q.and(
          q.eq(q.field("ownerId"), user._id),
          q.neq(q.field("isArchived"), true)
        )
      )
      .order("desc")
      .take(limit);

    const subject = await ctx.db.get(args.subjectId);

    return recordings.map((recording) => ({
      ...recording,
      subjectName: subject?.name ?? recording.subjectAlias ?? "Unknown",
      leftKnee: undefined,
      rightKnee: undefined,
    }));
  },
});

// Create new recording
export const create = mutation({
  args: {
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
    sampleRate: v.number(),
    leftKnee: v.array(v.float64()),
    rightKnee: v.array(v.float64()),
    notes: v.optional(v.string()),
    exerciseType: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Validate subject if provided
    if (args.subjectId) {
      const subject = await ctx.db.get(args.subjectId);
      if (!subject || subject.isArchived) {
        throw new Error("Subject user not found");
      }

      // Check if subject is self or a contact
      if (args.subjectId !== user._id) {
        const isContact = user.contacts.some((c) => c.userId === args.subjectId);
        if (!isContact) {
          throw new Error("Subject must be yourself or a contact");
        }
      }
    }

    // Validate arrays have same length
    if (args.leftKnee.length !== args.rightKnee.length) {
      throw new Error("Left and right knee arrays must have same length");
    }

    const sampleCount = args.leftKnee.length;
    const durationMs = args.endTime - args.startTime;

    const recordingId = await ctx.db.insert("recordings", {
      ownerId: user._id,
      subjectId: args.subjectId,
      subjectAlias: args.subjectAlias,
      sharedWith: [],
      startTime: args.startTime,
      endTime: args.endTime,
      sampleRate: args.sampleRate,
      sampleCount,
      durationMs,
      leftKnee: args.leftKnee,
      rightKnee: args.rightKnee,
      notes: args.notes,
      exerciseType: args.exerciseType,
      tags: args.tags,
      createdAt: Date.now(),
    });

    return recordingId;
  },
});

// Update recording metadata (notes, tags, exerciseType)
export const update = mutation({
  args: {
    recordingId: v.id("recordings"),
    notes: v.optional(v.string()),
    exerciseType: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    subjectAlias: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const recording = await ctx.db.get(args.recordingId);
    if (!recording) {
      throw new Error("Recording not found");
    }

    // Only owner can update
    if (recording.ownerId !== user._id) {
      throw new Error("Not authorized to update this recording");
    }

    const updates: {
      notes?: string;
      exerciseType?: string;
      tags?: string[];
      subjectAlias?: string;
    } = {};

    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.exerciseType !== undefined) updates.exerciseType = args.exerciseType;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.subjectAlias !== undefined) updates.subjectAlias = args.subjectAlias;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.recordingId, updates);
    }

    return args.recordingId;
  },
});

// Share recording with user
export const shareWith = mutation({
  args: {
    recordingId: v.id("recordings"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const recording = await ctx.db.get(args.recordingId);
    if (!recording) {
      throw new Error("Recording not found");
    }

    // Only owner can share
    if (recording.ownerId !== user._id) {
      throw new Error("Not authorized to share this recording");
    }

    // Check target user exists
    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser || targetUser.isArchived) {
      throw new Error("User not found");
    }

    // Check not already shared
    const currentShared = recording.sharedWith ?? [];
    if (currentShared.includes(args.userId)) {
      throw new Error("Recording already shared with this user");
    }

    await ctx.db.patch(args.recordingId, {
      sharedWith: [...currentShared, args.userId],
    });

    return args.recordingId;
  },
});

// Unshare recording
export const unshare = mutation({
  args: {
    recordingId: v.id("recordings"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const recording = await ctx.db.get(args.recordingId);
    if (!recording) {
      throw new Error("Recording not found");
    }

    if (recording.ownerId !== user._id) {
      throw new Error("Not authorized to modify sharing for this recording");
    }

    const currentShared = recording.sharedWith ?? [];
    const updatedShared = currentShared.filter((id) => id !== args.userId);

    await ctx.db.patch(args.recordingId, { sharedWith: updatedShared });

    return args.recordingId;
  },
});

// Archive recording (soft delete)
export const archive = mutation({
  args: {
    recordingId: v.id("recordings"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const recording = await ctx.db.get(args.recordingId);
    if (!recording) {
      throw new Error("Recording not found");
    }

    // Only owner can archive
    if (recording.ownerId !== user._id) {
      throw new Error("Not authorized to archive this recording");
    }

    await ctx.db.patch(args.recordingId, {
      isArchived: true,
      archivedAt: Date.now(),
      archiveReason: args.reason ?? "User deleted recording",
    });

    return args.recordingId;
  },
});

// Restore archived recording
export const restore = mutation({
  args: { recordingId: v.id("recordings") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const recording = await ctx.db.get(args.recordingId);
    if (!recording) {
      throw new Error("Recording not found");
    }

    if (recording.ownerId !== user._id) {
      throw new Error("Not authorized to restore this recording");
    }

    if (!recording.isArchived) {
      throw new Error("Recording is not archived");
    }

    await ctx.db.patch(args.recordingId, {
      isArchived: false,
      archivedAt: undefined,
      archiveReason: undefined,
    });

    return args.recordingId;
  },
});
