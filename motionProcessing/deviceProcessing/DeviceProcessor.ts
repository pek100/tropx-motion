import { IMUData } from '../../muse_sdk/core/MuseData';
import { DeviceData, MotionConfig } from '../shared/types';
import { InterpolationService } from './InterpolationService';
import { DataSyncService } from './DataSyncService';
import { DEVICE, SYSTEM, BATTERY, CONNECTION_STATE } from '../shared/constants';
import { testDeviceAgainstPatterns } from '../shared/utils';
import { QuaternionService } from '../shared/QuaternionService';
import { PerformanceLogger } from '../shared/PerformanceLogger';

interface DeviceStatus {
    total: number;
    connected: number;
    lowBattery: number;
    recentlyActive: number;
}

/**
 * Manages device data processing, synchronization, and state tracking.
 * Coordinates between interpolation service, sync service, and joint processors
 * while maintaining device health monitoring and joint-device mapping.
 */
export class DeviceProcessor {
    private static instance: DeviceProcessor | null = null;
    private interpolationService: InterpolationService;
    private dataSyncService: DataSyncService;
    private subscribers = new Set<() => void>();
    private batteryLevels = new Map<string, number>();
    private connectionStates = new Map<string, string>();
    private latestDeviceData = new Map<string, DeviceData>();
    private deviceToJoints = new Map<string, string[]>();
    private interpolationSubscription: (() => void) | null = null;

    // Async notification state
    private pendingNotifications = 0;
    private readonly MAX_PENDING_NOTIFICATIONS = 5;
    private lastNotificationTime = 0;
    private readonly MIN_NOTIFICATION_INTERVAL = 16; // 60fps cap
    private processingCounter = 0;

    private constructor(private config: MotionConfig) {
        this.interpolationService = new InterpolationService(config.targetHz);
        this.dataSyncService = new DataSyncService();
        this.setupInterpolationSubscription();
    }

    /**
     * Returns singleton instance, creating it with provided configuration if needed.
     */
    static getInstance(config?: MotionConfig): DeviceProcessor {
        if (!DeviceProcessor.instance && config) {
            DeviceProcessor.instance = new DeviceProcessor(config);
        }
        return DeviceProcessor.instance!;
    }

    /**
     * Cleans up singleton instance and releases all resources.
     */
    static reset(): void {
        if (DeviceProcessor.instance) {
            DeviceProcessor.instance.cleanup();
            DeviceProcessor.instance = null;
        }
    }

    /**
     * Processes incoming IMU data through synchronization and interpolation pipeline.
     */
    processData(deviceId: string, imuData: IMUData): void {
        if (!deviceId || !imuData) return;

        // Periodic cleanup during high-throughput
        this.processingCounter++;
        if (this.processingCounter % 100 === 0) {
            this.performPeriodicCleanup();
        }

        const synchronizedIMU = this.dataSyncService.createSynchronizedIMUData(deviceId, imuData);
        if (!synchronizedIMU) return;

        this.ensureDeviceJointMapping(deviceId);

        // Optional bypass: emit raw sample directly without interpolation
        if (this.config.performance?.bypassInterpolation) {
            const rawTimestamp = synchronizedIMU.timestamp || performance.now();
            const deviceSample: DeviceData = {
                deviceId,
                quaternion: QuaternionService.normalize(synchronizedIMU.quaternion ?? QuaternionService.createIdentity()),
                timestamp: rawTimestamp,
                interpolated: false,
                connectionState: 'streaming' as any
            };
            this.updateLatestDeviceData(deviceSample);
            this.notifySubscribers();
            return;
        }

        this.interpolationService.processSample(deviceId, synchronizedIMU);
    }

    /**
     * Returns device data for all devices associated with specified joint.
     * Creates defensive copies to prevent external modification.
     */
    getDevicesForJoint(jointName: string): Map<string, DeviceData> {
        const matchingDevices = new Map<string, DeviceData>();

        this.deviceToJoints.forEach((joints, deviceId) => {
            if (joints.includes(jointName)) {
                const deviceData = this.latestDeviceData.get(deviceId);
                if (deviceData) {
                    matchingDevices.set(deviceId, this.cloneDeviceData(deviceData));
                }
            }
        });

        return matchingDevices;
    }

