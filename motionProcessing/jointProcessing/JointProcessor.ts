import { JointConfig, DeviceData, JointAngleData, MotionConfig, Quaternion } from '../shared/types';
import { AngleCalculationService, AngleCalculationResult } from './AngleCalculationService';
import { roundToPrecision } from '../shared/utils';
import { SYSTEM } from "../shared/constants";

// Module load verification
console.log('🔧 [JointProcessor] Module loaded');

/** Extended joint angle data including relative quaternion for recording. */
export interface JointAngleDataWithQuat extends JointAngleData {
    relativeQuat: Quaternion;
}

/**
 * Sorting buffer configuration for smooth real-time visualization.
 * DISABLED: DeviceProcessor now handles timestamp matching, so samples
 * already arrive in proper order. No need for additional buffering.
 */
const SORTING_BUFFER_CONFIG = {
    FLUSH_INTERVAL_MS: 16,
    ENABLED: false,  // Disabled - timestamp matching handles ordering
};

/**
 * Abstract base class for joint angle processing.
 */
export abstract class JointProcessor {
    protected angleCalculator: AngleCalculationService;
    protected subscribers = new Set<(angleData: JointAngleDataWithQuat) => void>();
    protected latestAngle: JointAngleData | null = null;

    // Sorting buffer for smooth real-time output
    private static sortingBuffer: JointAngleDataWithQuat[] = [];
    private static flushTimer: NodeJS.Timeout | null = null;
    private static subscribersMap = new Map<string, Set<(angleData: JointAngleDataWithQuat) => void>>();

    constructor(protected jointConfig: JointConfig, protected motionConfig: MotionConfig) {
        this.validateJointConfig(jointConfig);
        this.angleCalculator = new AngleCalculationService(jointConfig, motionConfig);

        // Register this processor's subscribers in the static map
        JointProcessor.subscribersMap.set(jointConfig.name, this.subscribers);

        // Start the flush timer if not already running
        if (SORTING_BUFFER_CONFIG.ENABLED && !JointProcessor.flushTimer) {
            JointProcessor.startFlushTimer();
        }
    }

    /** Start the periodic flush timer (static, shared across all processors). */
    private static startFlushTimer(): void {
        if (JointProcessor.flushTimer) return;

        console.log(`⏱️ [JointProcessor] Starting sorting buffer (${SORTING_BUFFER_CONFIG.FLUSH_INTERVAL_MS}ms flush interval)`);

        JointProcessor.flushTimer = setInterval(() => {
            JointProcessor.flushSortingBuffer();
        }, SORTING_BUFFER_CONFIG.FLUSH_INTERVAL_MS);
    }

    /** Stop the flush timer. */
    static stopFlushTimer(): void {
        if (JointProcessor.flushTimer) {
            clearInterval(JointProcessor.flushTimer);
            JointProcessor.flushTimer = null;
            console.log(`⏱️ [JointProcessor] Stopped sorting buffer timer`);
        }
        // Flush any remaining samples
        JointProcessor.flushSortingBuffer();
    }

    /** Flush the sorting buffer - sort by timestamp and emit to subscribers. */
    private static flushSortingBuffer(): void {
        if (JointProcessor.sortingBuffer.length === 0) return;

        // Sort by timestamp
        const sorted = JointProcessor.sortingBuffer.sort((a, b) => a.timestamp - b.timestamp);

        // Clear buffer before emitting (in case callbacks add new samples)
        JointProcessor.sortingBuffer = [];

        // Emit each sample to the appropriate joint's subscribers
        for (const angleData of sorted) {
            const subscribers = JointProcessor.subscribersMap.get(angleData.jointName);
            if (subscribers) {
                subscribers.forEach(callback => {
                    try {
                        callback(angleData);
                    } catch {
                        // Continue with other subscribers if one fails
                    }
                });
            }
        }
    }

    /** Add sample to sorting buffer (or emit directly if disabled). */
    private bufferOrEmit(angleData: JointAngleDataWithQuat): void {
        if (SORTING_BUFFER_CONFIG.ENABLED) {
            JointProcessor.sortingBuffer.push(angleData);
        } else {
            this.notifySubscribers(angleData);
        }
    }

