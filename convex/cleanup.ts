import { internalMutation } from "./_generated/server";

// Constants
const ARCHIVE_RETENTION_DAYS = 30;
const ARCHIVE_RETENTION_MS = ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Cleanup archived users and recordings after retention period
export const cleanupArchivedData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoffTime = Date.now() - ARCHIVE_RETENTION_MS;
    let deletedUsers = 0;
    let deletedRecordings = 0;

    // Find archived users past retention
    const archivedUsers = await ctx.db
      .query("users")
      .withIndex("by_archived", (q) => q.eq("isArchived", true))
      .collect();

    for (const user of archivedUsers) {
      if (user.archivedAt && user.archivedAt < cutoffTime) {
        // Delete all recordings owned by this user
        const userRecordings = await ctx.db
          .query("recordings")
          .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
          .collect();

        for (const recording of userRecordings) {
          await ctx.db.delete(recording._id);
          deletedRecordings++;
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
          const hasContact = otherUser.contacts.some(
            (c) => c.userId === user._id
          );
          if (hasContact) {
            const updatedContacts = otherUser.contacts.filter(
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

    // Find archived recordings past retention (not already deleted with user)
    const archivedRecordings = await ctx.db
      .query("recordings")
      .withIndex("by_archived", (q) => q.eq("isArchived", true))
      .collect();

    for (const recording of archivedRecordings) {
      if (recording.archivedAt && recording.archivedAt < cutoffTime) {
        await ctx.db.delete(recording._id);
        deletedRecordings++;
      }
    }

    console.log(
      `Cleanup completed: ${deletedUsers} users, ${deletedRecordings} recordings deleted`
    );

    return {
      deletedUsers,
      deletedRecordings,
      cutoffDate: new Date(cutoffTime).toISOString(),
    };
  },
});