    /**
     * Updates battery level for specific device.
     */
    updateBatteryLevel(deviceId: string, level: number): void {
        this.batteryLevels.set(deviceId, level);
    }

    /**
     * Updates connection state for specific device.
     */
    updateConnectionState(deviceId: string, state: string): void {
        this.connectionStates.set(deviceId, state);
    }

    /**
     * Returns defensive copy of current battery levels map.
     */
    getBatteryLevels(): Map<string, number> {
        return new Map(this.batteryLevels);
    }

    /**
     * Returns defensive copy of current connection states map.
     */
    getConnectionStates(): Map<string, string> {
        return new Map(this.connectionStates);
    }

    /**
     * Subscribes to device data updates, returns unsubscribe function.
     */
    subscribe(callback: () => void): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Returns comprehensive device status summary for monitoring.
     */
    getDeviceStatus(): DeviceStatus {
        if (this.latestDeviceData.size === 0) {
            return { total: 0, connected: 0, lowBattery: 0, recentlyActive: 0 };
        }

        return {
            total: this.latestDeviceData.size,
            connected: this.countConnectedDevices(),
            lowBattery: this.countLowBatteryDevices(),
            recentlyActive: this.countRecentlyActiveDevices()
        };
    }

    /**
     * Initializes new recording session by resetting synchronization state.
     */
    startNewRecording(): void {
        this.dataSyncService.reset();
    }

    /**
     * Returns whether synchronization service is ready for coordinated data processing.
     */
    isSyncReady(): boolean {
        return this.dataSyncService.isReadyForSync();
    }

    /**
     * Performs complete cleanup of all services and internal state.
     * Enhanced to prevent event listener leaks.
     */
    cleanup(): void {
        // CRITICAL FIX: Clean up subscriptions first to prevent callback accumulation
        if (this.interpolationSubscription) {
            this.interpolationSubscription();
            this.interpolationSubscription = null;
        }

        // Clear subscribers explicitly before cleanup
        this.subscribers.clear();

        this.interpolationService.cleanup();
        this.dataSyncService.reset();
        this.clearAllMaps();

        console.log('🧹 DeviceProcessor cleanup completed');
    }


    /**
     * Establishes subscription to interpolation service for processed data.
     */
    private setupInterpolationSubscription(): void {
        this.interpolationSubscription = this.interpolationService.subscribe((interpolatedData: DeviceData[]) => {
            this.handleInterpolatedData(interpolatedData);
        });
    }

    /**
     * Processes interpolated data and notifies subscribers of updates.
     */
    private handleInterpolatedData(interpolatedData: DeviceData[]): void {
        if (interpolatedData.length === 0) return;

        let hasNewData = false;
        for (const deviceData of interpolatedData) {
            if (this.updateLatestDeviceData(deviceData)) {
                hasNewData = true;
            }
        }

        if (hasNewData) {
            this.notifySubscribers();
        }
    }

    /**
     * Updates latest device data if new data is more recent than current.
     */
    private updateLatestDeviceData(deviceData: DeviceData): boolean {
        const currentLatest = this.latestDeviceData.get(deviceData.deviceId);
        if (!currentLatest || deviceData.timestamp >= currentLatest.timestamp) {
            this.latestDeviceData.set(deviceData.deviceId, deviceData);
            return true;
        }
        return false;
    }

    /**
     * Ensures device has joint mapping by performing pattern matching if needed.
     */
    private ensureDeviceJointMapping(deviceId: string): void {
        if (!this.deviceToJoints.has(deviceId)) {
            const joints = this.findMatchingJoints(deviceId);
            this.deviceToJoints.set(deviceId, joints);
        }
    }

    /**
     * Finds all joints that match device ID based on configuration patterns.
     */
    private findMatchingJoints(deviceId: string): string[] {
        const matchingJoints: string[] = [];

        for (const jointConfig of this.config.joints) {
            if (this.deviceMatchesJoint(deviceId, jointConfig)) {
                matchingJoints.push(jointConfig.name);
            }
        }

        return matchingJoints;
    }

    /**
     * Tests if device ID matches any pattern defined for a joint configuration.
     */
    private deviceMatchesJoint(deviceId: string, jointConfig: any): boolean {
        return testDeviceAgainstPatterns(deviceId, jointConfig.topSensorPattern) ||
            testDeviceAgainstPatterns(deviceId, jointConfig.bottomSensorPattern);
    }

