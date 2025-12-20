import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireRole } from "./lib/auth";
import { ROLES } from "./schema";

// Require admin role for all functions in this module
const requireAdmin = (ctx: any) => requireRole(ctx, [ROLES.ADMIN]);

// List all users (paginated)
export const listAllUsers = query({
  args: {
    limit: v.optional(v.number()),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const limit = args.limit ?? 100;

    let usersQuery = ctx.db.query("users");

    if (!args.includeArchived) {
      usersQuery = usersQuery.filter((q) => q.neq(q.field("isArchived"), true));
    }

    const users = await usersQuery.order("desc").take(limit);

    return users.map((user) => ({
      _id: user._id,
      email: user.email,
      name: user.name,
      image: user.image,
      role: user.role,
      contactsCount: (user.contacts ?? []).length,
      isArchived: user.isArchived,
      archivedAt: user.archivedAt,
      archiveReason: user.archiveReason,
      _creationTime: user._creationTime,
    }));
  },
});

// Get system stats
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    // Count users by role
    const allUsers = await ctx.db
      .query("users")
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    const usersByRole = {
      physiotherapist: 0,
      patient: 0,
      admin: 0,
      noRole: 0,
    };

    for (const user of allUsers) {
      if (!user.role) {
        usersByRole.noRole++;
      } else if (user.role === ROLES.PHYSIOTHERAPIST) {
        usersByRole.physiotherapist++;
      } else if (user.role === ROLES.PATIENT) {
        usersByRole.patient++;
      } else if (user.role === ROLES.ADMIN) {
        usersByRole.admin++;
      }
    }

    // Count sessions
    const allSessions = await ctx.db
      .query("recordingSessions")
      .filter((q) => q.neq(q.field("isArchived"), true))
      .collect();

    // Count invites
    const pendingInvites = await ctx.db
      .query("invites")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    // Archived counts
    const archivedUsers = await ctx.db
      .query("users")
      .withIndex("by_archived", (q) => q.eq("isArchived", true))
      .collect();

    const archivedSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_archived", (q) => q.eq("isArchived", true))
      .collect();

    // Calculate total recording duration
    const totalRecordingMs = allSessions.reduce(
      (sum, s) => sum + (s.endTime - s.startTime),
      0
    );

    return {
      users: {
        total: allUsers.length,
        byRole: usersByRole,
        archived: archivedUsers.length,
      },
      recordings: {
        total: allSessions.length,
        archived: archivedSessions.length,
        totalDurationMs: totalRecordingMs,
        totalDurationHours: Math.round(totalRecordingMs / 3600000 * 10) / 10,
      },
      invites: {
        pending: pendingInvites.length,
      },
    };
  },
});

// Set user role (admin only)
export const setUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(
      v.literal(ROLES.PHYSIOTHERAPIST),
      v.literal(ROLES.PATIENT),
      v.literal(ROLES.ADMIN)
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    // Can't change own role (safety)
    if (args.userId === admin._id) {
      throw new Error("Cannot change your own role");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.isArchived) {
      throw new Error("Cannot change role of archived user");
    }

    await ctx.db.patch(args.userId, { role: args.role });

    return args.userId;
  },
});

// Archive any user (admin only)
export const archiveUser = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    // Can't archive yourself
    if (args.userId === admin._id) {
      throw new Error("Cannot archive your own account");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (user.isArchived) {
      throw new Error("User is already archived");
    }

    await ctx.db.patch(args.userId, {
      isArchived: true,
      archivedAt: Date.now(),
      archiveReason: args.reason ?? "Archived by admin",
    });

    return args.userId;
  },
});

// Restore archived user (admin only)
export const restoreUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.isArchived) {
      throw new Error("User is not archived");
    }

    await ctx.db.patch(args.userId, {
      isArchived: false,
      archivedAt: undefined,
      archiveReason: undefined,
    });

    return args.userId;
  },
});

// Permanently delete user (admin only, immediate)
export const permanentlyDeleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    if (args.userId === admin._id) {
      throw new Error("Cannot delete your own account");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Delete all sessions owned by this user
    const userSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.userId))
      .collect();

    for (const session of userSessions) {
      // Delete associated recording chunks
      const chunks = await ctx.db
        .query("recordingChunks")
        .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
        .collect();

      for (const chunk of chunks) {
        await ctx.db.delete(chunk._id);
      }

      // Delete recording metrics
      const metrics = await ctx.db
        .query("recordingMetrics")
        .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
        .first();

      if (metrics) {
        await ctx.db.delete(metrics._id);
      }

      await ctx.db.delete(session._id);
    }

    // Delete all invites from this user
    const userInvites = await ctx.db
      .query("invites")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", args.userId))
      .collect();

    for (const invite of userInvites) {
      await ctx.db.delete(invite._id);
    }

    // Remove from other users' contacts
    const allUsers = await ctx.db.query("users").collect();
    for (const otherUser of allUsers) {
      if (otherUser._id === args.userId) continue;
      const hasContact = (otherUser.contacts ?? []).some((c) => c.userId === args.userId);
      if (hasContact) {
        const updatedContacts = (otherUser.contacts ?? []).filter(
          (c) => c.userId !== args.userId
        );
        await ctx.db.patch(otherUser._id, { contacts: updatedContacts });
      }
    }

    // Delete user
    await ctx.db.delete(args.userId);

    return args.userId;
  },
});
