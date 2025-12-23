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
import { useConvex } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { useSyncedQuery, useCacheOptional, cacheQuery } from '../lib/cache';
import {
  PackedChunkData,
  AngleSample,
  UniformSample,
  mergeChunks,
  unpack,
  toAngles,
} from '../../../../shared/QuaternionCodec';
import {
  decompressAllChunks,
  type CompressedChunk,
  type SessionMetadata as CompressionSessionMeta,
} from '../../../../shared/compression/decompressSession';

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
  const cache = useCacheOptional();
  const [loadedSession, setLoadedSession] = useState<LoadedSession | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch session list (synced with timestamps)
  const { data: sessionsQuery, isLoading: isLoadingSessions } = useSyncedQuery(
    api.recordingSessions.listMySessions,
    { limit: 50 },
    { timestamps: api.sync.getSessionTimestamps }
  );

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
      // Fetch session with compressed chunks (cached for offline)
      const { data: result } = await cacheQuery(
        cache?.store ?? null,
        "recordingChunks.getSessionWithChunks",
        { sessionId },
        () => convex.query(api.recordingChunks.getSessionWithChunks, { sessionId })
      );

      if (!result || result.chunks.length === 0) {
        throw new Error('Session not found or empty');
      }

      const { session, chunks } = result;

      // Build session metadata for decompression
      const sessionMeta: CompressionSessionMeta = {
        sessionId: session.sessionId,
        sampleRate: session.sampleRate,
        totalSamples: session.totalSamples,
        totalChunks: session.totalChunks,
        activeJoints: session.activeJoints,
        startTime: session.startTime,
        endTime: session.endTime,
      };

      // Decompress all chunks
      const decompressedChunks = decompressAllChunks(
        chunks as CompressedChunk[],
        sessionMeta
      );

      // Convert to PackedChunkData format
      const packedChunks: PackedChunkData[] = decompressedChunks.map((chunk) => ({
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
        sessionId: session.sessionId,
        owner: null, // Would need separate query
        subject: null,
        subjectAlias: session.subjectAlias,
        notes: session.notes,
        tags: session.tags,
        activeJoints: session.activeJoints,
        sampleRate: session.sampleRate,
        totalChunks: session.totalChunks,
        startTime: session.startTime,
        endTime: session.endTime,
        totalSampleCount: session.totalSamples,
        durationMs: session.endTime - session.startTime,
        createdAt: session._creationTime,
        isArchived: session.isArchived,
      };

      setLoadedSession({
        metadata,
        samples,
        angles,
      });
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Failed to load session'
      );
    } finally {
      setIsLoadingSession(false);
    }
  }, [convex, cache?.store]);

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
