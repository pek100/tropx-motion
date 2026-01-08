/**
 * Types and constants for batch synchronization system.
 * Handles temporal alignment of multi-sensor IMU data.
 */

import { Quaternion } from '../shared/types';
import { DeviceID } from '../../ble-management';

// ============================================================================
// Constants
// ============================================================================

export const SYNC_CONFIG = {
    MAX_BUFFER_SIZE: 100,           // Safety limit per sensor buffer
    MIN_SAMPLES_FOR_ALIGNMENT: 2,   // Minimum samples needed to compute alignment
    STALE_SAMPLE_TIMEOUT_MS: 500,   // Discard samples older than this
} as const;

export enum DevicePosition {
    THIGH = 'thigh',
    SHIN = 'shin',
}

export enum JointSide {
    LEFT = 'left',
    RIGHT = 'right',
}

// Device ID to position/joint mapping (matches ble-management/types.ts DeviceID enum)
// Upper nibble: joint (1=left, 2=right), Lower nibble: position (1=shin, 2=thigh)
export const DEVICE_MAPPING: Record<number, { joint: JointSide; position: DevicePosition }> = {
    0x11: { joint: JointSide.LEFT, position: DevicePosition.SHIN },
    0x12: { joint: JointSide.LEFT, position: DevicePosition.THIGH },
    0x21: { joint: JointSide.RIGHT, position: DevicePosition.SHIN },
    0x22: { joint: JointSide.RIGHT, position: DevicePosition.THIGH },
};

// ============================================================================
// Core Sample Types
// ============================================================================

/** Single timestamped quaternion sample from a sensor */
export interface Sample {
    timestamp: number;
    quaternion: Quaternion;
}

/** Samples from thigh and/or shin sensors for a joint (either or both) */
export interface JointSamples {
    thigh?: Sample;
    shin?: Sample;
}

/** Output from batch synchronizer - aligned samples from all active sensors */
export interface AlignedSampleSet {
    timestamp: number;              // MAX timestamp from aligned samples
    leftKnee?: JointSamples;        // Present if left knee sensors active
    rightKnee?: JointSamples;       // Present if right knee sensors active
}

// ============================================================================
// Alignment State Types
// ============================================================================

/** Alignment offset computed between two buffers */
export interface AlignmentOffset {
    offsetIndex: number;            // How many indices to shift buffer B to align with A
    referenceTimestamp: number;     // Timestamp used as alignment reference
    valid: boolean;                 // Whether alignment could be computed
}

/** Range of valid aligned indices */
export interface AlignedRange {
    startIndex: number;
    endIndex: number;
    size: number;
}

// ============================================================================
// Debug/Stats Types
// ============================================================================

export interface BufferStats {
    deviceId: number;
    size: number;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
}

export interface SyncDebugStats {
    buffers: BufferStats[];
    leftKneeAligned: boolean;
    rightKneeAligned: boolean;
    globalAligned: boolean;
    scanWindowPosition: number;
    outputCount: number;
}

// ============================================================================
// Callback Types
// ============================================================================

export type AlignedSampleCallback = (samples: AlignedSampleSet) => void;
