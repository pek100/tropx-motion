/**
 * SaveModal - Modal for saving new recordings or editing existing ones.
 *
 * Modes:
 * - "save": New recording from buffer → upload to Convex
 * - "edit": Existing recording → update metadata with diff tracking
 *
 * Features:
 * - Smart tags with autocomplete and recent suggestions
 * - Notes textarea
 * - System tags display (non-removable)
 * - Modification history viewer
 * - Subject notes section (for subjects)
 * - Upload progress (save mode)
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useMutation, useQuery } from '@/lib/customConvex';
import { api } from '../../../../convex/_generated/api';
import {
  XIcon,
  CloudUpload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  WifiOff,
  Save,
  History,
  MessageSquare,
  User,
  ChevronDown,
  ChevronUp,
  Tag,
  Type,
  StickyNote,
  ChevronRight,
  Activity,
  Sparkles,
} from 'lucide-react';
import { cn, formatDuration, formatDateTime } from '@/lib/utils';
import { isWeb } from '@/lib/platform';
import { useRecordingUpload, UseRecordingUploadOptions } from '@/hooks/useRecordingUpload';
import { QuaternionSample, quaternionToAngle } from '../../../../shared/QuaternionCodec';
import { RawDeviceSample } from '../../../../motionProcessing/recording/types';
import { GridSnapService } from '../../../../motionProcessing/recording/GridSnapService';
import { InterpolationService } from '../../../../motionProcessing/recording/InterpolationService';
import { detectActivityProfile } from '../../../../shared/classification';
import { Id } from '../../../../convex/_generated/dataModel';
import { TagsInput } from './TagsInput';
import { PatientSearchModal } from './PatientSearchModal';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type ModalMode = 'save' | 'edit';

type ActivityProfile = 'power' | 'endurance' | 'rehabilitation' | 'general';

const ACTIVITY_PROFILE_OPTIONS: { value: ActivityProfile; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'power', label: 'Power' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'rehabilitation', label: 'Rehab' },
];

export interface SaveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ModalMode;
  // For save mode
  selectedPatientId?: Id<'users'> | null;
  selectedPatientName?: string;
  selectedPatientImage?: string;
  recordingSource?: 'app' | 'csv';
  // Recording title (synced with toolbar)
  recordingTitle?: string;
  onRecordingTitleChange?: (title: string) => void;
  // Patient selection callback
  onPatientSelect?: (patient: { userId: Id<'users'>; name: string; image?: string } | null) => void;
  // For edit mode
  sessionId?: string;
  onEditSuccess?: () => void;
}

interface RecordingInfo {
  sampleCount: number;
  durationMs: number;
  startTime: number | null;
  samples?: QuaternionSample[]; // For mini chart preview
}

interface ModificationHistoryEntry {
  modifiedAt: number;
  modifiedBy: Id<'users'>;
  diffs: Array<{ field: string; old: unknown; new: unknown }>;
}

interface SubjectNote {
  userId: Id<'users'>;
  note: string;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

const hasBackendAPI = (): boolean => {
  return !isWeb() && !!window.electronAPI?.recording?.getSamples;
};

/**
 * Mini chart component for recording preview.
 * Renders downsampled angle data as a sparkline using the shared quaternionToAngle codec.
 */