    private static debugCalcFailCount = new Map<string, number>();

    processDevices(devices: Map<string, DeviceData>, triggeringTimestamp?: number): JointAngleDataWithQuat | null {
        if (devices.size < SYSTEM.MINIMUM_DEVICES_FOR_JOINT) {
            console.warn(`⚠️ [JointProcessor] ${this.jointConfig.name}: devices.size=${devices.size} < ${SYSTEM.MINIMUM_DEVICES_FOR_JOINT}`);
            return null;
        }

        const deviceArray = Array.from(devices.values());
        const result = this.calculateJointAngle(deviceArray);

        if (!result || !this.isValidAngle(result.angle)) {
            // Track calculation failures per joint
            const count = (JointProcessor.debugCalcFailCount.get(this.jointConfig.name) || 0) + 1;
            JointProcessor.debugCalcFailCount.set(this.jointConfig.name, count);
            if (count <= 5 || count % 100 === 0) {
                console.warn(`⚠️ [JointProcessor] ${this.jointConfig.name}: angle calc failed (count=${count}), result=${JSON.stringify(result)}`);
            }
            return null;
        }

        // Use the triggering device's timestamp (spread at source) instead of max()
        // This ensures each sample gets the correct timestamp from the device that just updated,
        // rather than a stale timestamp from another device that hasn't sent data yet
        const timestamp = triggeringTimestamp ?? Math.max(...deviceArray.map(d => d.timestamp));
        const deviceIds = Array.from(devices.keys());
        return this.createAndProcessAngleData(result.angle, result.relativeQuat, timestamp, deviceIds);
    }

    subscribe(callback: (angleData: JointAngleDataWithQuat) => void): () => void {
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

        // Remove this processor from the subscribers map
        JointProcessor.subscribersMap.delete(this.jointConfig.name);

        // If no more processors, stop the timer
        if (JointProcessor.subscribersMap.size === 0) {
            JointProcessor.stopFlushTimer();
        }
    }

    /** Reset the sorting buffer (call when starting a new streaming session). */
    static resetSortingBuffer(): void {
        JointProcessor.sortingBuffer = [];
        console.log(`⏱️ [JointProcessor] Sorting buffer reset`);
    }

    protected abstract calculateJointAngle(devices: DeviceData[]): AngleCalculationResult | null;

    private validateJointConfig(config: JointConfig): void {
        if (!config.name || !config.topSensorPattern || !config.bottomSensorPattern) {
            throw new TypeError('Joint config must have name, topSensorPattern, and bottomSensorPattern');
        }
    }

    private isValidAngle(angle: number | null): boolean {
        return angle !== null && isFinite(angle);
    }

    private static debugSampleCount = 0;

    private createAndProcessAngleData(angle: number, relativeQuat: Quaternion, timestamp: number, deviceIds: string[]): JointAngleDataWithQuat {
        const processedAngle = roundToPrecision(angle);

        const angleData: JointAngleDataWithQuat = {
            jointName: this.jointConfig.name,
            angle: processedAngle,
            timestamp: timestamp,
            deviceIds: deviceIds,
            relativeQuat: relativeQuat
        };

        // Debug: log first few samples to verify quaternion is attached
        JointProcessor.debugSampleCount++;
        if (JointProcessor.debugSampleCount <= 5) {
            console.log(`🔢 [JointProcessor] Sample #${JointProcessor.debugSampleCount}: joint=${angleData.jointName}, quat=[${relativeQuat.w.toFixed(3)}, ${relativeQuat.x.toFixed(3)}, ${relativeQuat.y.toFixed(3)}, ${relativeQuat.z.toFixed(3)}]`);
        }

        // Note: Recording push moved to JointSynchronizer for unified timestamp handling
        this.latestAngle = angleData;

        // Use sorting buffer for smooth real-time output
        this.bufferOrEmit(angleData);
        return angleData;
    }

    private notifySubscribers(angleData: JointAngleDataWithQuat): void {
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
    protected calculateJointAngle(devices: DeviceData[]): AngleCalculationResult | null {
        return this.angleCalculator.calculateJointAngle(devices, 'y');
    }
}
