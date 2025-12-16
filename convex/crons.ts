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

// Delete expired raw recordings daily at 4:00 AM UTC
crons.daily(
  "cleanup expired raw recordings",
  { hourUTC: 4, minuteUTC: 0 },
  internal.rawRecordings.deleteExpired
);

export default crons;
