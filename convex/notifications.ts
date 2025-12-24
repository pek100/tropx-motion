import { v } from "convex/values";
import { query, action } from "./_generated/server";
import { mutation, internalMutation } from "./lib/functions";
import { internal } from "./_generated/api";
import { requireUser, getCurrentUser } from "./lib/auth";
import { NOTIFICATION_TYPES } from "./schema";

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

// List notifications for current user
export const listForUser = query({
  args: {
    limit: v.optional(v.number()),
    unreadOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];

    const limit = Math.min(args.limit ?? 50, 100);

    const notifications = args.unreadOnly
      ? await ctx.db
          .query("notifications")
          .withIndex("by_user_unread", (q) =>
            q.eq("userId", user._id).eq("read", false)
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .order("desc")
          .take(limit);

    // Map _creationTime to createdAt for frontend compatibility
    return notifications.map((n) => ({
      ...n,
      createdAt: n._creationTime,
    }));
  },
});

// Get unread count
export const getUnreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return 0;

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", user._id).eq("read", false)
      )
      .collect();

    return unread.length;
  },
});

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

// Mark single notification as read
export const markRead = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      throw new Error("Notification not found");
    }

    if (notification.userId !== user._id) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.notificationId, { read: true });

    return { success: true };
  },
});

// Mark all notifications as read
export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_unread", (q) =>
        q.eq("userId", user._id).eq("read", false)
      )
      .collect();

    for (const notification of unread) {
      await ctx.db.patch(notification._id, { read: true });
    }

    return { success: true, count: unread.length };
  },
});

// Delete a notification
export const deleteNotification = mutation({
  args: {
    notificationId: v.id("notifications"),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const notification = await ctx.db.get(args.notificationId);
    if (!notification) {
      throw new Error("Notification not found");
    }

    if (notification.userId !== user._id) {
      throw new Error("Not authorized");
    }

    await ctx.db.delete(args.notificationId);

    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Mutations (for creating notifications from other modules)
// ─────────────────────────────────────────────────────────────────

// Create notification (internal use)
export const create = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const notificationId = await ctx.db.insert("notifications", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      data: args.data,
      read: false,
    });

    // Check if user wants email notifications
    const user = await ctx.db.get(args.userId);
    const shouldSendEmail = user?.emailNotifications !== false; // Default true

    if (shouldSendEmail && user?.email) {
      // Schedule email sending
      await ctx.scheduler.runAfter(0, internal.notifications.sendEmailNotification, {
        userId: args.userId,
        email: user.email,
        type: args.type,
        title: args.title,
        body: args.body,
        data: args.data,
      });
    }

    return notificationId;
  },
});

// ─────────────────────────────────────────────────────────────────
// Actions (for side effects like email)
// ─────────────────────────────────────────────────────────────────

// Send email notification (placeholder - implement with email provider)
export const sendEmailNotification = internalMutation({
  args: {
    userId: v.id("users"),
    email: v.string(),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // TODO: Implement actual email sending with provider (Resend, SendGrid, etc.)
    // For now, just log the email that would be sent
    console.log(`[EMAIL] Would send to ${args.email}:`, {
      subject: args.title,
      body: args.body,
      type: args.type,
    });

    // In production, you would call an email API here:
    // await resend.emails.send({
    //   from: 'TropX Motion <notifications@tropx.app>',
    //   to: args.email,
    //   subject: args.title,
    //   html: generateEmailTemplate(args.type, args.title, args.body, args.data),
    // });

    return { sent: true, email: args.email };
  },
});

// ─────────────────────────────────────────────────────────────────
// Email Templates (to be used when email sending is implemented)
// ─────────────────────────────────────────────────────────────────

// Generate email HTML template based on notification type
export function generateEmailTemplate(
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): string {
  const baseStyle = `
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    padding: 20px;
  `;

  const headerStyle = `
    color: #1a1a1a;
    font-size: 24px;
    margin-bottom: 16px;
  `;

  const bodyStyle = `
    color: #4a4a4a;
    font-size: 16px;
    line-height: 1.5;
  `;

  const buttonStyle = `
    display: inline-block;
    background-color: #7c3aed;
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    text-decoration: none;
    margin-top: 20px;
  `;

  let actionButton = "";

  if (type === NOTIFICATION_TYPES.SUBJECT_NOTE && data?.sessionId) {
    actionButton = `
      <a href="tropx://recording/${data.sessionId}" style="${buttonStyle}">
        View Recording
      </a>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
      </head>
      <body style="${baseStyle}">
        <h1 style="${headerStyle}">${title}</h1>
        <p style="${bodyStyle}">${body}</p>
        ${actionButton}
        <hr style="margin-top: 40px; border: none; border-top: 1px solid #e0e0e0;">
        <p style="color: #888; font-size: 12px;">
          This email was sent by TropX Motion.
          You can manage your notification preferences in the app settings.
        </p>
      </body>
    </html>
  `;
}
