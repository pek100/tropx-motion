
import { DeviceProcessor } from './deviceProcessing/DeviceProcessor';
import { JointProcessor, KneeJointProcessor } from './jointProcessing/JointProcessor';
import { UIProcessor } from './uiProcessing/UIProcessor';
import { MotionConfig, IMUData, SessionContext, JointAngleData, DeviceData } from './shared/types';
import { createMotionConfig, PerformanceProfile } from './shared/config';
import { PerformanceLogger } from './shared/PerformanceLogger';
import { DeviceID } from '../ble-management';

interface RecordingStatus {
    isRecording: boolean;
    sessionContext: SessionContext | null;
}

/**
 * Central coordinator for motion processing system.
 * Manages data flow between device processing, joint calculations, and UI updates.
 */
export class MotionProcessingCoordinator {
    private static instance: MotionProcessingCoordinator | null = null;
    private deviceProcessor!: DeviceProcessor;
    private jointProcessors = new Map<string, JointProcessor>();
    private uiProcessor!: UIProcessor;
    private isRecording = false;
    private sessionContext: SessionContext | null = null;
    private isInitialized = false;
    private performanceInterval: NodeJS.Timeout | null = null;

    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

    private constructor(private config: MotionConfig) {
        try {
            this.initializeServices();
            this.initializeJointProcessors();
            this.setupDataFlow();
            this.startPerformanceMonitoring();
            this.isInitialized = true;
            console.log('✅ MotionProcessingCoordinator initialized successfully');
        } catch (error) {
            this.isInitialized = false;
            console.error('❌ MotionProcessingCoordinator initialization failed:', error);
            throw error;
        }
    }

    static getInstance(config?: MotionConfig): MotionProcessingCoordinator {
        if (!MotionProcessingCoordinator.instance) {
            MotionProcessingCoordinator.instance = new MotionProcessingCoordinator(
                config || createMotionConfig(PerformanceProfile.HZ_100_SAMPLING)
            );
        }
        return MotionProcessingCoordinator.instance;
    }

    setWebSocketBroadcast(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
        this.webSocketBroadcast = broadcastFn;
        if (this.uiProcessor) {
            this.uiProcessor.setWebSocketBroadcast(broadcastFn);
        }
    }

    static reset(): void {
        if (MotionProcessingCoordinator.instance) {
            MotionProcessingCoordinator.instance.cleanup();
            MotionProcessingCoordinator.instance = null;
        }
    }

    processNewData(deviceId: DeviceID | string, imuData: IMUData): void {
        if (!this.isInitialized) {
            console.error(`❌ [MOTION_COORDINATOR] Not initialized - cannot process data from ${deviceId}`);
            return;
        }

        const start = performance.now();
        this.deviceProcessor.processData(deviceId, imuData);
        const duration = performance.now() - start;

        if (duration > 1) {
            console.warn(`⚠️ [COORD] Slow processing for ${deviceId}: ${duration.toFixed(2)}ms`);
        }
    }

    removeDevice(deviceId: DeviceID | string): void {
        console.log(`🧹 [MOTION_COORDINATOR] Removing device ${deviceId} from motion processing`);
        this.deviceProcessor.removeDevice(deviceId);
    }

    startRecording(sessionId: string, exerciseId: string, setNumber: number): boolean {
        if (this.isRecording) {
            console.warn('⚠️ Recording already in progress');
            return false;
        }

        this.sessionContext = { sessionId, exerciseId, setNumber };
        this.isRecording = true;
        this.resetJointProcessors();

        console.log('🎬 Recording started:', { sessionId, exerciseId, setNumber });
        return true;
    }

    async stopRecording(): Promise<boolean> {
        if (!this.isRecording) {
            console.warn('⚠️ No recording in progress');
            return false;
        }

        console.log('🛑 Recording stopped');
        this.isRecording = false;
        this.sessionContext = null;
        return true;
    }

    getUIData(): { left: any; right: any } {
        return this.uiProcessor.getChartFormat();
    }

