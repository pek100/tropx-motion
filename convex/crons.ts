import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run cleanup daily at 3:00 AM UTC
crons.daily(
  "cleanup archived data",
  { hourUTC: 3, minuteUTC: 0 },
  internal.cleanup.cleanupArchivedData
);

// Expire old invites every hour
crons.hourly(
  "expire old invites",
  { minuteUTC: 30 },
  internal.invites.expireOldInvites
);

// Clean up LWW conflict logs weekly (Sundays at 4:00 AM UTC)
crons.weekly(
  "cleanup lww conflicts",
  { dayOfWeek: "sunday", hourUTC: 4, minuteUTC: 0 },
  internal.lwwConflicts.cleanupOldConflicts
);

// Clean up orphaned storage files daily at 4:30 AM UTC
// Handles: abandoned uploads (never saved) and cascade-deleted note images
crons.daily(
  "cleanup orphaned images",
  { hourUTC: 4, minuteUTC: 30 },
  internal.notes.cleanupOrphanedImages
);

export default crons;
