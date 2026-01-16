import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { mutation } from "./lib/functions";
import { getCurrentUser } from "./lib/auth";
import { NOTE_CATEGORIES } from "./schema";
import type { Id } from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

const noteCategoryValidator = v.union(
  v.literal(NOTE_CATEGORIES.PATIENT)
);

// ─────────────────────────────────────────────────────────────────
// Image Storage
// ─────────────────────────────────────────────────────────────────

/** Generate a presigned URL for uploading an image to Convex storage. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** Get the URL for a stored image by storageId. */
export const getImageUrl = query({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

/** Get URLs for multiple stored images. */
export const getImageUrls = query({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const urls: Record<string, string | null> = {};
    for (const storageId of args.storageIds) {
      urls[storageId] = await ctx.storage.getUrl(storageId);
    }
    return urls;
  },
});

// ─────────────────────────────────────────────────────────────────
// Note CRUD
// ─────────────────────────────────────────────────────────────────

/** Create a new note. */
export const createNote = mutation({
  args: {
    category: noteCategoryValidator,
    contextId: v.string(),
    content: v.string(),
    imageIds: v.optional(v.array(v.id("_storage"))),
    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Validate contextId based on category
    if (args.category === NOTE_CATEGORIES.PATIENT) {
      // For patient notes, contextId should be a valid user (subject) ID
      // We allow any string for flexibility, but could add validation here
    }

    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      userId: user._id,
      category: args.category,
      contextId: args.contextId,
      content: args.content,
      imageIds: args.imageIds,
      createdAt: now,
      modifiedAt: args.modifiedAt ?? now,
    });

    // Link images to this note (update existing tracking records from registerUpload)
    for (const storageId of args.imageIds ?? []) {
      const existing = await ctx.db
        .query("storageTracking")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();

      if (existing) {
        // Update existing tracking record (from registerUpload)
        await ctx.db.patch(existing._id, {
          linkedAt: now,
          linkedTo: noteId,
        });
      } else {
        // Create new tracking record if not already tracked
        await ctx.db.insert("storageTracking", {
          storageId,
          uploadedBy: user._id,
          uploadedAt: now,
          linkedAt: now,
          linkedTo: noteId,
        });
      }
    }

    return { noteId };
  },
});

/** Update an existing note. */
export const updateNote = mutation({
  args: {
    noteId: v.id("notes"),
    content: v.string(),
    imageIds: v.optional(v.array(v.id("_storage"))),
    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    // Only owner can update
    if (note.userId !== user._id) {
      throw new Error("Not authorized to update this note");
    }

    // Soft deleted notes cannot be updated
    if (note.isArchived) {
      throw new Error("Cannot update archived note");
    }

    // Find images that were added/removed
    const oldImageIds = note.imageIds ?? [];
    const newImageIds = args.imageIds ?? [];
    const removedImageIds = oldImageIds.filter(id => !newImageIds.includes(id));
    const addedImageIds = newImageIds.filter(id => !oldImageIds.includes(id));

    const now = Date.now();

    // Delete removed images from storage and tracking
    for (const storageId of removedImageIds) {
      await ctx.storage.delete(storageId);
      // Remove tracking record
      const tracking = await ctx.db
        .query("storageTracking")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();
      if (tracking) {
        await ctx.db.delete(tracking._id);
      }
    }

    // Link newly added images (update existing tracking records from registerUpload)
    for (const storageId of addedImageIds) {
      const existing = await ctx.db
        .query("storageTracking")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();

      if (existing) {
        // Update existing tracking record (from registerUpload)
        await ctx.db.patch(existing._id, {
          linkedAt: now,
          linkedTo: args.noteId,
        });
      } else {
        // Create new tracking record if not already tracked
        await ctx.db.insert("storageTracking", {
          storageId,
          uploadedBy: user._id,
          uploadedAt: now,
          linkedAt: now,
          linkedTo: args.noteId,
        });
      }
    }

    await ctx.db.patch(args.noteId, {
      content: args.content,
      imageIds: args.imageIds,
      modifiedAt: args.modifiedAt ?? now,
    });

    return { success: true };
  },
});

