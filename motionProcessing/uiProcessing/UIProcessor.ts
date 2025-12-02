import { JointAngleData, UIJointData, APIRecording } from '../shared/types';
import {JointName} from "../shared/config";

interface UIState {
    left: UIJointData;
    right: UIJointData;
}

/**
 * Manages UI data state and updates for joint angle visualization.
 */
export class UIProcessor {
    private static instance: UIProcessor | null = null;
    private jointDataMap = new Map<string, UIJointData>();
    private subscribers = new Set<(data: UIState) => void>();
    private sampleCounter = 0;
    private notifyCounter = 0;

    // WebSocket broadcast function for sending processed joint angles to UI
    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

    // Throttle WebSocket broadcasts to prevent overwhelming the UI with duplicate messages
    private lastBroadcastTime = 0;
    private readonly MIN_BROADCAST_INTERVAL = 10; // Max 100 broadcasts/sec (one per joint update cycle)
    private pendingBroadcast = false;

    private constructor() {
        this.initializeJointData();
    }

    /**
     * Returns singleton instance, creating it if necessary.
     */
    static getInstance(): UIProcessor {
        if (!UIProcessor.instance) {
            UIProcessor.instance = new UIProcessor();
        }
        return UIProcessor.instance;
    }

    /**
     * Cleans up singleton instance and releases resources.
     */
    static reset(): void {
        if (UIProcessor.instance) {
            UIProcessor.instance.cleanup();
            UIProcessor.instance = null;
        }
    }

    /**
     * Set WebSocket broadcast function for sending processed joint angles to UI
     */
    setWebSocketBroadcast(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
        this.webSocketBroadcast = broadcastFn;
        console.log('📡 UIProcessor: WebSocket broadcast function configured');
    }

    /**
     * Rounds angle to 1 decimal place for consistent precision.
     */
    private roundToOneDecimal(value: number): number {
        return Math.round(value * 10) / 10;
    }

    /**
     * Updates joint angle data and notifies subscribers for EVERY sample.
     */
    updateJointAngle(angleData: JointAngleData): void {
        // DISABLED for performance (called at 100Hz)
        // console.log(`🦵 [UI_PROCESSOR] updateJointAngle called:`, {
        //     angleData: angleData,
        //     jointName: angleData.jointName,
        //     angle: angleData.angle,
        //     timestamp: angleData.timestamp,
        //     hasWebSocketBroadcast: !!this.webSocketBroadcast,
        //     jointExists: !!this.jointDataMap.get(angleData.jointName)
        // });

        const jointData = this.jointDataMap.get(angleData.jointName);
        if (!jointData) {
            console.error(`❌ [UI_PROCESSOR] Joint data not found for: ${angleData.jointName}`);
            return;
        }

        // Update data with 1 decimal precision
        this.updateJointData(jointData, angleData);

        // ALWAYS notify subscribers for smooth visualization
        this.notifySubscribers();

        // Broadcast processed joint angle data via WebSocket to UI
        this.broadcastJointAngleData(angleData);
    }

    /**
     * Processes recording data received from server for historical display.
     */
    processServerData(recording: APIRecording): void {
        this.processJointsData(recording.joints_arr);
        this.processMeasurementSequences(recording.measurement_sequences, recording.joints_arr);
        this.notifySubscribers();
    }

    /**
     * Returns current UI state formatted for chart components.
     */
    getChartFormat(): UIState {
        return {
            left: this.jointDataMap.get(JointName.LEFT_KNEE) || this.createEmptyJointData(),
            right: this.jointDataMap.get(JointName.RIGHT_KNEE) || this.createEmptyJointData()
        };
    }

    /**
     * Subscribes to UI state changes, returns unsubscribe function.
     */
    subscribe(callback: (data: UIState) => void): () => void {
        this.subscribers.add(callback);
        callback(this.getChartFormat());
        return () => this.subscribers.delete(callback);
    }

    /**
     * Performs cleanup and resets to initial state.
     */
    cleanup(): void {
        this.subscribers.clear();
        this.initializeJointData();
    }

    /**
     * Initializes joint data maps with default empty values.
     */
    private initializeJointData(): void {
        const defaultData = this.createEmptyJointData();
        this.jointDataMap.set(JointName.LEFT_KNEE, { ...defaultData });
        this.jointDataMap.set(JointName.RIGHT_KNEE, { ...defaultData });
    }

    /**
     * Creates empty joint data structure with zero values.
     */
    private createEmptyJointData(): UIJointData {
        return {
            current: 0,
            max: 0,
            min: 0,
            rom: 0,
            lastUpdate: 0,
            devices: []
        };
    }

