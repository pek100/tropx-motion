import { DeviceProcessor } from './deviceProcessing/DeviceProcessor';
import { JointProcessor, KneeJointProcessor } from './jointProcessing/JointProcessor';
import { DataParser } from './dataProcessing/DataParser';
import { UIProcessor } from './uiProcessing/UIProcessor';
import { ServerService } from './dataProcessing/ServerService';
import { ChunkingService } from './dataProcessing/ChunkingService';
import { MotionConfig, IMUData, SessionContext, JointAngleData } from './shared/types';
import {createMotionConfig, PerformanceProfile} from './shared/config';
import { CHUNKING, SAMPLE_RATES } from './shared/constants';

interface RecordingStatus {
    isRecording: boolean;
    sessionContext: SessionContext | null;
    isSyncReady: boolean;
}

/**
 * Central coordinator for motion processing system.
 * Manages data flow between device processing, joint calculations, and UI updates.
 * Implements singleton pattern to ensure consistent state across the application.
 * Enhanced with separate flows for database upload and AI analysis.
 */
export class MotionProcessingCoordinator {
    private static instance: MotionProcessingCoordinator | null = null;
    private deviceProcessor!: DeviceProcessor;
    private jointProcessors = new Map<string, JointProcessor>();
    private dataParser!: DataParser;
    private uiProcessor!: UIProcessor;
    private serverService!: ServerService;
    private chunkingService!: ChunkingService;
    private lastCompleteRecording: any = null;
    private isRecording = false;
    private sessionContext: SessionContext | null = null;
    private isInitialized = false;

    private constructor(private config: MotionConfig) {
        try {
            this.initializeServices();
            this.initializeJointProcessors();
            this.setupDataFlow();
            this.isInitialized = true;
            console.log('✅ MotionProcessingCoordinator initialized successfully');
        } catch (error) {
            this.isInitialized = false;
            console.error('❌ MotionProcessingCoordinator initialization failed:', error);
            throw error;
        }
    }

    /**
     * Returns singleton instance, creating it if necessary with provided configuration.
     */
    static getInstance(config?: MotionConfig): MotionProcessingCoordinator {
        if (!MotionProcessingCoordinator.instance) {
            MotionProcessingCoordinator.instance = new MotionProcessingCoordinator(
                config || createMotionConfig(PerformanceProfile.HZ_100_SAMPLING)
            );
        }
        return MotionProcessingCoordinator.instance;
    }

    /**
     * Cleans up singleton instance and releases all resources.
     */
    static reset(): void {
        if (MotionProcessingCoordinator.instance) {
            MotionProcessingCoordinator.instance.cleanup();
            MotionProcessingCoordinator.instance = null;
        }
    }

    /**
     * Processes new IMU data from a specific device.
     */
    processNewData(deviceId: string, imuData: IMUData): void {
        if (!this.isInitialized) return;
        this.deviceProcessor.processData(deviceId, imuData);
    }

    /**
     * Initiates a new recording session with specified parameters.
     */
    startRecording(sessionId: string, exerciseId: string, setNumber: number): boolean {
        if (this.isRecording) {
            console.warn('⚠️ Recording already in progress');
            return false;
        }

        try {
            this.deviceProcessor.startNewRecording();
            this.sessionContext = { sessionId, exerciseId, setNumber };
            this.isRecording = true;
            this.resetJointProcessors();
            this.dataParser.startNewRecording();
            this.lastCompleteRecording = null;

            console.log('🎬 Recording started:', {
                sessionId,
                exerciseId,
                setNumber
            });

            return true;
        } catch (error) {
            console.error('❌ Failed to start recording:', error);
            this.isRecording = false;
            this.sessionContext = null;
            return false;
        }
    }

    /**
     * Stops the current recording session and processes the data.
     */
    async stopRecording(): Promise<boolean> {
        if (!this.isRecording) {
            console.warn('⚠️ No recording in progress');
            return false;
        }

        try {
            // Add null check for sessionContext
            if (!this.sessionContext) {
                console.error('❌ No session context available');
                this.isRecording = false;
                return false;
            }

            const recording = this.dataParser.createFinalRecording(this.sessionContext);
            if (!recording) {
                console.error('❌ Failed to create final recording');
                this.isRecording = false;
                this.sessionContext = null;
                return false;
            }

            // Store complete recording
            this.lastCompleteRecording = recording;

            // Simple database upload only - remove AI processing
            await this.uploadRecordingToDatabase(recording);

            this.isRecording = false;
            this.sessionContext = null;

            return true;

        } catch (error) {
            console.error('❌ Failed to stop recording:', error);
            this.isRecording = false;
            this.sessionContext = null;
            return false;
        }
    }

    /**
     * Upload recording to database using chunking service.
     */
    private async uploadRecordingToDatabase(recording: any): Promise<void> {
        try {
            const chunks = this.chunkingService.splitRecordingIntoChunks(recording);
            await this.chunkingService.uploadChunks(chunks);
            this.chunkingService.cleanupChunks(recording.id);
        } catch (error) {
            console.error('❌ Database upload failed:', error);
            // Continue without throwing to allow recording to complete
        }
    }

    /**
     * Returns current UI data formatted for chart display.
     */
    getUIData(): { left: any; right: any } {
        return this.uiProcessor.getChartFormat();
    }

    /**
     * Returns current joint angles for all active joints.
     */
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

