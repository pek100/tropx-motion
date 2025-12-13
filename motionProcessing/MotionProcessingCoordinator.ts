import { DeviceProcessor } from './deviceProcessing/DeviceProcessor';
import { UIProcessor } from './uiProcessing/UIProcessor';
import { BatchSynchronizer, type AlignedSampleSet } from './synchronization';
import { MotionConfig, IMUData, SessionContext, Quaternion } from './shared/types';
import { createMotionConfig, PerformanceProfile, JointName } from './shared/config';
import { DeviceID, UnifiedBLEStateStore, GlobalState, type GlobalStateChange } from '../ble-management';
import { RecordingBuffer, CSVExporter, type RecordingState, type ExportResult, type ExportOptions } from './recording';
import { AngleCalculationService } from './jointProcessing/AngleCalculationService';

/** Synchronized joint pair for downstream consumers */
export interface SynchronizedJointPair {
    timestamp: number;
    leftKnee: {
        angle: number;
        relativeQuat: Quaternion;
        deviceIds: string[];
    };
    rightKnee: {
        angle: number;
        relativeQuat: Quaternion;
        deviceIds: string[];
    };
}

interface RecordingStatus {
    isRecording: boolean;
    sessionContext: SessionContext | null;
}

/**
 * Central coordinator for motion processing system.
 * Manages data flow between device processing, joint calculations, and UI updates.
 *
 * Data flow:
 * DeviceProcessor → BatchSynchronizer → AngleCalculator → UIProcessor/RecordingBuffer
 */
export class MotionProcessingCoordinator {
    private static instance: MotionProcessingCoordinator | null = null;
    private deviceProcessor!: DeviceProcessor;
    private uiProcessor!: UIProcessor;
    private isRecording = false;
    private sessionContext: SessionContext | null = null;
    private isInitialized = false;
    private performanceInterval: NodeJS.Timeout | null = null;

    /** Angle calculators for direct calculation from BatchSynchronizer output */
    private leftKneeAngleCalc!: AngleCalculationService;
    private rightKneeAngleCalc!: AngleCalculationService;

    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

