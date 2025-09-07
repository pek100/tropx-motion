import { useRef, useEffect, useState, useCallback } from 'react';
import { UIJointData, IMUData } from '../shared/types';
import { motionProcessingCoordinator } from "../MotionProcessingCoordinator";
import { UI } from '../shared/constants';

interface UIJointDataWithTimestamp extends UIJointData {
    sensorTimestamp?: number;
}

interface UseMotionProcessingReturn {
    kneeData: { left: UIJointDataWithTimestamp; right: UIJointDataWithTimestamp };
    currentAngles: Map<string, number>;
    isRecording: boolean;
    batteryLevels: Map<string, number>;
    connectionStates: Map<string, string>;
    isInitialized: boolean;
    error: string | null;
    startRecording: (sessionId: string, exerciseId: string, setNumber: number) => boolean;
    stopRecording: () => Promise<boolean>;
    processData: (deviceId: string, imuData: IMUData) => void;
    updateBatteryLevel: (deviceId: string, level: number) => void;
    updateConnectionState: (deviceId: string, state: string) => void;
    getJointStats: (jointName: string) => any;
    isHealthy: () => boolean;
    getQueueSize: () => number;
    coordinator: typeof motionProcessingCoordinator;
    getLastRecording: () => any;
    serverService: null; // Removed to prevent confusion
}

// DirectConfig interface removed as it was unused

/**
 * Creates initial knee data structure with zero values.
 */
const createInitialKneeData = () => ({
    left: { current: 0, max: 0, min: 0, rom: 0, lastUpdate: 0, devices: [] },
    right: { current: 0, max: 0, min: 0, rom: 0, lastUpdate: 0, devices: [] }
});

/**
 * React hook for motion processing integration with enhanced AI analysis support.
 * Provides React-friendly interface to motion processing system with
 * automatic lifecycle management and complete recording data for AI analysis.
 */
