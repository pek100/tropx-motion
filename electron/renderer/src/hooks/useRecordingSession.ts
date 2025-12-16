/**
 * useRecordingSession - React hook for loading and decoding recording sessions.
 *
 * Features:
 * - Fetch session from Convex
 * - Reassemble chunks
 * - Decode to angles
 * - Apply flag metadata
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import {
  PackedChunkData,
  AngleSample,
  UniformSample,
  mergeChunks,
  unpack,
  toAngles,
  unpackToAngles,
} from '../../../../shared/QuaternionCodec';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SessionMetadata {
  sessionId: string;
  owner: { _id: string; name?: string; email?: string; image?: string } | null;
  subject: { _id: string; name?: string; email?: string; image?: string } | null;
  subjectAlias?: string;
  notes?: string;
  tags?: string[];
  activeJoints: string[];
  sampleRate: number;
  totalChunks: number;
  startTime: number;
  endTime: number;
  totalSampleCount: number;
  durationMs: number;
  createdAt: number;
  isArchived?: boolean;
}

export interface LoadedSession {
  metadata: SessionMetadata;
  samples: UniformSample[];
  angles: AngleSample[];
}

export interface UseRecordingSessionReturn {
  // Session list
  sessions: SessionMetadata[];
  isLoadingSessions: boolean;

  // Single session
  loadedSession: LoadedSession | null;
  isLoadingSession: boolean;
  loadError: string | null;

  // Actions
  loadSession: (sessionId: string) => Promise<void>;
  clearSession: () => void;
}

// ─────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────

export function useRecordingSession(): UseRecordingSessionReturn {
  const [loadedSession, setLoadedSession] = useState<LoadedSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Fetch session list
  const sessionsQuery = useQuery(api.recordings.listMySessions, { limit: 50 });
  const isLoadingSessions = sessionsQuery === undefined;

  const sessions: SessionMetadata[] = useMemo(() => {
    if (!sessionsQuery) return [];

    return sessionsQuery.map((s) => ({
      sessionId: s.sessionId,
      owner: null, // List view doesn't include owner
      subject: null,
      subjectAlias: s.subjectAlias,
      notes: s.notes,
      tags: s.tags,
      activeJoints: s.activeJoints,
      sampleRate: s.sampleRate,
      totalChunks: s.totalChunks,
      startTime: s.startTime,
      endTime: s.endTime,
      totalSampleCount: s.totalSampleCount,
      durationMs: s.durationMs,
      createdAt: s.createdAt,
    }));
  }, [sessionsQuery]);

  // Fetch single session (triggered by loadSession)
  const sessionQuery = useQuery(
    api.recordings.getSession,
    currentSessionId ? { sessionId: currentSessionId } : 'skip'
  );

  // Process session data when it loads
  useMemo(() => {
    if (!sessionQuery || !currentSessionId) return;

    try {
      // Convert chunks to PackedChunkData format
      const packedChunks: PackedChunkData[] = sessionQuery.chunks.map((chunk) => ({
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        sampleRate: chunk.sampleRate,
        sampleCount: chunk.sampleCount,
        activeJoints: chunk.activeJoints,
        leftKneeQ: chunk.leftKneeQ,
        rightKneeQ: chunk.rightKneeQ,
        leftKneeInterpolated: chunk.leftKneeInterpolated,
        leftKneeMissing: chunk.leftKneeMissing,
        rightKneeInterpolated: chunk.rightKneeInterpolated,
        rightKneeMissing: chunk.rightKneeMissing,
      }));

      // Merge chunks
      const merged = mergeChunks(packedChunks);

      // Unpack to samples
      const samples = unpack(merged);

      // Convert to angles
      const angles = toAngles(samples);

      // Build metadata
      const metadata: SessionMetadata = {
        sessionId: sessionQuery.sessionId,
        owner: sessionQuery.owner,
        subject: sessionQuery.subject,
        subjectAlias: sessionQuery.subjectAlias,
        notes: sessionQuery.notes,
        tags: sessionQuery.tags,
        activeJoints: sessionQuery.activeJoints,
        sampleRate: sessionQuery.sampleRate,
        totalChunks: sessionQuery.totalChunks,
        startTime: sessionQuery.startTime,
        endTime: sessionQuery.endTime,
        totalSampleCount: sessionQuery.totalSampleCount,
        durationMs: sessionQuery.endTime - sessionQuery.startTime,
        createdAt: sessionQuery.createdAt,
        isArchived: sessionQuery.isArchived,
      };

      setLoadedSession({
        metadata,
        samples,
        angles,
      });
      setIsLoadingSession(false);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Failed to decode session'
      );
      setIsLoadingSession(false);
    }
  }, [sessionQuery, currentSessionId]);

  const loadSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setIsLoadingSession(true);
    setLoadError(null);
    setLoadedSession(null);
  }, []);

  const clearSession = useCallback(() => {
    setCurrentSessionId(null);
    setLoadedSession(null);
    setLoadError(null);
  }, []);

  return {
    sessions,
    isLoadingSessions,
    loadedSession,
    isLoadingSession,
    loadError,
    loadSession,
    clearSession,
  };
}

export default useRecordingSession;
