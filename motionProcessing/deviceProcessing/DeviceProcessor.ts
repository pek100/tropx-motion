import { IMUData, DeviceData, MotionConfig } from '../shared/types';
import { DEVICE, SYSTEM, BATTERY, CONNECTION_STATE } from '../shared/constants';
import { QuaternionService } from '../shared/QuaternionService';
import { UnifiedBLEStateStore, DeviceID, isValidDeviceID, getJointName } from '../../ble-management';

interface DeviceStatus {
    total: number;
    connected: number;
    lowBattery: number;
    recentlyActive: number;
}

type JointUpdateCallback = (jointName: string, devices: Map<string, DeviceData>) => void;

/**
 * Manages device data processing and state tracking.
 * Processes raw quaternion data directly for real-time responsiveness.
 */
export class DeviceProcessor {
    private static instance: DeviceProcessor | null = null;
    private jointUpdateCallback: JointUpdateCallback | null = null;
    private batteryLevels = new Map<string, number>();
    private connectionStates = new Map<string, string>();
    private latestDeviceData = new Map<string, DeviceData>();
    private deviceToJoints = new Map<string, string[]>();
    private processingCounter = 0;

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

        console.log(`🧹 [DEVICE_PROCESSOR] Device ${deviceIdStr} removed`);
    }

    static reset(): void {
        if (DeviceProcessor.instance) {
            DeviceProcessor.instance.cleanup();
            DeviceProcessor.instance = null;
        }
    }

    processData(deviceId: DeviceID | string, imuData: IMUData): void {
        if (!deviceId || !imuData) {
            console.error(`❌ [DEVICE_PROCESSOR] Invalid data: deviceId=${deviceId}, imuData=${!!imuData}`);
            return;
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
        const systemTimestamp = Date.now();

        if (resolvedDeviceId) {
            UnifiedBLEStateStore.updateLastSeen(resolvedDeviceId);
        }

        const deviceIdStr = typeof deviceId === 'number' ? `0x${deviceId.toString(16)}` : deviceId;

        if (jointName && !this.deviceToJoints.has(deviceIdStr)) {
            this.deviceToJoints.set(deviceIdStr, [jointName]);
        }

        const deviceSample: DeviceData = {
            deviceId: deviceIdStr,
            quaternion: QuaternionService.normalize(imuData.quaternion ?? QuaternionService.createIdentity()),
            timestamp: systemTimestamp,
            interpolated: false,
            connectionState: 'streaming' as any
        };

        this.updateLatestDeviceData(deviceSample);
        this.processAffectedJoints(deviceIdStr);
    }

    private processAffectedJoints(deviceId: string): void {
        if (!this.jointUpdateCallback) return;

        const joints = this.deviceToJoints.get(deviceId);
        if (!joints || joints.length === 0) return;

        for (const jointName of joints) {
            const devices = this.getDevicesForJoint(jointName);
            if (devices.size >= SYSTEM.MINIMUM_DEVICES_FOR_JOINT) {
                this.jointUpdateCallback(jointName, devices);
            }
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
    }
}