    private constructor(private config: MotionConfig) {
        try {
            this.initializeServices();
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

    startRecording(sessionId?: string, exerciseId?: string, setNumber?: number): boolean {
        if (this.isRecording) {
            console.warn('⚠️ Recording already in progress');
            return false;
        }

        this.sessionContext = sessionId ? { sessionId, exerciseId: exerciseId || '', setNumber: setNumber || 0 } : null;
        this.isRecording = true;

        // Reset timestamp tracking for fresh recording
        DeviceProcessor.resetForNewRecording();
        UIProcessor.resetForNewRecording();

        // Start backend recording buffer with target Hz from config
        RecordingBuffer.start(this.config.targetHz);

        console.log('🎬 Recording started:', { sessionId, exerciseId, setNumber, targetHz: this.config.targetHz });
        return true;
    }

    stopRecording(): boolean {
        if (!this.isRecording) {
            console.warn('⚠️ No recording in progress');
            return false;
        }

        console.log('🛑 Recording stopped');
        this.isRecording = false;
        this.sessionContext = null;

        // Stop backend recording buffer
        RecordingBuffer.stop();
        return true;
    }

    /** Get recording state for IPC queries. */
    getRecordingState(): RecordingState {
        return RecordingBuffer.getState();
    }

    /** Export recording to CSV. */
    exportRecording(options: ExportOptions = {}): ExportResult {
        return CSVExporter.export(options);
    }

    /** Clear recording data. */
    clearRecording(): void {
        RecordingBuffer.clear();
    }

    getUIData(): { left: any; right: any } {
        return this.uiProcessor.getChartFormat();
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

        // Stop BatchSynchronizer timer and cleanup
        BatchSynchronizer.reset();

        this.deviceProcessor.cleanup();
        this.uiProcessor.cleanup();
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

        // Initialize angle calculators for BatchSync path
        const leftKneeConfig = this.config.joints.find(j => j.name === JointName.LEFT_KNEE);
        const rightKneeConfig = this.config.joints.find(j => j.name === JointName.RIGHT_KNEE);

        if (leftKneeConfig) {
            this.leftKneeAngleCalc = new AngleCalculationService(leftKneeConfig, this.config);
        }
        if (rightKneeConfig) {
            this.rightKneeAngleCalc = new AngleCalculationService(rightKneeConfig, this.config);
        }

        // Set up BatchSynchronizer subscription
        this.setupBatchSyncSubscription();

        console.log('✅ Core services initialized');
    }

    /**
     * Set up subscription to BatchSynchronizer for aligned data flow.
     * Processes aligned samples through angle calculation and routes to UI/Recording.
     */
    private setupBatchSyncSubscription(): void {
        const batchSync = BatchSynchronizer.getInstance();

        // Subscribe to aligned sample output
        batchSync.subscribe((alignedSamples: AlignedSampleSet) => {
            this.processAlignedSamples(alignedSamples);
        });

        // Listen to global state changes to start/stop BatchSynchronizer
        UnifiedBLEStateStore.on('globalStateChanged', (change: GlobalStateChange) => {
            if (change.newState === GlobalState.STREAMING) {
                // Start BatchSynchronizer when streaming begins
                if (!batchSync.isActive()) {
                    batchSync.start(this.config.targetHz);
                    console.log(`▶️ [BatchSync] Started on STREAMING state`);
                }
            } else if (change.previousState === GlobalState.STREAMING) {
                // Stop BatchSynchronizer when streaming ends
                batchSync.stop();
                console.log(`⏹️ [BatchSync] Stopped on ${change.newState} state`);
            }
        });

        // Don't auto-start - wait for STREAMING state
        console.log(`✅ BatchSynchronizer configured (waiting for STREAMING state)`);
    }

    /**
     * Process aligned samples from BatchSynchronizer.
     * Calculates joint angles and routes to UIProcessor and RecordingBuffer.
     * Requires BOTH thigh and shin for angle calculation.
     */
    private processAlignedSamples(aligned: AlignedSampleSet): void {
        // Check if we have complete data for at least one joint (both thigh AND shin)
        const leftComplete = aligned.leftKnee?.thigh && aligned.leftKnee?.shin;
        const rightComplete = aligned.rightKnee?.thigh && aligned.rightKnee?.shin;

        // Early return if no complete joint data
        if (!leftComplete && !rightComplete) return;

        let leftAngle = 0;
        let leftQuat: Quaternion = { w: 1, x: 0, y: 0, z: 0 };
        let rightAngle = 0;
        let rightQuat: Quaternion = { w: 1, x: 0, y: 0, z: 0 };

        // Calculate left knee angle if both sensors available
        if (leftComplete && this.leftKneeAngleCalc) {
            const result = this.leftKneeAngleCalc.calculateFromQuaternions(
                aligned.leftKnee!.thigh!.quaternion,
                aligned.leftKnee!.shin!.quaternion,
                'y'
            );
            if (result) {
                leftAngle = result.angle;
                leftQuat = result.relativeQuat;
            }
        }

        // Calculate right knee angle if both sensors available
        if (rightComplete && this.rightKneeAngleCalc) {
            const result = this.rightKneeAngleCalc.calculateFromQuaternions(
                aligned.rightKnee!.thigh!.quaternion,
                aligned.rightKnee!.shin!.quaternion,
                'y'
            );
            if (result) {
                rightAngle = result.angle;
                rightQuat = result.relativeQuat;
            }
        }

        // Create synchronized pair for downstream consumers
        const pair: SynchronizedJointPair = {
            timestamp: aligned.timestamp,
            leftKnee: {
                angle: leftAngle,
                relativeQuat: leftQuat,
                deviceIds: leftComplete ? ['0x11', '0x12'] : []
            },
            rightKnee: {
                angle: rightAngle,
                relativeQuat: rightQuat,
                deviceIds: rightComplete ? ['0x21', '0x22'] : []
            }
        };

        // Route to UIProcessor for display
        this.uiProcessor.broadcastCompletePair(pair);

        // Route to RecordingBuffer for recording
        RecordingBuffer.pushSynchronizedPair(
            pair.timestamp,
            pair.leftKnee.relativeQuat,
            pair.rightKnee.relativeQuat
        );
    }

    setPerformanceOptions(opts: { bypassInterpolation?: boolean; asyncNotify?: boolean }): void {
        if (this.deviceProcessor) {
            this.deviceProcessor.updatePerformanceOptions(opts);
        }
    }

    /** Get debug stats for pipeline analysis */
    static getDebugStats(): object {
        return {
            deviceProcessor: DeviceProcessor.getDebugStats(),
            batchSync: BatchSynchronizer.getInstance().getFullDebugInfo(),
            uiProcessor: UIProcessor.getDebugStats()
        };
    }
}

// Factory - always create coordinator
export const motionProcessingCoordinator = MotionProcessingCoordinator.getInstance(
    createMotionConfig(PerformanceProfile.HZ_100_SAMPLING, false)
);
