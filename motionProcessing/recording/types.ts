/**
 * Types for recording module.
 */

import { Quaternion } from '../shared/types';

// ============================================================================
// Raw Recording Types (new)
// ============================================================================

/**
 * Raw per-device sample stored during recording.
 * Contains original device timestamp - no alignment or processing.
 */
export interface RawDeviceSample {
    deviceId: number;      // 0x11, 0x12, 0x21, 0x22
    timestamp: number;     // device timestamp (ms)
    quaternion: Quaternion;
}

/**
 * Intermediate result after aligning thigh and shin sensors within a joint.
 * Contains the computed relative quaternion (thigh^-1 * shin).
 */
export interface AlignedJointSample {
    timestamp: number;              // reference timestamp (from thigh sensor)
    relativeQuaternion: Quaternion; // thigh^-1 * shin
}

// ============================================================================
// Output Types (existing, moved from RecordingBuffer.ts)
// ============================================================================

/**
 * Recording sample with quaternion data for both knees.
 * This is the output format used by CSVExporter and UploadService.
 */
export interface QuaternionSample {
    t: number;              // timestamp (ms)
    lq: Quaternion | null;  // left knee relative quaternion
    rq: Quaternion | null;  // right knee relative quaternion
}

/** Recording metadata. */
export interface RecordingMetadata {
    startTime: number;
    endTime: number;
    sampleCount: number;
    targetHz: number;
}

/** Recording state for IPC queries. */
export interface RecordingState {
    isRecording: boolean;
    sampleCount: number;
    durationMs: number;
    startTime: number | null;
}