export const useMotionProcessing = (): UseMotionProcessingReturn => {
    const coordinator = motionProcessingCoordinator;
    const subscriptionRef = useRef<(() => void) | null>(null);
    const aiCallbackRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(true);

    // Configuration with defaults
    // Direct updates configuration removed as it was unused

    // Core motion processing state
    const [kneeData, setKneeData] = useState(createInitialKneeData());
    const [currentAngles, setCurrentAngles] = useState<Map<string, number>>(new Map());
    const [isRecording, setIsRecording] = useState(false);
    const [batteryLevels, setBatteryLevels] = useState<Map<string, number>>(new Map());
    const [connectionStates, setConnectionStates] = useState<Map<string, string>>(new Map());
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Centralized error handling with component lifecycle awareness.
     */
    const logError = useCallback((error: unknown, context: string) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ useMotionProcessing error in ${context}:`, message);
        if (mountedRef.current) {
            setError(message);
        }
    }, []);

    /**
     * Updates knee data state using functional setState to prevent race conditions.
     */
    const updateKneeData = useCallback((data: any) => {
        if (mountedRef.current && data) {
            // Use functional setState to ensure we get the latest state
            setKneeData(prevKneeData => {
                // Extract sensor timestamps and merge with previous state
                const updatedData = {
                    left: {
                        ...prevKneeData.left,
                        ...data.left,
                        sensorTimestamp: data.left?.lastUpdate || Date.now(),
                        lastUpdate: Date.now()
                    },
                    right: {
                        ...prevKneeData.right,
                        ...data.right,
                        sensorTimestamp: data.right?.lastUpdate || Date.now(),
                        lastUpdate: Date.now()
                    }
                };

                return updatedData;
            });

            setCurrentAngles(new Map(coordinator.getCurrentJointAngles()));
        }
    }, [coordinator]);

    /**
     * Initiates recording session with error handling and state updates.
     */
    const startRecording = useCallback((sessionId: string, exerciseId: string, setNumber: number): boolean => {
        try {
            console.log('🎬 Starting recording via useMotionProcessing...', { sessionId, exerciseId, setNumber });
            const success = coordinator.startRecording(sessionId, exerciseId, setNumber);
            if (success && mountedRef.current) {
                setError(null);
                console.log('✅ Recording started successfully');
            } else {
                console.error('❌ Failed to start recording');
            }
            return success;
        } catch (err) {
            logError(err, 'Failed to start recording');
            return false;
        }
    }, [coordinator, logError]);

    /**
     * Stops recording session and processes final data with error handling.
     */
    const stopRecording = useCallback(async (): Promise<boolean> => {
        try {
            console.log('🛑 Stopping recording via useMotionProcessing...');
            const success: boolean = await coordinator.stopRecording();
            if (mountedRef.current) {
                setError(null);
                if (success) {
                    console.log('✅ Recording stopped successfully');
                } else {
                    console.error('❌ Failed to stop recording');
                }
            }
            return success;
        } catch (err) {
            logError(err, 'Failed to stop recording');
            return false;
        }
    }, [coordinator, logError]);

    /**
     * Processes incoming IMU data through coordinator with error handling.
     */
    const processData = useCallback((deviceId: string, imuData: IMUData): void => {
        try {
            coordinator.processNewData(deviceId, imuData);
        } catch (err) {
            logError(err, 'Data processing error');
        }
    }, [coordinator, logError]);

    /**
     * Updates battery level for specific device.
     */
    const updateBatteryLevel = useCallback((deviceId: string, level: number): void => {
        coordinator.updateBatteryLevel(deviceId, level);
    }, [coordinator]);

    /**
     * Updates connection state for specific device.
     */
    const updateConnectionState = useCallback((deviceId: string, state: string): void => {
        coordinator.updateConnectionState(deviceId, state);
    }, [coordinator]);

    /**
     * Retrieves statistical data for specified joint.
     */
    const getJointStats = useCallback((jointName: string): any => {
        return coordinator.getJointStats(jointName);
    }, [coordinator]);

    /**
     * Returns overall system health status.
     */
    const isHealthy = useCallback((): boolean => {
        return coordinator.isHealthy();
    }, [coordinator]);

    /**
     * Returns number of recordings queued for upload.
     */
    const getQueueSize = useCallback((): number => {
        return coordinator.getQueueSize();
    }, [coordinator]);

    /**
     * Gets the last complete recording (reassembled from chunks).
     */
    const getLastRecording = useCallback((): any => {
        const recording = coordinator.getLastCompleteRecording();
        if (recording) {
            console.log('📋 Retrieved complete recording for AI analysis:', {
                id: recording.id,
                jointsCount: recording.joints_arr?.length || 0,
                measurementsCount: recording.measurement_sequences?.length || 0,
                source: 'coordinator'
            });
        } else {
            console.log('📋 No complete recording available from coordinator');
        }
        return recording;
    }, [coordinator]);

    /**
     * Initializes coordinator and sets up error handling.
     */
    useEffect(() => {
        try {
            if (coordinator.getInitializationStatus()) {
                setIsInitialized(true);
                setError(null);
                console.log('✅ useMotionProcessing connected to initialized coordinator');
            } else {
                setError('Motion processing coordinator not initialized');
                setIsInitialized(false);
                console.error('❌ Motion processing coordinator not initialized');
            }
        } catch (err) {
            logError(err, 'Hook connection failed');
            setIsInitialized(false);
        }
    }, [coordinator, logError]);

    /**
     * Establishes UI data subscriptions and periodic device state updates.
     */
    useEffect(() => {
        if (!coordinator || !isInitialized) return;

        const unsubscribeUI = coordinator.subscribeToUI(updateKneeData);
        subscriptionRef.current = unsubscribeUI;

        // Periodic device state updates for battery and connection status
        const updateInterval = setInterval(() => {
            if (!mountedRef.current || !coordinator) return;

            try {
                setBatteryLevels(new Map(coordinator.getBatteryLevels()));
                setConnectionStates(new Map(coordinator.getConnectionStates()));
                const recordingStatus = coordinator.getRecordingStatus();
                setIsRecording(recordingStatus.isRecording);
            } catch (err) {
                logError(err, 'Error updating device states');
            }
        }, UI.DEVICE_STATE_UPDATE_INTERVAL_MS);

        console.log('✅ UI subscriptions and device state updates established');

        return () => {
            unsubscribeUI();
            clearInterval(updateInterval);
            console.log('🧹 UI subscriptions cleaned up');
        };
    }, [isInitialized, updateKneeData, coordinator, logError]);

    // AI analysis functionality removed

    /**
     * Component lifecycle management and cleanup.
     */
    useEffect(() => {
        mountedRef.current = true;
        console.log('✅ useMotionProcessing hook mounted');

        return () => {
            mountedRef.current = false;
            subscriptionRef.current?.();
            aiCallbackRef.current?.();
            console.log('🧹 useMotionProcessing hook unmounted and cleaned up');
        };
    }, []);

    // Recording validation function removed as it was unused

    return {
        kneeData,
        currentAngles,
        isRecording,
        batteryLevels,
        connectionStates,
        isInitialized,
        error,
        startRecording,
        stopRecording,
        processData,
        updateBatteryLevel,
        updateConnectionState,
        getJointStats,
        isHealthy,
        getQueueSize,
        coordinator,
        getLastRecording,
        serverService: null // Removed to prevent confusion with chunked data
    };
};