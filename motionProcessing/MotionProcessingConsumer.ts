import { UIJointData, IMUData, SessionContext } from './shared/types';
import { PerformanceLogger } from './shared/PerformanceLogger';

/**
 * Lightweight motion processing consumer for renderer process.
 * Only handles WebSocket data reception and UI updates.
 * Does NOT perform any device processing, interpolation, or joint calculations.
 */
export class MotionProcessingConsumer {
    private uiSubscribers = new Set<(data: any) => void>();
    private batteryLevels = new Map<string, number>();
    private connectionStates = new Map<string, string>();
    private currentAngles = new Map<string, number>();
    private isRecording = false;
    private sessionContext: SessionContext | null = null;
    private isInitialized = true; // Always initialized - no processing to set up

    /**
     * Subscribe to UI updates (data comes from WebSocket, not local processing)
     */
    subscribeToUI(callback: (data: any) => void): () => void {
        this.uiSubscribers.add(callback);
        return () => this.uiSubscribers.delete(callback);
    }

    /**
     * Consumer does not process data - data comes from main process via WebSocket
     */
    processNewData(deviceId: string, imuData: IMUData): void {
        PerformanceLogger.warn('CONSUMER', 'processNewData called on consumer - data should come from WebSocket');
    }

    /**
     * Recording is managed by main process - consumer just tracks state
     */
    startRecording(sessionId: string, exerciseId: string, setNumber: number): boolean {
        this.isRecording = true;
        this.sessionContext = { sessionId, exerciseId, setNumber };
        PerformanceLogger.info('CONSUMER', 'Recording state updated to: started');
        return true;
    }

    /**
     * Stop recording - consumer just updates state
     */
    async stopRecording(): Promise<boolean> {
        this.isRecording = false;
        this.sessionContext = null;
        PerformanceLogger.info('CONSUMER', 'Recording state updated to: stopped');
        return true;
    }

    /**
     * Update UI data from WebSocket messages
     */
    updateUIFromWebSocket(data: any): void {
        // Notify UI subscribers with received data
        this.uiSubscribers.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                PerformanceLogger.warn('CONSUMER', 'UI callback error', error);
            }
        });
    }

    // Getters for compatibility with existing interface
    getInitializationStatus(): boolean { return this.isInitialized; }
    getBatteryLevels(): Map<string, number> { return this.batteryLevels; }
    getConnectionStates(): Map<string, string> { return this.connectionStates; }
    getCurrentJointAngles(): Map<string, number> { return this.currentAngles; }
    getRecordingStatus(): { isRecording: boolean } { return { isRecording: this.isRecording }; }
    isHealthy(): boolean { return true; }
    getQueueSize(): number { return 0; }
    getLastCompleteRecording(): any { return null; }

    // Battery and connection updates from WebSocket
    updateBatteryLevel(deviceId: string, level: number): void {
        this.batteryLevels.set(deviceId, level);
    }

    updateConnectionState(deviceId: string, state: string): void {
        this.connectionStates.set(deviceId, state);
    }

    // UI updates from WebSocket data
    updateAnglesFromWebSocket(angles: Map<string, number>): void {
        this.currentAngles = new Map(angles);
    }

    // Stub methods for compatibility
    getJointStats(jointName: string): any { return null; }
    cleanup(): void {
        this.uiSubscribers.clear();
        this.batteryLevels.clear();
        this.connectionStates.clear();
        this.currentAngles.clear();
        PerformanceLogger.info('CONSUMER', 'Cleanup completed');
    }
}