    /**
     * Updates joint data values with 1 decimal precision.
     */
    private updateJointData(jointData: UIJointData, angleData: JointAngleData): void {
        jointData.current = this.roundToOneDecimal(angleData.angle);
        jointData.lastUpdate = angleData.timestamp;
        jointData.devices = angleData.deviceIds;

        // DISABLED: Min/max/ROM removed in Phase 1 optimization
        // this.updateMinMax(jointData, angleData.angle);
    }

    /**
     * Updates minimum, maximum, and range of motion values for joint data.
     */
    private updateMinMax(jointData: UIJointData, angle: number): void {
        const roundedAngle = this.roundToOneDecimal(angle);

        if (jointData.min === 0 || roundedAngle < jointData.min) {
            jointData.min = roundedAngle;
        }

        if (roundedAngle > jointData.max) {
            jointData.max = roundedAngle;
        }

        jointData.rom = this.roundToOneDecimal(jointData.max - jointData.min);
    }

    /**
     * Processes joint summary data from server response.
     */
    private processJointsData(joints: any[]): void {
        joints.forEach(joint => {
            const jointData = this.jointDataMap.get(joint.joint_name);
            if (!jointData) return;

            jointData.min = this.roundToOneDecimal(joint.min_flexion);
            jointData.max = this.roundToOneDecimal(joint.max_extension);
            jointData.rom = this.roundToOneDecimal(jointData.max - jointData.min);
            jointData.lastUpdate = new Date(joint.timestamp).getTime();
        });
    }

    /**
     * Processes measurement sequence data to extract latest angle values.
     */
    private processMeasurementSequences(sequences: any[], joints: any[]): void {
        sequences.forEach(sequence => {
            if (sequence.values.length === 0) return;

            const jointName = this.getJointNameFromId(sequence.joint_id, joints);
            const jointData = this.jointDataMap.get(jointName);

            if (jointData) {
                const lastValue = sequence.values[sequence.values.length - 1];
                jointData.current = this.roundToOneDecimal(lastValue);
            }
        });
    }

    /**
     * Maps joint ID to joint name using joints array reference.
     */
    private getJointNameFromId(jointId: string, joints: any[]): string {
        const joint = joints.find(j => j.id === jointId);
        return joint?.joint_name || '';
    }

    /**
     * Notifies all subscribers of current state for every update.
     */
    private notifySubscribers(): void {
        const state = this.getChartFormat();
        this.subscribers.forEach(callback => {
            try {
                callback(state);
            } catch {
            }
        });
    }

    /**
     * Broadcast processed joint angle data via WebSocket to UI.
     *
     * ARCHITECTURE NOTE: Throttling kept minimal (10ms = 100 broadcasts/sec max)
     * but pending broadcasts now use CURRENT joint data, not stale parameter.
     * This prevents "out of sync" where old angles would be broadcast.
     */
    private async broadcastJointAngleData(angleData: JointAngleData): Promise<void> {
        if (!this.webSocketBroadcast) {
            console.error('❌ [UI_PROCESSOR] No WebSocket broadcast function configured - cannot send joint angles to UI!');
            return;
        }

        const now = Date.now();
        const timeSinceLastBroadcast = now - this.lastBroadcastTime;

        // Throttle broadcast if called too frequently
        if (timeSinceLastBroadcast < this.MIN_BROADCAST_INTERVAL) {
            this.pendingBroadcast = true;
            return;
        }

        try {
            // Use Float32Array for optimized binary protocol
            // Format: [leftCurrent, rightCurrent] - only 2 floats, no junk
            // CRITICAL: Always use CURRENT joint data from map, not stale angleData parameter
            const leftKnee = this.jointDataMap.get(JointName.LEFT_KNEE) || this.createEmptyJointData();
            const rightKnee = this.jointDataMap.get(JointName.RIGHT_KNEE) || this.createEmptyJointData();

            const data = new Float32Array([
                leftKnee.current,
                rightKnee.current
            ]);

            // Create WebSocket message with Float32Array for binary protocol
            const message = {
                type: 0x30, // MESSAGE_TYPES.MOTION_DATA
                requestId: 0, // Fire-and-forget streaming data
                timestamp: now, // Use current time for broadcast timestamp
                deviceName: angleData.deviceIds.join(','),
                data: data
            };

            // Send immediately without await - fire and forget for performance
            this.webSocketBroadcast(message, []).catch(error => {
                console.error('❌ [UI_PROCESSOR] Error broadcasting joint angle data:', error);
            });

            this.lastBroadcastTime = now;
            this.pendingBroadcast = false;

        } catch (error) {
            console.error('❌ [UI_PROCESSOR] Error creating WebSocket message:', error);
        }
    }
}