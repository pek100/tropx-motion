/**
 * Device Identifier Service
 *
 * Provides deterministic device ID assignment based on device naming patterns.
 * Implements the mapping logic defined in DeviceMappingConfig.
 */

import {
  DEVICE_MAPPING_CONFIG,
  DeviceID,
  DeviceMappingRule
} from './DeviceMappingConfig';

export interface DeviceIdentification {
  deviceID: DeviceID;
  joint: string;
  position: string;
  description: string;
  matchedBy: 'pattern' | 'legacy' | 'manual';
}

/**
 * Attempts to identify a device by its name using configured mapping rules.
 * Returns null if device cannot be identified.
 *
 * Matching priority:
 * 1. Pattern rules (in order)
 * 2. Legacy exact name matches
 * 3. Returns null if no match
 */
export function identifyDevice(deviceName: string): DeviceIdentification | null {
  const normalizedName = deviceName.toLowerCase();

  // 1. Try pattern matching rules (first match wins)
  for (const rule of DEVICE_MAPPING_CONFIG.rules) {
    if (normalizedName.includes(rule.pattern.toLowerCase())) {
      console.log(`✅ [DEVICE_IDENTIFIER] Device "${deviceName}" matched pattern "${rule.pattern}" → ID 0x${rule.deviceID.toString(16)}`);
      return {
        deviceID: rule.deviceID,
        joint: rule.joint,
        position: rule.position,
        description: rule.description,
        matchedBy: 'pattern'
      };
    }
  }

  // 2. Try legacy exact name matches
  const legacyMatch = DEVICE_MAPPING_CONFIG.legacyDevices[normalizedName];
  if (legacyMatch) {
    console.log(`✅ [DEVICE_IDENTIFIER] Device "${deviceName}" matched legacy device → ID 0x${legacyMatch.deviceID.toString(16)}`);
    return {
      deviceID: legacyMatch.deviceID,
      joint: legacyMatch.joint,
      position: legacyMatch.position,
      description: `Legacy device: ${deviceName}`,
      matchedBy: 'legacy'
    };
  }

  // 3. No match found
  console.warn(`⚠️ [DEVICE_IDENTIFIER] Unknown device: "${deviceName}" - no matching pattern or legacy entry`);
  return null;
}

/**
 * Gets the full identifier string in namespace:name format
 */
export function getFullIdentifier(deviceName: string): string {
  return `${DEVICE_MAPPING_CONFIG.namespace}:${deviceName}`;
}

/**
 * Validates if a device ID is within the valid range
 */
export function isValidDeviceID(deviceID: number): boolean {
  return Object.values(DeviceID).includes(deviceID as DeviceID);
}

/**
 * Gets human-readable description for a device ID
 */
export function getDeviceIDDescription(deviceID: DeviceID): string {
  const rule = DEVICE_MAPPING_CONFIG.rules.find(r => r.deviceID === deviceID);
  if (rule) {
    return rule.description;
  }

  const legacyEntry = Object.entries(DEVICE_MAPPING_CONFIG.legacyDevices)
    .find(([_, mapping]) => mapping.deviceID === deviceID);

  if (legacyEntry) {
    return `Legacy device: ${legacyEntry[0]}`;
  }

  return `Unknown device ID: 0x${deviceID.toString(16)}`;
}

/**
 * Lists all configured device patterns for debugging
 */
export function listConfiguredPatterns(): string[] {
  const patterns = DEVICE_MAPPING_CONFIG.rules.map(r =>
    `${r.pattern} → 0x${r.deviceID.toString(16)} (${r.joint}, ${r.position})`
  );

  const legacy = Object.entries(DEVICE_MAPPING_CONFIG.legacyDevices).map(([name, mapping]) =>
    `${name} (legacy) → 0x${mapping.deviceID.toString(16)} (${mapping.joint}, ${mapping.position})`
  );

  return [...patterns, ...legacy];
}
