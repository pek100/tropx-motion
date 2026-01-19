/**
 * SessionLoader - Centralized session data loading.
 *
 * This is the SINGLE SOURCE OF TRUTH for loading session data.
 * All code paths that need session samples MUST use this module.
 *
 * Features:
 * - Fetches session and chunks from Convex
 * - Decompresses quaternion data
 * - Supports caching via SyncProvider
 */

import { ConvexClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import {
  mergeChunks,
  unpack,
  toAngles,
  type PackedChunkData,
  type MergedPackedData,
  type UniformSample,
  type AngleSample,
} from "../../../../../shared/QuaternionCodec";
import {
  decompressAllChunks,
  type CompressedChunk,
  type SessionMetadata as CompressionSessionMeta,
} from "../../../../../shared/compression/decompressSession";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface SessionMetadata {
  sessionId: string;
  sampleRate: number;
  totalChunks: number;
  startTime: number;
  endTime: number;
  activeJoints: string[];
  /** Duration in ms */
  durationMs: number;
  /** Sample count */
  sampleCount: number;
  /** Additional session fields from database */
  subjectAlias?: string;
  notes?: string;
  tags?: string[];
  isArchived?: boolean;
  createdAt?: number;
}

export interface LoadedSessionData {
  metadata: SessionMetadata;
  /** Merged packed data (quaternions) */
  packed: MergedPackedData;
  /** Unpacked uniform samples */
  samples: UniformSample[];
  /** Angle samples */
  angles: AngleSample[];
}

export interface LoadSessionOptions {
  /** Optional sync cache for faster loads */
  syncCache?: {
    getQuery: (key: string) => unknown;
    setQuery: (key: string, value: unknown) => void;
  };
}

// ─────────────────────────────────────────────────────────────────
// Core Loading Function
// ─────────────────────────────────────────────────────────────────

/**
 * Load session data from Convex.
 *
 * This is the centralized function for loading session data.
 * Data is returned as-is from storage (cropping happens at save time).
 */
export async function loadSessionData(
  convex: ConvexClient,
  sessionId: string,
  options: LoadSessionOptions = {}
): Promise<LoadedSessionData | null> {
  const { syncCache } = options;

  // Check cache first
  const cacheKey = `recordingChunks:getSessionWithChunks:${JSON.stringify({ sessionId })}`;
  let result = syncCache?.getQuery(cacheKey) as { session: any; chunks: any[] } | undefined | null;

  // Fetch from Convex if not cached
  if (!result) {
    result = await convex.query(api.recordingChunks.getSessionWithChunks, { sessionId }) as { session: any; chunks: any[] } | null;
    // Cache the result
    if (result && syncCache) {
      syncCache.setQuery(cacheKey, result);
    }
  }

  if (!result || !result.chunks || result.chunks.length === 0) {
    return null;
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

  // Calculate duration
  const durationMs = session.endTime - session.startTime;

  const metadata: SessionMetadata = {
    sessionId: session.sessionId,
    sampleRate: session.sampleRate,
    totalChunks: session.totalChunks,
    startTime: session.startTime,
    endTime: session.endTime,
    activeJoints: session.activeJoints,
    durationMs,
    sampleCount: samples.length,
    // Additional session fields
    subjectAlias: session.subjectAlias,
    notes: session.notes,
    tags: session.tags,
    isArchived: session.isArchived,
    createdAt: session._creationTime,
  };

  return {
    metadata,
    packed: merged,
    samples,
    angles,
  };
}

// ─────────────────────────────────────────────────────────────────
// Convenience Exports
// ─────────────────────────────────────────────────────────────────

export { type MergedPackedData, type UniformSample, type AngleSample };