    /**
     * Creates deep copy of device data to prevent external mutations.
     */
    private cloneDeviceData(deviceData: DeviceData): DeviceData {
        return {
            ...deviceData,
            quaternion: { ...deviceData.quaternion }
        };
    }

    /**
     * Counts devices with connected or streaming connection states.
     */
    private countConnectedDevices(): number {
        let connected = 0;
        for (const [deviceId] of this.latestDeviceData) {
            const state = this.connectionStates.get(deviceId);
            if (state === CONNECTION_STATE.CONNECTED || state === CONNECTION_STATE.STREAMING) {
                connected++;
            }
        }
        return connected;
    }

    /**
     * Counts devices with battery levels below low threshold.
     */
    private countLowBatteryDevices(): number {
        let lowBattery = 0;
        for (const [deviceId] of this.latestDeviceData) {
            const batteryLevel = this.batteryLevels.get(deviceId);
            if (batteryLevel !== undefined && batteryLevel < BATTERY.LOW) {
                lowBattery++;
            }
        }
        return lowBattery;
    }

    /**
     * Counts devices that have sent data within recent activity window.
     */
    private countRecentlyActiveDevices(): number {
        const recentThreshold = this.calculateRecentThreshold();
        const now = performance.now();
        let recentlyActive = 0;

        for (const deviceData of this.latestDeviceData.values()) {
            if (now - deviceData.timestamp < recentThreshold) {
                recentlyActive++;
            }
        }

        return recentlyActive;
    }

    /**
     * Calculates recent activity threshold based on sampling rate and multiplier.
     */
    private calculateRecentThreshold(): number {
        return (SYSTEM.MILLISECONDS_PER_SECOND / this.config.targetHz) * DEVICE.RECENT_ACTIVITY_MULTIPLIER;
    }

    /**
     * Safely notifies all subscribers of data updates.
     */
    private notifySubscribers(): void {
        const now = performance.now();

        // Throttling: Enforce minimum interval between notifications
        if (now - this.lastNotificationTime < this.MIN_NOTIFICATION_INTERVAL) {
            return;
        }

        // Backpressure: Skip if too many notifications are pending
        if (this.pendingNotifications >= this.MAX_PENDING_NOTIFICATIONS) {
            return;
        }

        const runCallbacks = () => {
            this.pendingNotifications--;
            this.subscribers.forEach(callback => {
                try {
                    callback();
                } catch (error) {
                    PerformanceLogger.warn('DEVICE', 'Callback error', error);
                }
            });
        };

        this.lastNotificationTime = now;
        this.pendingNotifications++;

        // Always use async processing to prevent event loop blocking
        queueMicrotask(runCallbacks);
    }

    /**
     * Allows runtime updates of performance options (bypass/async notify).
     */
    updatePerformanceOptions(opts: { bypassInterpolation?: boolean; asyncNotify?: boolean }): void {
        this.config.performance = {
            ...this.config.performance,
            ...opts,
        };
    }

    /**
     * Performs periodic cleanup to prevent memory accumulation during long sessions.
     */
    private performPeriodicCleanup(): void {
        // Clean old device data (keep only last 100 entries)
        if (this.latestDeviceData.size > 100) {
            const entries = Array.from(this.latestDeviceData.entries());
            const sorted = entries.sort(([,a], [,b]) => b.timestamp - a.timestamp);

            this.latestDeviceData.clear();
            sorted.slice(0, 50).forEach(([id, data]) => {
                this.latestDeviceData.set(id, data);
            });
        }

        // Trigger interpolation service cleanup
        if (this.interpolationService && typeof this.interpolationService.performPeriodicCleanup === 'function') {
            this.interpolationService.performPeriodicCleanup();
        }

        PerformanceLogger.info('DEVICE', `Periodic cleanup: ${this.subscribers.size} subscribers, ${this.latestDeviceData.size} device entries`);
    }

    /**
     * Clears all internal maps and collections.
     */
    private clearAllMaps(): void {
        this.subscribers.clear();
        this.deviceToJoints.clear();
        this.latestDeviceData.clear();
        this.batteryLevels.clear();
        this.connectionStates.clear();
    }
}