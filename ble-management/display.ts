/**
 * Display Helpers
 * String representations for UI - only place strings are used
 */

import { DeviceID, ALL_DEVICE_IDS } from './types';
import { isLeftJoint, isShin, isThigh, getPartnerDevice, getSortOrder } from './operations';

const DEVICE_NAMES: Record<DeviceID, string> = {
  [DeviceID.LEFT_SHIN]: 'Left Shin',
  [DeviceID.LEFT_THIGH]: 'Left Thigh',
  [DeviceID.RIGHT_SHIN]: 'Right Shin',
  [DeviceID.RIGHT_THIGH]: 'Right Thigh',
};

const SHORT_NAMES: Record<DeviceID, string> = {
  [DeviceID.LEFT_SHIN]: 'L-Shin',
  [DeviceID.LEFT_THIGH]: 'L-Thigh',
  [DeviceID.RIGHT_SHIN]: 'R-Shin',
  [DeviceID.RIGHT_THIGH]: 'R-Thigh',
};

const JOINT_NAMES = {
  left: 'Left Knee',
  right: 'Right Knee',
} as const;

const POSITION_NAMES = {
  shin: 'Shin',
  thigh: 'Thigh',
} as const;

export function getDeviceDisplayName(id: DeviceID): string {
  return DEVICE_NAMES[id] ?? `Device 0x${id.toString(16)}`;
}

export function getDeviceShortName(id: DeviceID): string {
  return SHORT_NAMES[id] ?? `0x${id.toString(16)}`;
}

export function getJointDisplayName(id: DeviceID): string {
  return isLeftJoint(id) ? JOINT_NAMES.left : JOINT_NAMES.right;
}

export function getPositionDisplayName(id: DeviceID): string {
  return isShin(id) ? POSITION_NAMES.shin : POSITION_NAMES.thigh;
}

/**
 * Format DeviceID as hex string (e.g., "0x11")
 */
export function formatDeviceID(id: DeviceID): string {
  return `0x${id.toString(16).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────
// UI Definition Types (for React hooks)
// ─────────────────────────────────────────────────────────────────

export type JointId = 'left-knee' | 'right-knee';
export const JOINT_IDS: readonly JointId[] = ['left-knee', 'right-knee'] as const;

export type Placement = 'thigh' | 'shin';
export type AnatomicalRole = 'proximal' | 'distal';
export type ConnectionState =
  | 'disconnected'
  | 'discovered'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'reconnecting';

/**
 * Static sensor definition for UI
 */
export interface SensorDefinition {
  readonly id: DeviceID;
  readonly joint: JointId;
  readonly placement: Placement;
  readonly anatomicalRole: AnatomicalRole;
  readonly displayName: string;
  readonly shortName: string;
  readonly sortOrder: number;
  readonly pairedWith: DeviceID;
}

/**
 * Runtime sensor state for UI
 */
export interface SensorState {
  bleAddress: string | null;
  bleName: string | null;
  connectionState: ConnectionState;
  isReconnecting: boolean;
  reconnectAttempts: number;
  lastSeen: number | null;
  batteryLevel: number | null;
  rssi: number | null;
  clockOffset: number | null;
}

export interface Sensor extends SensorDefinition {
  state: SensorState;
}

export const DEFAULT_SENSOR_STATE: SensorState = {
  bleAddress: null,
  bleName: null,
  connectionState: 'disconnected',
  isReconnecting: false,
  reconnectAttempts: 0,
  lastSeen: null,
  batteryLevel: null,
  rssi: null,
  clockOffset: null,
};

/**
 * Build SensorDefinition from DeviceID
 */
export function buildSensorDefinition(id: DeviceID): SensorDefinition {
  return {
    id,
    joint: isLeftJoint(id) ? 'left-knee' : 'right-knee',
    placement: isShin(id) ? 'shin' : 'thigh',
    anatomicalRole: isThigh(id) ? 'proximal' : 'distal',
    displayName: getDeviceDisplayName(id),
    shortName: getDeviceShortName(id),
    sortOrder: getSortOrder(id),
    pairedWith: getPartnerDevice(id),
  };
}

/**
 * All sensor definitions (built from DeviceID)
 */
export const SENSOR_DEFINITIONS: Record<DeviceID, SensorDefinition> = {
  [DeviceID.LEFT_SHIN]: buildSensorDefinition(DeviceID.LEFT_SHIN),
  [DeviceID.LEFT_THIGH]: buildSensorDefinition(DeviceID.LEFT_THIGH),
  [DeviceID.RIGHT_SHIN]: buildSensorDefinition(DeviceID.RIGHT_SHIN),
  [DeviceID.RIGHT_THIGH]: buildSensorDefinition(DeviceID.RIGHT_THIGH),
};

/**
 * Joint definitions with sensor pairs
 * Order: [distal (shin), proximal (thigh)] for angle calculation
 */
export const JOINT_DEFINITIONS: Record<JointId, { displayName: string; sensors: [DeviceID, DeviceID] }> = {
  'left-knee': {
    displayName: 'Left Knee',
    sensors: [DeviceID.LEFT_SHIN, DeviceID.LEFT_THIGH],
  },
  'right-knee': {
    displayName: 'Right Knee',
    sensors: [DeviceID.RIGHT_SHIN, DeviceID.RIGHT_THIGH],
  },
};
