/**
 * UploadService - Orchestrates recording upload to Convex.
 *
 * Pipeline:
 * 1. Get samples from RecordingBuffer
 * 2. Resample to uniform rate (fill gaps)
 * 3. Pack into chunks
 * 4. Upload chunks to Convex
 * 5. Upload raw chunks (for debugging)
 */

import { ConvexClient } from 'convex/browser';
import { api } from '../../../../../convex/_generated/api';
import { Id } from '../../../../../convex/_generated/dataModel';
import {
  QuaternionSample,
  UniformSample,
  pack,
  PackedChunkData,
} from '../../../../../shared/QuaternionCodec';
import {
  resample,
  ResampleResult,
} from '../../../../../motionProcessing/recording/GapFiller';
import {
  chunkSamples,
  generateSessionId,
  PreparedChunk,
  SAMPLES_PER_CHUNK,
} from '../../../../../motionProcessing/recording/Chunker';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface UploadOptions {
  subjectId?: Id<'users'>;
  subjectAlias?: string;
  notes?: string;
  tags?: string[];
  targetHz?: number;
}

export interface UploadProgress {
  phase: 'processing' | 'uploading' | 'complete' | 'error';
  currentChunk: number;
  totalChunks: number;
  message: string;
}

export type ProgressCallback = (progress: UploadProgress) => void;

export interface UploadResult {
  success: boolean;
  sessionId?: string;
  totalChunks?: number;
  totalSamples?: number;
  error?: string;
  stats?: ResampleResult['stats'];
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const DEFAULT_TARGET_HZ = 100;

// ─────────────────────────────────────────────────────────────────
// Upload Service
// ─────────────────────────────────────────────────────────────────

export class UploadService {
  private convex: ConvexClient;

  constructor(convexClient: ConvexClient) {
    this.convex = convexClient;
  }

  /**
   * Upload a recording to Convex.
   * @param rawSamples Raw quaternion samples from RecordingBuffer
   * @param options Upload options (metadata)
   * @param onProgress Optional progress callback
   */
  async upload(
    rawSamples: QuaternionSample[],
    options: UploadOptions = {},
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const targetHz = options.targetHz ?? DEFAULT_TARGET_HZ;
    const sessionId = generateSessionId();

    try {
      // Phase 1: Processing
      onProgress?.({
        phase: 'processing',
        currentChunk: 0,
        totalChunks: 0,
        message: 'Processing recording...',
      });

      if (rawSamples.length === 0) {
        return {
          success: false,
          error: 'No samples to upload',
        };
      }

      // Resample to uniform rate
      const resampleResult = resample(rawSamples, { targetHz });
      const uniformSamples = resampleResult.samples;

      if (uniformSamples.length === 0) {
        return {
          success: false,
          error: 'Resampling produced no samples',
        };
      }

      // Chunk the samples
      const { chunks, totalChunks, totalSamples } = chunkSamples(
        uniformSamples,
        sessionId
      );

      if (chunks.length === 0) {
        return {
          success: false,
          error: 'Chunking produced no chunks',
        };
      }

      // Phase 2: Upload processed chunks
      onProgress?.({
        phase: 'uploading',
        currentChunk: 0,
        totalChunks,
        message: `Uploading chunk 1 of ${totalChunks}...`,
      });

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        await this.convex.mutation(api.recordings.createChunk, {
          sessionId: chunk.sessionId,
          chunkIndex: chunk.chunkIndex,
          totalChunks: chunk.totalChunks,
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
          // Metadata only on first chunk
          ...(i === 0
            ? {
                subjectId: options.subjectId,
                subjectAlias: options.subjectAlias,
                notes: options.notes,
                tags: options.tags,
              }
            : {}),
        });

        onProgress?.({
          phase: 'uploading',
          currentChunk: i + 1,
          totalChunks,
          message: `Uploaded chunk ${i + 1} of ${totalChunks}`,
        });
      }

      // Phase 3: Upload raw chunks (for debugging)
      await this.uploadRawChunks(rawSamples, sessionId);

      // Complete
      onProgress?.({
        phase: 'complete',
        currentChunk: totalChunks,
        totalChunks,
        message: 'Upload complete',
      });

      return {
        success: true,
        sessionId,
        totalChunks,
        totalSamples,
        stats: resampleResult.stats,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      onProgress?.({
        phase: 'error',
        currentChunk: 0,
        totalChunks: 0,
        message: errorMessage,
      });

      return {
        success: false,
        sessionId,
        error: errorMessage,
      };
    }
  }

  /**
   * Upload raw samples for debugging (2-week TTL).
   */
  private async uploadRawChunks(
    rawSamples: QuaternionSample[],
    sessionId: string
  ): Promise<void> {
    const totalChunks = Math.ceil(rawSamples.length / SAMPLES_PER_CHUNK);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * SAMPLES_PER_CHUNK;
      const end = Math.min(start + SAMPLES_PER_CHUNK, rawSamples.length);
      const chunkSamples = rawSamples.slice(start, end);

      // Convert to raw format
      const samples = chunkSamples.map((s) => ({
        t: s.t,
        lq: s.lq ?? undefined,
        rq: s.rq ?? undefined,
      }));

      await this.convex.mutation(api.rawRecordings.createChunk, {
        sessionId,
        chunkIndex: i,
        totalChunks,
        samples,
      });
    }
  }
}
