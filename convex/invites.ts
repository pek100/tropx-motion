import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { requireUser, requireAuth, getCurrentUser } from "./lib/auth";
import { INVITE_STATUS, ROLES } from "./schema";

// Constants
const INVITE_EXPIRY_DAYS = 7;
const INVITE_EXPIRY_MS = INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

// Generate a unique invite token
function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Get invites I've sent
export const getMyInvites = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_from_user", (q) => q.eq("fromUserId", user._id))
      .collect();

    return invites.map((invite) => ({
      _id: invite._id,
      toEmail: invite.toEmail,
      alias: invite.alias,
      status: invite.status,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      isExpired: invite.expiresAt < Date.now() && invite.status === "pending",
    }));
  },
});

// Get invite by token (public - for invite link page)
export const getInviteByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) return null;

    // Get inviter info
    const inviter = await ctx.db.get(invite.fromUserId);

    return {
      _id: invite._id,
      status: invite.status,
      alias: invite.alias,
      expiresAt: invite.expiresAt,
      isExpired: invite.expiresAt < Date.now() && invite.status === "pending",
      inviter: inviter
        ? {
            name: inviter.name,
            email: inviter.email,
            image: inviter.image,
          }
        : null,
    };
  },
});

// Get pending invites for an email (used during signup)
export const getPendingInvitesForEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const invites = await ctx.db
      .query("invites")
      .withIndex("by_to_email", (q) =>
        q.eq("toEmail", args.email.toLowerCase()).eq("status", "pending")
      )
      .collect();

    // Filter out expired
    return invites.filter((invite) => invite.expiresAt > Date.now());
  },
});

// Get my pending invitations (invites sent TO the current user)
export const getMyPendingInvitations = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || !user.email) return [];

    const invites = await ctx.db
      .query("invites")
      .withIndex("by_to_email", (q) =>
        q.eq("toEmail", user.email!).eq("status", "pending")
      )
      .collect();

    // Filter out expired and get inviter info
    const validInvites = await Promise.all(
      invites
        .filter((invite) => invite.expiresAt > Date.now())
        .map(async (invite) => {
          const inviter = await ctx.db.get(invite.fromUserId);
          return {
            _id: invite._id,
            alias: invite.alias,
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
            inviter: inviter
              ? {
                  _id: inviter._id,
                  name: inviter.name,
                  email: inviter.email,
                  image: inviter.image,
                  role: inviter.role,
                }
              : null,
          };
        })
    );

    return validInvites;
  },
});

// Reject invite
export const rejectInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throw new Error("Invite not found");
    }

    // Can only reject invites sent to you
    if (invite.toEmail.toLowerCase() !== user.email?.toLowerCase()) {
      throw new Error("Not authorized to reject this invite");
    }

    if (invite.status !== "pending") {
      throw new Error(`Cannot reject ${invite.status} invite`);
    }

    // Delete the invite (or could mark as rejected if we want to track)
    await ctx.db.delete(args.inviteId);
    return args.inviteId;
  },
});

// Accept invite by ID (for notification bell)
export const acceptInviteById = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throw new Error("Invite not found");
    }

    // Can only accept invites sent to you
    if (invite.toEmail.toLowerCase() !== user.email?.toLowerCase()) {
      throw new Error("Not authorized to accept this invite");
    }

    if (invite.status !== "pending") {
      throw new Error(`Invite already ${invite.status}`);
    }

    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, { status: INVITE_STATUS.EXPIRED });
      throw new Error("Invite has expired");
    }

    // Mark invite as accepted
    await ctx.db.patch(invite._id, {
      status: INVITE_STATUS.ACCEPTED,
      acceptedAt: Date.now(),
      acceptedByUserId: user._id,
    });

    // Add contact relationship (inviter -> invitee)
    const inviter = await ctx.db.get(invite.fromUserId);
    if (inviter && !inviter.isArchived) {
      const inviterContacts = inviter.contacts ?? [];
      const alreadyContact = inviterContacts.some(
        (c) => c.userId === user._id
      );
      if (!alreadyContact) {
        const updatedContacts = [
          ...inviterContacts,
          {
            userId: user._id,
            alias: invite.alias,
            addedAt: Date.now(),
          },
        ];
        await ctx.db.patch(invite.fromUserId, { contacts: updatedContacts });
      }
    }

    return { userId: user._id, inviterId: invite.fromUserId };
  },
});

