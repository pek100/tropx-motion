import { v } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./lib/functions";
import { requireAuth, getAuthUserId } from "./lib/auth";

const MAX_RECENT_TAGS = 20;
const MAX_TAGS_PER_RECORDING = 10;
const DEFAULT_USER_ID = "default" as const;

// Default tags to seed
const DEFAULT_TAGS = [
  { tag: "squat", category: "exercise" },
  { tag: "lunge", category: "exercise" },
  { tag: "step-up", category: "exercise" },
  { tag: "deadlift", category: "exercise" },
  { tag: "leg-press", category: "exercise" },
  { tag: "walking", category: "exercise" },
  { tag: "running", category: "exercise" },
  { tag: "assessment", category: "session-type" },
  { tag: "rehab", category: "session-type" },
  { tag: "follow-up", category: "session-type" },
  { tag: "baseline", category: "session-type" },
];

// Get user's tags sorted by most recently used
export const getUserTags = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const limit = args.limit ?? MAX_RECENT_TAGS;

    const tags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    return tags.map((t) => ({
      tag: t.tag,
      lastUsedAt: t.lastUsedAt,
      usageCount: t.usageCount,
    }));
  },
});

// Search user's tags by prefix (for autocomplete)
export const searchUserTags = query({
  args: {
    prefix: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const limit = args.limit ?? 10;
    const prefix = args.prefix.toLowerCase();

    if (!prefix) return [];

    // Get all user tags and filter by prefix
    const allTags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    const matches = allTags
      .filter((t) => t.tag.toLowerCase().startsWith(prefix))
      .slice(0, limit);

    return matches.map((t) => ({
      tag: t.tag,
      lastUsedAt: t.lastUsedAt,
      usageCount: t.usageCount,
    }));
  },
});

// Track tag usage when saving/editing recording
export const syncUserTags = mutation({
  args: {
    tags: v.array(v.string()),
    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const now = Date.now();

    // Limit and clean tags
    const tags = args.tags
      .slice(0, MAX_TAGS_PER_RECORDING)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    for (const tag of tags) {
      // Check if tag exists
      const existing = await ctx.db
        .query("userTags")
        .withIndex("by_user_tag", (q) => q.eq("userId", userId).eq("tag", tag))
        .first();

      if (existing) {
        // Update existing
        await ctx.db.patch(existing._id, {
          lastUsedAt: now,
          usageCount: existing.usageCount + 1,
        });
      } else {
        // Create new
        await ctx.db.insert("userTags", {
          userId,
          tag,
          lastUsedAt: now,
          usageCount: 1,
        });
      }
    }

    return { tracked: tags.length };
  },
});

// Get default/suggested tags
export const getDefaultTags = query({
  args: {},
  handler: async (ctx) => {
    const tags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .order("desc")
      .collect();

    return tags.map((t) => ({
      tag: t.tag,
      category: t.category,
      usageCount: t.usageCount,
    }));
  },
});

// Get user tags merged with defaults (for TagsInput)
// Returns only defaults if user is not authenticated
export const getTagsWithDefaults = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const limit = args.limit ?? MAX_RECENT_TAGS;

    // Get default tags (always available)
    const defaultTags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .collect();

    // If not authenticated, return only defaults
    if (!userId) {
      return {
        userTags: [],
        defaults: defaultTags.map((t) => ({
          tag: t.tag,
          category: t.category,
          usageCount: t.usageCount,
          isDefault: true,
        })),
      };
    }

    // Get user's tags
    const userTags = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);

    // Build set of user's tag names
    const userTagNames = new Set(userTags.map((t) => t.tag));

    // Filter defaults not already in user's tags
    const unusedDefaults = defaultTags.filter((t) => !userTagNames.has(t.tag));

    return {
      userTags: userTags.map((t) => ({
        tag: t.tag,
        category: t.category,
        lastUsedAt: t.lastUsedAt,
        usageCount: t.usageCount,
        isDefault: false,
      })),
      defaults: unusedDefaults.map((t) => ({
        tag: t.tag,
        category: t.category,
        usageCount: t.usageCount,
        isDefault: true,
      })),
    };
  },
});

// Seed default tags (run once)
export const seedDefaultTags = mutation({
  args: { modifiedAt: v.optional(v.number()) },
  handler: async (ctx) => {
    const now = Date.now();

    // Check if already seeded
    const existing = await ctx.db
      .query("userTags")
      .withIndex("by_user", (q) => q.eq("userId", DEFAULT_USER_ID))
      .first();

    if (existing) {
      return { seeded: false, message: "Default tags already exist" };
    }

    // Seed all default tags
    for (const { tag, category } of DEFAULT_TAGS) {
      await ctx.db.insert("userTags", {
        userId: DEFAULT_USER_ID,
        tag,
        category,
        lastUsedAt: now,
        usageCount: 0,
      });
    }

    return { seeded: true, count: DEFAULT_TAGS.length };
  },
});