function MiniRecordingChart({ samples }: { samples: QuaternionSample[] }) {
  // Downsample to ~50 points for performance
  const targetPoints = 50;
  const step = Math.max(1, Math.floor(samples.length / targetPoints));

  const points: { left: number; right: number }[] = [];
  for (let i = 0; i < samples.length; i += step) {
    const sample = samples[i];
    // Use shared codec's quaternionToAngle for proper Euler Y-axis extraction
    points.push({
      left: sample.lq ? quaternionToAngle(sample.lq, 'y') : 0,
      right: sample.rq ? quaternionToAngle(sample.rq, 'y') : 0,
    });
  }

  if (points.length === 0) return null;

  // Find min/max to normalize the chart view
  const allValues = points.flatMap(p => [p.left, p.right]);
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const range = maxVal - minVal || 1;

  // Normalize to chart dimensions
  const width = 280;
  const height = 48;
  const padding = 4;

  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Generate SVG paths
  const createPath = (data: number[], color: string) => {
    const xStep = chartWidth / (data.length - 1 || 1);
    const pathData = data.map((val, i) => {
      const x = padding + i * xStep;
      // Normalize value to chart height (flip Y so higher angles are at top)
      const normalized = (val - minVal) / range;
      const y = padding + normalized * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    return (
      <path
        key={color}
        d={pathData}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    );
  };

  return (
    <div className="h-14 bg-[var(--tropx-muted)] rounded-lg border border-[var(--tropx-border)] overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
        {/* Grid line at center */}
        <line x1={padding} y1={height/2} x2={width-padding} y2={height/2} stroke="var(--tropx-border)" strokeWidth="0.5" />
        {/* Left knee (blue) */}
        {createPath(points.map(p => p.left), 'var(--leg-left-band)')}
        {/* Right knee (coral/red) */}
        {createPath(points.map(p => p.right), 'var(--leg-right-band)')}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub-Components
// ─────────────────────────────────────────────────────────────────

// Modification history viewer
function ModificationHistory({
  history,
}: {
  history: ModificationHistoryEntry[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="border border-[var(--tropx-border)] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-[var(--tropx-muted)] hover:bg-[var(--tropx-hover)] transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-[var(--tropx-shadow)]">
          <History className="size-4" />
          <span>{history.length} modification{history.length > 1 ? 's' : ''}</span>
        </div>
        {isExpanded ? (
          <ChevronUp className="size-4 text-[var(--tropx-shadow)]" />
        ) : (
          <ChevronDown className="size-4 text-[var(--tropx-shadow)]" />
        )}
      </button>

      {isExpanded && (
        <div className="p-3 space-y-3 max-h-48 overflow-y-auto">
          {history
            .slice()
            .reverse()
            .map((entry, idx) => (
              <div key={idx} className="text-xs">
                <p className="text-[var(--tropx-shadow)] mb-1">
                  {formatDateTime(entry.modifiedAt)}
                </p>
                <ul className="space-y-1">
                  {entry.diffs.map((diff, diffIdx) => (
                    <li key={diffIdx} className="flex items-start gap-2">
                      <span className="font-medium text-[var(--tropx-text-main)]">
                        {diff.field}:
                      </span>
                      <span className="text-red-500 line-through">
                        {JSON.stringify(diff.old) || '(empty)'}
                      </span>
                      <span>→</span>
                      <span className="text-green-600">
                        {JSON.stringify(diff.new) || '(empty)'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// Subject notes section
function SubjectNotesSection({
  notes,
  sessionId,
  isSubject,
  currentUserId,
}: {
  notes: SubjectNote[];
  sessionId: string;
  isSubject: boolean;
  currentUserId?: Id<'users'>;
}) {
  const [newNote, setNewNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const addSubjectNote = useMutation(api.recordingSessions.addSubjectNote);

  const handleAddNote = async () => {
    if (!newNote.trim() || !isSubject) return;

    setIsSubmitting(true);
    try {
      await addSubjectNote({ sessionId, note: newNote.trim() });
      setNewNote('');
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="border border-[var(--tropx-border)] rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 p-3 bg-[var(--tropx-muted)] text-sm text-[var(--tropx-shadow)]">
        <MessageSquare className="size-4" />
        <span>Subject Notes ({notes.length})</span>
      </div>

      {notes.length > 0 && (
        <div className="p-3 space-y-2 max-h-32 overflow-y-auto">
          {notes.map((note, idx) => (
            <div key={idx} className="text-xs p-2 bg-[var(--tropx-muted)] rounded">
              <p className="text-[var(--tropx-text-main)]">{note.note}</p>
              <p className="text-[var(--tropx-shadow)] mt-1">
                {formatDateTime(note.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}

      {isSubject && (
        <div className="p-3 border-t border-[var(--tropx-border)]">
          <div className="flex gap-2">
            <input
              type="text"
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note..."
              className="flex-1 px-3 py-2 text-sm border border-[var(--tropx-border)] bg-[var(--tropx-card)] rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)]"
              disabled={isSubmitting}
            />
            <button
              onClick={handleAddNote}
              disabled={!newNote.trim() || isSubmitting}
              className={cn(
                'px-3 py-2 rounded-lg text-sm font-medium',
                newNote.trim() && !isSubmitting
                  ? 'bg-violet-500 text-white hover:bg-violet-600'
                  : 'bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] cursor-not-allowed'
              )}
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function SaveModal({
  open,
  onOpenChange,
  mode,
  selectedPatientId,
  selectedPatientName,
  selectedPatientImage,
  recordingSource = 'app',
  recordingTitle = '',
  onRecordingTitleChange,
  onPatientSelect,
  sessionId,
  onEditSuccess,
}: SaveModalProps) {
  // State
  const [recordingInfo, setRecordingInfo] = useState<RecordingInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [activityProfile, setActivityProfile] = useState<ActivityProfile>('general');
  const [isProfileAutoDetected, setIsProfileAutoDetected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isPatientSearchOpen, setIsPatientSearchOpen] = useState(false);

  // Upload hook (for save mode)
  const {
    isUploading,
    progress,
    lastResult,
    isConnected,
    upload,
  } = useRecordingUpload();

  // Edit mutation
  const updateSession = useMutation(api.recordingSessions.updateSession);

  // Sync tags mutation
  const syncUserTags = useMutation(api.tags.syncUserTags);

  // Fetch session data for edit mode
  const sessionData = useQuery(
    api.recordingSessions.getSession,
    mode === 'edit' && sessionId ? { sessionId } : 'skip'
  );

  // Current user
  const currentUser = useQuery(api.users.getMe, {});

  // Compute if user is the subject (not owner)
  const isSubject = useMemo(() => {
    if (!sessionData || !currentUser) return false;
    return (
      sessionData.subject?._id === currentUser._id &&
      sessionData.owner?._id !== currentUser._id
    );
  }, [sessionData, currentUser]);

  // Compute if user is the owner
  const isOwner = useMemo(() => {
    if (!sessionData || !currentUser) return false;
    return sessionData.owner?._id === currentUser._id;
  }, [sessionData, currentUser]);


  // Load recording info for save mode
  useEffect(() => {
    if (!open || mode !== 'save') return;

    const loadInfo = async () => {
      if (!hasBackendAPI()) {
        setRecordingInfo(null);
        return;
      }

      setIsLoadingInfo(true);
      try {
        // Get raw samples for accurate duration calculation and preview chart
        const response = await window.electronAPI.recording.getSamples();
        if (response.success && response.samples.length > 0) {
          const rawSamples = response.samples as RawDeviceSample[];

          // Process raw samples through GridSnapService + InterpolationService for preview
          // Use 100Hz for preview (default target)
          const gridData = GridSnapService.snap(rawSamples, 100);
          const alignedSamples = InterpolationService.interpolate(gridData);

          if (alignedSamples.length > 0) {
            // Calculate actual duration from timestamps
            const firstTs = alignedSamples[0].t;
            const lastTs = alignedSamples[alignedSamples.length - 1].t;
            const actualDuration = lastTs - firstTs;

            setRecordingInfo({
              sampleCount: rawSamples.length,  // Show raw sample count
              durationMs: actualDuration,
              startTime: firstTs,
              samples: alignedSamples,
            });

            // Auto-detect activity profile from movement classification
            const { profile } = detectActivityProfile(alignedSamples);
            setActivityProfile(profile);
            setIsProfileAutoDetected(true);
          }
        } else {
          // Fallback to state if no samples
          const state = await window.electronAPI.recording.getState();
          setRecordingInfo({
            sampleCount: state.sampleCount,
            durationMs: state.durationMs,
            startTime: state.startTime,
          });
        }
      } catch (err) {
        console.error('Failed to load recording info:', err);
        setRecordingInfo(null);
      } finally {
        setIsLoadingInfo(false);
      }
    };

    loadInfo();
  }, [open, mode]);

  // Pre-fill form for edit mode
  useEffect(() => {
    if (mode === 'edit' && sessionData) {
      setNotes(sessionData.notes ?? '');
      setTags(sessionData.tags ?? []);
    }
  }, [mode, sessionData]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setNotes('');
      setTags([]);
      setActivityProfile('general');
      setIsProfileAutoDetected(false);
      setSaveError(null);
      setSaveSuccess(false);
      setIsPatientSearchOpen(false);
    }
  }, [open]);

  // Handle save (new recording)
  const handleSave = useCallback(async () => {
    if (mode !== 'save' || !hasBackendAPI()) return;

    try {
      const response = await window.electronAPI.recording.getSamples();

      if (!response.success || response.samples.length === 0) {
        setSaveError('No samples to upload');
        return;
      }

      // Raw samples are now passed directly - alignment happens in UploadService
      const rawSamples: RawDeviceSample[] = response.samples;

      // Build tags array: title as first tag (if provided), followed by user tags
      const allTags: string[] = [];
      if (recordingTitle.trim()) {
        allTags.push(recordingTitle.trim());
      }
      // Add user tags (avoiding duplicates with the title)
      for (const tag of tags) {
        if (tag.toLowerCase() !== recordingTitle.trim().toLowerCase()) {
          allTags.push(tag);
        }
      }

      const options: UseRecordingUploadOptions = {
        subjectId: selectedPatientId || undefined,
        subjectAlias: selectedPatientName || undefined,
        notes: notes || undefined,
        tags: allTags.length > 0 ? allTags : undefined,
        activityProfile,
      };

      const result = await upload(rawSamples, options);

      if (result.success) {
        // Sync user tags for autocomplete history (don't include title)
        if (tags.length > 0) {
          await syncUserTags({ tags });
        }
        setSaveSuccess(true);
        setTimeout(() => onOpenChange(false), 1000);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [mode, notes, tags, recordingTitle, activityProfile, selectedPatientId, selectedPatientName, upload, syncUserTags, onOpenChange]);

  // Handle edit (update existing)
  const handleEdit = useCallback(async () => {
    if (mode !== 'edit' || !sessionId || !isOwner) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      await updateSession({
        sessionId,
        notes: notes || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });

      // Sync user tags for autocomplete history
      if (tags.length > 0) {
        await syncUserTags({ tags });
      }

      setSaveSuccess(true);
      onEditSuccess?.();
      setTimeout(() => onOpenChange(false), 1000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsSaving(false);
    }
  }, [mode, sessionId, isOwner, notes, tags, updateSession, syncUserTags, onEditSuccess, onOpenChange]);

  const handleClose = () => onOpenChange(false);

  // Compute if can save/edit
  const canSave =
    mode === 'save' &&
    hasBackendAPI() &&
    recordingInfo &&
    recordingInfo.sampleCount > 0 &&
    !isUploading;

  const canEdit = mode === 'edit' && isOwner && !isSaving;

  const isProcessing = isUploading || isSaving;

  // Title based on mode
  const title = mode === 'save' ? 'Save Recording' : 'Edit Recording';
  const actionLabel = mode === 'save' ? 'Save to Cloud' : 'Save Changes';
  const ActionIcon = mode === 'save' ? CloudUpload : Save;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 modal-blur-overlay cursor-default',
            'data-[state=open]:animate-[overlay-fade-in_0.15s_ease-out]',
            'data-[state=closed]:animate-[overlay-fade-out_0.1s_ease-in]'
          )}
          onClick={handleClose}
        />

        {/* Side-by-side container for both modals */}
        <div
          className={cn(
            'fixed inset-0 z-[51] flex items-center justify-center gap-4 pointer-events-none',
            'data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]',
            'data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]'
          )}
        >
          {/* SaveModal Content */}
          <DialogPrimitive.Content
            className={cn(
              'w-full max-w-sm h-fit max-h-[85vh] overflow-y-auto p-5',
              'bg-[var(--tropx-card)] rounded-2xl shadow-lg border border-[var(--tropx-border)]',
              'pointer-events-auto',
              'transition-transform duration-200 ease-out'
            )}
            onPointerDownOutside={(e) => {
              // Don't close if clicking within the side-by-side container area
              if (isPatientSearchOpen) {
                e.preventDefault();
              } else {
                handleClose();
              }
            }}
          >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <DialogPrimitive.Title className="text-lg font-semibold text-[var(--tropx-text-main)]">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              {mode === 'save' ? 'Save recording to cloud storage' : 'Edit recording metadata'}
            </DialogPrimitive.Description>
            <button
              onClick={handleClose}
              className="rounded-full p-1.5 hover:bg-[var(--tropx-muted)] transition-colors cursor-pointer"
            >
              <XIcon className="size-4 text-[var(--tropx-shadow)]" />
            </button>
          </div>

          {/* Content */}
          <div className="space-y-3">
            {/* Connection Status (save mode) */}
            {mode === 'save' && !isConnected && (
              <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
                <WifiOff className="size-4" />
                <span className="text-sm">Offline - will be queued</span>
              </div>
            )}

            {/* Recording Info (save mode) */}
            {mode === 'save' && (
              isLoadingInfo ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="size-5 animate-spin text-[var(--tropx-shadow)]" />
                </div>
              ) : recordingInfo ? (
                <div className="p-3 bg-[var(--tropx-muted)] rounded-lg">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-[var(--tropx-shadow)]">Samples:</span>
                      <span className="ml-2 font-medium">
                        {recordingInfo.sampleCount.toLocaleString()}
                      </span>
                    </div>
                    <div>
                      <span className="text-[var(--tropx-shadow)]">Duration:</span>
                      <span className="ml-2 font-medium">
                        {formatDuration(recordingInfo.durationMs)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-[var(--tropx-muted)] rounded-lg text-center text-[var(--tropx-shadow)] text-sm">
                  No recording data available
                </div>
              )
            )}

            {/* Session Info (edit mode) */}
            {mode === 'edit' && sessionData && (
              <div className="p-3 bg-[var(--tropx-muted)] rounded-lg">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-[var(--tropx-shadow)]">Duration:</span>
                    <span className="ml-2 font-medium">
                      {formatDuration(sessionData.endTime - sessionData.startTime)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[var(--tropx-shadow)]">Recorded:</span>
                    <span className="ml-2 font-medium">
                      {formatDateTime(sessionData.startTime)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Mini Chart Preview */}
            {mode === 'save' && recordingInfo && recordingInfo.samples && recordingInfo.samples.length > 0 && (
              <MiniRecordingChart samples={recordingInfo.samples} />
            )}

            {/* Activity Profile Selector */}
            {mode === 'save' && (
              <div>
                <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--tropx-text-main)] mb-1.5">
                  <Activity className="size-3.5" />
                  Activity Profile
                  {isProfileAutoDetected && (
                    <span className="ml-auto flex items-center gap-1 text-xs font-normal text-[var(--tropx-vibrant)]">
                      <Sparkles className="size-3" />
                      Auto-Detected
                    </span>
                  )}
                </label>
                <div className="flex rounded-lg border border-[var(--tropx-border)] overflow-hidden">
                  {ACTIVITY_PROFILE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setActivityProfile(option.value);
                        setIsProfileAutoDetected(false);
                      }}
                      disabled={isProcessing}
                      className={cn(
                        'flex-1 px-3 py-1.5 text-sm font-medium transition-colors',
                        activityProfile === option.value
                          ? 'bg-[var(--tropx-vibrant)] text-white'
                          : 'bg-[var(--tropx-card)] text-[var(--tropx-shadow)] hover:bg-[var(--tropx-muted)]',
                        isProcessing && 'opacity-50 cursor-not-allowed'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recording Title & Patient - Compact inline row */}
            {mode === 'save' && (
              <div className="flex gap-2">
                {/* Title - compact input with icon */}
                <div className="flex-1 relative">
                  <Type className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-[var(--tropx-shadow)]" />
                  <input
                    type="text"
                    value={recordingTitle}
                    onChange={(e) => onRecordingTitleChange?.(e.target.value)}
                    placeholder="Title..."
                    className="w-full pl-8 pr-2.5 py-1.5 border border-[var(--tropx-border)] bg-[var(--tropx-card)] rounded-lg text-sm text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)] focus:outline-none focus:ring-2 focus:ring-[var(--tropx-vibrant)] focus:border-transparent"
                    disabled={isProcessing}
                  />
                </div>

                {/* Patient selector button - opens PatientSearchModal beside */}
                <button
                  type="button"
                  onClick={() => setIsPatientSearchOpen(true)}
                  disabled={isProcessing}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg text-sm transition-colors',
                    selectedPatientId
                      ? 'border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                      : 'border-[var(--tropx-border)] text-[var(--tropx-shadow)] hover:bg-[var(--tropx-muted)]',
                    isProcessing && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {selectedPatientImage ? (
                    <img
                      src={selectedPatientImage}
                      alt=""
                      className="size-5 rounded-full object-cover"
                    />
                  ) : (
                    <User className="size-3.5" />
                  )}
                  <span className="max-w-[80px] truncate">
                    {selectedPatientName || 'Patient'}
                  </span>
                  <ChevronRight className="size-3.5 opacity-50" />
                </button>
              </div>
            )}

            {/* Subject Info (edit mode - read only) */}
            {mode === 'edit' && sessionData?.subject && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--tropx-muted)]">
                <div className="size-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                  <User className="size-4 text-violet-600" />
                </div>
                <div>
                  <p className="text-xs text-[var(--tropx-shadow)]">Subject</p>
                  <p className="text-sm font-medium text-[var(--tropx-text-main)]">
                    {sessionData.subject.name}
                  </p>
                </div>
              </div>
            )}


            {/* Tags */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--tropx-text-main)] mb-1">
                <Tag className="size-3.5" />
                Tags
              </label>
              <TagsInput
                value={tags}
                onChange={setTags}
                placeholder="Add tags (exercises, notes, etc.)"
                disabled={isProcessing || (mode === 'edit' && !isOwner)}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium text-[var(--tropx-text-main)] mb-1">
                <StickyNote className="size-3.5" />
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                rows={3}
                className="w-full px-3 py-2 border border-[var(--tropx-border)] bg-[var(--tropx-card)] rounded-lg text-sm text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)] focus:outline-none focus:ring-2 focus:ring-[var(--tropx-vibrant)] focus:border-transparent resize-none"
                disabled={isProcessing || (mode === 'edit' && !isOwner)}
              />
            </div>

            {/* Modification History (edit mode) */}
            {mode === 'edit' && (sessionData as any)?.modificationHistory && (
              <ModificationHistory
                history={(sessionData as any).modificationHistory}
              />
            )}

            {/* Subject Notes (edit mode) */}
            {mode === 'edit' && sessionId && (
              <SubjectNotesSection
                notes={(sessionData as any)?.subjectNotes ?? []}
                sessionId={sessionId}
                isSubject={isSubject}
                currentUserId={currentUser?._id}
              />
            )}

            {/* Upload Progress (save mode) */}
            {mode === 'save' && isUploading && progress && (
              <div className="p-4 bg-[var(--tropx-muted)] border border-[var(--tropx-border)] rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <CloudUpload className="size-5 text-[var(--tropx-vibrant)]" />
                      <div className="absolute -top-0.5 -right-0.5 size-2 bg-[var(--tropx-vibrant)] rounded-full animate-pulse" />
                    </div>
                    <span className="text-sm font-medium text-[var(--tropx-text-main)]">
                      {progress.message}
                    </span>
                  </div>
                  {progress.totalChunks > 0 && (
                    <span className="text-xs font-medium text-[var(--tropx-shadow)] tabular-nums">
                      {progress.currentChunk}/{progress.totalChunks}
                    </span>
                  )}
                </div>
                {progress.totalChunks > 0 && (
                  <div className="w-full bg-[var(--tropx-border)] rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--tropx-vibrant)] to-[var(--tropx-coral,#f97066)] transition-all duration-300 ease-out"
                      style={{
                        width: `${(progress.currentChunk / progress.totalChunks) * 100}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Success/Error Messages */}
            {saveSuccess && (
              <div className="p-4 rounded-xl flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <div className="size-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    {mode === 'save' ? 'Saved successfully' : 'Updated successfully'}
                  </span>
                  <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                    Your recording is now in the cloud
                  </p>
                </div>
              </div>
            )}

            {saveError && (
              <div className="p-4 rounded-xl flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <div className="size-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                  <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <span className="text-sm font-medium text-red-700 dark:text-red-300">
                    Upload failed
                  </span>
                  <p className="text-xs text-red-600/70 dark:text-red-400/70">
                    {saveError}
                  </p>
                </div>
              </div>
            )}

            {/* Last upload result (save mode) */}
            {mode === 'save' && lastResult && !isUploading && !saveSuccess && (
              <div
                className={cn(
                  'p-4 rounded-xl flex items-center gap-3',
                  lastResult.success
                    ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800'
                    : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800'
                )}
              >
                {lastResult.success ? (
                  <>
                    <div className="size-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                      <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                        Saved successfully
                      </span>
                      <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                        Your recording is now in the cloud
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="size-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center">
                      <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-red-700 dark:text-red-300">
                        Upload failed
                      </span>
                      <p className="text-xs text-red-600/70 dark:text-red-400/70">
                        {lastResult.error || 'Something went wrong'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-[var(--tropx-border)] rounded-lg text-sm font-medium text-[var(--tropx-shadow)] hover:bg-[var(--tropx-muted)] transition-colors"
              disabled={isProcessing}
            >
              Cancel
            </button>

            {/* Only show action button if owner (or save mode) */}
            {(mode === 'save' || isOwner) && (
              <button
                onClick={mode === 'save' ? handleSave : handleEdit}
                disabled={mode === 'save' ? !canSave : !canEdit}
                className={cn(
                  'flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                  (mode === 'save' ? canSave : canEdit)
                    ? 'bg-[var(--tropx-vibrant)] text-white hover:opacity-90'
                    : 'bg-[var(--tropx-muted)] text-[var(--tropx-text-sub)] cursor-not-allowed'
                )}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {mode === 'save' ? 'Saving...' : 'Updating...'}
                  </>
                ) : (
                  <>
                    <ActionIcon className="size-4" />
                    {actionLabel}
                  </>
                )}
              </button>
            )}
          </div>
        </DialogPrimitive.Content>

          {/* PatientSearchModal rendered beside SaveModal (embedded mode) */}
          {isPatientSearchOpen && mode === 'save' && (
            <div
              className={cn(
                'h-fit pointer-events-auto',
                'animate-[modal-bubble-in_0.15s_var(--spring-bounce)_forwards]'
              )}
            >
              <PatientSearchModal
                open={isPatientSearchOpen}
                onOpenChange={(open) => {
                  setIsPatientSearchOpen(open);
                }}
                onSelectPatient={(patient) => {
                  onPatientSelect?.({
                    userId: patient.userId,
                    name: patient.name,
                    image: patient.image,
                  });
                  setIsPatientSearchOpen(false);
                }}
                selectedPatientId={selectedPatientId}
                embedded
              />
            </div>
          )}
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default SaveModal;
