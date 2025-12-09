import { JointAngleData, UIJointData, APIRecording } from '../shared/types';
import { JointName } from "../shared/config";

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
    private webSocketBroadcast: ((message: any, clientIds: string[]) => Promise<void>) | null = null;

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

    setWebSocketBroadcast(broadcastFn: (message: any, clientIds: string[]) => Promise<void>): void {
        this.webSocketBroadcast = broadcastFn;
        console.log('📡 UIProcessor: WebSocket broadcast function configured');
    }

    updateJointAngle(angleData: JointAngleData): void {
        const jointData = this.jointDataMap.get(angleData.jointName);
        if (!jointData) {
            console.error(`❌ [UI_PROCESSOR] Joint data not found for: ${angleData.jointName}`);
            return;
        }

        this.updateJointData(jointData, angleData);
        this.notifySubscribers();
        this.broadcastJointAngleData(angleData);
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

    private updateJointData(jointData: UIJointData, angleData: JointAngleData): void {
        jointData.current = this.roundToOneDecimal(angleData.angle);
        jointData.lastUpdate = angleData.timestamp;
        jointData.devices = angleData.deviceIds;
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

    private async broadcastJointAngleData(angleData: JointAngleData): Promise<void> {
        if (!this.webSocketBroadcast) {
            console.error('❌ [UI_PROCESSOR] No WebSocket broadcast function configured');
            return;
        }

        try {
            const leftKnee = this.jointDataMap.get(JointName.LEFT_KNEE) || this.createEmptyJointData();
            const rightKnee = this.jointDataMap.get(JointName.RIGHT_KNEE) || this.createEmptyJointData();

            const data = new Float32Array([leftKnee.current, rightKnee.current]);

            const message = {
                type: 0x30, // MESSAGE_TYPES.MOTION_DATA
                requestId: 0,
                timestamp: Date.now(),
                deviceName: angleData.deviceIds.join(','),
                data: data
            };

            this.webSocketBroadcast(message, []).catch(error => {
                console.error('❌ [UI_PROCESSOR] Error broadcasting joint angle data:', error);
            });

        } catch (error) {
            console.error('❌ [UI_PROCESSOR] Error creating WebSocket message:', error);
        }
    }
}
