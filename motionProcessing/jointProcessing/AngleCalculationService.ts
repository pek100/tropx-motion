import { Quaternion, DeviceData, JointConfig, MotionConfig } from '../shared/types';
import {CACHE, SYSTEM} from '../shared/constants';
import {QuaternionService} from "../shared/QuaternionService";
import { isBottomSensor, isTopSensor, DeviceID } from '../../registry-management';

interface CacheEntry {
    angle: number;
    timestamp: number;
}

/**
 * Service for calculating joint angles from quaternion data of paired sensors.
 * Implements caching, device sorting, and mathematical transformations for angle computation.
 */
export class AngleCalculationService {
    private jointPrefix: string;
    private calculationCache = new Map<string, CacheEntry>();
    private readonly maxCacheSize: number;
    private readonly workingQuat1 = new Float32Array(4);
    private readonly workingQuat2 = new Float32Array(4);
    private readonly workingQuatRel = new Float32Array(4);
    private readonly workingMatrix = new Float32Array(9);

    constructor(private jointConfig: JointConfig, motionConfig: MotionConfig) {
        this.jointPrefix = jointConfig.name;
        this.maxCacheSize = motionConfig.performance.cacheSize;
    }

    /**
     * Calculates joint angle from device quaternion data using specified rotation axis.
     *
     * ARCHITECTURE NOTE: Cache was DISABLED because:
     * 1. During streaming, every quaternion sample is unique
     * 2. Cache hits returned stale angles from previous calculations
     * 3. This caused "out of sync" appearance after chaotic movement
     * 4. Angle calculation is fast (~0.05ms) - caching is counterproductive
     */
    calculateJointAngle(devices: DeviceData[], axis: 'x' | 'y' | 'z' = 'y'): number | null {
        if (devices.length < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

        const sortedDevices = this.sortDevicesByPattern(devices);
        const [proximal, distal] = sortedDevices;

        // Cache DISABLED - always calculate fresh angle for real-time accuracy
        // const cached = this.getCachedAngle(proximal, distal, axis);
        // if (cached !== null) return cached;

        try {
            const angle = this.calculateAngle(proximal.quaternion, distal.quaternion, axis);
            const finalAngle = this.applyCalibration(angle);

            // Cache disabled - no need to store
            // this.cacheAngle(proximal, distal, finalAngle, axis);
            return finalAngle;
        } catch {
            return null;
        }
    }

    /**
     * Clears calculation cache and internal state.
     */
    resetAngleState(): void {
        this.calculationCache.clear();
    }

    /**
     * Parses DeviceID from device identifier string.
     * DeviceID format: "0x11", "0x12", "0x21", "0x22"
     *
     * @throws Error if deviceId is not a valid DeviceID format
     */
    private parseDeviceID(deviceId: string): DeviceID {
        // Parse hex string (e.g., "0x11" -> 17)
        const numericId = parseInt(deviceId, 16);

        // Validate it's a known DeviceID
        const validDeviceIDs = [DeviceID.LEFT_KNEE_BOTTOM, DeviceID.LEFT_KNEE_TOP,
                                DeviceID.RIGHT_KNEE_BOTTOM, DeviceID.RIGHT_KNEE_TOP];

        if (!validDeviceIDs.includes(numericId)) {
            throw new Error(
                `CRITICAL: Unknown DeviceID "${deviceId}" (parsed as ${numericId}). ` +
                `Valid DeviceIDs are: 0x11 (left-bottom), 0x12 (left-top), 0x21 (right-bottom), 0x22 (right-top). ` +
                `Sensor ordering cannot proceed without valid device identification.`
            );
        }

        return numericId as DeviceID;
    }

    /**
     * Determines sort order for device based on DeviceID position encoding.
     *
     * PHYSICAL REALITY (naming is inverted from placement):
     * - 0x_1 = "bottom" in name, but physically on SHIN (below knee) = DISTAL → sort order 1 (second)
     * - 0x_2 = "top" in name, but physically on THIGH (above knee) = PROXIMAL → sort order 0 (first)
     *
     * For knee angle: angle = inverse(q_proximal) * q_distal
     * - Proximal sensor (thigh) must be first
     * - Distal sensor (shin) must be second
     *
     * @throws Error if device position cannot be determined
     */
    private getDeviceSortOrder(deviceId: string): number {
        const numericId = this.parseDeviceID(deviceId);

        if (isTopSensor(numericId)) {
            // "Top" in name = physically on THIGH = proximal → sorts first
            return 0;
        }

        if (isBottomSensor(numericId)) {
            // "Bottom" in name = physically on SHIN = distal → sorts second
            return 1;
        }

        // This should never happen if parseDeviceID validated correctly
        throw new Error(
            `CRITICAL: DeviceID "${deviceId}" (0x${numericId.toString(16)}) has invalid position encoding. ` +
            `Lower nibble must be 1 (bottom) or 2 (top), got ${numericId & 0x0F}.`
        );
    }

    /**
     * Sorts devices by anatomical position for consistent angle calculation.
     *
     * Order: [proximal (thigh - "top" named sensors), distal (shin - "bottom" named sensors)]
     *
     * NOTE: Device naming is INVERTED from physical placement:
     * - "top" sensors are physically on the THIGH (above knee) = proximal
     * - "bottom" sensors are physically on the SHIN (below knee) = distal
     *
     * This ordering is CRITICAL for correct joint angle calculation:
     * - angle = inverse(q_proximal) * q_distal
     * - Swapping proximal/distal inverts or corrupts the angle
     *
     * @throws Error if any device has unknown position
     */
    private sortDevicesByPattern(devices: DeviceData[]): DeviceData[] {
        // Validate ALL devices have known positions before sorting
        for (const device of devices) {
            this.getDeviceSortOrder(device.deviceId); // Throws if unknown
        }

        // Sort: "top" sensors (proximal/thigh) before "bottom" sensors (distal/shin)
        return devices.sort((a, b) => {
            const aOrder = this.getDeviceSortOrder(a.deviceId);
            const bOrder = this.getDeviceSortOrder(b.deviceId);
            return aOrder - bOrder;
        });
    }

    /**
     * Retrieves cached angle if available and valid.
     */
    private getCachedAngle(proximal: DeviceData, distal: DeviceData, axis: 'x' | 'y' | 'z'): number | null {
        const cacheKey = this.createCacheKey(proximal, distal, axis);
        const cached = this.calculationCache.get(cacheKey);

        if (cached && this.isCacheValid(cached)) {
            return cached.angle;
        }

        return null;
    }

    /**
     * Checks if cached entry is still within time-to-live window.
     */
    private isCacheValid(cached: CacheEntry): boolean {
        return (performance.now() - cached.timestamp) < CACHE.TTL_MS;
    }

    /**
     * Creates unique cache key from device data and timestamps.
     */
    private createCacheKey(proximal: DeviceData, distal: DeviceData, axis: 'x' | 'y' | 'z'): string {
        return `${this.jointPrefix}-${proximal.deviceId}-${distal.deviceId}-${proximal.timestamp}-${distal.timestamp}-${axis}`;
    }

    /**
     * Stores calculated angle in cache with timestamp for TTL validation.
     */
    private cacheAngle(proximal: DeviceData, distal: DeviceData, angle: number, axis: 'x' | 'y' | 'z'): void {
        const cacheKey = this.createCacheKey(proximal, distal, axis);
        this.calculationCache.set(cacheKey, {
            angle,
            timestamp: performance.now()
        });

        if (this.calculationCache.size > this.maxCacheSize) {
            this.cleanupCache();
        }
    }

    /**
     * Applies joint-specific calibration offset and multiplier to calculated angle.
     */
    private applyCalibration(angle: number): number {
        if (!this.jointConfig.calibration) return angle;

        return (angle + this.jointConfig.calibration.offset) * this.jointConfig.calibration.multiplier;
    }

    /**
     * Calculates relative angle between two quaternions using matrix transformation.
     * Uses inverse quaternion multiplication and matrix conversion for angle extraction.
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
            z: [1, 3]
        };

        const [a, b] = axisExtractionMap[axis];
        return Math.atan2(this.workingMatrix[a], this.workingMatrix[b]) * (180 / Math.PI);
    }


    /**
     * Removes expired cache entries to maintain memory bounds.
     */
    private cleanupCache(): void {
        const now = performance.now();
        const expiredKeys: string[] = [];

        for (const [key, value] of this.calculationCache.entries()) {
            if (now - value.timestamp > CACHE.TTL_MS * 2) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => this.calculationCache.delete(key));
    }
}