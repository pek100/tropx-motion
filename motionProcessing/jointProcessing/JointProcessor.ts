import { JointConfig, DeviceData, JointAngleData, MotionConfig } from '../shared/types';
import { JointStatisticsManager } from '../shared/JointStatisticsManager';
import { AngleCalculationService } from './AngleCalculationService';
import { roundToPrecision } from '../shared/utils';
import {SYSTEM} from "../shared/constants";

/**
 * Abstract base class for joint angle processing.
 * Manages device data processing, angle calculations, and statistical tracking.
 */
export abstract class JointProcessor {
    protected angleCalculator: AngleCalculationService;
    protected statisticsManager: JointStatisticsManager;
    protected subscribers = new Set<(angleData: JointAngleData) => void>();
    protected latestAngle: JointAngleData | null = null;

    constructor(protected jointConfig: JointConfig, protected motionConfig: MotionConfig) {
        this.validateJointConfig(jointConfig);
        this.statisticsManager = new JointStatisticsManager(motionConfig.targetHz);
        this.angleCalculator = new AngleCalculationService(jointConfig, motionConfig);
    }

    /**
     * Processes device data and calculates joint angle if sufficient devices available.
     * Requires minimum of 2 devices for joint angle calculation.
     */
    processDevices(devices: Map<string, DeviceData>): JointAngleData | null {
        if (devices.size < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) return null;

        const deviceArray = Array.from(devices.values());
        const angle = this.calculateJointAngle(deviceArray);

        if (angle === null || !this.isValidAngle(angle)) return null;

        // Use latest device timestamp (already offset to system time in DeviceProcessor)
        const latestTimestamp = Math.max(...deviceArray.map(d => d.timestamp));
        const deviceIds = Array.from(devices.keys()); // Extract device IDs
        return this.createAndProcessAngleData(angle, latestTimestamp, deviceIds);
    }

    /**
     * Subscribes to joint angle updates, returns unsubscribe function.
     */
    subscribe(callback: (angleData: JointAngleData) => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Returns statistical summary for this joint's angle data.
     */
    getStats() {
        return this.statisticsManager.getStats(this.jointConfig.name);
    }

    /**
     * Resets statistical data and angle calculation state.
     */
    resetStats(): void {
        this.statisticsManager.resetStats(this.jointConfig.name);
        this.angleCalculator.resetAngleState();
    }

    /**
     * Returns most recently calculated angle data.
     */
    getLatestAngle(): JointAngleData | null {
        return this.latestAngle;
    }

    /**
     * Performs cleanup of subscribers and resets internal state.
     */
    cleanup(): void {
        this.subscribers.clear();
        this.statisticsManager.resetStats(this.jointConfig.name);
        this.angleCalculator.resetAngleState();
    }

    /**
     * Abstract method for joint-specific angle calculation implementation.
     */
    protected abstract calculateJointAngle(devices: DeviceData[]): number | null;

    /**
     * Validates joint configuration has required fields.
     */
    private validateJointConfig(config: JointConfig): void {
        if (!config.name || !config.topSensorPattern || !config.bottomSensorPattern) {
            throw new TypeError('Joint config must have name, topSensorPattern, and bottomSensorPattern');
        }
    }

    /**
     * Validates that calculated angle is a finite number.
     */
    private isValidAngle(angle: number | null): boolean {
        return angle !== null && isFinite(angle);
    }

    /**
     * Creates angle data object, updates statistics, and notifies subscribers.
     */
    private createAndProcessAngleData(angle: number, timestamp: number, deviceIds: string[]): JointAngleData {
        const processedAngle = roundToPrecision(angle);
        this.statisticsManager.updateStats(this.jointConfig.name, processedAngle);

        const angleData: JointAngleData = {
            jointName: this.jointConfig.name,
            angle: processedAngle,
            timestamp: timestamp, // Use device timestamp (already offset to system time)
            deviceIds: deviceIds // Device IDs that contributed to this angle
        };

        this.latestAngle = angleData;
        this.notifySubscribers(angleData);
        return angleData;
    }

    /**
     * Safely notifies all subscribers of new angle data.
     */
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
 * Uses Y-axis rotation for knee flexion/extension measurements.
 */
export class KneeJointProcessor extends JointProcessor {
    /**
     * Calculates knee joint angle using Y-axis rotation between sensor pairs.
     */
    protected calculateJointAngle(devices: DeviceData[]): number | null {
        return this.angleCalculator.calculateJointAngle(devices, 'y');
    }
}