    getCurrentJointAngles(): Map<string, number> {
        const angles = new Map<string, number>();
        this.jointProcessors.forEach((processor, jointName) => {
            const latest = processor.getLatestAngle();
            if (latest) {
                angles.set(jointName, latest.angle);
            }
        });
        return angles;
    }

    getBatteryLevels(): Map<string, number> {
        return this.deviceProcessor.getBatteryLevels();
    }

    getConnectionStates(): Map<string, string> {
        return this.deviceProcessor.getConnectionStates();
    }

    getRecordingStatus(): RecordingStatus {
        return {
            isRecording: this.isRecording,
            sessionContext: this.sessionContext,
        };
    }

    updateBatteryLevel(deviceId: string, level: number): void {
        this.deviceProcessor.updateBatteryLevel(deviceId, level);
    }

    updateConnectionState(deviceId: string, state: string): void {
        this.deviceProcessor.updateConnectionState(deviceId, state);
    }

    subscribeToUI(callback: (data: any) => void): () => void {
        return this.uiProcessor.subscribe(callback);
    }

    isHealthy(): boolean {
        return this.isInitialized && this.deviceProcessor.getDeviceStatus().recentlyActive > 0;
    }

    getInitializationStatus(): boolean {
        return !!(this.deviceProcessor && this.uiProcessor);
    }

    cleanup(): void {
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
            this.performanceInterval = null;
        }

        this.deviceProcessor.cleanup();
        this.jointProcessors.forEach(processor => processor.cleanup());
        this.uiProcessor.cleanup();
        this.jointProcessors.clear();
        this.isInitialized = false;

        console.log('🧹 MotionProcessingCoordinator cleanup completed');
    }

    private startPerformanceMonitoring(): void {
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
        }

        this.performanceInterval = setInterval(() => {
            this.performPeriodicCleanup();
        }, 60000);
    }

    private performPeriodicCleanup(): void {
        if (this.deviceProcessor && typeof (this.deviceProcessor as any).performPeriodicCleanup === 'function') {
            (this.deviceProcessor as any).performPeriodicCleanup();
        }
    }

    private initializeServices(): void {
        this.deviceProcessor = DeviceProcessor.getInstance(this.config);
        this.uiProcessor = UIProcessor.getInstance();
        console.log('✅ Core services initialized');
    }

    private initializeJointProcessors(): void {
        for (const jointConfig of this.config.joints) {
            const processor = new KneeJointProcessor(jointConfig, this.config);
            this.jointProcessors.set(jointConfig.name, processor);
            this.subscribeToJointProcessor(processor);
        }
        console.log(`✅ Initialized ${this.jointProcessors.size} joint processors`);
    }

    private subscribeToJointProcessor(processor: JointProcessor): void {
        processor.subscribe((angleData: JointAngleData) => {
            const start = performance.now();
            this.uiProcessor.updateJointAngle(angleData);

            const duration = performance.now() - start;
            if (duration > 1) {
                PerformanceLogger.log('COORDINATOR', 'joint_processing', duration, angleData.jointName);
            }
        });
    }

    private setupDataFlow(): void {
        this.deviceProcessor.setJointUpdateCallback((jointName, devices) => {
            this.processSingleJoint(jointName, devices);
        });
    }

    private processSingleJoint(jointName: string, devices: Map<string, DeviceData>): void {
        const jointProcessor = this.jointProcessors.get(jointName);
        if (!jointProcessor) return;

        try {
            jointProcessor.processDevices(devices);
        } catch (error) {
            console.error(`❌ [MOTION_COORDINATOR] Error processing ${jointName}:`, error);
        }
    }

    private resetJointProcessors(): void {
        this.jointProcessors.forEach(processor => processor.resetStats());
    }

    setPerformanceOptions(opts: { bypassInterpolation?: boolean; asyncNotify?: boolean }): void {
        if (this.deviceProcessor) {
            this.deviceProcessor.updatePerformanceOptions(opts);
        }
    }
}

// Factory - always create coordinator (MotionProcessingConsumer removed)
export const motionProcessingCoordinator = MotionProcessingCoordinator.getInstance(
    createMotionConfig(PerformanceProfile.HZ_100_SAMPLING, false)
);
