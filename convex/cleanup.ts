import { internalMutation } from "./_generated/server";

// Constants
const ARCHIVE_RETENTION_DAYS = 30;
const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Cleanup archived users and sessions after retention period
export const cleanupArchivedData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoffTime = Date.now() - ARCHIVE_RETENTION_MS;
    let deletedUsers = 0;
    let deletedSessions = 0;
    let deletedChunks = 0;

    // Find archived users past retention
    const archivedUsers = await ctx.db
      .query("users")
      .withIndex("by_archived", (q) => q.eq("isArchived", true))
      .collect();

    for (const user of archivedUsers) {
      if (user.archivedAt && user.archivedAt < cutoffTime) {
        // Delete all sessions owned by this user
        const userSessions = await ctx.db
          .query("recordingSessions")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect();

        for (const session of userSessions) {
          // Delete associated recording chunks
          const chunks = await ctx.db
            .query("recordingChunks")
            .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
            .collect();

          for (const chunk of chunks) {
            await ctx.db.delete(chunk._id);
            deletedChunks++;
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
          deletedSessions++;
        }

        // Delete all invites from this user
        const userInvites = await ctx.db
          .query("invites")
          .withIndex("by_from_user", (q) => q.eq("fromUserId", user._id))
          .collect();

        for (const invite of userInvites) {
          await ctx.db.delete(invite._id);
        }

        // Remove from other users' contacts
        const allUsers = await ctx.db.query("users").collect();
        for (const otherUser of allUsers) {
          if (otherUser._id === user._id) continue;
          const hasContact = (otherUser.contacts ?? []).some(
            (c) => c.userId === user._id
          );
          if (hasContact) {
            const updatedContacts = (otherUser.contacts ?? []).filter(
              (c) => c.userId !== user._id
            );
            await ctx.db.patch(otherUser._id, { contacts: updatedContacts });
          }
        }

        // Delete user
        await ctx.db.delete(user._id);
        deletedUsers++;
      }
    }

    // Find archived sessions past retention (not already deleted with user)
    const archivedSessions = await ctx.db
      .query("recordingSessions")
      .withIndex("by_archived", (q) => q.eq("isArchived", true))
      .collect();

    for (const session of archivedSessions) {
      if (session.archivedAt && session.archivedAt < cutoffTime) {
        // Delete associated recording chunks
        const chunks = await ctx.db
          .query("recordingChunks")
          .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
          .collect();

        for (const chunk of chunks) {
          await ctx.db.delete(chunk._id);
          deletedChunks++;
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
        deletedSessions++;
      }
    }

    console.log(
      `Cleanup completed: ${deletedUsers} users, ${deletedSessions} sessions, ${deletedChunks} chunks deleted`
    );

    return {
      deletedUsers,
      deletedSessions,
      deletedChunks,
      cutoffDate: new Date(cutoffTime).toISOString(),
    };
  },
});
