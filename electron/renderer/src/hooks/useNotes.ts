/**
 * useNotes - Hook for managing notes with Convex backend.
 * Provides CRUD operations and real-time sync for notes.
 */

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { isConvexConfigured, useQuery } from "../lib/customConvex";
import { useCurrentUser } from "./useCurrentUser";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { NOTE_CATEGORIES } from "../../../../convex/schema";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type NoteCategory = (typeof NOTE_CATEGORIES)[keyof typeof NOTE_CATEGORIES];

export interface Note {
  _id: Id<"notes">;
  userId: Id<"users">;
  category: NoteCategory;
  contextId: string;
  content: string;
  imageIds?: Id<"_storage">[];
  createdAt: number;
  modifiedAt: number;
  isArchived?: boolean;
  archivedAt?: number;
}

export interface UseNotesResult {
  // Data
  notes: Note[];
  isLoading: boolean;

  // Mutations (no-op for read-only users)
  createNote: (content: string, imageIds?: Id<"_storage">[]) => Promise<Id<"notes"> | null>;
  updateNote: (noteId: Id<"notes">, content: string, imageIds?: Id<"_storage">[]) => Promise<boolean>;
  deleteNote: (noteId: Id<"notes">) => Promise<boolean>;

  // Access control
  isReadOnly: boolean; // True if user can only view (patient viewing their own notes)

  // Convex status
  isConvexEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Disabled State
// ─────────────────────────────────────────────────────────────────

const DISABLED_RESULT: UseNotesResult = {
  notes: [],
  isLoading: false,
  createNote: async () => {
    console.warn("Convex not configured");
    return null;
  },
  updateNote: async () => {
    console.warn("Convex not configured");
    return false;
  },
  deleteNote: async () => {
    console.warn("Convex not configured");
    return false;
  },
  isReadOnly: true,
  isConvexEnabled: false,
};

// ─────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────

interface UseNotesParams {
  category: NoteCategory;
  contextId: string;
}

function useNotesEnabled({ category, contextId }: UseNotesParams): UseNotesResult {
  const { user } = useCurrentUser();

  // Query for notes
  const notesData = useQuery(
    api.notes.listNotes,
    contextId ? { category, contextId } : "skip"
  );

  // Mutations
  const createNoteMutation = useMutation(api.notes.createNote);
  const updateNoteMutation = useMutation(api.notes.updateNote);
  const deleteNoteMutation = useMutation(api.notes.deleteNote);

  const isLoading = notesData === undefined;
  const notes = (notesData ?? []) as Note[];

  // Determine if user has read-only access
  // Patients viewing notes about themselves can only read
  const isReadOnly = category === "patient" && contextId === user?._id;

  const createNote = useCallback(
    async (content: string, imageIds?: Id<"_storage">[]): Promise<Id<"notes"> | null> => {
      if (!contextId || isReadOnly) return null;
      try {
        const result = await createNoteMutation({
          category,
          contextId,
          content,
          imageIds,
        });
        return result.noteId;
      } catch (error) {
        console.error("Failed to create note:", error);
        return null;
      }
    },
    [category, contextId, createNoteMutation, isReadOnly]
  );

  const updateNote = useCallback(
    async (noteId: Id<"notes">, content: string, imageIds?: Id<"_storage">[]): Promise<boolean> => {
      if (isReadOnly) return false;
      try {
        await updateNoteMutation({
          noteId,
          content,
          imageIds,
        });
        return true;
      } catch (error) {
        console.error("Failed to update note:", error);
        return false;
      }
    },
    [updateNoteMutation, isReadOnly]
  );

  const deleteNote = useCallback(
    async (noteId: Id<"notes">): Promise<boolean> => {
      if (isReadOnly) return false;
      try {
        await deleteNoteMutation({ noteId });
        return true;
      } catch (error) {
        console.error("Failed to delete note:", error);
        return false;
      }
    },
    [deleteNoteMutation, isReadOnly]
  );

  return {
    notes,
    isLoading,
    createNote,
    updateNote,
    deleteNote,
    isReadOnly,
    isConvexEnabled: true,
  };
}

// ─────────────────────────────────────────────────────────────────
// Main Hook
// ─────────────────────────────────────────────────────────────────

export function useNotes(params: UseNotesParams): UseNotesResult {
  const isEnabled = isConvexConfigured();

  if (!isEnabled) {
    return DISABLED_RESULT;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useNotesEnabled(params);
}

export default useNotes;