/** Soft delete a note and cleanup associated images. */
export const deleteNote = mutation({
  args: {
    noteId: v.id("notes"),
    modifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    const note = await ctx.db.get(args.noteId);
    if (!note) {
      throw new Error("Note not found");
    }

    // Only owner can delete
    if (note.userId !== user._id) {
      throw new Error("Not authorized to delete this note");
    }

    // Already deleted
    if (note.isArchived) {
      return { success: true };
    }

    // Delete associated images from storage and tracking
    const imageIds = note.imageIds ?? [];
    for (const storageId of imageIds) {
      await ctx.storage.delete(storageId);
      // Remove tracking record
      const tracking = await ctx.db
        .query("storageTracking")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();
      if (tracking) {
        await ctx.db.delete(tracking._id);
      }
    }

    // Soft delete the note
    const now = Date.now();
    await ctx.db.patch(args.noteId, {
      isArchived: true,
      archivedAt: now,
      imageIds: [], // Clear image references
      modifiedAt: args.modifiedAt ?? now,
    });

    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────
// Note Queries
// ─────────────────────────────────────────────────────────────────

/**
 * List notes for a specific category and context.
 *
 * Access rules:
 * - Clinicians see notes they created about the context (userId = current user)
 * - Patients see all notes about them from any clinician (contextId = current user)
 */
export const listNotes = query({
  args: {
    category: noteCategoryValidator,
    contextId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return [];
    }

    const isPatientViewingSelf =
      args.category === NOTE_CATEGORIES.PATIENT && args.contextId === user._id;

    if (isPatientViewingSelf) {
      // Patient viewing notes about themselves - see all notes from any clinician
      const notes = await ctx.db
        .query("notes")
        .withIndex("by_context", (q) => q.eq("contextId", user._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("category"), args.category),
            q.neq(q.field("isArchived"), true)
          )
        )
        .order("desc")
        .collect();
      return notes;
    }

    // Clinician viewing notes about a patient - see only their own notes
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_user_category_context", (q) =>
        q
          .eq("userId", user._id)
          .eq("category", args.category)
          .eq("contextId", args.contextId)
      )
      .filter((q) => q.neq(q.field("isArchived"), true))
      .order("desc")
      .collect();

    return notes;
  },
});

/**
 * Get a single note by ID.
 *
 * Access rules:
 * - Owner (clinician) can view their notes
 * - Subject (patient) can view notes about them
 */
export const getNote = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      return null;
    }

    const note = await ctx.db.get(args.noteId);
    if (!note || note.isArchived) {
      return null;
    }

    // Check access: owner or subject
    const isOwner = note.userId === user._id;
    const isSubject = note.category === NOTE_CATEGORIES.PATIENT && note.contextId === user._id;

    if (!isOwner && !isSubject) {
      return null;
    }

    return note;
  },
});

// ─────────────────────────────────────────────────────────────────
// Storage Tracking
// ─────────────────────────────────────────────────────────────────

/**
 * Register an uploaded image for tracking.
 * Called by client after successful upload to track abandoned uploads.
 */
export const registerUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) {
      throw new Error("Authentication required");
    }

    // Check if already tracked
    const existing = await ctx.db
      .query("storageTracking")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

    if (existing) {
      return { tracked: true };
    }

    // Track as unlinked upload
    await ctx.db.insert("storageTracking", {
      storageId: args.storageId,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
      // linkedAt and linkedTo remain undefined until note is saved
    });

    return { tracked: true };
  },
});

// ─────────────────────────────────────────────────────────────────
// Orphan Cleanup (Internal - called by cron)
// ─────────────────────────────────────────────────────────────────

// Orphan threshold: files unlinked for more than 24 hours
const ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Clean up orphaned storage files.
 *
 * Orphans are:
 * 1. Tracked uploads that were never linked to a note (abandoned uploads)
 * 2. Tracked uploads where the linked note no longer exists (cascade-deleted notes)
 */
export const cleanupOrphanedImages = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoffTime = Date.now() - ORPHAN_THRESHOLD_MS;
    let deletedCount = 0;

    // Get all tracking records
    const allTracking = await ctx.db.query("storageTracking").collect();

    for (const tracking of allTracking) {
      let shouldDelete = false;

      if (!tracking.linkedAt) {
        // Never linked - abandoned upload
        // Only delete if old enough (give user time to save)
        if (tracking.uploadedAt < cutoffTime) {
          shouldDelete = true;
        }
      } else if (tracking.linkedTo) {
        // Was linked - check if note still exists
        const note = await ctx.db.get(tracking.linkedTo);
        if (!note || note.isArchived) {
          // Note was deleted or archived - this image is orphaned
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        try {
          // Delete from storage
          await ctx.storage.delete(tracking.storageId);
        } catch (e) {
          // Storage file may already be deleted, continue
          console.warn(`Failed to delete storage ${tracking.storageId}:`, e);
        }
        // Delete tracking record
        await ctx.db.delete(tracking._id);
        deletedCount++;
      }
    }

    console.log(`Orphan cleanup: deleted ${deletedCount} orphaned images`);

    return { deletedCount };
  },
});
