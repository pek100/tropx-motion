import { JointAngleData, UIJointData, APIRecording } from '../shared/types';
import { JointName } from "../shared/config";
import { SynchronizedJointPair } from '../MotionProcessingCoordinator';

interface UIState {
    left: UIJointData;
    right: UIJointData;
}

/**
 * Manages UI data state and updates for joint angle visualization.
 *
 * Receives synchronized pairs from BatchSynchronizer via MotionProcessingCoordinator.
 * Broadcasts directly to WebSocket without any internal batching.
 */
export class UIProcessor {
    private static instance: UIProcessor | null = null;
    private jointDataMap = new Map<string, UIJointData>();
    private subscribers = new Set<(data: UIState) => void>();
    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

    /** Debug counter */
    private static debugBroadcastCount = 0;

    private constructor() {
        this.initializeJointData();
    }

    static getInstance(): UIProcessor {
        if (!UIProcessor.instance) {
            UIProcessor.instance = new UIProcessor();
        }
        return UIProcessor.instance;
    }

    static reset(): void {
        if (UIProcessor.instance) {
            UIProcessor.instance.cleanup();
            UIProcessor.instance = null;
        }
    }

    /** Reset state for new recording session. */
    static resetForNewRecording(): void {
        if (UIProcessor.instance) {
            UIProcessor.debugBroadcastCount = 0;
            console.log('🔄 [UI_PROCESSOR] Reset for new recording');
        }
    }

    setWebSocketBroadcast(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
        this.webSocketBroadcast = broadcastFn;
        console.log('📡 UIProcessor: WebSocket broadcast function configured');
    }

    /** Get debug stats for pipeline analysis */
    static getDebugStats(): { broadcastCount: number } {
        return {
            broadcastCount: UIProcessor.debugBroadcastCount
        };
    }

    /**
     * Broadcast COMPLETE synchronized pair directly.
     * No internal batching - JointSynchronizer already provides complete pairs.
     * Flight controller approach: every update is broadcast immediately.
     */
    broadcastCompletePair(pair: SynchronizedJointPair): void {
        // Update UI state for subscribers
        this.updateUIState(pair);
        this.notifySubscribers();

        // Broadcast via WebSocket
        if (!this.webSocketBroadcast) {
            return;
        }

        UIProcessor.debugBroadcastCount++;

        // Debug logging at intervals
        if (UIProcessor.debugBroadcastCount === 50 || UIProcessor.debugBroadcastCount === 200) {
            console.log(`📊 [UI_PROC_DEBUG] broadcasts=${UIProcessor.debugBroadcastCount}`);
        }

        try {
            const data = new Float32Array([pair.leftKnee.angle, pair.rightKnee.angle]);

            const message = {
                type: 0x30, // MESSAGE_TYPES.MOTION_DATA
                requestId: 0,
                timestamp: pair.timestamp,
                deviceName: [...pair.leftKnee.deviceIds, ...pair.rightKnee.deviceIds].join(','),
                data: data
            };

            this.webSocketBroadcast(message, []).catch(error => {
                console.error('❌ [UI_PROCESSOR] Error broadcasting:', error);
            });

        } catch (error) {
            console.error('❌ [UI_PROCESSOR] Error creating WebSocket message:', error);
        }
    }

    /** Update internal UI state from synchronized pair. */
    private updateUIState(pair: SynchronizedJointPair): void {
        const leftData = this.jointDataMap.get(JointName.LEFT_KNEE);
        const rightData = this.jointDataMap.get(JointName.RIGHT_KNEE);

        if (leftData) {
            leftData.current = this.roundToOneDecimal(pair.leftKnee.angle);
            leftData.lastUpdate = pair.timestamp;
            leftData.devices = pair.leftKnee.deviceIds;
        }

        if (rightData) {
            rightData.current = this.roundToOneDecimal(pair.rightKnee.angle);
            rightData.lastUpdate = pair.timestamp;
            rightData.devices = pair.rightKnee.deviceIds;
        }
    }

    // Legacy method - kept for backward compatibility with processServerData
    updateJointAngle(angleData: JointAngleData): void {
        const jointData = this.jointDataMap.get(angleData.jointName);
        if (!jointData) return;

        jointData.current = this.roundToOneDecimal(angleData.angle);
        jointData.lastUpdate = angleData.timestamp;
        jointData.devices = angleData.deviceIds;
        this.notifySubscribers();
    }

    processServerData(recording: APIRecording): void {
        this.processJointsData(recording.joints_arr);
        this.processMeasurementSequences(recording.measurement_sequences, recording.joints_arr);
        this.notifySubscribers();
    }

    getChartFormat(): UIState {
        return {
            left: this.jointDataMap.get(JointName.LEFT_KNEE) || this.createEmptyJointData(),
            right: this.jointDataMap.get(JointName.RIGHT_KNEE) || this.createEmptyJointData()
        };
    }

    subscribe(callback: (data: UIState) => void): () => void {
        this.subscribers.add(callback);
        callback(this.getChartFormat());
        return () => this.subscribers.delete(callback);
    }

    cleanup(): void {
        this.subscribers.clear();
        this.initializeJointData();
    }

    private initializeJointData(): void {
        const defaultData = this.createEmptyJointData();
        this.jointDataMap.set(JointName.LEFT_KNEE, { ...defaultData });
        this.jointDataMap.set(JointName.RIGHT_KNEE, { ...defaultData });
    }

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

    private roundToOneDecimal(value: number): number {
        return Math.round(value * 10) / 10;
    }

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

    private getJointNameFromId(jointId: string, joints: any[]): string {
        const joint = joints.find(j => j.id === jointId);
        return joint?.joint_name || '';
    }

    private notifySubscribers(): void {
        const state = this.getChartFormat();
        this.subscribers.forEach(callback => {
            try {
                callback(state);
            } catch {
                // Continue with other subscribers if one fails
            }
        });
    }
}
