import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Role types
export const ROLES = {
  PHYSIOTHERAPIST: "physiotherapist",
  PATIENT: "patient",
  ADMIN: "admin",
} as const;

// Joint types
export const JOINTS = {
  LEFT_KNEE: "left_knee",
  RIGHT_KNEE: "right_knee",
} as const;

// Recording constants
export const RECORDING_CONSTANTS = {
  SAMPLES_PER_CHUNK: 6000,
  DEFAULT_SAMPLE_RATE: 100,
  RAW_RECORDING_TTL_MS: 14 * 24 * 60 * 60 * 1000, // 14 days
} as const;

// Invite status types
export const INVITE_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
} as const;

// Notification types
export const NOTIFICATION_TYPES = {
  SUBJECT_NOTE: "subject_note",
  RECORDING_SHARED: "recording_shared",
  INVITE_ACCEPTED: "invite_accepted",
  ADDED_AS_SUBJECT: "added_as_subject",
} as const;

// Recording source types (system tags)
export const RECORDING_SOURCES = {
  APP: "source:app",
  CSV: "source:csv",
} as const;

// Validators
const roleValidator = v.union(
  v.literal(ROLES.PHYSIOTHERAPIST),
  v.literal(ROLES.PATIENT),
  v.literal(ROLES.ADMIN)
);

const inviteStatusValidator = v.union(
  v.literal(INVITE_STATUS.PENDING),
  v.literal(INVITE_STATUS.ACCEPTED),
  v.literal(INVITE_STATUS.EXPIRED)
);

const contactValidator = v.object({
  userId: v.id("users"),
  alias: v.optional(v.string()),
  addedAt: v.number(),
  starred: v.optional(v.boolean()),
});

// Modification diff validator (git-like tracking)
const modificationDiffValidator = v.object({
  field: v.string(),
  old: v.any(),
  new: v.any(),
});

const modificationHistoryEntryValidator = v.object({
  modifiedAt: v.number(),
  modifiedBy: v.id("users"),
  diffs: v.array(modificationDiffValidator),
});

// Subject note validator
const subjectNoteValidator = v.object({
  userId: v.id("users"),
  note: v.string(),
  createdAt: v.number(),
});

// Soft delete fields (reusable)
const softDeleteFields = {
  isArchived: v.optional(v.boolean()),
  archivedAt: v.optional(v.number()),
  archiveReason: v.optional(v.string()),
};

export default defineSchema({
  // Convex Auth tables
  ...authTables,

  // Users table - extends Convex Auth's users table
  // Fields from Convex Auth: email, name, image, emailVerificationTime
  // Our custom fields must be optional since Auth creates the initial record
  users: defineTable({
    // Profile (from Convex Auth - these are provided by OAuth)
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    name: v.optional(v.string()),
    image: v.optional(v.string()),

    // Role
    role: v.optional(roleValidator), // Optional until onboarding complete

    // Contacts
    contacts: v.optional(v.array(contactValidator)),

    // Notification settings
    emailNotifications: v.optional(v.boolean()), // Default true (send emails for notifications)

    // Soft delete
    ...softDeleteFields,

    // Timestamps
    createdAt: v.optional(v.number()),
  })
    .index("email", ["email"]) // Required by Convex Auth
    .index("by_role", ["role"])
    .index("by_archived", ["isArchived", "archivedAt"]),

  // Recordings table - quaternion storage with chunking
  recordings: defineTable({
    // Ownership
    ownerId: v.id("users"),
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),

    // Sharing
    sharedWith: v.optional(v.array(v.id("users"))),

    // Session chunking
    sessionId: v.string(),
    chunkIndex: v.number(),
    totalChunks: v.number(),

    // Timing (uniform rate - timestamps reconstructed from startTime + index * interval)
    startTime: v.number(),
    endTime: v.number(),
    sampleRate: v.number(),
    sampleCount: v.number(),

    // Active joints (empty array = joint not recorded)
    activeJoints: v.array(v.string()),

    // Quaternion data - flat arrays [w,x,y,z, w,x,y,z, ...] or [] if inactive
    leftKneeQ: v.array(v.float64()),
    rightKneeQ: v.array(v.float64()),

    // Sparse flag indices (only non-real samples are listed)
    leftKneeInterpolated: v.array(v.number()),
    leftKneeMissing: v.array(v.number()),
    rightKneeInterpolated: v.array(v.number()),
    rightKneeMissing: v.array(v.number()),

    // User metadata
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),

    // System tags (source:app, source:csv) - non-removable
    systemTags: v.optional(v.array(v.string())),

    // Subject notes (from subjects viewing their recordings)
    subjectNotes: v.optional(v.array(subjectNoteValidator)),

    // Audit trail
    recordedAt: v.optional(v.number()), // Original capture time (from first sample)
    modifiedAt: v.optional(v.number()), // Last modification time
    modificationHistory: v.optional(v.array(modificationHistoryEntryValidator)),

    // Soft delete
    ...softDeleteFields,

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId", "createdAt"])
    .index("by_session", ["sessionId", "chunkIndex"])
    .index("by_subject", ["subjectId", "createdAt"])
    .index("by_archived", ["isArchived", "archivedAt"])
    .searchIndex("search_recordings", {
      searchField: "notes",
      filterFields: ["ownerId", "subjectId", "isArchived"],
    }),

  // Raw recordings - original timestamps, 2-week TTL for debugging
  rawRecordings: defineTable({
    // Session chunking
    sessionId: v.string(),
    chunkIndex: v.number(),
    totalChunks: v.number(),

    // Raw samples with original timestamps
    samples: v.array(
      v.object({
        t: v.number(),
        lq: v.optional(
          v.object({
            w: v.float64(),
            x: v.float64(),
            y: v.float64(),
            z: v.float64(),
          })
        ),
        rq: v.optional(
          v.object({
            w: v.float64(),
            x: v.float64(),
            y: v.float64(),
            z: v.float64(),
          })
        ),
      })
    ),

    // TTL
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_session", ["sessionId", "chunkIndex"])
    .index("by_expires", ["expiresAt"]),

  // Invites table
  invites: defineTable({
    // Who sent the invite
    fromUserId: v.id("users"),

    // Invitee info
    toEmail: v.string(),
    alias: v.optional(v.string()),

    // Invite token (unique, used in URL)
    token: v.string(),

    // Status
    status: inviteStatusValidator,

    // Expiration
    expiresAt: v.number(),

    // Timestamps
    createdAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedByUserId: v.optional(v.id("users")),
  })
    .index("by_token", ["token"])
    .index("by_from_user", ["fromUserId", "status"])
    .index("by_to_email", ["toEmail", "status"])
    .index("by_status", ["status", "expiresAt"]),

  // Notifications table
  notifications: defineTable({
    // Who receives the notification
    userId: v.id("users"),

    // Notification type (subject_note, recording_shared, etc.)
    type: v.string(),

    // Display content
    title: v.string(),
    body: v.string(),

    // Additional data (sessionId, noteBy, etc.)
    data: v.optional(v.any()),

    // Status
    read: v.boolean(),

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_unread", ["userId", "read", "createdAt"]),

  // User tags - tracks tag usage history per user
  // userId = "default" for system-provided default tags
  userTags: defineTable({
    userId: v.union(v.id("users"), v.literal("default")),
    tag: v.string(),
    category: v.optional(v.string()), // 'exercise', 'session-type'
    lastUsedAt: v.number(),
    usageCount: v.number(),
  })
    .index("by_user", ["userId", "lastUsedAt"])
    .index("by_user_tag", ["userId", "tag"]),
});
