import { Quaternion } from '../../sdk/core/MuseData';
import { DeviceData, JointConfig, MotionConfig } from '../shared/types';
import {CACHE, DEVICE, SYSTEM} from '../shared/constants';
import {testDevicePattern} from '../shared/utils';
import {QuaternionService} from "../shared/QuaternionService";

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
    private deviceSortOrderCache = new Map<string, number>();

    constructor(private jointConfig: JointConfig, motionConfig: MotionConfig) {
        this.jointPrefix = jointConfig.name;
        this.maxCacheSize = motionConfig.performance.cacheSize;
        this.precomputeDeviceSortOrder();
    }

    /**
     * Calculates joint angle from device quaternion data using specified rotation axis.
     * Returns cached result if available, otherwise performs full calculation.
     */
    calculateJointAngle(devices: DeviceData[], axis: 'x' | 'y' | 'z' = 'y'): number | null {
        if (devices.length < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

        const sortedDevices = this.sortDevicesByPattern(devices);
        const [proximal, distal] = sortedDevices;

        const cached = this.getCachedAngle(proximal, distal, axis);
        if (cached !== null) return cached;

        try {
            const angle = this.calculateAngle(proximal.quaternion, distal.quaternion, axis);
            const finalAngle = this.applyCalibration(angle);

            this.cacheAngle(proximal, distal, finalAngle, axis);
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
     * Pre-computes device sort order from joint configuration patterns.
     * Improves performance by avoiding repeated pattern matching.
     */
    private precomputeDeviceSortOrder(): void {
        const allPatterns = [...this.jointConfig.topSensorPattern, ...this.jointConfig.bottomSensorPattern];
        allPatterns.forEach((pattern, index) => {
            this.deviceSortOrderCache.set(pattern, index);
        });
    }

    /**
     * Determines sort order for device based on pattern matching.
     * Returns high value for unknown devices to sort them last.
     */
    private getDeviceSortOrder(deviceId: string): number {
        // Check exact matches first
        for (const [pattern, order] of this.deviceSortOrderCache.entries()) {
            if (deviceId === pattern) {
                return order;
            }
        }

        // Check regex patterns
        for (const [pattern, order] of this.deviceSortOrderCache.entries()) {
            if (testDevicePattern(deviceId, pattern)) {
                return order;
            }
        }

        return DEVICE.UNKNOWN_SORT_ORDER;
    }

    /**
     * Sorts devices by joint configuration pattern order.
     * Ensures consistent proximal-distal ordering for angle calculations.
     */
    private sortDevicesByPattern(devices: DeviceData[]): DeviceData[] {
        return devices.sort((a, b) => {
            const aIndex = this.getDeviceSortOrder(a.deviceId);
            const bIndex = this.getDeviceSortOrder(b.deviceId);
            return aIndex - bIndex;
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