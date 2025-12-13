import { DeviceProcessor } from './deviceProcessing/DeviceProcessor';
import { JointProcessor, KneeJointProcessor, JointAngleDataWithQuat } from './jointProcessing/JointProcessor';
import { UIProcessor } from './uiProcessing/UIProcessor';
import { JointSynchronizer, SynchronizedJointPair, BatchSynchronizer, type AlignedSampleSet, JointSide } from './synchronization';
import { MotionConfig, IMUData, SessionContext, JointAngleData, DeviceData, Quaternion } from './shared/types';
import { createMotionConfig, PerformanceProfile, JointName } from './shared/config';
import { PerformanceLogger } from './shared/PerformanceLogger';
import { DeviceID } from '../ble-management';
import { RecordingBuffer, CSVExporter, type RecordingState, type ExportResult, type ExportOptions } from './recording';
import { TimestampDebugLogger, type PipelineStats } from '../ble-bridge/TimestampDebugLogger';
import { AngleCalculationService } from './jointProcessing/AngleCalculationService';

interface RecordingStatus {
    isRecording: boolean;
    sessionContext: SessionContext | null;
}

/**
 * Central coordinator for motion processing system.
 * Manages data flow between device processing, joint calculations, and UI updates.
 *
 * New flow (BatchSync enabled):
 * DeviceProcessor → BatchSynchronizer → AngleCalculator → UIProcessor/RecordingBuffer
 *
 * Legacy flow (BatchSync disabled):
 * DeviceProcessor → JointProcessor → JointSynchronizer → UIProcessor/RecordingBuffer
 */
export class MotionProcessingCoordinator {
    private static instance: MotionProcessingCoordinator | null = null;
    private deviceProcessor!: DeviceProcessor;
    private jointProcessors = new Map<string, JointProcessor>();
    private jointSynchronizer!: JointSynchronizer;
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

    startRecording(sessionId?: string, exerciseId?: string, setNumber?: number): boolean {
        if (this.isRecording) {
            console.warn('⚠️ Recording already in progress');
            return false;
        }

        this.sessionContext = sessionId ? { sessionId, exerciseId: exerciseId || '', setNumber: setNumber || 0 } : null;
        this.isRecording = true;
        this.resetJointProcessors();

        // Reset timestamp tracking for fresh recording
        // IMPORTANT: This prevents monotonic check from blocking samples based on previous recording
        DeviceProcessor.resetForNewRecording();
        JointSynchronizer.resetForNewRecording();
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

        // Stop BatchSynchronizer timer and cleanup
        BatchSynchronizer.reset();

        this.deviceProcessor.cleanup();
        this.jointProcessors.forEach(processor => processor.cleanup());
        JointSynchronizer.reset();
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
        this.jointSynchronizer = JointSynchronizer.getInstance();
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

        // Set up BatchSynchronizer subscription (new path)
        this.setupBatchSyncSubscription();

        // Set up legacy sync subscriptions (for fallback)
        this.setupSyncSubscriptions();

        console.log('✅ Core services initialized (BatchSync enabled)');
    }

    /**
     * Set up subscription to BatchSynchronizer for the new aligned data flow.
     * Processes aligned samples through angle calculation and routes to UI/Recording.
     */
    private setupBatchSyncSubscription(): void {
        const batchSync = BatchSynchronizer.getInstance();

        // Subscribe to aligned sample output
        batchSync.subscribe((alignedSamples: AlignedSampleSet) => {
            this.processAlignedSamples(alignedSamples);
        });

        // Start the time-grid timer at configured Hz
        batchSync.start(this.config.targetHz);

        console.log(`✅ BatchSynchronizer configured and started at ${this.config.targetHz}Hz`);
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

    /**
     * Set up subscriptions from JointSynchronizer to downstream consumers.
     * JointSynchronizer emits COMPLETE pairs on every update (flight controller approach).
     */
    private setupSyncSubscriptions(): void {
        this.jointSynchronizer.subscribe((pair: SynchronizedJointPair) => {
            // Route COMPLETE synchronized pair directly to UIProcessor
            // No individual joint updates - pass the whole pair for immediate broadcast
            this.uiProcessor.broadcastCompletePair(pair);

            // Route synchronized data to RecordingBuffer
            RecordingBuffer.pushSynchronizedPair(
                pair.timestamp,
                pair.leftKnee.relativeQuat,
                pair.rightKnee.relativeQuat
            );
        });
        console.log('✅ JointSynchronizer subscriptions configured (flight controller mode)');
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
        processor.subscribe((angleData: JointAngleDataWithQuat) => {
            const start = performance.now();

            // Route to JointSynchronizer for cross-joint timestamp matching
            // JointSynchronizer will emit synchronized pairs to UIProcessor and RecordingBuffer
            this.jointSynchronizer.pushJointSample(angleData, angleData.relativeQuat);

            const duration = performance.now() - start;
            if (duration > 1) {
                PerformanceLogger.log('COORDINATOR', 'joint_processing', duration, angleData.jointName);
            }
        });
    }

    private setupDataFlow(): void {
        this.deviceProcessor.setJointUpdateCallback((jointName, devices, triggeringTimestamp) => {
            this.processSingleJoint(jointName, devices, triggeringTimestamp);
        });
    }

    private processSingleJoint(jointName: string, devices: Map<string, DeviceData>, triggeringTimestamp: number): void {
        const jointProcessor = this.jointProcessors.get(jointName);
        if (!jointProcessor) return;

        try {
            jointProcessor.processDevices(devices, triggeringTimestamp);
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

    /** Collect and set pipeline stats to TimestampDebugLogger for analysis */
    static flushPipelineStats(): void {
        const stats: PipelineStats = {
            deviceProcessor: DeviceProcessor.getDebugStats(),
            jointSynchronizer: JointSynchronizer.getDebugStats(),
            uiProcessor: UIProcessor.getDebugStats()
        };
        TimestampDebugLogger.setPipelineStats(stats);
        console.log('📊 [MOTION_COORDINATOR] Pipeline stats collected for debug log');
    }
}

// Factory - always create coordinator (MotionProcessingConsumer removed)
export const motionProcessingCoordinator = MotionProcessingCoordinator.getInstance(
    createMotionConfig(PerformanceProfile.HZ_100_SAMPLING, false)
);
