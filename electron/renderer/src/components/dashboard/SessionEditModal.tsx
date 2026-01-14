/**
 * SessionEditModal - Modal for editing session details.
 * Opens immediately in edit mode with session data.
 */

import { useState, useEffect, useCallback } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery, useMutation } from '@/lib/customConvex';
import { api } from '../../../../../convex/_generated/api';
import { Id } from '../../../../../convex/_generated/dataModel';
import {
  XIcon,
  Loader2,
  Clock,
  User,
  ChevronRight,
  Check,
  Calendar,
} from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime } from '@/lib/utils';
import { PatientSearchModal } from '../PatientSearchModal';
import { TagsInput } from '../TagsInput';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { SvgPreviewChart, type PreviewPaths } from '../SvgPreviewChart';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionEditModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  /** Called after successful save */
  onSaved?: () => void;
}

// ─────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────

export function SessionEditModal({
  open,
  onOpenChange,
  sessionId,
  onSaved,
}: SessionEditModalProps) {
  // Fetch session details
  const sessionDetails = useQuery(
    api.recordingSessions.getSession,
    open && sessionId ? { sessionId } : 'skip'
  );

  // Fetch preview paths
  const previewResult = useQuery(
    api.recordingSessions.getSessionPreviewPaths,
    open && sessionId ? { sessionId } : 'skip'
  );

  // Mutation for updating session
  const updateSession = useMutation(api.recordingSessions.updateSession);

  // Edit state
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSubject, setEditSubject] = useState<{
    id: Id<'users'> | null;
    name: string;
    image?: string;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPatientSearchOpen, setIsPatientSearchOpen] = useState(false);

  // Derived session info
  const durationMs = sessionDetails ? (sessionDetails.endTime - sessionDetails.startTime) : 0;
  const recordedAt = sessionDetails?.startTime || 0;
  const isSubjectMe = sessionDetails?.subject?._id === sessionDetails?.owner?._id;

  // Initialize edit state when session data loads
  useEffect(() => {
    if (sessionDetails) {
      setEditTitle(sessionDetails.tags?.[0] || '');
      setEditNotes(sessionDetails.notes || '');
      setEditTags(sessionDetails.tags?.slice(1) || []);
      setEditSubject(null); // Reset to use original subject
    }
  }, [sessionDetails?.sessionId]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!sessionDetails) return;
    setIsSaving(true);
    try {
      // Combine title (first tag) with other tags
      const allTags = [editTitle.trim(), ...editTags].filter(Boolean);
      await updateSession({
        sessionId,
        notes: editNotes.trim() || undefined,
        tags: allTags.length > 0 ? allTags : undefined,
        // Include subject change if editSubject is set
        subjectId: editSubject?.id ?? undefined,
        subjectAlias: editSubject && !editSubject.id ? editSubject.name : undefined,
      });
      onSaved?.();
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update session:', err);
    } finally {
      setIsSaving(false);
    }
  }, [sessionDetails, sessionId, editTitle, editNotes, editTags, editSubject, updateSession, onSaved, onOpenChange]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  // Handle subject selection from PatientSearchModal
  const handleSubjectSelect = useCallback((patient: { userId: Id<'users'>; name: string; image?: string } | null) => {
    if (patient) {
      setEditSubject({ id: patient.userId, name: patient.name, image: patient.image });
    } else {
      setEditSubject({ id: null, name: '', image: undefined }); // Anonymous
    }
    setIsPatientSearchOpen(false);
  }, []);

  // Extract preview paths
  const leftPaths = previewResult?.leftKneePaths ?? null;
  const rightPaths = previewResult?.rightKneePaths ?? null;

  // Get current subject display
  const subjectDisplay = editSubject !== null
    ? editSubject
    : sessionDetails
      ? {
          id: sessionDetails.subject?._id || null,
          name: isSubjectMe ? 'Me' : (sessionDetails.subject?.name || sessionDetails.subjectAlias || 'Anonymous'),
          image: sessionDetails.subject?.image,
        }
      : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 modal-blur-overlay cursor-default',
            'data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]',
            'data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]'
          )}
          onClick={handleCancel}
        />

        {/* Side-by-side container for modal + patient search */}
        <div
          className={cn(
            'fixed inset-0 z-[51] flex items-center justify-center gap-4 pointer-events-none',
            'data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]',
            'data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]'
          )}
        >
          {/* Main Modal Content */}
          <DialogPrimitive.Content
            className={cn(
              'w-[95vw] sm:w-[450px] max-h-[90vh]',
              'bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]',
              'flex flex-col overflow-hidden',
              'pointer-events-auto'
            )}
            onPointerDownOutside={(e) => {
              if (isPatientSearchOpen) {
                e.preventDefault();
              } else {
                handleCancel();
              }
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--tropx-border)]">
              <DialogPrimitive.Title className="text-lg font-bold text-[var(--tropx-text-main)]">
                Edit Session
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Edit session details including title, notes, tags, and subject
              </DialogPrimitive.Description>
              <button
                onClick={handleCancel}
                className="rounded-full p-2 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
              >
                <XIcon className="size-5 text-[var(--tropx-shadow)]" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {sessionDetails === undefined ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="size-8 animate-spin text-[var(--tropx-vibrant)]" />
                </div>
              ) : sessionDetails === null ? (
                <div className="flex items-center justify-center py-16 text-[var(--tropx-shadow)]">
                  <p className="text-sm">Session not found</p>
                </div>
              ) : (
                <>
                  {/* Stats row */}
                  <div className="flex items-center justify-between text-xs px-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="size-3 text-[var(--tropx-text-sub)]" />
                      <span className="text-[var(--tropx-text-main)] font-medium">
                        {formatDuration(durationMs)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="size-3 text-[var(--tropx-text-sub)]" />
                      <span className="text-[var(--tropx-text-main)]">
                        {formatDate(recordedAt)} {formatTime(recordedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Preview chart */}
                  <SvgPreviewChart
                    leftPaths={leftPaths}
                    rightPaths={rightPaths}
                    isLoading={previewResult === undefined}
                    height={42}
                    showLegend
                  />

                  <Separator />

                  {/* Title field */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Title</Label>
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Recording title..."
                      className="w-full text-sm font-medium text-[var(--tropx-text-main)] bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-lg px-2.5 py-1.5 focus:border-[var(--tropx-vibrant)] focus:ring-1 focus:ring-[var(--tropx-vibrant)] outline-none"
                    />
                  </div>

                  {/* Subject field */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Subject</Label>
                    <button
                      type="button"
                      onClick={() => setIsPatientSearchOpen(true)}
                      disabled={isSaving}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 border rounded-lg text-sm transition-colors text-left',
                        subjectDisplay?.id
                          ? 'border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300'
                          : 'border-[var(--tropx-border)] text-[var(--tropx-text-sub)] hover:bg-[var(--tropx-muted)]',
                        isSaving && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {subjectDisplay?.image ? (
                        <img
                          src={subjectDisplay.image}
                          alt=""
                          className="size-5 rounded-full object-cover"
                        />
                      ) : (
                        <User className="size-4" />
                      )}
                      <span className="flex-1 truncate">
                        {subjectDisplay?.name || 'Anonymous'}
                      </span>
                      <ChevronRight className="size-4 opacity-50" />
                    </button>
                  </div>

                  {/* Notes field */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Notes</Label>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Add notes..."
                      rows={3}
                      className="w-full text-sm text-[var(--tropx-text-main)] bg-[var(--tropx-card)] border border-[var(--tropx-border)] rounded-lg px-2.5 py-1.5 focus:border-[var(--tropx-vibrant)] focus:ring-1 focus:ring-[var(--tropx-vibrant)] outline-none resize-none"
                    />
                  </div>

                  {/* Tags field */}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Tags</Label>
                    <TagsInput
                      value={editTags}
                      onChange={setEditTags}
                      placeholder="Add tags..."
                      disabled={isSaving}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-5 py-4 border-t border-[var(--tropx-border)]">
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="flex-1 py-2 rounded-lg text-sm font-medium text-[var(--tropx-text-main)] bg-[var(--tropx-muted)] border border-[var(--tropx-border)] hover:bg-[var(--tropx-hover)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving || sessionDetails === undefined || sessionDetails === null}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  isSaving
                    ? 'bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] cursor-not-allowed'
                    : 'bg-[var(--tropx-vibrant)] text-white hover:opacity-90'
                )}
              >
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </DialogPrimitive.Content>

          {/* PatientSearchModal rendered beside (embedded mode) */}
          {isPatientSearchOpen && (
            <div
              className={cn(
                'h-fit pointer-events-auto',
                'animate-[modal-bubble-in_0.15s_var(--spring-bounce)_forwards]'
              )}
            >
              <PatientSearchModal
                open={isPatientSearchOpen}
                onOpenChange={(open) => setIsPatientSearchOpen(open)}
                onSelectPatient={(patient) => {
                  handleSubjectSelect({
                    userId: patient.userId,
                    name: patient.name,
                    image: patient.image,
                  });
                }}
                selectedPatientId={subjectDisplay?.id || null}
                embedded
              />
            </div>
          )}
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default SessionEditModal;
