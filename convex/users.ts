import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  getAuthUserId,
  getCurrentUser,
  requireAuth,
  requireUser,
} from "./lib/auth";
import { ROLES } from "./schema";

// Get current user with onboarding status
export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);

    if (!user) {
      // User authenticated but no record - shouldn't happen with Convex Auth
      // but handle gracefully
      const identity = await ctx.auth.getUserIdentity();
      return {
        needsOnboarding: true,
        email: identity?.email ?? "",
        name: identity?.name ?? "",
        image: identity?.pictureUrl ?? undefined,
      };
    }

    // User exists but no role - needs to complete onboarding
    if (!user.role) {
      return {
        ...user,
        needsOnboarding: true,
      };
    }

    return {
      ...user,
      needsOnboarding: false,
    };
  },
});

// Get user by ID (for viewing contacts, etc.)
export const getUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user || user.isArchived) return null;

    // Return limited public info
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
    };
  },
});

// Complete onboarding - set role on user record
export const completeOnboarding = mutation({
  args: {
    role: v.union(
      v.literal(ROLES.PHYSIOTHERAPIST),
      v.literal(ROLES.PATIENT)
    ),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const user = await ctx.db.get(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // Update user with role if not already set
    if (!user.role) {
      await ctx.db.patch(userId, {
        role: args.role,
        contacts: user.contacts ?? [],
        createdAt: user.createdAt ?? Date.now(),
      });
    }

    // Check for pending invites for this email and auto-accept
    if (user.email) {
      const pendingInvites = await ctx.db
        .query("invites")
        .withIndex("by_to_email", (q) =>
          q.eq("toEmail", user.email!).eq("status", "pending")
        )
        .collect();

      for (const invite of pendingInvites) {
        if (invite.expiresAt > Date.now()) {
          // Accept the invite
          await ctx.db.patch(invite._id, {
            status: "accepted",
            acceptedAt: Date.now(),
            acceptedByUserId: userId,
          });

          // Add contact relationship (inviter -> invitee)
          const inviter = await ctx.db.get(invite.fromUserId);
          if (inviter && !inviter.isArchived) {
            const updatedContacts = [
              ...(inviter.contacts ?? []),
              {
                userId,
                alias: invite.alias,
                addedAt: Date.now(),
              },
            ];
            await ctx.db.patch(invite.fromUserId, { contacts: updatedContacts });
          }
        }
      }
    }

    return userId;
  },
});

// Update profile (name, image)
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    image: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const updates: { name?: string; image?: string } = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.image !== undefined) updates.image = args.image;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(user._id, updates);
    }

    return user._id;
  },
});

// Get contacts with full user data
export const getContacts = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user || !user.contacts) return [];

    const contacts = await Promise.all(
      user.contacts.map(async (contact) => {
        const contactUser = await ctx.db.get(contact.userId);
        if (!contactUser || contactUser.isArchived) return null;

        return {
          userId: contact.userId,
          alias: contact.alias,
          addedAt: contact.addedAt,
          starred: contact.starred ?? false,
          // User data
          name: contactUser.name,
          email: contactUser.email,
          image: contactUser.image,
          role: contactUser.role,
          // Display name: "John Brown (patient) (my patient)"
          displayName: contact.alias
            ? `${contactUser.name} (${contactUser.role}) (${contact.alias})`
            : `${contactUser.name} (${contactUser.role})`,
        };
      })
    );

    return contacts.filter(Boolean);
  },
});

// Search user by email (for manual contact adding)
export const searchUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);

    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email.toLowerCase()))
      .first();

    if (!user || user.isArchived) return null;

    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
    };
  },
});

// Add contact directly (if user already exists)
export const addContact = mutation({
  args: {
    userId: v.id("users"),
    alias: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Check target user exists
    const targetUser = await ctx.db.get(args.userId);
    if (!targetUser || targetUser.isArchived) {
      throw new Error("User not found");
    }

    // Check not already a contact
    const alreadyContact = user.contacts.some(
      (c) => c.userId === args.userId
    );
    if (alreadyContact) {
      throw new Error("User is already a contact");
    }

    // Can't add yourself
    if (args.userId === user._id) {
      throw new Error("Cannot add yourself as a contact");
    }

    const updatedContacts = [
      ...user.contacts,
      {
        userId: args.userId,
        alias: args.alias,
        addedAt: Date.now(),
      },
    ];

    await ctx.db.patch(user._id, { contacts: updatedContacts });
    return user._id;
  },
});

// Update contact alias
export const updateContactAlias = mutation({
  args: {
    userId: v.id("users"),
    alias: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const contactIndex = user.contacts.findIndex(
      (c) => c.userId === args.userId
    );
    if (contactIndex === -1) {
      throw new Error("Contact not found");
    }

    const updatedContacts = [...user.contacts];
    updatedContacts[contactIndex] = {
      ...updatedContacts[contactIndex],
      alias: args.alias ?? undefined,
    };

    await ctx.db.patch(user._id, { contacts: updatedContacts });
    return user._id;
  },
});

// Remove contact
export const removeContact = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const updatedContacts = user.contacts.filter(
      (c) => c.userId !== args.userId
    );

    if (updatedContacts.length === user.contacts.length) {
      throw new Error("Contact not found");
    }

    await ctx.db.patch(user._id, { contacts: updatedContacts });
    return user._id;
  },
});

// Toggle contact starred status
export const toggleContactStar = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const contactIndex = user.contacts.findIndex(
      (c) => c.userId === args.userId
    );
    if (contactIndex === -1) {
      throw new Error("Contact not found");
    }

    const updatedContacts = [...user.contacts];
    const currentStarred = updatedContacts[contactIndex].starred ?? false;
    updatedContacts[contactIndex] = {
      ...updatedContacts[contactIndex],
      starred: !currentStarred,
    };

    await ctx.db.patch(user._id, { contacts: updatedContacts });
    return !currentStarred; // Return new starred state
  },
});

// Archive own account (self-delete)
export const archiveMyAccount = mutation({
  args: { reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    await ctx.db.patch(user._id, {
      isArchived: true,
      archivedAt: Date.now(),
      archiveReason: args.reason ?? "User requested account deletion",
    });

    return user._id;
  },
});

