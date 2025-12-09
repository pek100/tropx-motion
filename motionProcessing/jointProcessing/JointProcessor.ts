import { JointConfig, DeviceData, JointAngleData, MotionConfig } from '../shared/types';
import { AngleCalculationService } from './AngleCalculationService';
import { roundToPrecision } from '../shared/utils';
import { SYSTEM } from "../shared/constants";

/**
 * Abstract base class for joint angle processing.
 */
export abstract class JointProcessor {
    protected angleCalculator: AngleCalculationService;
    protected subscribers = new Set<(angleData: JointAngleData) => void>();
    protected latestAngle: JointAngleData | null = null;

    constructor(protected jointConfig: JointConfig, protected motionConfig: MotionConfig) {
        this.validateJointConfig(jointConfig);
        this.angleCalculator = new AngleCalculationService(jointConfig, motionConfig);
    }

    processDevices(devices: Map<string, DeviceData>): JointAngleData | null {
        if (devices.size < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

        const deviceArray = Array.from(devices.values());
        const angle = this.calculateJointAngle(deviceArray);

        if (angle === null || !this.isValidAngle(angle)) return null;

        const latestTimestamp = Math.max(...deviceArray.map(d => d.timestamp));
        const deviceIds = Array.from(devices.keys());
        return this.createAndProcessAngleData(angle, latestTimestamp, deviceIds);
    }

    subscribe(callback: (angleData: JointAngleData) => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    getStats(): null {
        return null;
    }

    resetStats(): void {
        this.angleCalculator.resetAngleState();
    }

    getLatestAngle(): JointAngleData | null {
        return this.latestAngle;
    }

    cleanup(): void {
        this.subscribers.clear();
        this.angleCalculator.resetAngleState();
    }

    protected abstract calculateJointAngle(devices: DeviceData[]): number | null;

    private validateJointConfig(config: JointConfig): void {
        if (!config.name || !config.topSensorPattern || !config.bottomSensorPattern) {
            throw new TypeError('Joint config must have name, topSensorPattern, and bottomSensorPattern');
        }
    }

    private isValidAngle(angle: number | null): boolean {
        return angle !== null && isFinite(angle);
    }

    private createAndProcessAngleData(angle: number, timestamp: number, deviceIds: string[]): JointAngleData {
        const processedAngle = roundToPrecision(angle);

        const angleData: JointAngleData = {
            jointName: this.jointConfig.name,
            angle: processedAngle,
            timestamp: timestamp,
            deviceIds: deviceIds
        };

        this.latestAngle = angleData;
        this.notifySubscribers(angleData);
        return angleData;
    }

    private notifySubscribers(angleData: JointAngleData): void {
        this.subscribers.forEach(callback => {
            try {
                callback(angleData);
            } catch {
                // Continue with other subscribers if one fails
            }
        });
    }
}

/**
 * Specialized joint processor for knee joint angle calculations.
 */
export class KneeJointProcessor extends JointProcessor {
    protected calculateJointAngle(devices: DeviceData[]): number | null {
        return this.angleCalculator.calculateJointAngle(devices, 'y');
    }
}
