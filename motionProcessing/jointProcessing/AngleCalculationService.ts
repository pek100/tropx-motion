import { Quaternion, DeviceData, JointConfig, MotionConfig } from '../shared/types';
import { SYSTEM } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { DeviceID, isValidDeviceID, getSortOrder } from '../../ble-management';

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
   * Calculates joint angle from device quaternion data using specified rotation axis.
   */
  calculateJointAngle(devices: DeviceData[], axis: 'x' | 'y' | 'z' = 'y'): number | null {
    if (devices.length < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

    const sorted = this.sortBySensorDefinition(devices);
    if (!sorted) return null;

    const [proximal, distal] = sorted;

    try {
      const angle = this.calculateAngle(proximal.quaternion, distal.quaternion, axis);
      return this.applyCalibration(angle);
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

  /**
   * Sort devices by position (thigh=proximal=0, shin=distal=1).
   * Returns [proximal, distal] or null if devices can't be identified.
   */
  private sortBySensorDefinition(devices: DeviceData[]): [DeviceData, DeviceData] | null {
    if (devices.length < 2) return null;

    // Map devices to their sort orders
    const withOrder: { device: DeviceData; order: number }[] = [];

    for (const device of devices) {
      const deviceId = this.parseDeviceID(device.deviceId);
      if (!deviceId) {
        console.error(`[AngleCalc] Unknown device ID: ${device.deviceId}`);
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
   * Calculates relative angle between two quaternions using matrix transformation.
   */
  private calculateAngle(q1: Quaternion, q2: Quaternion, axis: 'x' | 'y' | 'z'): number {
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
    return Math.atan2(this.workingMatrix[a], this.workingMatrix[b]) * (180 / Math.PI);
  }
}
