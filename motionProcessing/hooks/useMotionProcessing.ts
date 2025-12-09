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
    isHealthy: () => boolean;
    coordinator: typeof motionProcessingCoordinator;
}

const createInitialKneeData = () => ({
    left: { current: 0, max: 0, min: 0, rom: 0, lastUpdate: 0, devices: [] },
    right: { current: 0, max: 0, min: 0, rom: 0, lastUpdate: 0, devices: [] }
});

/**
 * React hook for motion processing integration.
 */
export const useMotionProcessing = (): UseMotionProcessingReturn => {
    const coordinator = motionProcessingCoordinator;
    const subscriptionRef = useRef<(() => void) | null>(null);
    const mountedRef = useRef(true);

    const [kneeData, setKneeData] = useState(createInitialKneeData());
    const [currentAngles, setCurrentAngles] = useState<Map<string, number>>(new Map());
    const [isRecording, setIsRecording] = useState(false);
    const [batteryLevels, setBatteryLevels] = useState<Map<string, number>>(new Map());
    const [connectionStates, setConnectionStates] = useState<Map<string, string>>(new Map());
    const [isInitialized, setIsInitialized] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const logError = useCallback((error: unknown, context: string) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`❌ useMotionProcessing error in ${context}:`, message);
        if (mountedRef.current) {
            setError(message);
        }
    }, []);

    const updateKneeData = useCallback((data: any) => {
        if (mountedRef.current && data) {
            setKneeData(prevKneeData => ({
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
            }));

            setCurrentAngles(new Map(coordinator.getCurrentJointAngles()));
        }
    }, [coordinator]);

    const startRecording = useCallback((sessionId: string, exerciseId: string, setNumber: number): boolean => {
        try {
            const success = coordinator.startRecording(sessionId, exerciseId, setNumber);
            if (success && mountedRef.current) {
                setError(null);
            }
            return success;
        } catch (err) {
            logError(err, 'Failed to start recording');
            return false;
        }
    }, [coordinator, logError]);

    const stopRecording = useCallback(async (): Promise<boolean> => {
        try {
            const success: boolean = await coordinator.stopRecording();
            if (mountedRef.current) {
                setError(null);
            }
            return success;
        } catch (err) {
            logError(err, 'Failed to stop recording');
            return false;
        }
    }, [coordinator, logError]);

    const processData = useCallback((deviceId: string, imuData: IMUData): void => {
        try {
            coordinator.processNewData(deviceId, imuData);
        } catch (err) {
            logError(err, 'Data processing error');
        }
    }, [coordinator, logError]);

    const updateBatteryLevel = useCallback((deviceId: string, level: number): void => {
        coordinator.updateBatteryLevel(deviceId, level);
    }, [coordinator]);

    const updateConnectionState = useCallback((deviceId: string, state: string): void => {
        coordinator.updateConnectionState(deviceId, state);
    }, [coordinator]);

    const isHealthy = useCallback((): boolean => {
        return coordinator.isHealthy();
    }, [coordinator]);

    useEffect(() => {
        try {
            if (coordinator.getInitializationStatus()) {
                setIsInitialized(true);
                setError(null);
            } else {
                setError('Motion processing coordinator not initialized');
                setIsInitialized(false);
            }
        } catch (err) {
            logError(err, 'Hook connection failed');
            setIsInitialized(false);
        }
    }, [coordinator, logError]);

    useEffect(() => {
        if (!coordinator || !isInitialized) return;

        const unsubscribeUI = coordinator.subscribeToUI(updateKneeData);
        subscriptionRef.current = unsubscribeUI;

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

        return () => {
            unsubscribeUI();
            clearInterval(updateInterval);
        };
    }, [isInitialized, updateKneeData, coordinator, logError]);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            subscriptionRef.current?.();
        };
    }, []);

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
        isHealthy,
        coordinator,
    };
};
