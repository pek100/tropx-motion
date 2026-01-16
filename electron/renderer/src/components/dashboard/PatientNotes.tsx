/**
 * PatientNotes - Tabbed notes component with notes grouped by author.
 * Shows "Your Notes" tab for current user's notes, plus tabs for each other author.
 */

import { useState, useMemo } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { StickyNote, Plus, X, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Editor } from "@/components/ui/editor";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { SerializedEditorState } from "lexical";

const MAX_DISPLAY_CHARS = 40;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface PatientNote {
  id: string;
  userId: string; // Author of the note
  content: string;
  createdAt: number;
  visibleTo?: string[]; // Who can see this note (besides author)
}

interface PatientNotesProps {
  notes: PatientNote[];
  authors: Record<string, string>; // userId -> name mapping
  onAddNote?: (content: string, imageIds?: string[], visibleTo?: string[]) => void;
  onEditNote?: (noteId: string, content: string, imageIds?: string[], visibleTo?: string[]) => void;
  onDeleteNote?: (noteId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Current user ID for determining ownership */
  currentUserId?: string;
  /** Subject ID (who the notes are about) */
  subjectId?: string;
  /** Subject name for UI display */
  subjectName?: string;
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
    if (parsed && typeof parsed === "object" && "root" in parsed) {
      return parsed as SerializedEditorState;
    }
    return content;
  } catch {
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
  authors,
  onAddNote,
  onEditNote,
  onDeleteNote,
  isLoading,
  className,
  currentUserId,
  subjectId,
  subjectName,
}: PatientNotesProps) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<PatientNote | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [activeTab, setActiveTab] = useState<string>(currentUserId || "mine");
  const [shareWithSubject, setShareWithSubject] = useState(false);

  // Should we show the share toggle? Only when writing about someone else
  const showShareToggle = subjectId && subjectId !== currentUserId;

  // Group notes by author
  const notesByAuthor = useMemo(() => {
    const grouped: Record<string, PatientNote[]> = {};
    for (const note of notes) {
      if (!grouped[note.userId]) grouped[note.userId] = [];
      grouped[note.userId].push(note);
    }
    // Sort each group by date (newest first)
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => b.createdAt - a.createdAt);
    }
    return grouped;
  }, [notes]);

  // Get list of other authors (not current user)
  const otherAuthors = useMemo(() => {
    return Object.keys(notesByAuthor).filter(id => id !== currentUserId);
  }, [notesByAuthor, currentUserId]);

  // Check if user owns a specific note
  const isOwnNote = (note: PatientNote) => currentUserId && note.userId === currentUserId;

  // Can add new notes if callback exists
  const canAdd = !!onAddNote;

  // Can edit/delete only own notes
  const canEditNote = (note: PatientNote) => onEditNote && isOwnNote(note);
  const canDeleteNote = (note: PatientNote) => onDeleteNote && isOwnNote(note);

  // Is viewing a note in read-only mode (not own note)
  const isViewingReadOnly = (note: PatientNote | null) => {
    if (!note) return false; // Adding new note
    return !isOwnNote(note);
  };

  const openAddDialog = () => {
    setEditingNote(null);
    setNoteContent("");
    setShareWithSubject(false); // Default to private
    setIsEditDialogOpen(true);
  };

  const openEditDialog = (note: PatientNote) => {
    setEditingNote(note);
    setNoteContent(note.content);
    // Initialize share toggle based on existing visibility
    const isSharedWithSubject = subjectId && note.visibleTo?.includes(subjectId);
    setShareWithSubject(!!isSharedWithSubject);
    setIsEditDialogOpen(true);
  };

  const handleSubmit = () => {
    const plainText = getPlainText(noteContent);
    if (!plainText.trim()) return;

    const imageIds = extractImageStorageIds(noteContent);

    // Build visibleTo array based on share toggle
    const visibleTo = shareWithSubject && subjectId ? [subjectId] : undefined;

    if (editingNote && onEditNote && isOwnNote(editingNote)) {
      onEditNote(editingNote.id, noteContent, imageIds.length > 0 ? imageIds : undefined, visibleTo);
    } else if (onAddNote) {
      onAddNote(noteContent, imageIds.length > 0 ? imageIds : undefined, visibleTo);
    }

    setNoteContent("");
    setEditingNote(null);
    setShareWithSubject(false);
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

  const handleEditorChange = (state: SerializedEditorState) => {
    setNoteContent(JSON.stringify(state));
  };

  // Render notes list for a specific author
  const renderNotesList = (authorNotes: PatientNote[], isCurrentUser: boolean) => {
    if (authorNotes.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-3 text-center">
          <StickyNote className="size-5 text-[var(--tropx-text-sub)] opacity-50 mb-1.5" />
          <p className="text-[11px] text-[var(--tropx-text-sub)]">No notes yet</p>
          {isCurrentUser && canAdd && (
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
      );
    }

    return (
      <div className="divide-y divide-[var(--tropx-border)]">
        {authorNotes.map((note) => (
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
              {canDeleteNote(note) && (
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
    );
  };

  const yourNotes = notesByAuthor[currentUserId || ""] || [];
  const totalNotes = notes.length;

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-[var(--tropx-border)] bg-[var(--tropx-card)] overflow-hidden",
        className
      )}
    >
      {/* Header with tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--tropx-border)] shrink-0">
          <div className="flex items-center gap-2">
            <StickyNote className="size-3.5 text-[var(--tropx-vibrant)]" />
            <TabsList className="h-auto p-0 bg-transparent">
              <TabsTrigger
                value={currentUserId || "mine"}
                className="text-[10px] px-2 py-1 data-[state=active]:bg-[var(--tropx-muted)]"
              >
                My Notes
                {yourNotes.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-3.5 px-1 text-[8px]">
                    {yourNotes.length}
                  </Badge>
                )}
              </TabsTrigger>
              {otherAuthors.map((authorId) => (
                <TabsTrigger
                  key={authorId}
                  value={authorId}
                  className="text-[10px] px-2 py-1 data-[state=active]:bg-[var(--tropx-muted)]"
                >
                  {authors[authorId] || "Unknown"}
                  {notesByAuthor[authorId]?.length > 0 && (
                    <Badge variant="secondary" className="ml-1 h-3.5 px-1 text-[8px]">
                      {notesByAuthor[authorId].length}
                    </Badge>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {/* Add note button */}
          {canAdd && activeTab === (currentUserId || "mine") && (
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

        {/* My Notes tab */}
        <TabsContent
          value={currentUserId || "mine"}
          className="flex-1 min-h-0 overflow-y-auto mt-0"
        >
          {renderNotesList(yourNotes, true)}
        </TabsContent>

        {/* Other authors' tabs */}
        {otherAuthors.map((authorId) => (
          <TabsContent
            key={authorId}
            value={authorId}
            className="flex-1 min-h-0 overflow-y-auto mt-0"
          >
            {renderNotesList(notesByAuthor[authorId] || [], false)}
          </TabsContent>
        ))}
      </Tabs>

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
              {isViewingReadOnly(editingNote) ? "View Note" : editingNote ? "Edit Note" : "Add Note"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {isViewingReadOnly(editingNote)
                ? "Viewing note"
                : editingNote
                  ? "Update your note"
                  : "Write a new note"}
            </DialogPrimitive.Description>

            {/* Author info for viewing others' notes */}
            {editingNote && isViewingReadOnly(editingNote) && (
              <div className="px-4 py-2 border-b border-[var(--tropx-border)] bg-[var(--tropx-muted)]">
                <p className="text-xs text-[var(--tropx-text-sub)]">
                  Note by <span className="font-medium text-[var(--tropx-text-main)]">{authors[editingNote.userId] || "Unknown"}</span>
                </p>
              </div>
            )}

            {/* Editor fills the modal */}
            <Editor
              key={editingNote?.id ?? "new"}
              initialValue={noteContent ? parseNoteContent(noteContent) : undefined}
              onChangeState={handleEditorChange}
              placeholder={isViewingReadOnly(editingNote) ? "" : "Write your note here..."}
              autoFocus={!isViewingReadOnly(editingNote)}
              editable={!isViewingReadOnly(editingNote)}
              borderless
              className="h-full"
              contentClassName="pb-16"
              hideToolbar={isViewingReadOnly(editingNote)}
            />

            {/* Floating action area */}
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
              {/* Share toggle - only show when writing about someone else */}
              {!isViewingReadOnly(editingNote) && showShareToggle && (
                <label className="flex items-center gap-2 text-sm cursor-pointer bg-[var(--tropx-card)]/80 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-[var(--tropx-border)]">
                  <input
                    type="checkbox"
                    checked={shareWithSubject}
                    onChange={(e) => setShareWithSubject(e.target.checked)}
                    className="rounded border-[var(--tropx-border)] text-[var(--tropx-vibrant)] focus:ring-[var(--tropx-vibrant)]"
                  />
                  <span className="text-xs text-[var(--tropx-text-main)]">
                    Share with {subjectName || "subject"}
                  </span>
                </label>
              )}
              {/* Spacer when no toggle */}
              {(isViewingReadOnly(editingNote) || !showShareToggle) && <div />}

              {/* Action buttons */}
              <div className="flex gap-2">
                {editingNote && canDeleteNote(editingNote) && (
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
                    setShareWithSubject(false);
                    setIsEditDialogOpen(false);
                  }}
                  className="bg-[var(--tropx-card)]/80 backdrop-blur-sm"
                >
                  {isViewingReadOnly(editingNote) ? "Close" : "Cancel"}
                </Button>
                {!isViewingReadOnly(editingNote) && (
                  <Button
                    size="sm"
                    onClick={handleSubmit}
                    disabled={!getPlainText(noteContent).trim()}
                    className="bg-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/90"
                  >
                    {editingNote ? "Update" : "Save"}
                  </Button>
                )}
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

export default PatientNotes;
