/**
 * UploadService - Orchestrates recording upload to Convex with compression.
 *
 * Pipeline:
 * 1. Get samples from RecordingBuffer
 * 2. Resample to uniform rate (fill gaps)
 * 3. Compress and chunk
 * 4. Create session with preview
 * 5. Upload compressed chunks
 */

import { ConvexClient } from 'convex/browser';
import { api } from '../../../../../convex/_generated/api';
import { Id } from '../../../../../convex/_generated/dataModel';
import { RawDeviceSample, QuaternionSample } from '../../../../../motionProcessing/recording/types';
import { GridSnapService } from '../../../../../motionProcessing/recording/GridSnapService';
import { InterpolationService } from '../../../../../motionProcessing/recording/InterpolationService';
import { UniformSample, SampleFlag } from '../../../../../shared/QuaternionCodec';
import {
  chunkAndCompress,
  generateSessionId,
  getCompressionStats,
} from '../../../../../motionProcessing/recording/Chunker';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ActivityProfile = 'power' | 'endurance' | 'rehabilitation' | 'general';

export interface UploadOptions {
  subjectId?: Id<'users'>;
  subjectAlias?: string;
  notes?: string;
  tags?: string[];
  activityProfile?: ActivityProfile;
  targetHz?: number;
}

export interface UploadProgress {
  phase: 'processing' | 'compressing' | 'uploading' | 'complete' | 'error';
  currentChunk: number;
  totalChunks: number;
  message: string;
  compressionRatio?: number;
}

export type ProgressCallback = (progress: UploadProgress) => void;

export interface UploadResult {
  success: boolean;
  sessionId?: string;
  totalChunks?: number;
  totalSamples?: number;
  rawSampleCount?: number;
  alignedSampleCount?: number;
  error?: string;
  compressionStats?: {
    rawSizeBytes: number;
    compressedSizeBytes: number;
    compressionRatio: number;
  };
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
   * Upload a recording to Convex with compression.
   * @param rawSamples Raw per-device samples from RecordingBuffer
   * @param options Upload options (metadata)
   * @param onProgress Optional progress callback
   */
  async upload(
    rawSamples: RawDeviceSample[],
    options: UploadOptions = {},
    onProgress?: ProgressCallback
  ): Promise<UploadResult> {
    const targetHz = options.targetHz ?? DEFAULT_TARGET_HZ;
    const sessionId = generateSessionId();

    try {
      // Phase 1: Processing - align and interpolate raw samples
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

      // Process raw samples: snap to grid → interpolate → relative quaternions
      const gridData = GridSnapService.snap(rawSamples, targetHz);

      if (gridData.gridPoints.length === 0) {
        return {
          success: false,
          error: 'Grid alignment failed - ensure sensors are connected',
        };
      }

      const alignedSamples = InterpolationService.interpolate(gridData);

      if (alignedSamples.length === 0) {
        return {
          success: false,
          error: 'Interpolation failed - ensure both thigh and shin sensors are connected per joint',
        };
      }

      console.log(`[UploadService] Processed ${rawSamples.length} raw → ${alignedSamples.length} samples at ${targetHz}Hz`);

      // Convert to UniformSample format for Chunker
      const uniformSamples: UniformSample[] = alignedSamples.map(s => ({
        t: s.t,
        lq: s.lq,
        rq: s.rq,
        leftFlag: s.lq ? SampleFlag.REAL : SampleFlag.MISSING,
        rightFlag: s.rq ? SampleFlag.REAL : SampleFlag.MISSING,
      }));

      // Phase 2: Compress and chunk
      onProgress?.({
        phase: 'compressing',
        currentChunk: 0,
        totalChunks: 0,
        message: 'Compressing data...',
      });

      const compressed = chunkAndCompress(uniformSamples, sessionId);
      const compressionStats = getCompressionStats(compressed);

      if (compressed.chunks.length === 0) {
        return {
          success: false,
          error: 'Compression produced no chunks',
        };
      }

      onProgress?.({
        phase: 'compressing',
        currentChunk: 0,
        totalChunks: compressed.session.totalChunks,
        message: `Compressed ${compressionStats.compressionRatio.toFixed(1)}x`,
        compressionRatio: compressionStats.compressionRatio,
      });

      // Phase 3: Create session first
      onProgress?.({
        phase: 'uploading',
        currentChunk: 0,
        totalChunks: compressed.session.totalChunks,
        message: 'Creating session...',
      });

      await this.convex.mutation(api.recordingSessions.createSession, {
        sessionId: compressed.session.sessionId,
        sampleRate: compressed.session.sampleRate,
        totalSamples: compressed.session.totalSamples,
        totalChunks: compressed.session.totalChunks,
        activeJoints: compressed.session.activeJoints,
        startTime: compressed.session.startTime,
        endTime: compressed.session.endTime,
        leftKneePreview: compressed.session.leftKneePreview ?? undefined,
        rightKneePreview: compressed.session.rightKneePreview ?? undefined,
        notes: options.notes,
        tags: options.tags,
        subjectId: options.subjectId,
        subjectAlias: options.subjectAlias,
        activityProfile: options.activityProfile,
      });

      // Phase 4: Upload compressed chunks
      for (let i = 0; i < compressed.chunks.length; i++) {
        const chunk = compressed.chunks[i];

        onProgress?.({
          phase: 'uploading',
          currentChunk: i + 1,
          totalChunks: compressed.session.totalChunks,
          message: `Uploading chunk ${i + 1} of ${compressed.session.totalChunks}...`,
          compressionRatio: compressionStats.compressionRatio,
        });

        // Convert Uint8Array to ArrayBuffer for Convex bytes type
        let leftBytes: ArrayBuffer | undefined;
        if (chunk.leftKneeCompressed) {
          const copy = new Uint8Array(chunk.leftKneeCompressed.length);
          copy.set(chunk.leftKneeCompressed);
          leftBytes = copy.buffer;
        }
        let rightBytes: ArrayBuffer | undefined;
        if (chunk.rightKneeCompressed) {
          const copy = new Uint8Array(chunk.rightKneeCompressed.length);
          copy.set(chunk.rightKneeCompressed);
          rightBytes = copy.buffer;
        }

        await this.convex.mutation(api.recordingChunks.createChunk, {
          sessionId: chunk.sessionId,
          chunkIndex: chunk.chunkIndex,
          startTime: chunk.startTime,
          endTime: chunk.endTime,
          sampleCount: chunk.sampleCount,
          leftKneeCompressed: leftBytes,
          rightKneeCompressed: rightBytes,
          leftKneeInterpolated: chunk.leftKneeInterpolated,
          leftKneeMissing: chunk.leftKneeMissing,
          rightKneeInterpolated: chunk.rightKneeInterpolated,
          rightKneeMissing: chunk.rightKneeMissing,
        });
      }

      // Complete
      onProgress?.({
        phase: 'complete',
        currentChunk: compressed.session.totalChunks,
        totalChunks: compressed.session.totalChunks,
        message: 'Upload complete',
        compressionRatio: compressionStats.compressionRatio,
      });

      return {
        success: true,
        sessionId,
        totalChunks: compressed.session.totalChunks,
        totalSamples: compressed.session.totalSamples,
        rawSampleCount: rawSamples.length,
        alignedSampleCount: alignedSamples.length,
        compressionStats: {
          rawSizeBytes: compressionStats.rawSizeBytes,
          compressedSizeBytes: compressionStats.compressedSizeBytes,
          compressionRatio: compressionStats.compressionRatio,
        },
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
}
