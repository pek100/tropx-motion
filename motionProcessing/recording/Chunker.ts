/**
 * Chunker - Splits uniform samples into chunks for Convex upload.
 *
 * Chunk size: 6000 samples (1 minute @ 100Hz)
 * Each chunk: ~384KB of quaternion data
 */

import { UniformSample, pack, PackedChunkData } from '../../shared/QuaternionCodec';

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const SAMPLES_PER_CHUNK = 6000;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  sessionId: string;
  chunkIndex: number;
  totalChunks: number;
}

export interface PreparedChunk extends PackedChunkData, ChunkMetadata {}

export interface ChunkingResult {
  chunks: PreparedChunk[];
  sessionId: string;
  totalChunks: number;
  totalSamples: number;
}

// ─────────────────────────────────────────────────────────────────
// Session ID Generation
// ─────────────────────────────────────────────────────────────────

/**
 * Generate a unique session ID.
 * Format: session_{timestamp}_{random}
 */
export function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `session_${timestamp}_${random}`;
}

// ─────────────────────────────────────────────────────────────────
// Chunking
// ─────────────────────────────────────────────────────────────────

/**
 * Split uniform samples into chunks.
 * @param samples Uniform samples to chunk
 * @param sessionId Optional session ID (generated if not provided)
 * @returns Chunking result with prepared chunks
 */
export function chunkSamples(
  samples: UniformSample[],
  sessionId?: string
): ChunkingResult {
  const id = sessionId ?? generateSessionId();

  if (samples.length === 0) {
    return {
      chunks: [],
      sessionId: id,
      totalChunks: 0,
      totalSamples: 0,
    };
  }

  const totalChunks = Math.ceil(samples.length / SAMPLES_PER_CHUNK);
  const chunks: PreparedChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * SAMPLES_PER_CHUNK;
    const end = Math.min(start + SAMPLES_PER_CHUNK, samples.length);
    const chunkSamples = samples.slice(start, end);

    const packed = pack(chunkSamples);

    chunks.push({
      ...packed,
      sessionId: id,
      chunkIndex: i,
      totalChunks,
    });
  }

  return {
    chunks,
    sessionId: id,
    totalChunks,
    totalSamples: samples.length,
  };
}

/**
 * Estimate the size of a packed chunk in bytes.
 * Useful for planning uploads and checking Convex limits.
 */
export function estimateChunkSize(chunk: PackedChunkData): number {
  // Base metadata overhead (rough estimate)
  let size = 200;

  // Quaternion arrays: 4 floats × 8 bytes × sampleCount
  size += chunk.leftKneeQ.length * 8;
  size += chunk.rightKneeQ.length * 8;

  // Flag arrays (integers, ~4 bytes each)
  size += chunk.leftKneeInterpolated.length * 4;
  size += chunk.leftKneeMissing.length * 4;
  size += chunk.rightKneeInterpolated.length * 4;
  size += chunk.rightKneeMissing.length * 4;

  return size;
}

/**
 * Calculate expected chunk count for a given duration.
 */
export function calculateChunkCount(
  durationMs: number,
  sampleRate: number = 100
): number {
  const totalSamples = Math.ceil((durationMs / 1000) * sampleRate);
  return Math.ceil(totalSamples / SAMPLES_PER_CHUNK);
}
