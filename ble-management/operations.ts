/**
 * Device Operations
 * Bit operations for DeviceID and device identification
 */

import { DeviceID } from './types';

// ─────────────────────────────────────────────────────────────────
// Bit Operations - derive joint/position from DeviceID
// ─────────────────────────────────────────────────────────────────

const JOINT_MASK = 0xf0;
const POSITION_MASK = 0x0f;
const LEFT_JOINT = 0x10;
const RIGHT_JOINT = 0x20;
const SHIN_POSITION = 0x01;
const THIGH_POSITION = 0x02;

export function isLeftJoint(id: DeviceID): boolean {
  return (id & JOINT_MASK) === LEFT_JOINT;
}

export function isRightJoint(id: DeviceID): boolean {
  return (id & JOINT_MASK) === RIGHT_JOINT;
}

export function isShin(id: DeviceID): boolean {
  return (id & POSITION_MASK) === SHIN_POSITION;
}

export function isThigh(id: DeviceID): boolean {
  return (id & POSITION_MASK) === THIGH_POSITION;
}

export function getJointPair(id: DeviceID): [DeviceID, DeviceID] {
  if (isLeftJoint(id)) {
    return [DeviceID.LEFT_SHIN, DeviceID.LEFT_THIGH];
  }
  return [DeviceID.RIGHT_SHIN, DeviceID.RIGHT_THIGH];
}

export function getPartnerDevice(id: DeviceID): DeviceID {
  const [shin, thigh] = getJointPair(id);
  return isShin(id) ? thigh : shin;
}

/**
 * Get joint name for internal mapping (e.g., 'left-knee', 'right-knee')
 * Use getJointDisplayName() for UI strings
 */
export function getJointName(id: DeviceID): string {
  return isLeftJoint(id) ? 'left-knee' : 'right-knee';
}

/**
 * Get sort order for angle calculation (proximal=0, distal=1)
 * Thigh is proximal (closer to body), shin is distal
 */
export function getSortOrder(id: DeviceID): number {
  return isThigh(id) ? 0 : 1;
}

export function isValidDeviceID(value: number): value is DeviceID {
  return (
    value === DeviceID.LEFT_SHIN ||
    value === DeviceID.LEFT_THIGH ||
    value === DeviceID.RIGHT_SHIN ||
    value === DeviceID.RIGHT_THIGH
  );
}

// ─────────────────────────────────────────────────────────────────
// Device Identification - BLE name pattern matching
// ─────────────────────────────────────────────────────────────────

interface IdentificationRule {
  pattern: RegExp;
  deviceId: DeviceID;
}

const IDENTIFICATION_RULES: IdentificationRule[] = [
  // Primary patterns (TropX naming convention)
  { pattern: /ln_bottom|ln_shin/i, deviceId: DeviceID.LEFT_SHIN },
  { pattern: /ln_top|ln_thigh/i, deviceId: DeviceID.LEFT_THIGH },
  { pattern: /rn_bottom|rn_shin/i, deviceId: DeviceID.RIGHT_SHIN },
  { pattern: /rn_top|rn_thigh/i, deviceId: DeviceID.RIGHT_THIGH },
  // Legacy patterns (Muse v3)
  { pattern: /^muse_v3$/i, deviceId: DeviceID.LEFT_SHIN },
  { pattern: /^muse_v3_2$/i, deviceId: DeviceID.LEFT_THIGH },
  { pattern: /^muse_v3_01$/i, deviceId: DeviceID.RIGHT_SHIN },
  { pattern: /^muse_v3_02$/i, deviceId: DeviceID.RIGHT_THIGH },
];

/**
 * Identify device from BLE name
 * @returns DeviceID if recognized, null otherwise
 */
export function identifyDevice(bleName: string): DeviceID | null {
  const name = bleName.toLowerCase();

  for (const rule of IDENTIFICATION_RULES) {
    if (rule.pattern.test(name)) {
      return rule.deviceId;
    }
  }

  return null;
}

/**
 * Check if BLE name is a known TropX device
 */
export function isTropXDevice(bleName: string): boolean {
  const lower = bleName.toLowerCase();
  return lower.startsWith('tropx') || lower.startsWith('muse_v3');
}
