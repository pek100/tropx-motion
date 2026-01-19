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
import { compressQuaternions } from '../../../../../shared/compression/index';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ActivityProfile = 'power' | 'endurance' | 'rehabilitation' | 'general';

export interface UploadOptions {
  subjectId?: Id<'users'>;
  subjectAlias?: string;
  title?: string;
  notes?: string;
  tags?: string[];
  activityProfile?: ActivityProfile;
  targetHz?: number;
  /** Crop range in ms - if specified, data outside this range is stored separately */
  cropRange?: { startMs: number; endMs: number };
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
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Compress trimmed samples into a blob for storage.
 * Combines left and right knee quaternions into a single compressed blob.
 * Format: [leftQuaternions compressed][rightQuaternions compressed]
 */
function compressTrimmedSamples(samples: UniformSample[]): ArrayBuffer | undefined {
  if (samples.length === 0) return undefined;

  // Extract quaternion values into flat arrays
  const leftValues: number[] = [];
  const rightValues: number[] = [];

  for (const s of samples) {
    if (s.lq) {
      leftValues.push(s.lq.w, s.lq.x, s.lq.y, s.lq.z);
    }
    if (s.rq) {
      rightValues.push(s.rq.w, s.rq.x, s.rq.y, s.rq.z);
    }
  }

  // Compress each leg separately
  const leftCompressed = leftValues.length > 0 ? compressQuaternions(leftValues) : new Uint8Array(0);
  const rightCompressed = rightValues.length > 0 ? compressQuaternions(rightValues) : new Uint8Array(0);

  // Combine into single blob with length headers
  // Format: [leftLength:4][leftData][rightLength:4][rightData]
  const totalLength = 4 + leftCompressed.length + 4 + rightCompressed.length;
  const combined = new Uint8Array(totalLength);
  const view = new DataView(combined.buffer);

  let offset = 0;
  view.setUint32(offset, leftCompressed.length, true);
  offset += 4;
  combined.set(leftCompressed, offset);
  offset += leftCompressed.length;
  view.setUint32(offset, rightCompressed.length, true);
  offset += 4;
  combined.set(rightCompressed, offset);

  return combined.buffer;
}

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
      let uniformSamples: UniformSample[] = alignedSamples.map(s => ({
        t: s.t,
        lq: s.lq,
        rq: s.rq,
        leftFlag: s.lq ? SampleFlag.REAL : SampleFlag.MISSING,
        rightFlag: s.rq ? SampleFlag.REAL : SampleFlag.MISSING,
      }));

      // Apply crop if specified - slice samples and compress trimmed portions
      let trimmedStartBlob: ArrayBuffer | undefined;
      let trimmedEndBlob: ArrayBuffer | undefined;
      let originalDurationMs: number | undefined;
      let originalSampleCount: number | undefined;

      if (options.cropRange && uniformSamples.length > 0) {
        const { startMs, endMs } = options.cropRange;
        const firstSampleTime = uniformSamples[0].t;
        const lastSampleTime = uniformSamples[uniformSamples.length - 1].t;

        // Store original metrics before cropping
        originalDurationMs = lastSampleTime - firstSampleTime;
        originalSampleCount = uniformSamples.length;

        // Find crop indices based on relative time
        const cropStartIndex = uniformSamples.findIndex(s => (s.t - firstSampleTime) >= startMs);
        const cropEndIndex = uniformSamples.findIndex(s => (s.t - firstSampleTime) > endMs);

        // Handle edge cases
        const startIdx = cropStartIndex === -1 ? 0 : cropStartIndex;
        const endIdx = cropEndIndex === -1 ? uniformSamples.length : cropEndIndex;

        // Extract and compress trimmed portions
        const trimmedStart = uniformSamples.slice(0, startIdx);
        const trimmedEnd = uniformSamples.slice(endIdx);

        if (trimmedStart.length > 0) {
          trimmedStartBlob = compressTrimmedSamples(trimmedStart);
          console.log(`[UploadService] Trimmed ${trimmedStart.length} samples from start`);
        }
        if (trimmedEnd.length > 0) {
          trimmedEndBlob = compressTrimmedSamples(trimmedEnd);
          console.log(`[UploadService] Trimmed ${trimmedEnd.length} samples from end`);
        }

        // Keep only cropped portion
        uniformSamples = uniformSamples.slice(startIdx, endIdx);

        // Rebase timestamps to start at 0
        if (uniformSamples.length > 0) {
          const newFirstTime = uniformSamples[0].t;
          uniformSamples = uniformSamples.map(s => ({
            ...s,
            t: s.t - newFirstTime,
          }));
        }

        console.log(`[UploadService] Cropped: ${originalSampleCount} → ${uniformSamples.length} samples`);

        if (uniformSamples.length === 0) {
          return {
            success: false,
            error: 'Crop range contains no samples',
          };
        }
      }

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
        title: options.title,
        notes: options.notes,
        tags: options.tags,
        subjectId: options.subjectId,
        subjectAlias: options.subjectAlias,
        activityProfile: options.activityProfile,
        // Crop: trimmed data stored separately for potential recovery
        trimmedStartBlob,
        trimmedEndBlob,
        originalDurationMs,
        originalSampleCount,
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
