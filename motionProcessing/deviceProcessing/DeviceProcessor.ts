import { IMUData, DeviceData, MotionConfig } from '../shared/types';
import { DataSyncService } from './DataSyncService';
import { DEVICE, SYSTEM, BATTERY, CONNECTION_STATE } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { PerformanceLogger } from '../shared/PerformanceLogger';
import { deviceRegistry, DeviceID } from '../../registry-management';

interface DeviceStatus {
    total: number;
    connected: number;
    lowBattery: number;
    recentlyActive: number;
}

/**
 * Manages device data processing and state tracking.
 * Processes raw quaternion data directly without interpolation for real-time responsiveness.
 * Maintains device health monitoring and joint-device mapping.
 *
 * ARCHITECTURE NOTE: Interpolation was removed because:
 * 1. It introduced lag during rapid movements (SLERP correction factor)
 * 2. Small buffers (4 samples) caused data loss during BLE jitter
 * 3. Real-time motion capture needs latest data, not smoothed/interpolated data
 * 4. The sensors already provide clean 100Hz data - no interpolation needed
 */
export class DeviceProcessor {
    private static instance: DeviceProcessor | null = null;
    private dataSyncService: DataSyncService;
    private subscribers = new Set<() => void>();
    private batteryLevels = new Map<string, number>();
    private connectionStates = new Map<string, string>();
    private latestDeviceData = new Map<string, DeviceData>();
    private deviceToJoints = new Map<string, string[]>();

    // Async notification state
    private pendingNotifications = 0;
    private readonly MAX_PENDING_NOTIFICATIONS = 5;
    private lastNotificationTime = 0;
    private readonly MIN_NOTIFICATION_INTERVAL = 16; // 60fps cap
    private processingCounter = 0;

    private constructor(private config: MotionConfig) {
        this.dataSyncService = new DataSyncService();
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
     * Removes device from all tracking maps when it disconnects.
     * CRITICAL: Must be called when device disconnects to prevent stale data affecting joint processing.
     * @param deviceId - DeviceID (0x11, 0x12, 0x21, 0x22) or device address string
     */
    removeDevice(deviceId: DeviceID | string): void {
        // Convert DeviceID to string for map lookups
        const deviceIdStr = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;

        console.log(`🧹 [DEVICE_PROCESSOR] Removing device ${deviceIdStr} from all tracking maps`);

        // Check what we're removing
        const hadDeviceData = this.latestDeviceData.has(deviceIdStr);
        const hadJointMapping = this.deviceToJoints.has(deviceIdStr);

        // Remove from all tracking maps
        this.latestDeviceData.delete(deviceIdStr);
        this.deviceToJoints.delete(deviceIdStr);
        this.batteryLevels.delete(deviceIdStr);
        this.connectionStates.delete(deviceIdStr);

        console.log(`✅ [DEVICE_PROCESSOR] Device ${deviceIdStr} removed (had data: ${hadDeviceData}, had joint mapping: ${hadJointMapping})`);

        // Log remaining devices for debugging
        console.log(`📊 [DEVICE_PROCESSOR] Remaining devices: ${Array.from(this.deviceToJoints.keys()).join(', ')}`);

        // Notify subscribers that device state has changed
        this.notifySubscribers();
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
     * @param deviceId - DeviceID (0x11, 0x12, 0x21, 0x22) for most efficient lookup
     */
    processData(deviceId: DeviceID | string, imuData: IMUData): void {
        if (!deviceId || !imuData) {
            console.error(`❌ [DEVICE_PROCESSOR] Invalid data: deviceId=${deviceId}, imuData=${!!imuData}`);
            return;
        }

        // Periodic cleanup during high-throughput
        this.processingCounter++;
        if (this.processingCounter % 100 === 0) {
            this.performPeriodicCleanup();
        }

        // Get device from registry using DeviceID (most efficient - O(1) lookup)
        const device = typeof deviceId === 'number'
            ? deviceRegistry.getDeviceByID(deviceId)
            : deviceRegistry.getDeviceByAddress(deviceId);

        // TODO: Fix device timestamp offset calculation
        // Currently device timestamps are showing 1975 after sync, causing stuck in loop
        // Issue: offset is 0ms even though it should be calculated
        // For now, use performance.now() for reliable timestamps
        // const deviceTimestamp = imuData.timestamp || 0;
        // const deviceIdKey = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;
        // if (!this.sessionOffsetCalculated) {
        //     this.sessionOffsetCalculated = new Set();
        // }
        // let clockOffset = device?.clockOffset || 0;
        // if (!this.sessionOffsetCalculated.has(deviceIdKey) && deviceTimestamp > 0 && device) {
        //     clockOffset = Date.now() - deviceTimestamp;
        //     device.clockOffset = clockOffset;
        //     deviceRegistry.setClockOffset(device.deviceID, clockOffset, 'fully_synced');
        //     this.sessionOffsetCalculated.add(deviceIdKey);
        //     console.log(`⏱️ [DEVICE_PROCESSOR] First packet - calculated offset for DeviceID 0x${device.deviceID.toString(16)}: ${clockOffset}ms (system: ${Date.now()}ms, device: ${deviceTimestamp}ms)`);
        // }
        // const systemTimestamp = deviceTimestamp + clockOffset;

        // Use Date.now() for absolute timestamps until device timestamp offset is fixed
        const systemTimestamp = Date.now();

        const synchronizedIMU = {
            ...imuData,
            timestamp: systemTimestamp
        };

        // Legacy software sync (DISABLED - kept for reference):
        // const synchronizedIMU = this.dataSyncService.createSynchronizedIMUData(deviceId, imuData);
        // if (!synchronizedIMU) return;

        // Update last seen timestamp in registry
        deviceRegistry.updateLastSeen(deviceId);

        // Convert DeviceID to string for legacy data structures
        const deviceIdStr = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;

        if (device) {
            // Ensure mapping exists (will be used by getDevicesForJoint)
            if (!this.deviceToJoints.has(deviceIdStr)) {
                this.deviceToJoints.set(deviceIdStr, [device.joint]);
            }
        }

        // Process raw quaternion data directly - no interpolation
        // This provides real-time responsiveness without lag or buffer-induced artifacts
        const rawTimestamp = synchronizedIMU.timestamp || performance.now();
        const deviceSample: DeviceData = {
            deviceId: deviceIdStr,
            quaternion: QuaternionService.normalize(synchronizedIMU.quaternion ?? QuaternionService.createIdentity()),
            timestamp: rawTimestamp,
            interpolated: false,
            connectionState: 'streaming' as any
        };

        this.updateLatestDeviceData(deviceSample);
        this.notifySubscribers();
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
     */
    cleanup(): void {
        // Clear subscribers explicitly before cleanup
        this.subscribers.clear();

        this.dataSyncService.reset();
        this.clearAllMaps();

        console.log('🧹 DeviceProcessor cleanup completed');
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
     * Notifies all subscribers of data updates.
     *
     * ARCHITECTURE NOTE: Throttling was REMOVED because:
     * 1. At 100Hz × 2 devices, 16ms throttle dropped 75% of updates
     * 2. Dropped updates caused "out of sync" after chaotic movement
     * 3. Each notification is only ~0.1ms of work - throttling is counterproductive
     * 4. Real-time motion capture needs every sample for accurate joint angles
     */
    private notifySubscribers(): void {
        // Notify synchronously for lowest latency - callbacks are fast
        this.subscribers.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error(`❌ [DEVICE_PROCESSOR] Subscriber callback error:`, error);
                PerformanceLogger.warn('DEVICE', 'Callback error', error);
            }
        });
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