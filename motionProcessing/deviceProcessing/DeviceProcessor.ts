import { IMUData, DeviceData, MotionConfig, Quaternion } from '../shared/types';
import { DEVICE, SYSTEM, BATTERY, CONNECTION_STATE } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { UnifiedBLEStateStore, DeviceID, isValidDeviceID, getJointName } from '../../ble-management';

interface DeviceStatus {
    total: number;
    connected: number;
    lowBattery: number;
    recentlyActive: number;
}

/**
 * Sample entry for timestamp matching.
 */
interface DeviceSample {
    quaternion: Quaternion;
    timestamp: number;
}

/**
 * "Latest value" fusion strategy (flight controller approach).
 * When ANY sensor updates, combine with latest values from all other sensors.
 * No buffering = zero added latency.
 */

type JointUpdateCallback = (jointName: string, devices: Map<string, DeviceData>, triggeringTimestamp: number) => void;

/**
 * Manages device data processing and state tracking.
 * Processes raw quaternion data directly for real-time responsiveness.
 *
 * Note: Timestamp spreading is handled at the source (TropXDevice.ts)
 * to ensure all downstream consumers receive properly spaced timestamps.
 */
export class DeviceProcessor {
    private static instance: DeviceProcessor | null = null;
    private jointUpdateCallback: JointUpdateCallback | null = null;
    private batteryLevels = new Map<string, number>();
    private connectionStates = new Map<string, string>();
    private latestDeviceData = new Map<string, DeviceData>();
    private deviceToJoints = new Map<string, string[]>();
    private processingCounter = 0;

    /** Latest sample per device - "flight controller" approach: always use most recent */
    private latestSamples = new Map<string, DeviceSample>();

    /** Debug counters for tracing sample flow */
    private static debugEmitCount = new Map<string, number>();
    private static debugDropCount = new Map<string, number>();

    private constructor(private config: MotionConfig) {}

    static getInstance(config?: MotionConfig): DeviceProcessor {
        if (!DeviceProcessor.instance && config) {
            DeviceProcessor.instance = new DeviceProcessor(config);
        }
        return DeviceProcessor.instance!;
    }

    removeDevice(deviceId: DeviceID | string): void {
        const deviceIdStr = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;

        this.latestDeviceData.delete(deviceIdStr);
        this.deviceToJoints.delete(deviceIdStr);
        this.batteryLevels.delete(deviceIdStr);
        this.connectionStates.delete(deviceIdStr);
        this.latestSamples.delete(deviceIdStr);

        console.log(`🧹 [DEVICE_PROCESSOR] Device ${deviceIdStr} removed`);
    }

    /** Store latest sample for device (replaces buffering) */
    private setLatestSample(deviceId: string, sample: DeviceSample): void {
        this.latestSamples.set(deviceId, sample);
    }

    /** Get latest sample from device (no buffering, immediate) */
    private getLatestSample(deviceId: string): DeviceSample | null {
        return this.latestSamples.get(deviceId) || null;
    }

    static reset(): void {
        if (DeviceProcessor.instance) {
            DeviceProcessor.instance.cleanup();
            DeviceProcessor.instance = null;
        }
    }

    /** Reset debug counters for fresh logging (call when starting recording). */
    static resetDebugCounters(): void {
        DeviceProcessor.debugPacketCount = 0;
        DeviceProcessor.lastProcessedTs.clear();
    }

    /** Reset timestamp tracking for new recording session.
     *  IMPORTANT: Must be called when starting a new recording to prevent
     *  monotonic timestamp check from blocking samples based on previous recording's timestamps.
     */
    static resetForNewRecording(): void {
        if (DeviceProcessor.instance) {
            DeviceProcessor.instance.latestSamples.clear();
            console.log('🔄 [DEVICE_PROCESSOR] Reset for new recording');
        }
        DeviceProcessor.resetDebugCounters();
        // Reset emit/drop debug counters
        DeviceProcessor.debugEmitCount.clear();
        DeviceProcessor.debugDropCount.clear();
    }

    private static debugPacketCount = 0;
    private static lastProcessedTs = new Map<string, number>();

