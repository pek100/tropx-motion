import { DeviceProcessor } from './deviceProcessing/DeviceProcessor';
import { JointProcessor, KneeJointProcessor } from './jointProcessing/JointProcessor';
import { AsyncDataParser } from './dataProcessing/AsyncDataParser';
import { UIProcessor } from './uiProcessing/UIProcessor';
import { ServerService } from './dataProcessing/ServerService';
import { ChunkingService } from './dataProcessing/ChunkingService';
import { MotionConfig, IMUData, SessionContext, JointAngleData } from './shared/types';
import {createMotionConfig, PerformanceProfile} from './shared/config';
import { CHUNKING, SAMPLE_RATES } from './shared/constants';
import { PerformanceLogger } from './shared/PerformanceLogger';

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
    private dataParser!: AsyncDataParser;
    private uiProcessor!: UIProcessor;
    private serverService!: ServerService;
    private chunkingService!: ChunkingService;
    private lastCompleteRecording: any = null;
    private isRecording = false;
    private sessionContext: SessionContext | null = null;
    private isInitialized = false;
    private processingCounter = 0;

    // WebSocket broadcast function for sending processed joint angles to UI
    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

    private constructor(private config: MotionConfig) {
        try {
            this.initializeServices();
            this.initializeJointProcessors();
            this.setupDataFlow();
            this.startPerformanceMonitoring(); // Start automatic cleanup
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
        console.log(`🏗️ [MOTION_COORDINATOR] getInstance called:`, {
            hasExistingInstance: !!MotionProcessingCoordinator.instance,
            existingInstanceId: MotionProcessingCoordinator.instance ? MotionProcessingCoordinator.instance.toString().slice(-8) : null,
            hasConfig: !!config
        });

        if (!MotionProcessingCoordinator.instance) {
            console.log(`🏗️ [MOTION_COORDINATOR] Creating new instance...`);
            MotionProcessingCoordinator.instance = new MotionProcessingCoordinator(
                config || createMotionConfig(PerformanceProfile.HZ_100_SAMPLING)
            );
            console.log(`✅ [MOTION_COORDINATOR] New instance created with ID: ${MotionProcessingCoordinator.instance.toString().slice(-8)}`);
        } else {
            console.log(`♻️ [MOTION_COORDINATOR] Returning existing instance with ID: ${MotionProcessingCoordinator.instance.toString().slice(-8)}`);
        }
        return MotionProcessingCoordinator.instance;
    }

    /**
     * Set WebSocket broadcast function for sending processed joint angles to UI
     */
    setWebSocketBroadcast(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
        this.webSocketBroadcast = broadcastFn;
        console.log('📡 [MOTION_COORDINATOR] WebSocket broadcast function configured:', {
            hasBroadcastFunction: !!broadcastFn,
            hasUIProcessor: !!this.uiProcessor,
            isInitialized: this.isInitialized
        });

        // Also configure UIProcessor if it's already initialized
        if (this.uiProcessor) {
            this.uiProcessor.setWebSocketBroadcast(broadcastFn);
            console.log('📡 [MOTION_COORDINATOR] UIProcessor WebSocket broadcast configured');
        } else {
            console.warn('⚠️ [MOTION_COORDINATOR] UIProcessor not yet initialized - WebSocket broadcast will be configured later');
        }
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
        console.log(`🔄 [MOTION_COORDINATOR] processNewData called for ${deviceId}:`, {
            isInitialized: this.isInitialized,
            hasWebSocketBroadcast: !!this.webSocketBroadcast,
            imuData: imuData,
            timestamp: imuData.timestamp
        });

        if (!this.isInitialized) {
            console.error(`❌ [MOTION_COORDINATOR] Not initialized - cannot process data from ${deviceId}`);
            return;
        }

        // PERFORMANCE LOGGING: Track the data processing pipeline
        const start = performance.now();

        // Sample logging every 50th call to avoid spam
        this.processingCounter = (this.processingCounter || 0) + 1;
        const shouldLog = this.processingCounter % 50 === 0;

        if (shouldLog) {
            console.log(`🔄[COORD][Process start] Device: ${deviceId} | ${new Date().toISOString()}`);
        }

        // Measure device processor time
        const deviceStart = performance.now();
        this.deviceProcessor.processData(deviceId, imuData);
        const deviceDuration = performance.now() - deviceStart;

        const totalDuration = performance.now() - start;
        if (shouldLog || totalDuration > 1) {
            console.log(`📊[COORD][Process complete] ${deviceId} | Total: ${totalDuration.toFixed(2)}ms | Device: ${deviceDuration.toFixed(2)}ms | ${new Date().toISOString()}`);
        }
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
     * Returns async parser statistics for performance monitoring.
     */
    getAsyncParserStats(): any {
        return {
            recordingStats: this.dataParser.getRecordingStats(),
            bufferUtilization: Object.fromEntries(this.dataParser.getBufferUtilization()),
            isAsync: true,
            parserType: 'AsyncDataParser'
        };
    }

    /**
     * Returns whether async parser is enabled.
     * Always returns true as only AsyncDataParser is supported.
     */
    isUsingAsyncParser(): boolean {
        return true;
    }


    /**
     * Performs cleanup of all resources and resets state.
     * Enhanced with performance monitoring and periodic cleanup.
     */
    cleanup(): void {
        // Stop any performance monitoring intervals
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
            this.performanceInterval = null;
        }

        this.deviceProcessor.cleanup();
        this.jointProcessors.forEach(processor => processor.cleanup());
        this.dataParser.cleanup();
        this.uiProcessor.cleanup();
        this.serverService.cleanup();
        this.chunkingService.cleanup();

        // Clear all maps and counters
        this.jointProcessors.clear();
        this.processingCounter = 0;

        this.isInitialized = false;
        console.log('🧹 MotionProcessingCoordinator cleanup completed');
    }

    private performanceInterval: NodeJS.Timeout | null = null;

    /**
     * Starts performance monitoring to detect and prevent memory leaks.
     */
    startPerformanceMonitoring(): void {
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
        }

        this.performanceInterval = setInterval(() => {
            this.performPeriodicCleanup();
        }, 60000); // Run cleanup every minute

        console.log('🔍 Performance monitoring started');
    }

    /**
     * Stops performance monitoring.
     */
    stopPerformanceMonitoring(): void {
        if (this.performanceInterval) {
            clearInterval(this.performanceInterval);
            this.performanceInterval = null;
            console.log('🛑 Performance monitoring stopped');
        }
    }

    /**
     * Performs periodic cleanup to prevent memory accumulation.
     */
    private performPeriodicCleanup(): void {
        const start = performance.now();

        // Clean up device processor
        if (this.deviceProcessor && typeof (this.deviceProcessor as any).performPeriodicCleanup === 'function') {
            (this.deviceProcessor as any).performPeriodicCleanup();
        }

        // Clean up joint processors
        this.jointProcessors.forEach(processor => {
            if (typeof (processor as any).performPeriodicCleanup === 'function') {
                (processor as any).performPeriodicCleanup();
            }
        });

        const duration = performance.now() - start;
        console.log(`🧹 Coordinator periodic cleanup completed in ${duration.toFixed(2)}ms`);
    }

    /**
     * Initializes all core processing services with current configuration.
     * Enhanced with async data parser for non-blocking joint processing.
     */
    private initializeServices(): void {
        this.deviceProcessor = DeviceProcessor.getInstance(this.config);

        // Initialize parser (always using AsyncDataParser for non-blocking processing)
        this.dataParser = AsyncDataParser.getInstance(this.config.targetHz);
        PerformanceLogger.info('COORDINATOR', 'Using AsyncDataParser for non-blocking joint processing');

        this.uiProcessor = UIProcessor.getInstance();
        this.serverService = new ServerService();
        this.chunkingService = new ChunkingService(this.serverService, this.getOptimalChunkSize());

        console.log('✅ Core services initialized with AsyncDataParser');
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
     * Enhanced with performance monitoring and async data processing.
     */
    private subscribeToJointProcessor(processor: JointProcessor): void {
        processor.subscribe((angleData: JointAngleData) => {
            const start = performance.now();

            // UI update - always synchronous and fast
            this.uiProcessor.updateJointAngle(angleData);

            // Recording accumulation - now async and non-blocking!
            if (this.isRecording) {
                this.dataParser.accumulateAngleData(angleData);
            }

            // Performance logging for async operations
            const duration = performance.now() - start;
            if (duration > 1) {
                PerformanceLogger.log('COORDINATOR', 'joint_processing', duration, angleData.jointName);
            }
        });
    }

    /**
     * Establishes data flow pipeline from device processor to joint calculations.
     */
    private setupDataFlow(): void {
        console.log('🔗 [MOTION_COORDINATOR] Setting up data flow subscription...');
        this.deviceProcessor.subscribe(() => {
            console.log('📡 [MOTION_COORDINATOR] DeviceProcessor subscriber callback triggered');
            try {
                this.processJoints();
            } catch (error) {
                console.error('❌ [MOTION_COORDINATOR] Error in processJoints callback:', error);
            }
        });
        console.log('✅ [MOTION_COORDINATOR] Data flow pipeline established');
    }

    /**
     * Processes joint calculations for all joints that have sufficient device data.
     */
    private processJoints(): void {
        console.log(`🦴 [MOTION_COORDINATOR] processJoints called:`, {
            jointProcessorCount: this.jointProcessors.size,
            jointNames: Array.from(this.jointProcessors.keys())
        });

        this.jointProcessors.forEach((jointProcessor, jointName) => {
            const jointDevices = this.deviceProcessor.getDevicesForJoint(jointName);
            console.log(`🦴 [MOTION_COORDINATOR] Processing joint ${jointName}:`, {
                availableDevices: jointDevices.size,
                deviceIds: Array.from(jointDevices.keys()),
                requiredDevices: 2
            });

            if (jointDevices.size >= 2) {
                console.log(`✅ [MOTION_COORDINATOR] Sufficient devices for ${jointName} - processing joint angles`);
                jointProcessor.processDevices(jointDevices);
            } else {
                console.warn(`⚠️ [MOTION_COORDINATOR] Insufficient devices for ${jointName}: ${jointDevices.size}/2 available`);
            }
        });
    }

    /**
     * Resets statistical data for all joint processors.
     */
    private resetJointProcessors(): void {
        this.jointProcessors.forEach(processor => processor.resetStats());
    }

    /**
     * Updates performance options of the processing pipeline at runtime.
     */
    setPerformanceOptions(opts: { bypassInterpolation?: boolean; asyncNotify?: boolean }): void {
        if (this.deviceProcessor) {
            this.deviceProcessor.updatePerformanceOptions(opts);
        }
    }
}

import { MotionProcessingConsumer } from './MotionProcessingConsumer';

/**
 * Factory function to create the appropriate motion processing instance.
 * Main process: Full MotionProcessingCoordinator with device processing
 * Renderer process: Lightweight MotionProcessingConsumer (WebSocket-only)
 */
function createMotionProcessingInstance() {
    // Detect if we're in the renderer process (has window object)
    const isRenderer = typeof window !== 'undefined';

    if (isRenderer) {
        console.log('🔄 Creating MotionProcessingConsumer for renderer process');
        return new MotionProcessingConsumer();
    } else {
        console.log('🔄 Creating MotionProcessingCoordinator for main process');
        return MotionProcessingCoordinator.getInstance(
            createMotionConfig(PerformanceProfile.HZ_100_SAMPLING, false)
        );
    }
}

export const motionProcessingCoordinator = createMotionProcessingInstance();