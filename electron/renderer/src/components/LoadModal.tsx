/**
 * LoadModal - Modal for browsing, searching, and loading recordings.
 *
 * Features:
 * - Server-side search (tags, exercise type, notes)
 * - Subject filter with side-by-side patient search
 * - Infinite scroll pagination
 * - Preview panel with mini chart
 * - Import CSV button
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { Id } from '../../../../convex/_generated/dataModel';
import { PackedChunkData } from '../../../../shared/QuaternionCodec';
import { MiniRecordingChart } from './MiniRecordingChart';
import {
  XIcon,
  Search,
  Upload,
  Loader2,
  Clock,
  Activity,
  User,
  ChevronRight,
  Play,
  Calendar,
  Users,
  Trash2,
  Pencil,
  Check,
  MessageSquare,
  Send,
} from 'lucide-react';
import { cn, formatDuration, formatDate, formatTime } from '@/lib/utils';
import { isWeb } from '@/lib/platform';
import { PatientSearchModal } from './PatientSearchModal';
import { TagsInput } from './TagsInput';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

interface SessionSummary {
  sessionId: string;
  ownerId: Id<'users'>;
  ownerName: string;
  ownerImage?: string;
  isOwner: boolean;
  subjectId?: Id<'users'>;
  subjectName: string;
  subjectImage?: string;
  subjectAlias?: string;
  isSubjectMe: boolean;
  notes?: string;
  tags: string[];
  systemTags: string[];
  activeJoints: string[];
  sampleRate: number;
  totalChunks: number;
  startTime: number;
  endTime: number;
  recordedAt: number;
  totalSampleCount: number;
  durationMs: number;
  createdAt: number;
  modifiedAt?: number;
}

interface LoadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadSession: (sessionId: string) => void;
  onImportCSV?: () => void;
  /** Pre-select a session when modal opens */
  initialSessionId?: string;
}

// ─────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────

