import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Role types
export const ROLES = {
  PHYSIOTHERAPIST: "physiotherapist",
  PATIENT: "patient",
  ADMIN: "admin",
} as const;

// Invite status types
export const INVITE_STATUS = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
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

  // Users table
  users: defineTable({
    // Auth link (from Convex Auth)
    authId: v.string(),

    // Profile
    email: v.string(),
    name: v.string(),
    image: v.optional(v.string()),

    // Role
    role: v.optional(roleValidator), // Optional until onboarding complete

    // Contacts
    contacts: v.array(contactValidator),

    // Soft delete
    ...softDeleteFields,

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_authId", ["authId"])
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_archived", ["isArchived", "archivedAt"]),

  // Recordings table
  recordings: defineTable({
    // Ownership
    ownerId: v.id("users"),
    subjectId: v.optional(v.id("users")),
    subjectAlias: v.optional(v.string()),

    // Sharing
    sharedWith: v.optional(v.array(v.id("users"))),

    // Timing metadata
    startTime: v.number(),
    endTime: v.number(),
    sampleRate: v.number(),
    sampleCount: v.number(),
    durationMs: v.number(),

    // Angle data (arrays of float64)
    leftKnee: v.array(v.float64()),
    rightKnee: v.array(v.float64()),
    // Future joints can be added here:
    // leftHip: v.optional(v.array(v.float64())),
    // rightHip: v.optional(v.array(v.float64())),

    // Optional metadata
    notes: v.optional(v.string()),
    exerciseType: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),

    // Soft delete
    ...softDeleteFields,

    // Timestamps
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId", "createdAt"])
    .index("by_subject", ["subjectId", "createdAt"])
    .index("by_archived", ["isArchived", "archivedAt"]),

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
});
