import { IMUData, DeviceData, MotionConfig } from '../shared/types';
import { InterpolationService } from './InterpolationService';
import { DataSyncService } from './DataSyncService';
import { DEVICE, SYSTEM, BATTERY, CONNECTION_STATE } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { PerformanceLogger } from '../shared/PerformanceLogger';
import { deviceRegistry } from '../../registry-management';

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
        // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
        // console.log(`🔧 [DEVICE_PROCESSOR] processData called for ${deviceId}:`, {
        //     deviceId: deviceId,
        //     hasQuaternion: !!imuData.quaternion,
        //     timestamp: imuData.timestamp
        // });

        if (!deviceId || !imuData) {
            console.error(`❌ [DEVICE_PROCESSOR] Invalid data: deviceId=${deviceId}, imuData=${!!imuData}`);
            return;
        }

        // Periodic cleanup during high-throughput
        this.processingCounter++;
        if (this.processingCounter % 100 === 0) {
            this.performPeriodicCleanup();
        }

        // HARDWARE SYNC: Devices now use hardware clock offset (SET_CLOCK_OFFSET command)
        // Timestamps are already synchronized via BLE hardware sync, no software correction needed
        // Software sync is DISABLED to avoid double-syncing and interference
        const synchronizedIMU = imuData; // Use hardware-synced timestamp directly

        // Legacy software sync (DISABLED - kept for reference):
        // const synchronizedIMU = this.dataSyncService.createSynchronizedIMUData(deviceId, imuData);
        // if (!synchronizedIMU) return;

        // Update last seen timestamp in registry (fast O(1) lookup)
        deviceRegistry.updateLastSeen(deviceId);

        // Get device-to-joint mapping from registry (no pattern matching needed)
        const device = deviceRegistry.getDeviceByName(deviceId);
        if (device) {
            // Ensure mapping exists (will be used by getDevicesForJoint)
            if (!this.deviceToJoints.has(deviceId)) {
                this.deviceToJoints.set(deviceId, [device.joint]);
            }
        }

        // Optional bypass: emit raw sample directly without interpolation
        if (this.config.performance?.bypassInterpolation) {
            console.log(`🚀 [DEVICE_PROCESSOR] Bypassing interpolation for ${deviceId} - emitting raw sample`);
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
            console.log(`✅ [DEVICE_PROCESSOR] Raw sample processed and subscribers notified for ${deviceId}`);
            return;
        }

        // DISABLED for performance (100Hz × 2 devices = 200 logs/sec causes stuttering)
        // console.log(`🔄 [DEVICE_PROCESSOR] Sending ${deviceId} to interpolation service`);
        this.interpolationService.processSample(deviceId, synchronizedIMU);
    }

    /**
     * Returns device data for all devices associated with specified joint.
     * Creates defensive copies to prevent external modification.
     */
    getDevicesForJoint(jointName: string): Map<string, DeviceData> {
        // PERFORMANCE FIX: Return direct references instead of clones
        // Cloning 800 objects/sec (4 devices × 2 joints × 100Hz) causes GC pressure
        // Joint processors should treat data as read-only

        const matchingDevices = new Map<string, DeviceData>();

        // PERFORMANCE: Use for...of instead of forEach (faster in hot path)
        for (const [deviceId, joints] of this.deviceToJoints) {
            if (joints.includes(jointName)) {
                const deviceData = this.latestDeviceData.get(deviceId);
                if (deviceData) {
                    // Return direct reference - processors MUST NOT mutate!
                    matchingDevices.set(deviceId, deviceData);
                } else {
                    // Keep error logs for debugging
                    console.warn(`⚠️ [DEVICE_PROCESSOR] Device ${deviceId} has no data for joint ${jointName}`);
                }
            }
        }

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
     * DEPRECATED: Replaced by DeviceRegistry
     * Device-to-joint mapping now happens at connection time via deviceRegistry.registerDevice()
     * This eliminates on-demand pattern matching during data processing (was called at 100Hz!)
     *
     * The mapping is now:
     * 1. Set once when device connects (NobleBLEServiceAdapter.connectToDevice)
     * 2. Stored in deviceToJoints map (populated in processData from registry lookup)
     * 3. Never needs pattern matching during runtime
     */

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
        // DISABLED for performance (called at 100Hz)
        // console.log(`🔔 [DEVICE_PROCESSOR] notifySubscribers called:`, {
        //     subscriberCount: this.subscribers.size,
        //     latestDeviceDataCount: this.latestDeviceData.size,
        //     deviceIds: Array.from(this.latestDeviceData.keys())
        // });

        const now = performance.now();

        // Throttling: Enforce minimum interval between notifications
        if (now - this.lastNotificationTime < this.MIN_NOTIFICATION_INTERVAL) {
            // DISABLED for performance (called at 100Hz)
            // console.log(`⏳ [DEVICE_PROCESSOR] Throttled - too soon since last notification`);
            return;
        }

        // Backpressure: Skip if too many notifications are pending
        if (this.pendingNotifications >= this.MAX_PENDING_NOTIFICATIONS) {
            // DISABLED for performance (called at 100Hz)
            // console.log(`⚠️ [DEVICE_PROCESSOR] Backpressure - too many pending notifications`);
            return;
        }

        const runCallbacks = () => {
            this.pendingNotifications--;
            // DISABLED for performance (called at 100Hz)
            // console.log(`📢 [DEVICE_PROCESSOR] Calling ${this.subscribers.size} subscribers`);
            this.subscribers.forEach(callback => {
                try {
                    callback();
                } catch (error) {
                    console.error(`❌ [DEVICE_PROCESSOR] Subscriber callback error:`, error);
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

        // DISABLED: Cleanup logging is noisy and unnecessary
        // PerformanceLogger.info('DEVICE', `Periodic cleanup: ${this.subscribers.size} subscribers, ${this.latestDeviceData.size} device entries`);
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