    processData(deviceId: DeviceID | string, imuData: IMUData): void {
        if (!deviceId || !imuData) {
            console.error(`❌ [DEVICE_PROCESSOR] Invalid data: deviceId=${deviceId}, imuData=${!!imuData}`);
            return;
        }

        const deviceIdStr = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;

        // Calculate delta from last timestamp for this device to verify spreading
        const lastTs = DeviceProcessor.lastProcessedTs.get(deviceIdStr);
        const delta = lastTs !== undefined ? imuData.timestamp - lastTs : 0;
        DeviceProcessor.lastProcessedTs.set(deviceIdStr, imuData.timestamp);

        // Debug: log first few packets with timestamp delta
        DeviceProcessor.debugPacketCount++;
        if (DeviceProcessor.debugPacketCount <= 20) {
            console.log(`📥 [DeviceProcessor] Packet #${DeviceProcessor.debugPacketCount}: device=${deviceIdStr.slice(-8)}, ts=${imuData.timestamp}, delta=${delta.toFixed(1)}ms`);
        }

        this.processingCounter++;
        if (this.processingCounter % 100 === 0) {
            this.performPeriodicCleanup();
        }

        let resolvedDeviceId: DeviceID | null = null;
        if (typeof deviceId === 'number' && isValidDeviceID(deviceId)) {
            resolvedDeviceId = deviceId;
        } else if (typeof deviceId === 'string') {
            resolvedDeviceId = UnifiedBLEStateStore.getDeviceIdByAddress(deviceId);
        }

        const jointName = resolvedDeviceId ? getJointName(resolvedDeviceId) : null;

        if (resolvedDeviceId) {
            UnifiedBLEStateStore.updateLastSeen(resolvedDeviceId);
        }

        if (jointName && !this.deviceToJoints.has(deviceIdStr)) {
            this.deviceToJoints.set(deviceIdStr, [jointName]);
        }

        // Timestamp already spread at source (TropXDevice.ts)
        // Use it directly - no additional processing needed
        const deviceSample: DeviceData = {
            deviceId: deviceIdStr,
            quaternion: QuaternionService.normalize(imuData.quaternion ?? QuaternionService.createIdentity()),
            timestamp: imuData.timestamp,
            interpolated: false,
            connectionState: 'streaming' as any
        };

        this.updateLatestDeviceData(deviceSample);

        // Store latest sample (flight controller approach - no buffering)
        this.setLatestSample(deviceIdStr, {
            quaternion: deviceSample.quaternion,
            timestamp: deviceSample.timestamp
        });

        // Trigger joint angle calculation using latest values from all sensors
        if (this.jointUpdateCallback) {
            const joints = this.deviceToJoints.get(deviceIdStr);
            if (joints && joints.length > 0) {
                for (const jointName of joints) {
                    // Get the OTHER device's ID for this joint
                    let otherDeviceId: string | null = null;
                    for (const [devId, devJoints] of this.deviceToJoints) {
                        if (devId !== deviceIdStr && devJoints.includes(jointName)) {
                            otherDeviceId = devId;
                            break;
                        }
                    }

                    if (!otherDeviceId) {
                        // Debug: track when no other device found
                        const dropKey = `${jointName}:no_other`;
                        DeviceProcessor.debugDropCount.set(dropKey, (DeviceProcessor.debugDropCount.get(dropKey) || 0) + 1);
                        continue;
                    }

                    // Flight controller approach: ALWAYS emit on every sensor update
                    // otherSample = last available quaternion from the other sensor (persists between updates)
                    const otherSample = this.getLatestSample(otherDeviceId);

                    // Only skip if other sensor has NEVER reported (no last available)
                    // Once it reports once, we always have a "last available" to use
                    if (!otherSample) {
                        const dropKey = `${jointName}:no_sample`;
                        DeviceProcessor.debugDropCount.set(dropKey, (DeviceProcessor.debugDropCount.get(dropKey) || 0) + 1);
                        continue;
                    }

                    // Use MAX of both timestamps - other sensor's timestamp is from its last update
                    const emitTimestamp = Math.max(imuData.timestamp, otherSample.timestamp);

                    // Build matched devices using LAST AVAILABLE quaternion from other sensor
                    const matchedDevices = new Map<string, DeviceData>();
                    matchedDevices.set(deviceIdStr, deviceSample);
                    matchedDevices.set(otherDeviceId, {
                        deviceId: otherDeviceId,
                        quaternion: otherSample.quaternion, // Last available - always valid
                        timestamp: otherSample.timestamp,
                        interpolated: false,
                        connectionState: 'streaming' as any
                    });

                    this.jointUpdateCallback(jointName, matchedDevices, emitTimestamp);

                    // Debug: track successful emits
                    DeviceProcessor.debugEmitCount.set(jointName, (DeviceProcessor.debugEmitCount.get(jointName) || 0) + 1);
                }
            }
        }

        // Debug: periodic logging of emit/drop stats
        if (DeviceProcessor.debugPacketCount === 50 || DeviceProcessor.debugPacketCount === 200) {
            console.log(`📊 [DEVICE_PROC_DEBUG] Packet #${DeviceProcessor.debugPacketCount}`);
            console.log(`📊 [DEVICE_PROC_DEBUG] Emit counts:`, Object.fromEntries(DeviceProcessor.debugEmitCount));
            console.log(`📊 [DEVICE_PROC_DEBUG] Drop counts:`, Object.fromEntries(DeviceProcessor.debugDropCount));
            console.log(`📊 [DEVICE_PROC_DEBUG] latestSamples keys:`, Array.from(DeviceProcessor.instance?.latestSamples.keys() || []));
            console.log(`📊 [DEVICE_PROC_DEBUG] deviceToJoints:`, Object.fromEntries(DeviceProcessor.instance?.deviceToJoints || []));
        }
    }

