/**
 * useRecordingSession - React hook for loading and decoding recording sessions.
 *
 * Features:
 * - Fetch session from Convex
 * - Decompress and reassemble chunks
 * - Decode to angles
 * - Apply flag metadata
 */

import { useState, useCallback, useMemo } from 'react';
import { useConvex, useQuery, useSyncOptional } from '@/lib/customConvex';
import { api } from '../../../../convex/_generated/api';
import type { AngleSample, UniformSample } from '../../../../shared/QuaternionCodec';
import { loadSessionData as loadSessionDataCentral } from '@/lib/recording/SessionLoader';

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
  const convex = useConvex();
  const sync = useSyncOptional();
  const [loadedSession, setLoadedSession] = useState<LoadedSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch session list (no limit - SyncProvider caches with {} args)
  const sessionsQuery = useQuery(api.recordingSessions.listMySessions, {});
  const isLoadingSessions = sessionsQuery === undefined;

  const sessions: SessionMetadata[] = useMemo(() => {
    // Defensive: check it's an array before mapping
    if (!Array.isArray(sessionsQuery)) return [];

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
      createdAt: s._creationTime,
    }));
  }, [sessionsQuery]);

  const loadSession = useCallback(async (sessionId: string) => {
    setIsLoadingSession(true);
    setLoadError(null);
    setLoadedSession(null);

    try {
      // Use centralized SessionLoader
      const result = await loadSessionDataCentral(
        convex as unknown as import("convex/browser").ConvexClient,
        sessionId,
        {
          syncCache: sync ? {
            getQuery: (key) => sync.getQuery(key),
            setQuery: (key, value) => sync.setQuery(key, value),
          } : undefined,
        }
      );

      if (!result) {
        throw new Error('Session not found or empty');
      }

      // Map SessionLoader metadata to hook's SessionMetadata format
      const metadata: SessionMetadata = {
        sessionId: result.metadata.sessionId,
        owner: null,
        subject: null,
        subjectAlias: result.metadata.subjectAlias,
        notes: result.metadata.notes,
        tags: result.metadata.tags,
        activeJoints: result.metadata.activeJoints,
        sampleRate: result.metadata.sampleRate,
        totalChunks: result.metadata.totalChunks,
        startTime: result.metadata.startTime,
        endTime: result.metadata.endTime,
        totalSampleCount: result.metadata.sampleCount,
        durationMs: result.metadata.durationMs,
        createdAt: result.metadata.createdAt ?? result.metadata.startTime,
        isArchived: result.metadata.isArchived,
      };

      setLoadedSession({
        metadata,
        samples: result.samples,
        angles: result.angles,
      });
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Failed to load session'
      );
    } finally {
      setIsLoadingSession(false);
    }
  }, [convex, sync]);

  const clearSession = useCallback(() => {
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
