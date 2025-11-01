/**
 * Registry Management Module
 *
 * Provides deterministic device identification and registration for IoT sensor systems.
 * Implements industry best practices from Azure IoT Hub and Bosch IoT Suite.
 *
 * Key Features:
 * - Deterministic device ID assignment based on naming patterns
 * - Semantic IDs encoding joint + position (0x11, 0x12, 0x21, 0x22)
 * - Registration happens at connection time (not during data processing)
 * - Manual override support via localStorage
 * - Persistent mappings across sessions
 * - Event-based notifications for UI updates
 *
 * Usage:
 * ```typescript
 * import { deviceRegistry, DeviceID } from './registry-management';
 *
 * // On device connection
 * const device = deviceRegistry.registerDevice(bleAddress, deviceName);
 * if (device) {
 *   console.log(`Device assigned ID: 0x${device.deviceID.toString(16)}`);
 * }
 *
 * // During data processing (fast lookup)
 * const device = deviceRegistry.getDeviceByAddress(bleAddress);
 * if (device) {
 *   processData(device.deviceID, data);
 * }
 * ```
 */

// Configuration and types
export {
  DeviceID,
  DeviceMappingRule,
  LegacyDeviceMapping,
  DEVICE_MAPPING_CONFIG,
  DEVICE_NAMESPACE,
  getJointID,
  getPositionID,
  isLeftKnee,
  isRightKnee,
  isBottomSensor,
  isTopSensor
} from './DeviceMappingConfig';

// Device identification
export {
  DeviceIdentification,
  identifyDevice,
  getFullIdentifier,
  isValidDeviceID,
  getDeviceIDDescription,
  listConfiguredPatterns
} from './DeviceIdentifier';

// Registry
export {
  RegisteredDevice,
  DeviceRegistry,
  deviceRegistry // Singleton instance
} from './DeviceRegistry';