// Create invite
export const createInvite = mutation({
  args: {
    email: v.string(),
    alias: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Normalize email
    const email = args.email.toLowerCase().trim();

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error("Invalid email format");
    }

    // Can't invite yourself
    if (email === user.email) {
      throw new Error("Cannot invite yourself");
    }

    // Check if user already exists and is already a contact
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .first();

    if (existingUser && !existingUser.isArchived) {
      const alreadyContact = (user.contacts ?? []).some(
        (c) => c.userId === existingUser._id
      );
      if (alreadyContact) {
        throw new Error("This user is already in your contacts");
      }
    }

    // Check for existing pending invite
    const existingInvite = await ctx.db
      .query("invites")
      .withIndex("by_to_email", (q) =>
        q.eq("toEmail", email).eq("status", "pending")
      )
      .first();

    if (existingInvite && existingInvite.fromUserId === user._id) {
      if (existingInvite.expiresAt > Date.now()) {
        throw new Error("You already have a pending invite for this email");
      }
      // Expired - update it
      const newToken = generateToken();
      await ctx.db.patch(existingInvite._id, {
        token: newToken,
        alias: args.alias,
        expiresAt: Date.now() + INVITE_EXPIRY_MS,
        createdAt: Date.now(),
      });
      return { inviteId: existingInvite._id, token: newToken };
    }

    // Create new invite
    const token = generateToken();
    const inviteId = await ctx.db.insert("invites", {
      fromUserId: user._id,
      toEmail: email,
      alias: args.alias,
      token,
      status: INVITE_STATUS.PENDING,
      expiresAt: Date.now() + INVITE_EXPIRY_MS,
      createdAt: Date.now(),
    });

    return { inviteId, token };
  },
});

// Accept invite (called after user signs in via invite link)
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // Find invite
    const invite = await ctx.db
      .query("invites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      throw new Error("Invite not found");
    }

    if (invite.status !== "pending") {
      throw new Error(`Invite already ${invite.status}`);
    }

    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, { status: INVITE_STATUS.EXPIRED });
      throw new Error("Invite has expired");
    }

    // Set role to patient if not already set (default for invite acceptance)
    if (!user.role) {
      await ctx.db.patch(userId, {
        role: ROLES.PATIENT,
        contacts: user.contacts ?? [],
        createdAt: user.createdAt ?? Date.now(),
      });
    }

    // Mark invite as accepted
    await ctx.db.patch(invite._id, {
      status: INVITE_STATUS.ACCEPTED,
      acceptedAt: Date.now(),
      acceptedByUserId: user._id,
    });

    // Add contact relationship (inviter -> invitee)
    const inviter = await ctx.db.get(invite.fromUserId);
    if (inviter && !inviter.isArchived) {
      const inviterContacts = inviter.contacts ?? [];
      const alreadyContact = inviterContacts.some(
        (c) => c.userId === user!._id
      );
      if (!alreadyContact) {
        const updatedContacts = [
          ...inviterContacts,
          {
            userId: user._id,
            alias: invite.alias,
            addedAt: Date.now(),
          },
        ];
        await ctx.db.patch(invite.fromUserId, { contacts: updatedContacts });
      }
    }

    return { userId: user._id, inviterId: invite.fromUserId };
  },
});

// Cancel invite
export const cancelInvite = mutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throw new Error("Invite not found");
    }

    if (invite.fromUserId !== user._id) {
      throw new Error("Not authorized to cancel this invite");
    }

    if (invite.status !== "pending") {
      throw new Error(`Cannot cancel ${invite.status} invite`);
    }

    await ctx.db.delete(args.inviteId);
    return args.inviteId;
  },
});

// Internal: Expire old invites (called by cron)
export const expireOldInvites = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // Find pending invites that have expired
    const expiredInvites = await ctx.db
      .query("invites")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();

    let expiredCount = 0;
    for (const invite of expiredInvites) {
      if (invite.expiresAt < now) {
        await ctx.db.patch(invite._id, { status: INVITE_STATUS.EXPIRED });
        expiredCount++;
      }
    }

    return { expiredCount };
  },
});