    /**
     * Returns statistical data for a specific joint.
     */
    getJointStats(jointName: string): any {
        return this.jointProcessors.get(jointName)?.getStats();
    }

    /**
     * Returns current battery levels for all connected devices.
     */
    getBatteryLevels(): Map<string, number> {
        return this.deviceProcessor.getBatteryLevels();
    }

    /**
     * Returns connection states for all devices.
     */
    getConnectionStates(): Map<string, string> {
        return this.deviceProcessor.getConnectionStates();
    }


    /**
     * Returns comprehensive recording status information.
     */
    getRecordingStatus(): RecordingStatus {
        return {
            isRecording: this.isRecording,
            sessionContext: this.sessionContext,
            isSyncReady: this.deviceProcessor.isSyncReady()
        };
    }

    /**
     * Returns the last complete recording that was processed.
     */
    getLastCompleteRecording(): any {
        return this.lastCompleteRecording;
    }

    /**
     * Returns number of recordings queued for server upload.
     */
    getQueueSize(): number {
        return this.serverService.getQueueSize();
    }

    /**
     * Updates battery level for a specific device.
     */
    updateBatteryLevel(deviceId: string, level: number): void {
        this.deviceProcessor.updateBatteryLevel(deviceId, level);
    }

    /**
     * Updates connection state for a specific device.
     */
    updateConnectionState(deviceId: string, state: string): void {
        this.deviceProcessor.updateConnectionState(deviceId, state);
    }

    /**
     * Subscribes to UI data updates, returns unsubscribe function.
     */
    subscribeToUI(callback: (data: any) => void): () => void {
        return this.uiProcessor.subscribe(callback);
    }

    /**
     * Processes server response data for UI display.
     */
    processServerData(recording: any): void {
        this.uiProcessor.processServerData(recording);
    }

    /**
     * Returns whether the system is healthy and actively processing data.
     */
    isHealthy(): boolean {
        return this.isInitialized && this.deviceProcessor.getDeviceStatus().recentlyActive > 0;
    }



    /**
     * Returns the initialization status of the coordinator.
     */
    getInitializationStatus(): boolean {
        return !!(this.deviceProcessor && this.dataParser && this.uiProcessor && 
                 this.serverService && this.chunkingService);
    }


    /**
     * Performs cleanup of all resources and resets state.
     */
    cleanup(): void {
        this.deviceProcessor.cleanup();
        this.jointProcessors.forEach(processor => processor.cleanup());
        this.dataParser.cleanup();
        this.uiProcessor.cleanup();
        this.serverService.cleanup();
        this.chunkingService.cleanup();
        // Cleanup completed
        this.isInitialized = false;
        console.log('🧹 MotionProcessingCoordinator cleanup completed');
    }

    /**
     * Initializes all core processing services with current configuration.
     */
    private initializeServices(): void {
        this.deviceProcessor = DeviceProcessor.getInstance(this.config);
        this.dataParser = DataParser.getInstance(this.config.targetHz);
        this.uiProcessor = UIProcessor.getInstance();
        this.serverService = new ServerService();
        this.chunkingService = new ChunkingService(this.serverService, this.getOptimalChunkSize());

        console.log('✅ Core services initialized');
    }

    /**
     * Calculates optimal chunk size based on target sampling frequency.
     */
    private getOptimalChunkSize(): number {
        if (this.config.targetHz >= SAMPLE_RATES.HZ_400) return CHUNKING.CHUNK_SIZE_HIGH_FREQ;
        if (this.config.targetHz >= SAMPLE_RATES.HZ_200) return CHUNKING.CHUNK_SIZE_MID_FREQ;
        return CHUNKING.CHUNK_SIZE_LOW_FREQ;
    }

    /**
     * Creates and configures joint processors for each joint in the configuration.
     */
    private initializeJointProcessors(): void {
        for (const jointConfig of this.config.joints) {
            const processor = new KneeJointProcessor(jointConfig, this.config);
            this.jointProcessors.set(jointConfig.name, processor);
            this.subscribeToJointProcessor(processor);
        }
        console.log(`✅ Initialized ${this.jointProcessors.size} joint processors`);
    }

    /**
     * Establishes data flow subscriptions between joint processor and UI/recording systems.
     */
    private subscribeToJointProcessor(processor: JointProcessor): void {
        processor.subscribe((angleData: JointAngleData) => {
            this.uiProcessor.updateJointAngle(angleData);
            if (this.isRecording) {
                this.dataParser.accumulateAngleData(angleData);
            }
        });
    }

    /**
     * Establishes data flow pipeline from device processor to joint calculations.
     */
    private setupDataFlow(): void {
        this.deviceProcessor.subscribe(() => {
            this.processJoints();
        });
        console.log('✅ Data flow pipeline established');
    }

    /**
     * Processes joint calculations for all joints that have sufficient device data.
     */
    private processJoints(): void {
        this.jointProcessors.forEach((jointProcessor, jointName) => {
            const jointDevices = this.deviceProcessor.getDevicesForJoint(jointName);
            if (jointDevices.size >= 2) {
                jointProcessor.processDevices(jointDevices);
            }
        });
    }

    /**
     * Resets statistical data for all joint processors.
     */
    private resetJointProcessors(): void {
        this.jointProcessors.forEach(processor => processor.resetStats());
    }
}

export const motionProcessingCoordinator = MotionProcessingCoordinator.getInstance(
    createMotionConfig(PerformanceProfile.HZ_100_SAMPLING, false)
);