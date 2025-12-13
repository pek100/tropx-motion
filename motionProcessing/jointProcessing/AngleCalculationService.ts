import { Quaternion, DeviceData, JointConfig, MotionConfig } from '../shared/types';
import { SYSTEM } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { DeviceID, isValidDeviceID, getSortOrder } from '../../ble-management';

/** Result containing both angle and relative quaternion for recording. */
export interface AngleCalculationResult {
  angle: number;
  relativeQuat: Quaternion;
}

/**
 * Service for calculating joint angles from quaternion data of paired sensors.
 * Uses ble-management DeviceID operations for consistent sensor ordering.
 */
export class AngleCalculationService {
  private jointPrefix: string;
  private readonly workingQuat1 = new Float32Array(4);
  private readonly workingQuat2 = new Float32Array(4);
  private readonly workingQuatRel = new Float32Array(4);
  private readonly workingMatrix = new Float32Array(9);

  constructor(private jointConfig: JointConfig, _motionConfig: MotionConfig) {
    this.jointPrefix = jointConfig.name;
  }

  /**
   * Calculates joint angle and relative quaternion from device quaternion data.
   * Returns both for recording purposes - angle for display, quaternion for SLERP interpolation.
   */
  calculateJointAngle(devices: DeviceData[], axis: 'x' | 'y' | 'z' = 'y'): AngleCalculationResult | null {
    if (devices.length < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

    const sorted = this.sortBySensorDefinition(devices);
    if (!sorted) return null;

    const [proximal, distal] = sorted;

    try {
      const { angle, relativeQuat } = this.calculateAngleWithQuat(proximal.quaternion, distal.quaternion, axis);
      return {
        angle: this.applyCalibration(angle),
        relativeQuat
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate joint angle directly from thigh (proximal) and shin (distal) quaternions.
   * Used by BatchSynchronizer path where sensors are already aligned.
   *
   * @param thighQuat - Proximal (thigh) sensor quaternion
   * @param shinQuat - Distal (shin) sensor quaternion
   * @param axis - Rotation axis to extract angle from
   */
  calculateFromQuaternions(thighQuat: Quaternion, shinQuat: Quaternion, axis: 'x' | 'y' | 'z' = 'y'): AngleCalculationResult | null {
    try {
      const { angle, relativeQuat } = this.calculateAngleWithQuat(thighQuat, shinQuat, axis);
      return {
        angle: this.applyCalibration(angle),
        relativeQuat
      };
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
   * Applies joint-specific calibration offset and multiplier.
   */
  private applyCalibration(angle: number): number {
    if (!this.jointConfig.calibration) return angle;
    return (angle + this.jointConfig.calibration.offset) * this.jointConfig.calibration.multiplier;
  }

  /**
   * Calculates relative angle and quaternion between two quaternions.
   * Returns copy of relative quaternion to avoid race conditions with shared buffer.
   */
  private calculateAngleWithQuat(q1: Quaternion, q2: Quaternion, axis: 'x' | 'y' | 'z'): { angle: number; relativeQuat: Quaternion } {
    QuaternionService.writeToBuffer(q1, this.workingQuat1);
    QuaternionService.writeToBuffer(q2, this.workingQuat2);
    QuaternionService.getInverseQuaternion(this.workingQuat1, this.workingQuat1);
    QuaternionService.multiplyQuaternions(this.workingQuat1, this.workingQuat2, this.workingQuatRel);
    QuaternionService.quaternionToMatrix(this.workingQuatRel, this.workingMatrix);

    const axisExtractionMap = {
      x: [5, 4],
      y: [2, 0],
      z: [1, 3],
    };

    const [a, b] = axisExtractionMap[axis];
    const angle = Math.atan2(this.workingMatrix[a], this.workingMatrix[b]) * (180 / Math.PI);

    // Return copy to avoid race condition with shared workingQuatRel buffer
    const relativeQuat = QuaternionService.readFromBuffer(this.workingQuatRel);

    return { angle, relativeQuat };
  }
}
