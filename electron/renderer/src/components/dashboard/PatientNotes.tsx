/**
 * PatientNotes - Scrollable list of notes with modal for adding.
 * Fixed height container, newest notes appear first.
 */

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { StickyNote, Plus, X, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

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
  onAddNote?: (content: string) => void;
  onEditNote?: (noteId: string, content: string) => void;
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
  const [viewingNote, setViewingNote] = useState<PatientNote | null>(null);
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
    setViewingNote(null);
    setIsEditDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!noteContent.trim()) return;

    if (editingNote && onEditNote) {
      onEditNote(editingNote.id, noteContent.trim());
    } else if (onAddNote) {
      onAddNote(noteContent.trim());
    }

    setNoteContent("");
    setEditingNote(null);
    setIsEditDialogOpen(false);
  };

  const handleDelete = (noteId: string) => {
    onDeleteNote?.(noteId);
    setViewingNote(null);
  };

  const truncateContent = (content: string) => {
    if (content.length <= MAX_DISPLAY_CHARS) return content;
    return content.slice(0, MAX_DISPLAY_CHARS).trim() + "...";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
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
      <div className="flex-1 min-h-0 overflow-hidden">
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
          <ScrollArea className="h-full">
            <div className="divide-y divide-[var(--tropx-border)]">
              {sortedNotes.map((note) => (
                <div
                  key={note.id}
                  className="px-3 py-2 group cursor-pointer hover:bg-[var(--tropx-muted)] transition-colors"
                  onClick={() => setViewingNote(note)}
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
          </ScrollArea>
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
              "w-full max-w-sm h-fit p-5",
              "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
              "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
              "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
              "pointer-events-auto"
            )}
            onPointerDownOutside={() => setIsEditDialogOpen(false)}
            onInteractOutside={() => setIsEditDialogOpen(false)}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-text-main)]">
                  {editingNote ? "Edit Note" : "Add Note"}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-[var(--tropx-text-sub)] mt-0.5">
                  {editingNote ? "Update your note" : "Write a note about this patient"}
                </DialogPrimitive.Description>
              </div>
              <button
                type="button"
                onClick={() => setIsEditDialogOpen(false)}
                className="rounded-full p-1.5 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
              >
                <X className="size-4 text-[var(--tropx-text-sub)]" />
              </button>
            </div>
            <Textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write your note here..."
              className="min-h-[120px] resize-none text-sm"
              autoFocus
            />
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-[var(--tropx-text-sub)]">
                Ctrl+Enter to save
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setNoteContent("");
                    setEditingNote(null);
                    setIsEditDialogOpen(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!noteContent.trim()}
                  className="bg-[var(--tropx-vibrant)] hover:bg-[var(--tropx-vibrant)]/90"
                >
                  {editingNote ? "Update" : "Save"}
                </Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* View Note Modal */}
      <DialogPrimitive.Root open={!!viewingNote} onOpenChange={(open) => !open && setViewingNote(null)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className={cn(
              "fixed inset-0 z-50 modal-blur-overlay cursor-default",
              "data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]",
              "data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]"
            )}
            style={{ willChange: "opacity", transform: "translateZ(0)" }}
            onClick={() => setViewingNote(null)}
          />
          <DialogPrimitive.Content
            className={cn(
              "fixed inset-0 z-[51] m-auto",
              "w-full max-w-sm h-fit p-5",
              "bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]",
              "data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]",
              "data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]",
              "pointer-events-auto"
            )}
            onPointerDownOutside={() => setViewingNote(null)}
            onInteractOutside={() => setViewingNote(null)}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-text-main)]">
                  Note
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-sm text-[var(--tropx-text-sub)] mt-0.5">
                  {viewingNote && formatNoteDate(viewingNote.createdAt)}
                </DialogPrimitive.Description>
              </div>
              <button
                type="button"
                onClick={() => setViewingNote(null)}
                className="rounded-full p-1.5 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
              >
                <X className="size-4 text-[var(--tropx-text-sub)]" />
              </button>
            </div>
            <div className="bg-[var(--tropx-muted)] rounded-lg p-3 max-h-[200px] overflow-y-auto">
              <p className="text-sm text-[var(--tropx-text-main)] leading-relaxed whitespace-pre-wrap">
                {viewingNote?.content}
              </p>
            </div>
            <div className="flex justify-between mt-4">
              <div>
                {onDeleteNote && viewingNote && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => handleDelete(viewingNote.id)}
                  >
                    <Trash2 className="size-3.5 mr-1.5" />
                    Delete
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {onEditNote && viewingNote && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditDialog(viewingNote)}
                  >
                    <Pencil className="size-3.5 mr-1.5" />
                    Edit
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setViewingNote(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}

export default PatientNotes;
