/**
 * Session Decompression Utilities
 *
 * Provides functions to decompress compressed recording chunks
 * and convert them to the PackedChunkData format used by the UI.
 */

import { decompressQuaternions } from './index';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Compressed chunk as returned from Convex recordingChunks table */
export interface CompressedChunk {
  sessionId: string;
  chunkIndex: number;
  startTime: number;
  endTime: number;
  sampleCount: number;
  leftKneeCompressed?: ArrayBuffer;
  rightKneeCompressed?: ArrayBuffer;
  leftKneeInterpolated: number[];
  leftKneeMissing: number[];
  rightKneeInterpolated: number[];
  rightKneeMissing: number[];
  compressionVersion: string;
}

/** Decompressed chunk in PackedChunkData format */
export interface DecompressedChunk {
  startTime: number;
  endTime: number;
  sampleRate: number;
  sampleCount: number;
  activeJoints: string[];
  leftKneeQ: number[];
  rightKneeQ: number[];
  leftKneeInterpolated: number[];
  leftKneeMissing: number[];
  rightKneeInterpolated: number[];
  rightKneeMissing: number[];
}

/** Session metadata from sessions table */
export interface SessionMetadata {
  sessionId: string;
  sampleRate: number;
  totalSamples: number;
  totalChunks: number;
  activeJoints: string[];
  startTime: number;
  endTime: number;
}

// ─────────────────────────────────────────────────────────────────
// Decompression Functions
// ─────────────────────────────────────────────────────────────────

/**
 * Decompress a single chunk.
 *
 * @param chunk Compressed chunk from Convex
 * @param session Session metadata for sample rate and active joints
 * @returns Decompressed chunk in PackedChunkData format
 * @throws Error if decompression fails
 */
export function decompressChunk(
  chunk: CompressedChunk,
  session: SessionMetadata
): DecompressedChunk {
  let leftKneeQ: number[] = [];
  let rightKneeQ: number[] = [];

  // Decompress left knee if present
  if (chunk.leftKneeCompressed) {
    const bytes = new Uint8Array(chunk.leftKneeCompressed);
    const decompressed = decompressQuaternions(bytes);
    leftKneeQ = Array.from(decompressed);
  }

  // Decompress right knee if present
  if (chunk.rightKneeCompressed) {
    const bytes = new Uint8Array(chunk.rightKneeCompressed);
    const decompressed = decompressQuaternions(bytes);
    rightKneeQ = Array.from(decompressed);
  }

  return {
    startTime: chunk.startTime,
    endTime: chunk.endTime,
    sampleRate: session.sampleRate,
    sampleCount: chunk.sampleCount,
    activeJoints: session.activeJoints,
    leftKneeQ,
    rightKneeQ,
    leftKneeInterpolated: chunk.leftKneeInterpolated,
    leftKneeMissing: chunk.leftKneeMissing,
    rightKneeInterpolated: chunk.rightKneeInterpolated,
    rightKneeMissing: chunk.rightKneeMissing,
  };
}

/**
 * Decompress all chunks for a session.
 *
 * @param chunks Compressed chunks from Convex (should be sorted by chunkIndex)
 * @param session Session metadata
 * @returns Array of decompressed chunks
 * @throws Error if any chunk fails to decompress
 */
export function decompressAllChunks(
  chunks: CompressedChunk[],
  session: SessionMetadata
): DecompressedChunk[] {
  return chunks.map((chunk) => decompressChunk(chunk, session));
}

/**
 * Decompress session with progress callback.
 *
 * @param chunks Compressed chunks
 * @param session Session metadata
 * @param onProgress Optional progress callback (0-100)
 * @returns Array of decompressed chunks
 */
export async function decompressWithProgress(
  chunks: CompressedChunk[],
  session: SessionMetadata,
  onProgress?: (percent: number) => void
): Promise<DecompressedChunk[]> {
  const results: DecompressedChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    results.push(decompressChunk(chunks[i], session));

    if (onProgress) {
      onProgress(Math.round(((i + 1) / chunks.length) * 100));
    }

    // Yield to event loop periodically for large sessions
    if (i % 10 === 0 && i > 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return results;
}

/**
 * Check if a chunk is using the compressed format.
 */
export function isCompressedChunk(chunk: unknown): chunk is CompressedChunk {
  if (!chunk || typeof chunk !== 'object') return false;
  const c = chunk as Record<string, unknown>;
  return (
    'compressionVersion' in c &&
    typeof c.compressionVersion === 'string' &&
    ('leftKneeCompressed' in c || 'rightKneeCompressed' in c)
  );
}
