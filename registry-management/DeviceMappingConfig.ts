/**
 * Device Mapping Configuration
 *
 * Defines deterministic device ID assignment rules based on device naming patterns.
 * Follows IoT industry best practices:
 * - Semantic IDs encode device function (joint + position)
 * - Hierarchical namespace pattern (com.tropx.motion)
 * - Mapping happens at connection time, not during runtime
 */

export const DEVICE_NAMESPACE = 'com.tropx.motion';

/**
 * Device ID encoding scheme (single byte):
 * Upper nibble (bits 4-7): Joint identifier (1=left, 2=right)
 * Lower nibble (bits 0-3): Position identifier (1=bottom, 2=top)
 *
 * Examples:
 * 0x11 = 0001 0001 = Left knee, bottom sensor
 * 0x12 = 0001 0010 = Left knee, top sensor
 * 0x21 = 0010 0001 = Right knee, bottom sensor
 * 0x22 = 0010 0010 = Right knee, top sensor
 */
export enum DeviceID {
  LEFT_KNEE_BOTTOM  = 0x11,
  LEFT_KNEE_TOP     = 0x12,
  RIGHT_KNEE_BOTTOM = 0x21,
  RIGHT_KNEE_TOP    = 0x22,
}

export interface DeviceMappingRule {
  pattern: string;        // Substring to match in device name (e.g., "ln_bottom")
  deviceID: DeviceID;     // Assigned device ID
  joint: string;          // Joint name (e.g., "left-knee")
  position: string;       // Sensor position (e.g., "bottom")
  description: string;    // Human-readable description
}

export interface LegacyDeviceMapping {
  deviceID: DeviceID;
  joint: string;
  position: string;
}

/**
 * Device mapping configuration
 * Rules are checked in order - first match wins
 */
export const DEVICE_MAPPING_CONFIG = {
  namespace: DEVICE_NAMESPACE,

  /**
   * Pattern matching rules (checked in order)
   * Uses simple substring matching (case-insensitive)
   *
   * NOTE: Naming convention is INVERTED from physical placement:
   * - "bottom" sensors are physically on the SHIN (below knee) = distal
   * - "top" sensors are physically on the THIGH (above knee) = proximal
   */
  rules: [
    {
      pattern: 'ln_bottom',
      deviceID: DeviceID.LEFT_KNEE_BOTTOM,
      joint: 'left-knee',
      position: 'bottom',
      description: 'Left knee "bottom" sensor (physically on SHIN - distal)'
    },
    {
      pattern: 'ln_top',
      deviceID: DeviceID.LEFT_KNEE_TOP,
      joint: 'left-knee',
      position: 'top',
      description: 'Left knee "top" sensor (physically on THIGH - proximal)'
    },
    {
      pattern: 'rn_bottom',
      deviceID: DeviceID.RIGHT_KNEE_BOTTOM,
      joint: 'right-knee',
      position: 'bottom',
      description: 'Right knee "bottom" sensor (physically on SHIN - distal)'
    },
    {
      pattern: 'rn_top',
      deviceID: DeviceID.RIGHT_KNEE_TOP,
      joint: 'right-knee',
      position: 'top',
      description: 'Right knee "top" sensor (physically on THIGH - proximal)'
    },
  ] as DeviceMappingRule[],

  /**
   * Legacy exact name matches (for backward compatibility)
   * Used if pattern rules don't match
   */
  legacyDevices: {
    'muse_v3':    { deviceID: DeviceID.LEFT_KNEE_BOTTOM,  joint: 'left-knee',  position: 'bottom' },
    'muse_v3_2':  { deviceID: DeviceID.LEFT_KNEE_TOP,     joint: 'left-knee',  position: 'top' },
    'muse_v3_01': { deviceID: DeviceID.RIGHT_KNEE_BOTTOM, joint: 'right-knee', position: 'bottom' },
    'muse_v3_02': { deviceID: DeviceID.RIGHT_KNEE_TOP,    joint: 'right-knee', position: 'top' },
  } as Record<string, LegacyDeviceMapping>
};

/**
 * Extract joint ID from device ID
 * @param deviceID - Device ID byte (e.g., 0x11)
 * @returns Joint ID (1=left, 2=right)
 */
export function getJointID(deviceID: DeviceID): number {
  return (deviceID >> 4) & 0x0F;
}

/**
 * Extract position ID from device ID
 * @param deviceID - Device ID byte (e.g., 0x11)
 * @returns Position ID (1=bottom, 2=top)
 */
export function getPositionID(deviceID: DeviceID): number {
  return deviceID & 0x0F;
}

/**
 * Check if device ID represents a left knee sensor
 */
export function isLeftKnee(deviceID: DeviceID): boolean {
  return getJointID(deviceID) === 1;
}

/**
 * Check if device ID represents a right knee sensor
 */
export function isRightKnee(deviceID: DeviceID): boolean {
  return getJointID(deviceID) === 2;
}

/**
 * Check if device ID represents a "bottom" named sensor.
 *
 * IMPORTANT: Naming is INVERTED from physical placement!
 * - "bottom" sensors are physically placed on the SHIN (below knee) = anatomically DISTAL
 */
export function isBottomSensor(deviceID: DeviceID): boolean {
  return getPositionID(deviceID) === 1;
}

/**
 * Check if device ID represents a "top" named sensor.
 *
 * IMPORTANT: Naming is INVERTED from physical placement!
 * - "top" sensors are physically placed on the THIGH (above knee) = anatomically PROXIMAL
 */
export function isTopSensor(deviceID: DeviceID): boolean {
  return getPositionID(deviceID) === 2;
}

export type JointName = 'left_knee' | 'right_knee';

/**
 * Map device ID to joint name
 * @returns Joint name or null if deviceID is invalid
 */
export function getJointName(deviceID: DeviceID): JointName | null {
  if (isLeftKnee(deviceID)) return 'left_knee';
  if (isRightKnee(deviceID)) return 'right_knee';
  return null;
}
