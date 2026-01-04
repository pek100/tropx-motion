import { Quaternion, DeviceData, JointConfig, MotionConfig } from '../shared/types';
import { SYSTEM } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { DeviceID, isValidDeviceID, getSortOrder } from '../../ble-management';

/**
 * Service for computing relative quaternions from paired sensor data.
 * Angle extraction is done in frontend via QuaternionCodec.quaternionToAngle().
 */
export class AngleCalculationService {
  private readonly workingQuat1 = new Float32Array(4);
  private readonly workingQuat2 = new Float32Array(4);
  private readonly workingQuatRel = new Float32Array(4);

  constructor(private jointConfig: JointConfig, _motionConfig: MotionConfig) {}

  /**
   * Computes relative quaternion from device quaternion data.
   * @returns Relative quaternion (proximal⁻¹ × distal) or null if invalid
   */
  calculateRelativeQuaternion(devices: DeviceData[]): Quaternion | null {
    if (devices.length < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

    const sorted = this.sortBySensorDefinition(devices);
    if (!sorted) return null;

    const [proximal, distal] = sorted;

    try {
      return this.computeRelativeQuat(proximal.quaternion, distal.quaternion);
    } catch {
      return null;
    }
  }

  /**
   * Computes relative quaternion directly from thigh and shin quaternions.
   * Used by BatchSynchronizer path where sensors are already aligned.
   */
  calculateFromQuaternions(thighQuat: Quaternion, shinQuat: Quaternion): Quaternion | null {
    try {
      return this.computeRelativeQuat(thighQuat, shinQuat);
    } catch {
      return null;
    }
  }

  /**
   * Clears internal state.
   */
  resetAngleState(): void {
    // No cache to clear - kept for API compatibility
  }

  /**
   * Parse deviceId string to DeviceID number.
   */
  private parseDeviceID(deviceId: string): DeviceID | null {
    // Handle hex format "0x11"
    if (deviceId.startsWith('0x')) {
      const num = parseInt(deviceId, 16);
      return isValidDeviceID(num) ? num : null;
    }
    // Handle decimal format
    const num = parseInt(deviceId, 10);
    return isValidDeviceID(num) ? num : null;
  }

  private static debugSortFailCount = 0;

  /**
   * Sort devices by position (thigh=proximal=0, shin=distal=1).
   * Returns [proximal, distal] or null if devices can't be identified.
   */
  private sortBySensorDefinition(devices: DeviceData[]): [DeviceData, DeviceData] | null {
    if (devices.length < 2) {
      console.warn(`[AngleCalc] sortBySensorDefinition: devices.length=${devices.length} < 2`);
      return null;
    }

    // Map devices to their sort orders
    const withOrder: { device: DeviceData; order: number }[] = [];

    for (const device of devices) {
      const deviceId = this.parseDeviceID(device.deviceId);
      if (!deviceId) {
        AngleCalculationService.debugSortFailCount++;
        if (AngleCalculationService.debugSortFailCount <= 5) {
          console.error(`[AngleCalc] Unknown device ID: ${device.deviceId} (fail #${AngleCalculationService.debugSortFailCount})`);
        }
        return null;
      }

      // Use getSortOrder: thigh=0 (proximal), shin=1 (distal)
      withOrder.push({ device, order: getSortOrder(deviceId) });
    }

    // Sort by sortOrder (proximal=0 first, distal=1 second)
    withOrder.sort((a, b) => a.order - b.order);

    return [withOrder[0].device, withOrder[1].device];
  }

  /**
   * Computes relative quaternion: q1⁻¹ × q2
   * Returns copy to avoid race conditions with shared buffer.
   */
  private computeRelativeQuat(q1: Quaternion, q2: Quaternion): Quaternion {
    QuaternionService.writeToBuffer(q1, this.workingQuat1);
    QuaternionService.writeToBuffer(q2, this.workingQuat2);
    QuaternionService.getInverseQuaternion(this.workingQuat1, this.workingQuat1);
    QuaternionService.multiplyQuaternions(this.workingQuat1, this.workingQuat2, this.workingQuatRel);

    return QuaternionService.readFromBuffer(this.workingQuatRel);
  }
}