// Recording card item with inline delete confirmation
function RecordingCard({
  session,
  isSelected,
  onClick,
  onDelete,
}: {
  session: SessionSummary;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const title = session.tags[0] || 'Untitled Recording';

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Show delete confirmation overlay
  if (showDeleteConfirm) {
    return (
      <div
        className={cn(
          'relative w-full p-3 rounded-xl border-2 border-red-300 bg-red-50',
          'transition-all'
        )}
      >
        <p className="text-sm font-medium text-red-700 mb-2">Delete this recording?</p>
        <p className="text-xs text-red-600 mb-3 line-clamp-1">{title}</p>
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
            disabled={isDeleting}
            className="flex-1 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
            disabled={isDeleting}
            className="flex-1 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1"
          >
            {isDeleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={cn(
        'relative w-full text-left p-3 rounded-xl transition-all cursor-pointer group',
        'border-2',
        isSelected
          ? 'bg-white border-[var(--tropx-vibrant)] shadow-sm'
          : 'bg-white hover:bg-gray-50/80 border-transparent hover:border-gray-200'
      )}
    >
      {/* Delete button - top right corner */}
      {session.isOwner && onDelete && (
        <div className={cn(
          'absolute top-2 right-2 flex items-center gap-1',
          'opacity-0 group-hover:opacity-100 transition-opacity',
          isSelected && 'opacity-100'
        )}>
          <button
            onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
            className="p-1.5 rounded-lg bg-white/80 backdrop-blur-sm border border-gray-200 text-[var(--tropx-shadow)] hover:text-red-500 hover:border-red-300 hover:bg-red-50 transition-all shadow-sm"
            title="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      )}

      {/* Title */}
      <h4 className="text-sm font-semibold text-[var(--tropx-dark)] line-clamp-1 pr-16 mb-2">
        {title}
      </h4>

      {/* Stats row */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <div className="flex items-center gap-1 text-[var(--tropx-shadow)]">
          <Clock className="size-3" />
          <span className="text-[var(--tropx-dark)] font-medium">{formatDuration(session.durationMs)}</span>
        </div>
        <span className="text-[var(--tropx-shadow)]">{session.totalSampleCount.toLocaleString()} samples</span>
        <span className="text-muted-foreground">{formatDate(session.recordedAt)}</span>
      </div>

      {/* Bottom row: Subject, Owner, Tags */}
      <div className="flex items-center gap-2 text-xs">
        {/* Subject badge */}
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-0.5 rounded-md",
          session.isSubjectMe ? "bg-violet-100" : "bg-gray-100"
        )}>
          {session.subjectImage ? (
            <img src={session.subjectImage} alt="" className="size-4 rounded-full object-cover" />
          ) : (
            <User className={cn("size-3.5", session.isSubjectMe ? "text-violet-600" : "text-gray-500")} />
          )}
          <span className={cn(
            "truncate max-w-[70px]",
            session.isSubjectMe ? "text-violet-700 font-medium" : session.subjectName ? "text-gray-700" : "text-gray-400 italic"
          )}>
            {session.isSubjectMe ? 'Me' : session.subjectName || 'Anon'}
          </span>
        </div>

        {/* Owner badge */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-50 border border-gray-100">
          {session.ownerImage ? (
            <img src={session.ownerImage} alt="" className="size-4 rounded-full object-cover" />
          ) : (
            <User className="size-3.5 text-gray-400" />
          )}
          <span className="text-gray-600 truncate max-w-[60px]">{session.ownerName}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tags */}
        {(session.systemTags.includes('source:csv') || session.tags.length > 1) && (
          <div className="flex items-center gap-1">
            {session.systemTags.includes('source:csv') && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">CSV</Badge>
            )}
            {session.tags.slice(1, 2).map((tag) => (
              <Badge key={tag} className="text-[10px] px-1.5 py-0 bg-[var(--tropx-vibrant)]">
                {tag}
              </Badge>
            ))}
            {session.tags.length > 2 && (
              <span className="text-[10px] text-muted-foreground">+{session.tags.length - 2}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Subject note input (for subjects who are not owners)
function SubjectNoteInput({
  sessionId,
  onNoteSent,
}: {
  sessionId: string;
  onNoteSent?: () => void;
}) {
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const addSubjectNote = useMutation(api.recordings.addSubjectNote);

  const handleSend = async () => {
    if (!note.trim() || isSending) return;
    setIsSending(true);
    try {
      await addSubjectNote({ sessionId, note: note.trim() });
      setNote('');
      onNoteSent?.();
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Leave a note</Label>
      <div className="flex gap-2">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Type your note..."
          className="flex-1 px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-[var(--tropx-vibrant)] focus:ring-1 focus:ring-[var(--tropx-vibrant)]"
          disabled={isSending}
        />
        <button
          onClick={handleSend}
          disabled={!note.trim() || isSending}
          className={cn(
            'p-1.5 rounded-lg transition-colors',
            note.trim() && !isSending
              ? 'text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-hover)]'
              : 'text-gray-300 cursor-not-allowed'
          )}
        >
          {isSending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </div>
    </div>
  );
}

// Preview panel - with inline editing support
function RecordingPreview({
  session,
  previewData,
  isPreviewLoading,
  onLoad,
  onDelete,
  onSessionUpdated,
  onOpenPatientSearch,
  editSubject,
  isLoading,
  isDeleting,
  isOwner,
}: {
  session: SessionSummary | null;
  previewData: PackedChunkData | null;
  isPreviewLoading: boolean;
  onLoad: () => void;
  onDelete?: () => void;
  onSessionUpdated?: () => void;
  onOpenPatientSearch?: () => void;
  editSubject?: { id: Id<'users'> | null; name: string; image?: string } | null;
  isLoading: boolean;
  isDeleting: boolean;
  isOwner: boolean;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Editable fields
  const [editTitle, setEditTitle] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);

  // Mutation for updating session
  const updateSession = useMutation(api.recordings.updateSession);

  // Reset edit state when session changes
  useEffect(() => {
    if (session) {
      setEditTitle(session.tags[0] || '');
      setEditNotes(session.notes || '');
      setEditTags(session.tags.slice(1)); // Tags excluding title (first tag)
    }
    setIsEditing(false);
  }, [session?.sessionId]);

  const handleStartEdit = () => {
    if (!session) return;
    setEditTitle(session.tags[0] || '');
    setEditNotes(session.notes || '');
    setEditTags(session.tags.slice(1));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    if (!session) return;
    setEditTitle(session.tags[0] || '');
    setEditNotes(session.notes || '');
    setEditTags(session.tags.slice(1));
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!session) return;
    setIsSaving(true);
    try {
      // Combine title (first tag) with other tags
      const allTags = [editTitle.trim(), ...editTags].filter(Boolean);
      await updateSession({
        sessionId: session.sessionId,
        notes: editNotes.trim() || undefined,
        tags: allTags.length > 0 ? allTags : undefined,
        // Include subject change if editSubject is provided
        subjectId: editSubject?.id ?? undefined,
        subjectAlias: editSubject && !editSubject.id ? editSubject.name : undefined,
      });
      setIsEditing(false);
      onSessionUpdated?.();
    } catch (err) {
      console.error('Failed to update session:', err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!session) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--tropx-shadow)]">
        <Activity className="size-10 opacity-20 mb-3" />
        <p className="text-sm">Select a recording</p>
      </div>
    );
  }

  const title = session.tags[0] || 'Untitled Recording';

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Stats row */}
      <div className="flex items-center justify-between text-xs px-1">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3 text-[var(--tropx-shadow)]" />
          <span className="text-[var(--tropx-dark)] font-medium">{formatDuration(session.durationMs)}</span>
        </div>
        <div className="text-[var(--tropx-dark)]">{session.totalSampleCount.toLocaleString()} samples</div>
        <div className="text-[var(--tropx-shadow)]">{formatDate(session.recordedAt)}</div>
      </div>

      {/* Chart */}
      <div className="min-h-[52px]">
        <MiniRecordingChart
          packedData={previewData}
          isLoading={isPreviewLoading}
          height={42}
        />
      </div>

      <Separator />

      {/* Title field */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Title</Label>
        {isEditing ? (
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Recording title..."
            className="w-full text-sm font-medium text-[var(--tropx-dark)] bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-[var(--tropx-vibrant)] focus:ring-1 focus:ring-[var(--tropx-vibrant)] outline-none"
          />
        ) : (
          <p className="text-sm font-semibold text-[var(--tropx-dark)] truncate">{title}</p>
        )}
      </div>

      {/* Subject + Owner row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Subject */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          {isEditing ? (
            <button
              type="button"
              onClick={() => onOpenPatientSearch?.()}
              disabled={isSaving}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 border rounded-lg text-sm transition-colors text-left',
                editSubject?.id || (editSubject === undefined && session.subjectId)
                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                  : 'border-gray-200 text-[var(--tropx-shadow)] hover:bg-gray-50',
                isSaving && 'opacity-50 cursor-not-allowed'
              )}
            >
              {(editSubject?.image || (editSubject === undefined && session.subjectImage)) ? (
                <img
                  src={editSubject?.image || session.subjectImage}
                  alt=""
                  className="size-5 rounded-full object-cover"
                />
              ) : (
                <User className="size-4" />
              )}
              <span className="flex-1 truncate">
                {editSubject !== undefined
                  ? (editSubject?.name || 'Anonymous')
                  : (session.isSubjectMe ? 'Me' : session.subjectName || 'Anonymous')}
              </span>
              <ChevronRight className="size-4 opacity-50" />
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {session.subjectImage ? (
                <img src={session.subjectImage} alt="" className="size-6 rounded-full object-cover" />
              ) : (
                <div className={cn(
                  "size-6 rounded-full flex items-center justify-center",
                  session.subjectName || session.isSubjectMe ? "bg-violet-100" : "bg-gray-100"
                )}>
                  <User className={cn(
                    "size-3.5",
                    session.subjectName || session.isSubjectMe ? "text-violet-600" : "text-gray-400"
                  )} />
                </div>
              )}
              <span className={cn(
                "text-sm truncate",
                session.subjectName || session.isSubjectMe ? "text-[var(--tropx-dark)]" : "text-gray-400 italic"
              )}>
                {session.isSubjectMe ? 'Me' : session.subjectName || 'Anonymous'}
              </span>
            </div>
          )}
        </div>

        {/* Owner */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Owner</Label>
          <div className="flex items-center gap-2">
            {session.ownerImage ? (
              <img src={session.ownerImage} alt="" className="size-6 rounded-full object-cover" />
            ) : (
              <div className="size-6 rounded-full flex items-center justify-center bg-gray-100">
                <User className="size-3.5 text-gray-500" />
              </div>
            )}
            <span className="text-sm text-[var(--tropx-dark)] truncate">{session.ownerName}</span>
          </div>
        </div>
      </div>

      {/* Notes */}
      {(isEditing || session.notes) && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Notes</Label>
          {isEditing ? (
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="Add notes..."
              rows={2}
              className="w-full text-sm text-[var(--tropx-dark)] bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:border-[var(--tropx-vibrant)] focus:ring-1 focus:ring-[var(--tropx-vibrant)] outline-none resize-none"
            />
          ) : (
            <p className="text-sm text-[var(--tropx-dark)] line-clamp-2">{session.notes}</p>
          )}
        </div>
      )}

      {/* Tags */}
      {(isEditing || session.tags.length > 1 || session.systemTags.length > 0) && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tags</Label>
          {isEditing ? (
            <TagsInput
              value={editTags}
              onChange={setEditTags}
              placeholder="Add tags..."
              disabled={isSaving}
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {session.systemTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
              {session.tags.slice(1).map((tag) => (
                <Badge key={tag} className="text-xs bg-[var(--tropx-vibrant)]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Subject note input (for subjects who are not owners) */}
      {!isOwner && session.isSubjectMe && !isEditing && (
        <SubjectNoteInput
          sessionId={session.sessionId}
          onNoteSent={onSessionUpdated}
        />
      )}

      {/* Spacer */}
      <div className="flex-1 min-h-4" />

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-700 mb-2">Delete this recording?</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onDelete?.();
                setShowDeleteConfirm(false);
              }}
              disabled={isDeleting}
              className="flex-1 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              {isDeleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {isEditing ? (
          <>
            {/* Cancel edit */}
            <button
              onClick={handleCancelEdit}
              disabled={isSaving}
              className="p-2 rounded-lg text-[var(--tropx-shadow)] hover:bg-gray-100 transition-colors disabled:opacity-50"
              title="Cancel"
            >
              <XIcon className="size-4" />
            </button>

            {/* Save edit */}
            <button
              onClick={handleSaveEdit}
              disabled={isSaving}
              className={cn(
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                isSaving
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[var(--tropx-vibrant)] text-white hover:opacity-90'
              )}
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </>
        ) : (
          <>
            {/* Edit button (owner only) */}
            {isOwner && (
              <button
                onClick={handleStartEdit}
                className="p-2 rounded-lg text-[var(--tropx-shadow)] hover:bg-gray-100 transition-colors"
                title="Edit"
              >
                <Pencil className="size-4" />
              </button>
            )}

            {/* Delete button (owner only) */}
            {isOwner && onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 rounded-lg text-[var(--tropx-shadow)] hover:bg-red-50 hover:text-red-500 transition-colors"
                title="Delete"
              >
                <Trash2 className="size-4" />
              </button>
            )}

            {/* Load button */}
            <button
              onClick={onLoad}
              disabled={isLoading}
              className={cn(
                'flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                isLoading
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-[var(--tropx-vibrant)] text-white hover:opacity-90'
              )}
            >
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {isLoading ? 'Loading...' : 'Load'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function LoadModal({
  open,
  onOpenChange,
  onLoadSession,
  onImportCSV,
  initialSessionId,
}: LoadModalProps) {
  // State
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState<Id<'users'> | null>(null);
  const [selectedSubjectName, setSelectedSubjectName] = useState<string | null>(null);
  const [selectedSubjectImage, setSelectedSubjectImage] = useState<string | undefined>(undefined);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isPatientSearchOpen, setIsPatientSearchOpen] = useState(false);
  const [patientSearchMode, setPatientSearchMode] = useState<'filter' | 'edit'>('filter');

  // Edit subject state (for RecordingPreview)
  const [editSubject, setEditSubject] = useState<{ id: Id<'users'> | null; name: string; image?: string } | undefined>(undefined);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mutations
  const archiveSession = useMutation(api.recordings.archiveSession);

  // Debounce search input
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCursor(null);
    }, 300);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchInput]);

  // Query sessions list
  const searchResult = useQuery(
    api.recordings.searchSessions,
    open
      ? {
          search: debouncedSearch || undefined,
          subjectId: selectedSubjectId ?? undefined,
          includeMe: true,
          cursor: cursor ?? undefined,
          limit: 20,
        }
      : 'skip'
  );

  // Query preview data for selected session (adaptive downsampling for chart)
  const previewResult = useQuery(
    api.recordings.getSessionPreviewForChart,
    open && selectedSessionId
      ? { sessionId: selectedSessionId, maxPoints: 100 }
      : 'skip'
  );

  // Convert preview result to PackedChunkData format
  const previewData: PackedChunkData | null = useMemo(() => {
    if (!previewResult) return null;
    return {
      startTime: previewResult.startTime,
      endTime: previewResult.endTime,
      sampleRate: previewResult.sampleRate,
      sampleCount: previewResult.sampleCount,
      activeJoints: previewResult.activeJoints,
      leftKneeQ: previewResult.leftKneeQ,
      rightKneeQ: previewResult.rightKneeQ,
      // No flags needed for chart preview
      leftKneeInterpolated: [],
      leftKneeMissing: [],
      rightKneeInterpolated: [],
      rightKneeMissing: [],
    };
  }, [previewResult]);

  // Get sessions
  const sessions = (searchResult?.sessions ?? []) as SessionSummary[];
  const selectedSession = sessions.find((s) => s.sessionId === selectedSessionId) ?? null;
  const isPreviewLoading = selectedSessionId !== null && previewResult === undefined;

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSearchInput('');
      setDebouncedSearch('');
      setSelectedSubjectId(null);
      setSelectedSubjectName(null);
      setSelectedSubjectImage(undefined);
      // Pre-select session if initialSessionId provided
      setSelectedSessionId(initialSessionId ?? null);
      setCursor(null);
      setIsPatientSearchOpen(false);
      setPatientSearchMode('filter');
      setEditSubject(undefined);
      if (!initialSessionId) {
        setTimeout(() => searchInputRef.current?.focus(), 100);
      }
    }
  }, [open, initialSessionId]);

  // Reset edit subject when session changes
  useEffect(() => {
    setEditSubject(undefined);
  }, [selectedSessionId]);

  // Handle subject selection from PatientSearchModal
  const handleSubjectSelect = useCallback((patient: { userId: Id<'users'>; name: string; image?: string } | null) => {
    if (patientSearchMode === 'edit') {
      // Editing preview subject
      if (patient) {
        setEditSubject({ id: patient.userId, name: patient.name, image: patient.image });
      } else {
        setEditSubject({ id: null, name: '', image: undefined }); // Anonymous
      }
    } else {
      // Filtering
      if (patient) {
        setSelectedSubjectId(patient.userId);
        setSelectedSubjectName(patient.name);
        setSelectedSubjectImage(patient.image);
      } else {
        setSelectedSubjectId(null);
        setSelectedSubjectName(null);
        setSelectedSubjectImage(undefined);
      }
      setCursor(null);
    }
    setIsPatientSearchOpen(false);
  }, [patientSearchMode]);

  // Open patient search for editing preview subject
  const handleOpenPatientSearchForEdit = useCallback(() => {
    setPatientSearchMode('edit');
    setIsPatientSearchOpen(true);
  }, []);

  // Clear subject filter
  const handleClearSubject = useCallback(() => {
    setSelectedSubjectId(null);
    setSelectedSubjectName(null);
    setSelectedSubjectImage(undefined);
    setCursor(null);
  }, []);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (searchResult?.nextCursor) {
      setCursor(searchResult.nextCursor);
    }
  }, [searchResult?.nextCursor]);

  // Handle scroll for infinite scroll
  const handleScroll = useCallback(() => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollHeight - scrollTop - clientHeight < 100) {
      handleLoadMore();
    }
  }, [handleLoadMore]);

  // Handle load session
  const handleLoad = useCallback(async () => {
    if (!selectedSessionId) return;
    setIsLoadingSession(true);
    try {
      onLoadSession(selectedSessionId);
      onOpenChange(false);
    } finally {
      setIsLoadingSession(false);
    }
  }, [selectedSessionId, onLoadSession, onOpenChange]);

  // Handle delete session
  const handleDelete = useCallback(async () => {
    if (!selectedSessionId) return;
    setIsDeleting(true);
    try {
      await archiveSession({ sessionId: selectedSessionId });
      setSelectedSessionId(null);
    } catch (err) {
      console.error('Failed to delete session:', err);
    } finally {
      setIsDeleting(false);
    }
  }, [selectedSessionId, archiveSession]);

  // Handle close
  const handleClose = () => {
    setIsPatientSearchOpen(false);
    onOpenChange(false);
  };

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
          onClick={handleClose}
        />

        {/* Side-by-side container */}
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
              'w-full max-w-3xl h-[85vh] max-h-[720px]',
              'bg-white rounded-2xl shadow-lg border border-gray-100',
              'flex flex-col overflow-hidden',
              'pointer-events-auto'
            )}
            onPointerDownOutside={(e) => {
              if (isPatientSearchOpen) {
                e.preventDefault();
              } else {
                handleClose();
              }
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <DialogPrimitive.Title className="text-xl font-bold text-[var(--tropx-dark)]">
                Load Recording
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Browse and load recordings from cloud or import from CSV
              </DialogPrimitive.Description>
              <button
                onClick={handleClose}
                className="rounded-full p-2 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <XIcon className="size-5 text-[var(--tropx-shadow)]" />
              </button>
            </div>

            {/* Search & Filter Bar */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50/50">
              {/* Search input */}
              <div className="flex-1 flex items-center gap-2.5 px-4 py-2.5 bg-white rounded-xl border border-gray-200 focus-within:border-[var(--tropx-vibrant)] focus-within:ring-2 focus-within:ring-[var(--tropx-vibrant)]/20 transition-all">
                <Search className="size-4 text-[var(--tropx-shadow)]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search by title, tags, notes..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="flex-1 bg-transparent text-sm outline-none placeholder-[var(--tropx-ivory-dark)]"
                />
              </div>

              {/* Subject filter button */}
              <button
                onClick={() => { setPatientSearchMode('filter'); setIsPatientSearchOpen(true); }}
                className={cn(
                  'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all',
                  'hover:scale-[1.02] active:scale-[0.98]',
                  selectedSubjectId
                    ? 'bg-violet-100 text-violet-700 border-2 border-violet-200'
                    : 'bg-white text-[var(--tropx-shadow)] border-2 border-gray-200 hover:border-gray-300'
                )}
              >
                {selectedSubjectImage ? (
                  <img src={selectedSubjectImage} alt="" className="size-5 rounded-full object-cover" />
                ) : (
                  <Users className="size-4" />
                )}
                <span className="max-w-[100px] truncate">
                  {selectedSubjectName || 'All Subjects'}
                </span>
                <ChevronRight className="size-4 opacity-50" />
              </button>

              {/* Clear filter button */}
              {selectedSubjectId && (
                <button
                  onClick={handleClearSubject}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                >
                  <XIcon className="size-4" />
                </button>
              )}

              {/* Import CSV button */}
              {onImportCSV && !isWeb() && (
                <button
                  onClick={onImportCSV}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium',
                    'bg-white text-[var(--tropx-shadow)] border-2 border-gray-200',
                    'hover:border-gray-300 hover:scale-[1.02] active:scale-[0.98] transition-all'
                  )}
                >
                  <Upload className="size-4" />
                  Import
                </button>
              )}
            </div>

            {/* Main content: two columns */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Recording list */}
              <div
                ref={listRef}
                onScroll={handleScroll}
                className="w-1/2 border-r border-gray-100 overflow-y-auto p-4 space-y-3 bg-gray-50/30"
              >
                {searchResult === undefined ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="size-8 animate-spin text-[var(--tropx-vibrant)]" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-[var(--tropx-shadow)]">
                    <div className="size-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                      <Search className="size-8 opacity-30" />
                    </div>
                    <p className="text-sm font-medium mb-1">No Recordings Found</p>
                    <p className="text-xs opacity-70">Try adjusting your search or filters</p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-medium text-[var(--tropx-shadow)] px-1">
                      {sessions.length} recording{sessions.length !== 1 && 's'}
                    </p>
                    {sessions.map((session) => (
                      <RecordingCard
                        key={session.sessionId}
                        session={session}
                        isSelected={session.sessionId === selectedSessionId}
                        onClick={() => setSelectedSessionId(session.sessionId)}
                        onDelete={session.isOwner ? async () => {
                          await archiveSession({ sessionId: session.sessionId });
                          if (selectedSessionId === session.sessionId) {
                            setSelectedSessionId(null);
                          }
                        } : undefined}
                      />
                    ))}
                    {searchResult.nextCursor && (
                      <button
                        onClick={handleLoadMore}
                        className="w-full py-3 text-sm font-medium text-[var(--tropx-vibrant)] hover:bg-[var(--tropx-hover)] rounded-xl transition-colors"
                      >
                        Load more recordings...
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* Right: Preview panel */}
              <div className="w-1/2 p-5 overflow-y-auto">
                <RecordingPreview
                  session={selectedSession}
                  previewData={previewData}
                  isPreviewLoading={isPreviewLoading}
                  onLoad={handleLoad}
                  onDelete={handleDelete}
                  onSessionUpdated={() => setEditSubject(undefined)}
                  onOpenPatientSearch={handleOpenPatientSearchForEdit}
                  editSubject={editSubject}
                  isLoading={isLoadingSession}
                  isDeleting={isDeleting}
                  isOwner={selectedSession?.isOwner ?? false}
                />
              </div>
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
                selectedPatientId={selectedSubjectId}
                embedded
              />
            </div>
          )}
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default LoadModal;
