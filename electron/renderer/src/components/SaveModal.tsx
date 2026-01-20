/**
 * SaveModal - Unified modal for saving recordings with integrated crop.
 *
 * Layout:
 * - Top: Title + Patient selector
 * - Center: Interactive crop chart with handles
 * - Middle: Tags + Activity Profile
 * - Bottom: Notes
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
  User,
  ChevronRight,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import { cn, formatDuration } from '@/lib/utils';
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
import { NumberStepper } from '@/components/ui/NumberStepper';
import { detectAutoCrop } from '../lib/recording/AutoCropService';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

type ActivityProfile = 'power' | 'endurance' | 'rehabilitation' | 'general';

export interface CropRange {
  startMs: number;
  endMs: number;
}

const ACTIVITY_PROFILE_OPTIONS: { value: ActivityProfile; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'power', label: 'Power' },
  { value: 'endurance', label: 'Endurance' },
  { value: 'rehabilitation', label: 'Rehab' },
];

export interface SaveModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedPatientId?: Id<'users'> | null;
  selectedPatientName?: string;
  selectedPatientImage?: string;
  recordingTitle?: string;
  onRecordingTitleChange?: (title: string) => void;
  onPatientSelect?: (patient: { userId: Id<'users'>; name: string; image?: string } | null) => void;
}

interface RecordingInfo {
  sampleCount: number;
  durationMs: number;
  startTime: number | null;
  samples?: QuaternionSample[];
}

interface ChartDataPoint {
  time: number;
  left: number | null;
  right: number | null;
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const MIN_CROP_DURATION_MS = 1000;
const CHART_HEIGHT = 220;
const LEFT_KNEE_COLOR = 'var(--chart-left)';
const RIGHT_KNEE_COLOR = 'var(--chart-right)';

// ─────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────

const hasBackendAPI = (): boolean => {
  return !isWeb() && !!window.electronAPI?.recording?.getSamples;
};

function formatTimeMs(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
  }
  return `${seconds.toFixed(1)}s`;
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────

export function SaveModal({
  open,
  onOpenChange,
  selectedPatientId,
  selectedPatientName,
  selectedPatientImage,
  recordingTitle = '',
  onRecordingTitleChange,
  onPatientSelect,
}: SaveModalProps) {
  // Persisted form state
  const STORAGE_KEY = 'tropx-save-modal-state';

  interface PersistedState {
    recordingHash: string;
    notes: string;
    tags: string[];
    activityProfile: ActivityProfile;
    autoDetectedProfile: ActivityProfile | null;
    cropRange: CropRange | null;
    isCropAutoDetected: boolean;
    hasRunAutoCrop: boolean;
    sets: number | null;
    reps: number | null;
  }

  const generateRecordingHash = useCallback((samples: QuaternionSample[], durationMs: number): string => {
    if (samples.length === 0) return '';
    const first = samples[0];
    const last = samples[samples.length - 1];
    const hashInput = `${samples.length}-${durationMs}-${first.lq?.w ?? 0}-${last.lq?.w ?? 0}`;
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }, []);

  const loadPersistedState = useCallback((): PersistedState | null => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }, []);

  const savePersistedState = useCallback((state: Partial<PersistedState>) => {
    const current = loadPersistedState() || {
      recordingHash: '',
      notes: '',
      tags: [],
      activityProfile: 'general' as ActivityProfile,
      autoDetectedProfile: null,
      cropRange: null,
      isCropAutoDetected: false,
      hasRunAutoCrop: false,
      sets: null,
      reps: null,
    };
    const updated = { ...current, ...state };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, [loadPersistedState]);

  const clearPersistedState = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const initialState = loadPersistedState();

  // State
  const [recordingInfo, setRecordingInfo] = useState<RecordingInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [notes, setNotesState] = useState(initialState?.notes || '');
  const [tags, setTagsState] = useState<string[]>(initialState?.tags || []);
  const [activityProfile, setActivityProfileState] = useState<ActivityProfile>(initialState?.activityProfile || 'general');
  const [autoDetectedProfile, setAutoDetectedProfile] = useState<ActivityProfile | null>(initialState?.autoDetectedProfile || null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isPatientSearchOpen, setIsPatientSearchOpen] = useState(false);
  const [cropRange, setCropRangeState] = useState<CropRange | null>(initialState?.cropRange || null);
  const [sets, setSetsState] = useState<number | null>(initialState?.sets ?? null);
  const [reps, setRepsState] = useState<number | null>(initialState?.reps ?? null);

  // Crop chart state
  const chartRef = useRef<HTMLDivElement>(null);
  const [localRange, setLocalRange] = useState<[number, number]>([0, 0]);
  const [dragMode, setDragMode] = useState<'left' | 'right' | null>(null);
  const [isCropAutoDetected, setIsCropAutoDetected] = useState(initialState?.isCropAutoDetected || false);

  // Wrapped setters that persist to sessionStorage
  const setNotes = useCallback((value: string) => {
    setNotesState(value);
    savePersistedState({ notes: value });
  }, [savePersistedState]);

  const setTags = useCallback((value: string[]) => {
    setTagsState(value);
    savePersistedState({ tags: value });
  }, [savePersistedState]);

  const setActivityProfile = useCallback((value: ActivityProfile) => {
    setActivityProfileState(value);
    savePersistedState({ activityProfile: value });
  }, [savePersistedState]);

  const setCropRange = useCallback((range: CropRange | null) => {
    setCropRangeState(range);
    savePersistedState({ cropRange: range });
  }, [savePersistedState]);

  const setSets = useCallback((value: number | null) => {
    setSetsState(value);
    savePersistedState({ sets: value });
  }, [savePersistedState]);

  const setReps = useCallback((value: number | null) => {
    setRepsState(value);
    savePersistedState({ reps: value });
  }, [savePersistedState]);

  // Upload hook
  const {
    isUploading,
    progress,
    lastResult,
    isConnected,
    upload,
  } = useRecordingUpload();

  const syncUserTags = useMutation(api.tags.syncUserTags);

  // Sync local crop range to parent state
  useEffect(() => {
    if (!recordingInfo?.durationMs) return;
    const durationMs = recordingInfo.durationMs;

    if (localRange[0] === 0 && localRange[1] === durationMs) {
      setCropRange(null);
    } else if (localRange[0] > 0 || localRange[1] < durationMs) {
      setCropRange({ startMs: localRange[0], endMs: localRange[1] });
    }
  }, [localRange, recordingInfo?.durationMs, setCropRange]);

  // Load recording info
  useEffect(() => {
    if (!open) return;

    const loadInfo = async () => {
      if (!hasBackendAPI()) {
        setRecordingInfo(null);
        return;
      }

      setIsLoadingInfo(true);
      try {
        const response = await window.electronAPI.recording.getSamples();
        if (response.success && response.samples.length > 0) {
          const rawSamples = response.samples as RawDeviceSample[];
          const gridData = GridSnapService.snap(rawSamples, 100);
          const alignedSamples = InterpolationService.interpolate(gridData);

          if (alignedSamples.length > 0) {
            const firstTs = alignedSamples[0].t;
            const lastTs = alignedSamples[alignedSamples.length - 1].t;
            const actualDuration = lastTs - firstTs;

            setRecordingInfo({
              sampleCount: rawSamples.length,
              durationMs: actualDuration,
              startTime: firstTs,
              samples: alignedSamples,
            });

            const currentHash = generateRecordingHash(alignedSamples, actualDuration);
            const persisted = loadPersistedState();

            if (persisted && persisted.recordingHash === currentHash) {
              // Restore persisted crop range
              if (persisted.cropRange) {
                setLocalRange([persisted.cropRange.startMs, persisted.cropRange.endMs]);
              } else {
                setLocalRange([0, actualDuration]);
              }
            } else {
              // New recording - run auto-detection
              clearPersistedState();

              const { profile } = detectActivityProfile(alignedSamples);
              setActivityProfile(profile);
              setAutoDetectedProfile(profile);

              const autoCropResult = detectAutoCrop(alignedSamples, actualDuration);
              const cropAutoDetected = autoCropResult.detected;
              if (cropAutoDetected) {
                setLocalRange([autoCropResult.startMs, autoCropResult.endMs]);
                setCropRange({ startMs: autoCropResult.startMs, endMs: autoCropResult.endMs });
                setIsCropAutoDetected(true);
              } else {
                setLocalRange([0, actualDuration]);
                setIsCropAutoDetected(false);
              }

              savePersistedState({
                recordingHash: currentHash,
                hasRunAutoCrop: true,
                autoDetectedProfile: profile,
                isCropAutoDetected: cropAutoDetected,
              });
            }
          }
        } else {
          const state = await window.electronAPI.recording.getState();
          setRecordingInfo({
            sampleCount: state.sampleCount,
            durationMs: state.durationMs,
            startTime: state.startTime,
          });
          setLocalRange([0, state.durationMs]);
        }
      } catch (err) {
        console.error('Failed to load recording info:', err);
        setRecordingInfo(null);
      } finally {
        setIsLoadingInfo(false);
      }
    };

    loadInfo();
  }, [open, generateRecordingHash, loadPersistedState, savePersistedState, clearPersistedState, setActivityProfile, setCropRange]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setNotesState('');
      setTagsState([]);
      setActivityProfileState('general');
      setAutoDetectedProfile(null);
      setIsCropAutoDetected(false);
      setSaveError(null);
      setSaveSuccess(false);
      setIsPatientSearchOpen(false);
      setCropRangeState(null);
      setLocalRange([0, 0]);
      setSetsState(null);
      setRepsState(null);
      clearPersistedState();
    }
  }, [open, clearPersistedState]);

  // Chart data
  const chartData = useMemo<ChartDataPoint[]>(() => {
    if (!recordingInfo?.samples || recordingInfo.samples.length === 0) return [];

    const samples = recordingInfo.samples;
    const durationMs = recordingInfo.durationMs;
    const targetPoints = 300;
    const step = Math.max(1, Math.floor(samples.length / targetPoints));
    const timeStep = durationMs / samples.length;

    const points: ChartDataPoint[] = [];
    for (let i = 0; i < samples.length; i += step) {
      const sample = samples[i];
      points.push({
        time: i * timeStep,
        left: sample.lq ? Math.round(quaternionToAngle(sample.lq, 'y') * 10) / 10 : null,
        right: sample.rq ? Math.round(quaternionToAngle(sample.rq, 'y') * 10) / 10 : null,
      });
    }
    return points;
  }, [recordingInfo?.samples, recordingInfo?.durationMs]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-45, 90];
    const allValues = chartData.flatMap((p) => [p.left, p.right]).filter((v): v is number => v !== null);
    if (allValues.length === 0) return [-45, 90];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const padding = (max - min) * 0.1;
    return [Math.floor(min - padding), Math.ceil(max + padding)];
  }, [chartData]);

  const durationMs = recordingInfo?.durationMs || 1;
  const leftCropPercent = (localRange[0] / durationMs) * 100;
  const rightCropPercent = (localRange[1] / durationMs) * 100;
  const selectedDuration = localRange[1] - localRange[0];
  const isCropped = localRange[0] > 0 || localRange[1] < durationMs;

  // Crop drag handlers
  const getTimeFromEvent = useCallback((e: MouseEvent | TouchEvent) => {
    if (!chartRef.current) return 0;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = chartRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * durationMs;
  }, [durationMs]);

  const handleDragStart = useCallback((mode: 'left' | 'right', e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
  }, []);

  const handleChartClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!chartRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const rect = chartRef.current.getBoundingClientRect();
    const clickTime = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * durationMs;

    const distToLeft = Math.abs(clickTime - localRange[0]);
    const distToRight = Math.abs(clickTime - localRange[1]);
    const closerHandle = distToLeft <= distToRight ? 'left' : 'right';
    setDragMode(closerHandle);

    if (closerHandle === 'left') {
      const maxAllowed = localRange[1] - MIN_CROP_DURATION_MS;
      const newStart = Math.max(0, Math.min(clickTime, maxAllowed));
      setLocalRange([newStart, localRange[1]]);
    } else {
      const minAllowed = localRange[0] + MIN_CROP_DURATION_MS;
      const newEnd = Math.min(durationMs, Math.max(clickTime, minAllowed));
      setLocalRange([localRange[0], newEnd]);
    }
  }, [durationMs, localRange]);

  const handleDragMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!dragMode || !chartRef.current) return;
    const currentTime = getTimeFromEvent(e);

    if (dragMode === 'left') {
      const maxAllowed = localRange[1] - MIN_CROP_DURATION_MS;
      const newStart = Math.max(0, Math.min(currentTime, maxAllowed));
      setLocalRange([newStart, localRange[1]]);
    } else if (dragMode === 'right') {
      const minAllowed = localRange[0] + MIN_CROP_DURATION_MS;
      const newEnd = Math.min(durationMs, Math.max(currentTime, minAllowed));
      setLocalRange([localRange[0], newEnd]);
    }
  }, [dragMode, durationMs, localRange, getTimeFromEvent]);

  const handleDragEnd = useCallback(() => {
    setDragMode(null);
    // Manual adjustment clears auto-detected flag
    setIsCropAutoDetected(false);
    savePersistedState({ isCropAutoDetected: false });
  }, [savePersistedState]);

  useEffect(() => {
    if (dragMode) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
      window.addEventListener('touchmove', handleDragMove);
      window.addEventListener('touchend', handleDragEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, [dragMode, handleDragMove, handleDragEnd]);

  const handleReset = useCallback(() => {
    if (recordingInfo?.durationMs) {
      setLocalRange([0, recordingInfo.durationMs]);
      setIsCropAutoDetected(false);
      savePersistedState({ isCropAutoDetected: false });
    }
  }, [recordingInfo?.durationMs, savePersistedState]);

  const handleAuto = useCallback(() => {
    if (!recordingInfo?.samples || !recordingInfo.durationMs) return;
    const result = detectAutoCrop(recordingInfo.samples, recordingInfo.durationMs);
    if (result.detected) {
      setLocalRange([result.startMs, result.endMs]);
      setIsCropAutoDetected(true);
      savePersistedState({ isCropAutoDetected: true });
    } else {
      setLocalRange([0, recordingInfo.durationMs]);
      setIsCropAutoDetected(false);
      savePersistedState({ isCropAutoDetected: false });
    }
  }, [recordingInfo?.samples, recordingInfo?.durationMs, savePersistedState]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!hasBackendAPI()) return;

    try {
      const response = await window.electronAPI.recording.getSamples();

      if (!response.success || response.samples.length === 0) {
        setSaveError('No samples to upload');
        return;
      }

      const rawSamples: RawDeviceSample[] = response.samples;

      const options: UseRecordingUploadOptions = {
        subjectId: selectedPatientId || undefined,
        subjectAlias: selectedPatientName || undefined,
        title: recordingTitle.trim() || undefined,
        notes: notes || undefined,
        tags: tags.length > 0 ? tags : undefined,
        activityProfile,
        sets: sets || undefined,
        reps: reps || undefined,
        cropRange: cropRange || undefined,
      };

      const result = await upload(rawSamples, options);

      if (result.success) {
        if (tags.length > 0) {
          await syncUserTags({ tags });
        }
        setSaveSuccess(true);
        setTimeout(() => onOpenChange(false), 1000);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  }, [notes, tags, recordingTitle, activityProfile, sets, reps, selectedPatientId, selectedPatientName, cropRange, upload, syncUserTags, onOpenChange]);

  const handleClose = () => onOpenChange(false);

  const canSave = hasBackendAPI() && recordingInfo && recordingInfo.sampleCount > 0 && !isUploading;
  const isProcessing = isUploading;

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

        <div
          className={cn(
            'fixed inset-0 z-[51] flex items-center justify-center gap-4 pointer-events-none',
            'data-[state=open]:animate-[modal-bubble-in_0.2s_var(--spring-bounce)_forwards]',
            'data-[state=closed]:animate-[modal-bubble-out_0.12s_var(--spring-smooth)_forwards]'
          )}
        >
          <DialogPrimitive.Content
            className={cn(
              'w-full max-w-lg p-4 pointer-events-auto',
              'bg-[var(--tropx-card)] rounded-2xl border border-[var(--tropx-border)] shadow-xl'
            )}
            onPointerDownOutside={(e) => {
              if (isPatientSearchOpen) {
                e.preventDefault();
              } else {
                handleClose();
              }
            }}
          >
            <DialogPrimitive.Title className="sr-only">Save Recording</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Save recording to cloud storage</DialogPrimitive.Description>

            {/* Connection Status */}
            {!isConnected && (
              <div className="flex items-center gap-2 p-2 mb-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                <WifiOff className="size-4" />
                <span>Offline - will be queued</span>
              </div>
            )}

            {/* Top Row: Title + Patient */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={recordingTitle}
                onChange={(e) => onRecordingTitleChange?.(e.target.value)}
                placeholder="Title..."
                className="flex-1 px-3 py-2 border border-[var(--tropx-border)] bg-[var(--tropx-muted)] rounded-lg text-sm text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)] focus:outline-none focus:ring-2 focus:ring-[var(--tropx-vibrant)] focus:border-transparent"
                disabled={isProcessing}
              />
              <button
                type="button"
                onClick={() => setIsPatientSearchOpen(true)}
                disabled={isProcessing}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors',
                  selectedPatientId
                    ? 'border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'border-[var(--tropx-border)] bg-[var(--tropx-muted)] text-[var(--tropx-shadow)] hover:bg-[var(--tropx-hover)]',
                  isProcessing && 'opacity-50 cursor-not-allowed'
                )}
              >
                {selectedPatientImage ? (
                  <img src={selectedPatientImage} alt="" className="size-5 rounded-full object-cover" />
                ) : (
                  <User className="size-4" />
                )}
                <span className="max-w-[80px] truncate">{selectedPatientName || 'Patient'}</span>
              </button>
            </div>

            {/* Chart Section */}
            {isLoadingInfo ? (
              <div className="flex items-center justify-center py-12 bg-[var(--tropx-muted)] rounded-xl">
                <Loader2 className="size-6 animate-spin text-[var(--tropx-shadow)]" />
              </div>
            ) : recordingInfo?.samples && chartData.length > 0 ? (
              <div
                ref={chartRef}
                className="relative cursor-ew-resize rounded-xl overflow-hidden bg-[var(--tropx-muted)] mb-3"
                style={{ height: CHART_HEIGHT }}
                onMouseDown={handleChartClick}
                onTouchStart={handleChartClick}
              >
                {/* Chart */}
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 8 }}>
                    <defs>
                      <linearGradient id="saveLeftGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={LEFT_KNEE_COLOR} stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="saveRightGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={RIGHT_KNEE_COLOR} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="time"
                      type="number"
                      domain={[0, durationMs]}
                      tickFormatter={(ms) => formatTimeMs(ms)}
                      tick={{ fill: 'var(--tropx-shadow)', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickCount={5}
                    />
                    <YAxis domain={yDomain} reversed hide />
                    <Area
                      type="monotone"
                      dataKey="left"
                      stroke={LEFT_KNEE_COLOR}
                      strokeWidth={1.5}
                      fill="url(#saveLeftGradient)"
                      isAnimationActive={false}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="right"
                      stroke={RIGHT_KNEE_COLOR}
                      strokeWidth={1.5}
                      fill="url(#saveRightGradient)"
                      isAnimationActive={false}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>

                {/* Crop overlays */}
                {localRange[0] > 0 && (
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-red-500/30 cursor-ew-resize hover:bg-red-500/40 transition-colors"
                    style={{ width: `${leftCropPercent}%` }}
                    onMouseDown={(e) => handleDragStart('left', e)}
                    onTouchStart={(e) => handleDragStart('left', e)}
                  />
                )}
                {localRange[1] < durationMs && (
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-red-500/30 cursor-ew-resize hover:bg-red-500/40 transition-colors"
                    style={{ width: `${100 - rightCropPercent}%` }}
                    onMouseDown={(e) => handleDragStart('right', e)}
                    onTouchStart={(e) => handleDragStart('right', e)}
                  />
                )}

                {/* Crop handles */}
                <div
                  className="absolute top-0 bottom-0 w-4 cursor-ew-resize z-20 flex justify-center"
                  style={{ left: `calc(${leftCropPercent}% - 8px)` }}
                  onMouseDown={(e) => handleDragStart('left', e)}
                  onTouchStart={(e) => handleDragStart('left', e)}
                >
                  <div className={cn("h-full w-1 transition-colors bg-red-500 hover:bg-red-400", dragMode === 'left' && "bg-red-400")} />
                </div>
                <div
                  className="absolute top-0 bottom-0 w-4 cursor-ew-resize z-20 flex justify-center"
                  style={{ left: `calc(${rightCropPercent}% - 8px)` }}
                  onMouseDown={(e) => handleDragStart('right', e)}
                  onTouchStart={(e) => handleDragStart('right', e)}
                >
                  <div className={cn("h-full w-1 transition-colors bg-red-500 hover:bg-red-400", dragMode === 'right' && "bg-red-400")} />
                </div>

                {/* Hint text */}
                <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
                  <span className="text-[10px] text-red-500 font-medium px-2 py-0.5 rounded bg-[var(--tropx-card)]/80 backdrop-blur-sm">
                    Click to drag closest edge
                  </span>
                </div>

                {/* Duration badge */}
                <div className="absolute top-1 right-2 z-30 pointer-events-none">
                  <span className="text-[10px] text-[var(--tropx-shadow)] font-mono px-1.5 py-0.5 rounded bg-[var(--tropx-card)]/80 backdrop-blur-sm">
                    {formatDuration(selectedDuration)}
                  </span>
                </div>

                {/* Chart action buttons */}
                <div
                  className="absolute bottom-2 right-2 z-30 flex items-center gap-1.5"
                  onMouseDown={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={handleReset}
                    disabled={!isCropped}
                    className={cn(
                      "size-8 flex items-center justify-center rounded-lg transition-all border border-[var(--tropx-border)] shadow-md",
                      isCropped
                        ? "bg-[var(--tropx-card)] text-[var(--tropx-text-main)] hover:bg-[var(--tropx-hover)] hover:scale-105"
                        : "bg-[var(--tropx-muted)]/50 text-[var(--tropx-shadow)]/50 cursor-not-allowed"
                    )}
                    title="Reset crop"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                  <button
                    onClick={handleAuto}
                    className="size-8 flex items-center justify-center rounded-lg transition-all border border-[var(--tropx-border)] shadow-md bg-[var(--tropx-card)] text-[var(--tropx-text-main)] hover:bg-[var(--tropx-hover)] hover:scale-105"
                    title="Auto-detect crop"
                  >
                    <Wand2 className="size-4" />
                  </button>
                </div>

                {/* Cropped badge */}
                {isCropped && (
                  <div className="absolute bottom-2 left-2 z-30 pointer-events-none">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-[var(--tropx-vibrant)] text-white shadow-sm">
                      Cropped{isCropAutoDetected && ' - Auto'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 bg-[var(--tropx-muted)] rounded-xl mb-3 text-[var(--tropx-shadow)] text-sm">
                No recording data available
              </div>
            )}

            {/* Sets/Reps + Activity Profile Row */}
            <div className="flex items-center justify-between mb-3">
              {/* Set */}
              <div className="flex items-center gap-1.5">
                <label className="text-sm text-[var(--tropx-shadow)]">Set</label>
                <NumberStepper
                  value={sets}
                  onChange={setSets}
                  max={99}
                  disabled={isProcessing}
                />
              </div>

              {/* Reps */}
              <div className="flex items-center gap-1.5">
                <label className="text-sm text-[var(--tropx-shadow)]">Reps</label>
                <NumberStepper
                  value={reps}
                  onChange={setReps}
                  max={999}
                  disabled={isProcessing}
                />
              </div>

              {/* Activity Profile Dropdown */}
              <div className="flex items-center gap-1.5">
                <label className="text-sm text-[var(--tropx-shadow)]">Profile</label>
                <Select
                  value={activityProfile}
                  onValueChange={(value) => setActivityProfile(value as ActivityProfile)}
                  disabled={isProcessing}
                >
                  <SelectTrigger
                    className={cn(
                      "h-auto px-3 py-1.5 text-sm rounded-lg",
                      "border-[var(--tropx-border)] bg-[var(--tropx-muted)]",
                      "text-[var(--tropx-text-main)]",
                      "hover:bg-[var(--tropx-hover)]",
                      "focus:ring-2 focus:ring-[var(--tropx-vibrant)] focus:ring-offset-0",
                      isProcessing && "opacity-50"
                    )}
                  >
                    <span>
                      {ACTIVITY_PROFILE_OPTIONS.find(o => o.value === activityProfile)?.label}
                      {autoDetectedProfile === activityProfile && <span className="text-[var(--tropx-shadow)] ml-1">- Auto</span>}
                    </span>
                  </SelectTrigger>
                  <SelectContent
                    position="popper"
                    side="bottom"
                    align="start"
                    sideOffset={4}
                    className={cn(
                      "z-[200] min-w-[140px]",
                      "bg-[var(--tropx-card)] border-[var(--tropx-border)]"
                    )}
                  >
                    {ACTIVITY_PROFILE_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className={cn(
                          "text-sm cursor-pointer",
                          "text-[var(--tropx-text-main)]",
                          "focus:bg-[var(--tropx-muted)] focus:text-[var(--tropx-text-main)]",
                          "data-[state=checked]:text-[var(--tropx-vibrant)]"
                        )}
                      >
                        {option.label}
                        {autoDetectedProfile === option.value && <span className="text-[var(--tropx-shadow)] ml-1">- Auto</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Notes */}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              rows={2}
              className="w-full px-3 py-2 border border-[var(--tropx-border)] bg-[var(--tropx-muted)] rounded-lg text-sm text-[var(--tropx-text-main)] placeholder-[var(--tropx-text-sub)] focus:outline-none focus:ring-2 focus:ring-[var(--tropx-vibrant)] focus:border-transparent resize-none"
              disabled={isProcessing}
            />

            {/* Upload Progress */}
            {isUploading && progress && (
              <div className="mt-3 p-3 bg-[var(--tropx-muted)] border border-[var(--tropx-border)] rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <CloudUpload className="size-4 text-[var(--tropx-vibrant)]" />
                    <span className="text-sm font-medium text-[var(--tropx-text-main)]">{progress.message}</span>
                  </div>
                  {progress.totalChunks > 0 && (
                    <span className="text-xs text-[var(--tropx-shadow)] tabular-nums">
                      {progress.currentChunk}/{progress.totalChunks}
                    </span>
                  )}
                </div>
                {progress.totalChunks > 0 && (
                  <div className="w-full bg-[var(--tropx-border)] rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--tropx-vibrant)] to-[var(--tropx-coral,#f97066)] transition-all duration-300"
                      style={{ width: `${(progress.currentChunk / progress.totalChunks) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Success/Error */}
            {saveSuccess && (
              <div className="mt-3 p-3 rounded-xl flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Saved successfully</span>
              </div>
            )}

            {saveError && (
              <div className="mt-3 p-3 rounded-xl flex items-center gap-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <AlertCircle className="size-5 text-red-600 dark:text-red-400" />
                <span className="text-sm font-medium text-red-700 dark:text-red-300">{saveError}</span>
              </div>
            )}

            {/* Bottom Row: Tags + Action Buttons */}
            <div className="flex items-start gap-2 mt-4">
              {/* Tags - left side */}
              <div className="flex-1 min-w-0">
                <TagsInput
                  value={tags}
                  onChange={setTags}
                  placeholder="Add tags... (exercise, session, etc...)"
                  disabled={isProcessing}
                />
              </div>
              {/* Action buttons - right side */}
              <div className="flex gap-2 shrink-0 self-start">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isProcessing}
                  className={cn(
                    'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                    'border border-[var(--tropx-border)] bg-[var(--tropx-muted)] text-[var(--tropx-text-main)]',
                    'hover:bg-[var(--tropx-hover)]',
                    isProcessing && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!canSave}
                  className={cn(
                    'px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2',
                    canSave
                      ? 'bg-[var(--tropx-vibrant)] text-white hover:bg-[var(--tropx-vibrant)]/90'
                      : 'bg-[var(--tropx-muted)] text-[var(--tropx-shadow)] cursor-not-allowed'
                  )}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </DialogPrimitive.Content>

          {/* Patient Search Modal */}
          {isPatientSearchOpen && (
            <div className="h-fit pointer-events-auto animate-[modal-bubble-in_0.15s_var(--spring-bounce)_forwards]">
              <PatientSearchModal
                open={isPatientSearchOpen}
                onOpenChange={setIsPatientSearchOpen}
                onSelectPatient={(patient) => {
                  onPatientSelect?.({ userId: patient.userId, name: patient.name, image: patient.image });
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
