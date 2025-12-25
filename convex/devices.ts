/**
 * Device Management
 *
 * Handles device registration, activity tracking, preferences, and revocation.
 */

import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { DEVICE_PLATFORMS, THEME_OPTIONS, NOTIFICATION_TYPES } from "./schema";
import { getAuthUserId } from "./lib/auth";

// ─────────────────────────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────────────────────────

const platformValidator = v.union(
  v.literal(DEVICE_PLATFORMS.WEB),
  v.literal(DEVICE_PLATFORMS.ELECTRON),
  v.literal(DEVICE_PLATFORMS.ELECTRON_WEB)
);

const themeValidator = v.union(
  v.literal(THEME_OPTIONS.LIGHT),
  v.literal(THEME_OPTIONS.DARK),
  v.literal(THEME_OPTIONS.SYSTEM)
);

// ─────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────

/** Get all devices for current user */
export const getMyDevices = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const devices = await ctx.db
      .query("userDevices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Filter out revoked, sort by lastSeenAt desc
    return devices
      .filter((d) => !d.isRevoked)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  },
});

/** Get current device preferences */
export const getDevicePreferences = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const device = await ctx.db
      .query("userDevices")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", userId).eq("deviceId", deviceId)
      )
      .first();

    return device?.preferences ?? null;
  },
});

// ─────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────

/** Register or update device on auth */
export const registerDevice = mutation({
  args: {
    deviceId: v.string(),
    deviceName: v.string(),
    platform: platformValidator,
    userAgent: v.optional(v.string()),
    modifiedAt: v.optional(v.number()), // Added by customConvex for LWW
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();

    // Check if device exists
    const existing = await ctx.db
      .query("userDevices")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", userId).eq("deviceId", args.deviceId)
      )
      .first();

    if (existing) {
      // Update existing device
      await ctx.db.patch(existing._id, {
        deviceName: args.deviceName,
        userAgent: args.userAgent,
        lastSeenAt: now,
        isRevoked: false, // Re-activate if was revoked
      });
      return { deviceId: existing._id, isNew: false };
    }

    // Create new device
    const deviceDocId = await ctx.db.insert("userDevices", {
      userId,
      deviceId: args.deviceId,
      deviceName: args.deviceName,
      platform: args.platform,
      userAgent: args.userAgent,
      lastSeenAt: now,
      createdAt: now,
    });

    // Notify user of new device
    await ctx.scheduler.runAfter(0, internal.devices.notifyNewDevice, {
      userId,
      deviceName: args.deviceName,
      platform: args.platform,
    });

    return { deviceId: deviceDocId, isNew: true };
  },
});

/** Update device activity (lastSeenAt, lastIp) */
export const updateDeviceActivity = mutation({
  args: {
    deviceId: v.string(),
    modifiedAt: v.optional(v.number()), // Added by customConvex for LWW
  },
  handler: async (ctx, { deviceId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;

    const device = await ctx.db
      .query("userDevices")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", userId).eq("deviceId", deviceId)
      )
      .first();

    if (device && !device.isRevoked) {
      await ctx.db.patch(device._id, {
        lastSeenAt: Date.now(),
      });
    }
  },
});

/** Update device preferences (theme, etc.) */
export const updateDevicePreferences = mutation({
  args: {
    deviceId: v.string(),
    preferences: v.object({
      theme: v.optional(themeValidator),
    }),
    modifiedAt: v.optional(v.number()), // Added by customConvex for LWW
  },
  handler: async (ctx, { deviceId, preferences }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null; // Not authenticated, silently skip

    const device = await ctx.db
      .query("userDevices")
      .withIndex("by_user_device", (q) =>
        q.eq("userId", userId).eq("deviceId", deviceId)
      )
      .first();

    // Device not found or revoked - silently skip (device might not be registered yet)
    if (!device || device.isRevoked) return null;

    // Merge with existing preferences
    const merged = { ...device.preferences, ...preferences };
    await ctx.db.patch(device._id, { preferences: merged });

    return merged;
  },
});

/** Revoke a device (sign it out) */
export const revokeDevice = mutation({
  args: {
    deviceDocId: v.id("userDevices"),
    modifiedAt: v.optional(v.number()), // Added by customConvex for LWW
  },
  handler: async (ctx, { deviceDocId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const device = await ctx.db.get(deviceDocId);
    if (!device) throw new Error("Device not found");
    if (device.userId !== userId) throw new Error("Not your device");

    await ctx.db.patch(deviceDocId, { isRevoked: true });
  },
});

// ─────────────────────────────────────────────────────────────────
// Internal Mutations
// ─────────────────────────────────────────────────────────────────

/** Send notification for new device login */
export const notifyNewDevice = internalMutation({
  args: {
    userId: v.id("users"),
    deviceName: v.string(),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, { userId, deviceName, platform }) => {
    // Count existing devices to determine if this is truly new
    const deviceCount = await ctx.db
      .query("userDevices")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Only notify if user has more than 1 device (first device = no notification)
    if (deviceCount.length <= 1) return;

    // Parse OS from device name (format: "Browser | OS")
    const parts = deviceName.split(" | ");
    const browser = parts[0] || "Unknown";
    const os = parts.length > 1 ? parts[1] : "Unknown";

    await ctx.db.insert("notifications", {
      userId,
      type: NOTIFICATION_TYPES.NEW_DEVICE_LOGIN,
      title: "New Device Sign-in",
      body: `You signed in on a new device: ${deviceName}`,
      data: { deviceName, platform, browser, os },
      read: false,
      modifiedAt: Date.now(),
    });
  },
});
