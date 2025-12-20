/**
 * Chunker - Splits uniform samples into compressed chunks for Convex upload.
 *
 * With compression (~23x), we can fit much larger chunks.
 * 5000 samples × 8 floats × 8 bytes = 320KB raw → ~14KB compressed
 */

import { UniformSample, pack, PackedChunkData } from '../../shared/QuaternionCodec';
import {
  compressQuaternions,
  downsampleQuaternions,
  COMPRESSION_VERSION,
} from '../../shared/compression';

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

export const SAMPLES_PER_CHUNK = 5000;
export const PREVIEW_POINTS = 100;

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface ChunkMetadata {
  sessionId: string;
  chunkIndex: number;
  totalChunks: number;
}

/** Legacy packed chunk (uncompressed). */
export interface PreparedChunk extends PackedChunkData, ChunkMetadata {}

/** Compressed chunk for new storage format. */
export interface CompressedChunk {
  sessionId: string;
  chunkIndex: number;
  startTime: number;
  endTime: number;
  sampleCount: number;

  // Compressed quaternion data
  leftKneeCompressed: Uint8Array | null;
  rightKneeCompressed: Uint8Array | null;

  // Sparse flags (kept uncompressed - small)
  leftKneeInterpolated: number[];
  leftKneeMissing: number[];
  rightKneeInterpolated: number[];
  rightKneeMissing: number[];

  compressionVersion: string;
}

/** Session data for creating the session record. */
export interface SessionData {
  sessionId: string;
  sampleRate: number;
  totalSamples: number;
  totalChunks: number;
  activeJoints: string[];
  startTime: number;
  endTime: number;

  // Preview quaternions (downsampled)
  leftKneePreview: number[] | null;
  rightKneePreview: number[] | null;

  compressionVersion: string;
}

export interface CompressedChunkingResult {
  session: SessionData;
  chunks: CompressedChunk[];
}

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
// Compressed Chunking (New)
// ─────────────────────────────────────────────────────────────────

/**
 * Split and compress uniform samples for upload.
 * Returns session data + compressed chunks.
 */
export function chunkAndCompress(
  samples: UniformSample[],
  sessionId?: string
): CompressedChunkingResult {
  const id = sessionId ?? generateSessionId();

  if (samples.length === 0) {
    return {
      session: {
        sessionId: id,
        sampleRate: 100,
        totalSamples: 0,
        totalChunks: 0,
        activeJoints: [],
        startTime: 0,
        endTime: 0,
        leftKneePreview: null,
        rightKneePreview: null,
        compressionVersion: COMPRESSION_VERSION,
      },
      chunks: [],
    };
  }

  const sampleRate = 100; // Assumed; could be passed as param
  const totalChunks = Math.ceil(samples.length / SAMPLES_PER_CHUNK);
  const chunks: CompressedChunk[] = [];

  // Determine active joints from first sample
  const activeJoints: string[] = [];
  if (samples[0].lq) activeJoints.push('left_knee');
  if (samples[0].rq) activeJoints.push('right_knee');

  // Collect all quaternion data for preview generation
  const allLeftQ: number[] = [];
  const allRightQ: number[] = [];

  // Process each chunk
  for (let i = 0; i < totalChunks; i++) {
    const start = i * SAMPLES_PER_CHUNK;
    const end = Math.min(start + SAMPLES_PER_CHUNK, samples.length);
    const chunkSamples = samples.slice(start, end);

    // Pack samples (get quaternion arrays + flags)
    const packed = pack(chunkSamples);

    // Accumulate for preview
    allLeftQ.push(...packed.leftKneeQ);
    allRightQ.push(...packed.rightKneeQ);

    // Compress quaternions
    let leftCompressed: Uint8Array | null = null;
    let rightCompressed: Uint8Array | null = null;

    if (packed.leftKneeQ.length > 0) {
      leftCompressed = compressQuaternions(packed.leftKneeQ);
    }
    if (packed.rightKneeQ.length > 0) {
      rightCompressed = compressQuaternions(packed.rightKneeQ);
    }

    chunks.push({
      sessionId: id,
      chunkIndex: i,
      startTime: packed.startTime,
      endTime: packed.endTime,
      sampleCount: packed.sampleCount,
      leftKneeCompressed: leftCompressed,
      rightKneeCompressed: rightCompressed,
      leftKneeInterpolated: packed.leftKneeInterpolated,
      leftKneeMissing: packed.leftKneeMissing,
      rightKneeInterpolated: packed.rightKneeInterpolated,
      rightKneeMissing: packed.rightKneeMissing,
      compressionVersion: COMPRESSION_VERSION,
    });
  }

  // Generate preview quaternions (downsampled)
  let leftPreview: number[] | null = null;
  let rightPreview: number[] | null = null;

  if (allLeftQ.length > 0) {
    const downsampled = downsampleQuaternions(allLeftQ, PREVIEW_POINTS);
    leftPreview = Array.from(downsampled);
  }
  if (allRightQ.length > 0) {
    const downsampled = downsampleQuaternions(allRightQ, PREVIEW_POINTS);
    rightPreview = Array.from(downsampled);
  }

  // Session timing from first and last chunks
  const startTime = chunks[0]?.startTime ?? 0;
  const endTime = chunks[chunks.length - 1]?.endTime ?? 0;

  return {
    session: {
      sessionId: id,
      sampleRate,
      totalSamples: samples.length,
      totalChunks,
      activeJoints,
      startTime,
      endTime,
      leftKneePreview: leftPreview,
      rightKneePreview: rightPreview,
      compressionVersion: COMPRESSION_VERSION,
    },
    chunks,
  };
}

// ─────────────────────────────────────────────────────────────────
// Legacy Chunking (Uncompressed) - For migration/backward compat
// ─────────────────────────────────────────────────────────────────

/**
 * Split uniform samples into chunks (legacy, uncompressed).
 * @deprecated Use chunkAndCompress for new uploads.
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

  // Use smaller chunk size for legacy uncompressed path
  const LEGACY_CHUNK_SIZE = 2000;
  const totalChunks = Math.ceil(samples.length / LEGACY_CHUNK_SIZE);
  const chunks: PreparedChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * LEGACY_CHUNK_SIZE;
    const end = Math.min(start + LEGACY_CHUNK_SIZE, samples.length);
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

// ─────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────

/**
 * Estimate compressed size for UI feedback.
 */
export function estimateCompressedSize(sampleCount: number): number {
  // ~1.5 bytes per sample after compression
  return Math.ceil(sampleCount * 1.5);
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

/**
 * Get compression statistics for a result.
 */
export function getCompressionStats(result: CompressedChunkingResult): {
  totalSamples: number;
  rawSizeBytes: number;
  compressedSizeBytes: number;
  compressionRatio: number;
} {
  let compressedSize = 0;
  for (const chunk of result.chunks) {
    if (chunk.leftKneeCompressed) {
      compressedSize += chunk.leftKneeCompressed.byteLength;
    }
    if (chunk.rightKneeCompressed) {
      compressedSize += chunk.rightKneeCompressed.byteLength;
    }
  }

  const rawSize = result.session.totalSamples * 8 * 8; // 8 floats × 8 bytes

  return {
    totalSamples: result.session.totalSamples,
    rawSizeBytes: rawSize,
    compressedSizeBytes: compressedSize,
    compressionRatio: compressedSize > 0 ? rawSize / compressedSize : 0,
  };
}
