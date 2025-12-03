import { IMUData, DeviceData, MotionConfig } from '../shared/types';
import { DataSyncService } from './DataSyncService';
import { DEVICE, SYSTEM, BATTERY, CONNECTION_STATE } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { PerformanceLogger } from '../shared/PerformanceLogger';
import { UnifiedBLEStateStore, DeviceID, isValidDeviceID, getJointName } from '../../ble-management';

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
// Callback signature for per-joint processing
type JointUpdateCallback = (jointName: string, devices: Map<string, DeviceData>) => void;

export class DeviceProcessor {
    private static instance: DeviceProcessor | null = null;
    private dataSyncService: DataSyncService;
    private jointUpdateCallback: JointUpdateCallback | null = null;
    private batteryLevels = new Map<string, number>();
    private connectionStates = new Map<string, string>();
    private latestDeviceData = new Map<string, DeviceData>();
    private deviceToJoints = new Map<string, string[]>();
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

        // Resolve DeviceID from input (may be numeric DeviceID or BLE address string)
        let resolvedDeviceId: DeviceID | null = null;
        if (typeof deviceId === 'number' && isValidDeviceID(deviceId)) {
            resolvedDeviceId = deviceId;
        } else if (typeof deviceId === 'string') {
            resolvedDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        }

        // Get joint name from DeviceID
        const jointName = resolvedDeviceId ? getJointName(resolvedDeviceId) : null;

        // TODO: Fix device timestamp offset calculation
        // Currently device timestamps are showing 1975 after sync, causing stuck in loop
        // For now, use Date.now() for reliable timestamps
        // Future: Use UnifiedBLEStateStore.getDevice(deviceId).clockOffset
        const systemTimestamp = Date.now();

        const synchronizedIMU = {
            ...imuData,
            timestamp: systemTimestamp
        };

        // Update last seen timestamp in UnifiedBLEStateStore
        if (resolvedDeviceId) {
            UnifiedBLEStateStore.updateLastSeen(resolvedDeviceId);
        }

        // Convert DeviceID to string for legacy data structures
        const deviceIdStr = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;

        if (jointName) {
            // Ensure mapping exists (will be used by getDevicesForJoint)
            if (!this.deviceToJoints.has(deviceIdStr)) {
                this.deviceToJoints.set(deviceIdStr, [jointName]);
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

        // Direct per-joint processing - no batching, no subscriber overhead
        // Only process the joint(s) this device belongs to
        this.processAffectedJoints(deviceIdStr);
    }

    /**
     * Processes joints immediately when new device data arrives.
     * No sync barrier or interpolation - uses latest available data from each device.
     */
    private processAffectedJoints(deviceId: string): void {
        if (!this.jointUpdateCallback) return;

        const joints = this.deviceToJoints.get(deviceId);
        if (!joints || joints.length === 0) return;

        for (const jointName of joints) {
            // Get all devices for this joint with latest data
            const devices = this.getDevicesForJoint(jointName);

            // Process immediately if we have minimum required devices
            if (devices.size >= SYSTEM.MINIMUM_DEVICES_FOR_JOINT) {
                this.jointUpdateCallback(jointName, devices);
            }
        }
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
     * Sets the callback for per-joint updates.
     * This replaces the old subscriber pattern for more efficient direct processing.
     *
     * @param callback - Called with (jointName, devices) when a joint has sufficient data
     */
    setJointUpdateCallback(callback: JointUpdateCallback): void {
        this.jointUpdateCallback = callback;
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
        this.dataSyncService.reset();
        this.clearAllMaps();

        console.log('🧹 DeviceProcessor cleanup completed');
    }

    /**
     * Updates latest device data.
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
     * DEPRECATED: Replaced by UnifiedBLEStateStore
     * Device-to-joint mapping now happens at connection time via UnifiedBLEStateStore.registerDevice()
     * This eliminates on-demand pattern matching during data processing (was called at 100Hz!)
     *
     * The mapping is now:
     * 1. Set once when device connects (BLEServiceAdapter.connectToDevice)
     * 2. Stored in deviceToJoints map (populated in processData from getJointName() lookup)
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
        this.jointUpdateCallback = null;
        this.deviceToJoints.clear();
        this.latestDeviceData.clear();
        this.batteryLevels.clear();
        this.connectionStates.clear();
    }
}