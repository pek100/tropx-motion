// Import types from SDK
import {
    IMUData,
    Quaternion,
    Vector3D
} from '../../muse_sdk/core/MuseData';
import { SDKConnectionState } from '../../muse_sdk/types/types';

// Re-export SDK types for convenience
export type { IMUData, Vector3D, Quaternion, SDKConnectionState };

/**
 * Device sample with timestamped measurement data.
 * Includes interpolation flag to distinguish between raw and computed data points.
 */
export interface DeviceSample {
    deviceId: string;
    quaternion: Quaternion;
    timestamp: number;
    interpolated: boolean;
    batteryLevel?: number;
    connectionState?: SDKConnectionState;
}

export type DeviceData = DeviceSample;

/**
 * Interpolated data result from interpolation service.
 */
export interface InterpolatedData {
    deviceId: string;
    interpolatedQuaternion: Quaternion;
    confidence: number;
    interpolationMethod: 'none' | 'linear' | 'slerp';
    originalTimestamp: number;
    targetTimestamp: number;
}

/**
 * Calculated joint angle data with source device information.
 * Represents the final output of joint angle calculations.
 */
export interface JointAngleData {
    jointName: string;
    angle: number;
    timestamp: number;
    deviceIds: string[];
}

/**
 * Configuration for a specific joint defining sensor patterns and calibration.
 * Sensor patterns use regex to match device IDs to joint positions.
 */
export interface JointConfig {
    name: string;
    topSensorPattern: readonly string[];
    bottomSensorPattern: readonly string[];
    calibration?: { offset: number; multiplier: number };
}

/**
 * System-wide motion processing configuration.
 * Defines sampling rate, logging, and performance parameters.
 */
export interface MotionConfig {
    targetHz: number;
    logging: boolean;
    joints: JointConfig[];
    performance: {
        cacheSize: number;
        bypassInterpolation?: boolean;
        asyncNotify?: boolean;
    };
}

/**
 * Recording session context for data association.
 * Links recorded data to specific exercise sessions and sets.
 */
export interface SessionContext {
    sessionId: string;
    exerciseId: string;
    setNumber: number;
}

/**
 * UI-optimized joint data structure for real-time display.
 * Maintains current, min, max, and range of motion values.
 */
export interface UIJointData {
    current: number;
    max: number;
    min: number;
    rom: number;
    lastUpdate: number;
    devices: string[];
}

/**
 * Complete recording data structure for API communication.
 * Contains session metadata, joint summaries, and measurement sequences.
 */
export interface APIRecording {
    id: string;
    session_instance_id: string;
    exercise_instance_id: string;
    set: number;
    timestamp: string;
    duration?: number;
    reps_completed?: number;
    joints_arr: APIJoint[];
    measurement_sequences: APIMeasurement[];
}

/**
 * Joint summary data with statistical information for a recording session.
 */
export interface APIJoint {
    id: string;
    timestamp: string;
    joint_name: string;
    interval: number;
    max_flexion: number;
    min_flexion: number;
    max_extension: number;
    min_extension: number;
}

/**
 * Time-series measurement data for a specific joint.
 * Contains array of angle values recorded during session.
 */
export interface APIMeasurement {
    joint_id: string;
    start_time: string;
    values: number[];
}