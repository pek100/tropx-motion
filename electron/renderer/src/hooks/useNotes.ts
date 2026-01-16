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

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface Note {
  _id: Id<"notes">;
  userId: Id<"users">; // Author
  contextId: Id<"users">; // Subject
  content: string;
  imageIds?: Id<"_storage">[];
  visibleTo?: Id<"users">[]; // Who can see this note (besides author)
  createdAt: number;
  modifiedAt: number;
  isArchived?: boolean;
  archivedAt?: number;
}

export interface UseNotesResult {
  // Data
  notes: Note[];
  authors: Record<string, string>; // userId -> name mapping
  isLoading: boolean;

  // Mutations
  createNote: (content: string, imageIds?: Id<"_storage">[], visibleTo?: Id<"users">[]) => Promise<Id<"notes"> | null>;
  updateNote: (noteId: Id<"notes">, content: string, imageIds?: Id<"_storage">[], visibleTo?: Id<"users">[]) => Promise<boolean>;
  deleteNote: (noteId: Id<"notes">) => Promise<boolean>;

  // Access control
  currentUserId?: string; // Current user ID for checking note ownership

  // Convex status
  isConvexEnabled: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Disabled State
// ─────────────────────────────────────────────────────────────────

const DISABLED_RESULT: UseNotesResult = {
  notes: [],
  authors: {},
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
  currentUserId: undefined,
  isConvexEnabled: false,
};

// ─────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────

interface UseNotesParams {
  contextId: string; // Subject ID (who the notes are about)
}

function useNotesEnabled({ contextId }: UseNotesParams): UseNotesResult {
  const { user } = useCurrentUser();

  // Query for notes - returns { notes, authors }
  const notesData = useQuery(
    api.notes.listNotes,
    contextId ? { contextId: contextId as Id<"users"> } : "skip"
  );

  // Mutations
  const createNoteMutation = useMutation(api.notes.createNote);
  const updateNoteMutation = useMutation(api.notes.updateNote);
  const deleteNoteMutation = useMutation(api.notes.deleteNote);

  const isLoading = notesData === undefined;
  const notes = (notesData?.notes ?? []) as Note[];
  const authors = (notesData?.authors ?? {}) as Record<string, string>;

  const createNote = useCallback(
    async (content: string, imageIds?: Id<"_storage">[], visibleTo?: Id<"users">[]): Promise<Id<"notes"> | null> => {
      if (!contextId) return null;
      try {
        const result = await createNoteMutation({
          contextId: contextId as Id<"users">,
          content,
          imageIds,
          visibleTo,
        });
        return result.noteId;
      } catch (error) {
        console.error("Failed to create note:", error);
        return null;
      }
    },
    [contextId, createNoteMutation]
  );

  const updateNote = useCallback(
    async (noteId: Id<"notes">, content: string, imageIds?: Id<"_storage">[], visibleTo?: Id<"users">[]): Promise<boolean> => {
      try {
        await updateNoteMutation({
          noteId,
          content,
          imageIds,
          visibleTo,
        });
        return true;
      } catch (error) {
        console.error("Failed to update note:", error);
        return false;
      }
    },
    [updateNoteMutation]
  );

  const deleteNote = useCallback(
    async (noteId: Id<"notes">): Promise<boolean> => {
      try {
        await deleteNoteMutation({ noteId });
        return true;
      } catch (error) {
        console.error("Failed to delete note:", error);
        return false;
      }
    },
    [deleteNoteMutation]
  );

  return {
    notes,
    authors,
    isLoading,
    createNote,
    updateNote,
    deleteNote,
    currentUserId: user?._id,
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
