/**
 * PatientNotes - Scrollable list of notes with modal for adding.
 * Fixed height container, newest notes appear first.
 */

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { StickyNote, Plus, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Editor } from "@/components/ui/editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { SerializedEditorState } from "lexical";

const MAX_DISPLAY_CHARS = 40;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface PatientNote {
  id: string;
  content: string;
  createdAt: number;
}

interface PatientNotesProps {
  notes: PatientNote[];
  onAddNote?: (content: string, imageIds?: string[]) => void;
  onEditNote?: (noteId: string, content: string, imageIds?: string[]) => void;
  onDeleteNote?: (noteId: string) => void;
  isLoading?: boolean;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function formatNoteDate(timestamp: number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Parse note content - returns SerializedEditorState if valid JSON, otherwise treats as plain text
 */
function parseNoteContent(content: string): SerializedEditorState | string {
  try {
    const parsed = JSON.parse(content);
    // Check if it looks like a Lexical serialized state
    if (parsed && typeof parsed === "object" && "root" in parsed) {
      return parsed as SerializedEditorState;
    }
    return content;
  } catch {
    // Not JSON, treat as plain text
    return content;
  }
}

/**
 * Extract plain text from note content for display purposes
 */
function getPlainText(content: string): string {
  const parsed = parseNoteContent(content);
  if (typeof parsed === "string") {
    return parsed;
  }
  // Extract text from serialized Lexical state
  try {
    return extractTextFromLexicalState(parsed);
  } catch {
    return content;
  }
}

/**
 * Recursively extract text from Lexical serialized state
 */
function extractTextFromLexicalState(state: SerializedEditorState): string {
  const texts: string[] = [];

  function traverse(node: any) {
    if (node.text) {
      texts.push(node.text);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  if (state.root) {
    traverse(state.root);
  }

  return texts.join(" ");
}

/**
 * Extract all storageIds from image nodes in Lexical content
 */
function extractImageStorageIds(content: string): string[] {
  const parsed = parseNoteContent(content);
  if (typeof parsed === "string") {
    return [];
  }

  const storageIds: string[] = [];

  function traverse(node: any) {
    // Check if this is an image node with a storageId
    if (node.type === "image" && node.storageId) {
      storageIds.push(node.storageId);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  if (parsed.root) {
    traverse(parsed.root);
  }

  return storageIds;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function PatientNotes({
  notes,
  onAddNote,
  onEditNote,
  onDeleteNote,
  isLoading,
  className,
}: PatientNotesProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<PatientNote | null>(null);
  const [noteContent, setNoteContent] = useState("");

  // Sort notes by date (newest first)
  const sortedNotes = [...notes].sort((a, b) => b.createdAt - a.createdAt);

  const openAddDialog = () => {
    setEditingNote(null);
    setNoteContent("");
    setIsEditDialogOpen(true);
  };

  const openEditDialog = (note: PatientNote) => {
    setEditingNote(note);
    setNoteContent(note.content);
    setIsEditDialogOpen(true);
  };

  const handleSubmit = () => {
    // Check if there's actual content (not just empty editor state)
    const plainText = getPlainText(noteContent);
    if (!plainText.trim()) return;

    // Extract image storageIds for tracking/cleanup
    const imageIds = extractImageStorageIds(noteContent);

    if (editingNote && onEditNote) {
      onEditNote(editingNote.id, noteContent, imageIds.length > 0 ? imageIds : undefined);
    } else if (onAddNote) {
      onAddNote(noteContent, imageIds.length > 0 ? imageIds : undefined);
    }

    setNoteContent("");
    setEditingNote(null);
    setIsEditDialogOpen(false);
  };

  const handleDelete = (noteId: string) => {
    onDeleteNote?.(noteId);
    setIsEditDialogOpen(false);
    setEditingNote(null);
  };

  const truncateContent = (content: string) => {
    const plainText = getPlainText(content);
    if (plainText.length <= MAX_DISPLAY_CHARS) return plainText;
    return plainText.slice(0, MAX_DISPLAY_CHARS).trim() + "...";
  };

  // Handle editor state changes - stringify for storage
  const handleEditorChange = (state: SerializedEditorState) => {
    setNoteContent(JSON.stringify(state));
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)] overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--tropx-border)] shrink-0">
        <div className="flex items-center gap-2">
          <StickyNote className="size-3.5 text-[var(--tropx-vibrant)]" />
          <span className="text-xs font-medium text-[var(--tropx-text-main)]">
            Notes
          </span>
          {notes.length > 0 && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-normal">
              {notes.length}
            </Badge>
          )}
        </div>
        {/* Add note button */}
        {onAddNote && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-[var(--tropx-text-sub)] hover:text-[var(--tropx-vibrant)]"
            onClick={openAddDialog}
          >
            <Plus className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Content area - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {sortedNotes.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center p-3 text-center">
            <StickyNote className="size-5 text-[var(--tropx-text-sub)] opacity-50 mb-1.5" />
            <p className="text-[11px] text-[var(--tropx-text-sub)]">No notes yet</p>
            {onAddNote && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-[11px] text-[var(--tropx-vibrant)]"
                onClick={openAddDialog}
              >
                Add your first note
              </Button>
            )}
          </div>
        ) : (
          /* Scrollable notes list */
          <div className="divide-y divide-[var(--tropx-border)]">
            {sortedNotes.map((note) => (
              <div
                key={note.id}
                className="px-3 py-2 group cursor-pointer hover:bg-[var(--tropx-muted)] transition-colors"
                onClick={() => openEditDialog(note)}
              >
                <p className="text-[11px] text-[var(--tropx-text-main)] leading-relaxed">
                  {truncateContent(note.content)}
                </p>
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[9px] text-[var(--tropx-text-sub)]">
                    {formatNoteDate(note.createdAt)}
                  </p>
                  {onDeleteNote && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-[var(--tropx-text-sub)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(note.id);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Note Modal */}
      <DialogPrimitive.Root open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 modal-blur-overlay cursor-default",
              "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
              "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
            )}
            style={{ willChange: "opacity", transform: "translateZ(0)" }}
            onClick={() => setIsEditDialogOpen(false)}
          />
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-0 z-[51] m-auto",
              "w-full max-w-3xl h-[70vh]",
              "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
              "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
              "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
              "pointer-events-auto overflow-hidden"
            )}
            onPointerDownOutside={() => setIsEditDialogOpen(false)}
            onInteractOutside={() => setIsEditDialogOpen(false)}
          >
            {/* Hidden title for accessibility */}
            <DialogPrimitive.Title className="sr-only">
              {editingNote ? "Edit Note" : "Add Note"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {editingNote ? "Update your note" : "Write a note about this patient"}
            </DialogPrimitive.Description>

            {/* Editor fills the modal */}
            <Editor
              key={editingNote?.id ?? "new"}
              initialValue={noteContent ? parseNoteContent(noteContent) : undefined}
              onChangeState={handleEditorChange}
              placeholder="Write your note here..."
              autoFocus
              borderless
              className="h-full"
              contentClassName="pb-16"
            />

            {/* Floating action buttons */}
            <div className="absolute bottom-4 right-4 flex gap-2">
              {editingNote && onDeleteNote && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(editingNote.id)}
                  className="text-red-500 hover:text-red-600 hover:bg-red-50 bg-[var(--tropx-card)]/80 backdrop-blur-sm"
                >
                  <Trash2 className="size-3.5 mr-1.5" />
                  Delete
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNoteContent("");
                  setEditingNote(null);
                  setIsEditDialogOpen(false);
                }}
                className="bg-[var(--tropx-card)]/80 backdrop-blur-sm"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!getPlainText(noteContent).trim()}
                className="bg-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/90"
              >
                {editingNote ? "Update" : "Save"}
              </Button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

export default PatientNotes;