    getDevicesForJoint(jointName: string): Map<string, DeviceData> {
        const matchingDevices = new Map<string, DeviceData>();

        for (const [deviceId, joints] of this.deviceToJoints) {
            if (joints.includes(jointName)) {
                const deviceData = this.latestDeviceData.get(deviceId);
                if (deviceData) {
                    matchingDevices.set(deviceId, deviceData);
                }
            }
        }

        return matchingDevices;
    }

    updateBatteryLevel(deviceId: string, level: number): void {
        this.batteryLevels.set(deviceId, level);
    }

    updateConnectionState(deviceId: string, state: string): void {
        this.connectionStates.set(deviceId, state);
    }

    getBatteryLevels(): Map<string, number> {
        return new Map(this.batteryLevels);
    }

    getConnectionStates(): Map<string, string> {
        return new Map(this.connectionStates);
    }

    setJointUpdateCallback(callback: JointUpdateCallback): void {
        this.jointUpdateCallback = callback;
    }

    /** Get debug stats for pipeline analysis */
    static getDebugStats(): {
        emitCounts: Record<string, number>;
        dropCounts: Record<string, number>;
        latestSampleDevices: string[];
        deviceToJoints: Record<string, string[]>;
    } {
        return {
            emitCounts: Object.fromEntries(DeviceProcessor.debugEmitCount),
            dropCounts: Object.fromEntries(DeviceProcessor.debugDropCount),
            latestSampleDevices: Array.from(DeviceProcessor.instance?.latestSamples.keys() || []),
            deviceToJoints: Object.fromEntries(
                Array.from(DeviceProcessor.instance?.deviceToJoints.entries() || [])
            )
        };
    }

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

    cleanup(): void {
        this.clearAllMaps();
        console.log('🧹 DeviceProcessor cleanup completed');
    }

    updatePerformanceOptions(opts: { bypassInterpolation?: boolean; asyncNotify?: boolean }): void {
        this.config.performance = { ...this.config.performance, ...opts };
    }

    performPeriodicCleanup(): void {
        if (this.latestDeviceData.size > 100) {
            const entries = Array.from(this.latestDeviceData.entries());
            const sorted = entries.sort(([,a], [,b]) => b.timestamp - a.timestamp);

            this.latestDeviceData.clear();
            sorted.slice(0, 50).forEach(([id, data]) => {
                this.latestDeviceData.set(id, data);
            });
        }
    }

    private updateLatestDeviceData(deviceData: DeviceData): boolean {
        const currentLatest = this.latestDeviceData.get(deviceData.deviceId);
        if (!currentLatest || deviceData.timestamp >= currentLatest.timestamp) {
            this.latestDeviceData.set(deviceData.deviceId, deviceData);
            return true;
        }
        return false;
    }

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

    private countRecentlyActiveDevices(): number {
        const recentThreshold = (SYSTEM.MILLISECONDS_PER_SECOND / this.config.targetHz) * DEVICE.RECENT_ACTIVITY_MULTIPLIER;
        const now = performance.now();
        let recentlyActive = 0;

        for (const deviceData of this.latestDeviceData.values()) {
            if (now - deviceData.timestamp < recentThreshold) {
                recentlyActive++;
            }
        }

        return recentlyActive;
    }

    private clearAllMaps(): void {
        this.jointUpdateCallback = null;
        this.deviceToJoints.clear();
        this.latestDeviceData.clear();
        this.batteryLevels.clear();
        this.connectionStates.clear();
        this.latestSamples.clear();
    }
}
