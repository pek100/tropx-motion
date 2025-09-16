import { JointAngleData, SessionContext, APIRecording, APIJoint, APIMeasurement } from '../shared/types';
import { JointStatisticsManager } from '../shared/JointStatisticsManager';
import { Cache } from '../shared/cache';
import { v4 as uuidv4 } from 'uuid';
import { CACHE } from '../shared/constants';
import { roundToPrecision, getCurrentTimestamp, convertSensorTimeToUTC } from '../shared/utils';

interface BufferedMeasurement {
    values: number[];
    startTime: number;
    lastUpdate: number;
}

/**
 * Accumulates and processes joint angle data during recording sessions.
 * Manages data buffering, statistical tracking, and final recording creation
 * with proper timestamp conversion and data structuring for API communication.
 */
export class DataParser {
    private static instance: DataParser | null = null;
    private recordingCache: Cache<APIRecording>;
    private recordingId: string | null = null;
    private measurementBuffer = new Map<string, BufferedMeasurement>();
    private jointIds = new Map<string, string>();
    private jointStats = new Map<string, JointStatisticsManager>();
    private recordingStartTime: number = 0;
    private targetHz: number;
    private sampleCounter = 0;

    private constructor(targetHz: number) {
        this.recordingCache = new Cache<APIRecording>(CACHE.RECORDING_SIZE, CACHE.RECORDING_TTL_MS);
        this.targetHz = targetHz;
    }

    /**
     * Returns singleton instance, creating it with specified target frequency if needed.
     */
    static getInstance(targetHz: number): DataParser {
        if (!DataParser.instance) {
            DataParser.instance = new DataParser(targetHz);
        }
        return DataParser.instance;
    }

    /**
     * Cleans up singleton instance and releases resources.
     */
    static reset(): void {
        if (DataParser.instance) {
            DataParser.instance.cleanup();
            DataParser.instance = null;
        }
    }

    /**
     * Initializes new recording session with unique ID and timestamp.
     */
    startNewRecording(): void {
        this.recordingId = uuidv4();
        this.recordingStartTime = getCurrentTimestamp();
        this.clearBuffers();
    }

    /**
     * Accumulates angle data during active recording session.
     * Updates both statistical tracking and measurement buffers.
     */
    accumulateAngleData(angleData: JointAngleData): void {
        if (!this.recordingId) return;

        const jointId = this.getOrCreateJointId(angleData.jointName);
        const roundedAngle = roundToPrecision(angleData.angle);

        this.updateJointStatistics(angleData.jointName, roundedAngle);
        this.updateMeasurementBuffer(jointId, angleData.timestamp, roundedAngle);
    }

    /**
     * Creates final recording object from accumulated data and session context.
     * Returns null if no data was recorded or recording ID is missing.
     */
    createFinalRecording(context: SessionContext): APIRecording | null {
        if (!this.recordingId || this.measurementBuffer.size === 0) return null;

        const finalTimestamp = getCurrentTimestamp();
        const { joints, measurements } = this.buildRecordingData(finalTimestamp);

        if (joints.length === 0) return null;

        const recording = this.createRecordingObject(context, finalTimestamp, joints, measurements);
        this.cacheRecording(recording);

        return recording;
    }

    /**
     * Returns current recording ID or null if no active recording.
     */
    getRecordingId(): string | null {
        return this.recordingId;
    }

    /**
     * Performs complete cleanup of caches and buffers.
     */
    cleanup(): void {
        this.recordingCache.cleanup();
        this.recordingId = null;
        this.recordingStartTime = 0;
        this.clearBuffers();
    }

    /**
     * Clears all recording-specific buffers and mappings.
     */
    private clearBuffers(): void {
        this.measurementBuffer.clear();
        this.jointIds.clear();
        this.jointStats.clear();
    }

    /**
     * Retrieves or creates unique ID for joint, initializing statistics manager.
     */
    private getOrCreateJointId(jointName: string): string {
        let jointId = this.jointIds.get(jointName);
        if (!jointId) {
            jointId = uuidv4();
            this.jointIds.set(jointName, jointId);
            this.jointStats.set(jointName, new JointStatisticsManager(this.targetHz));
        }
        return jointId;
    }

    /**
     * Updates statistical tracking for joint with new angle measurement.
     */
    private updateJointStatistics(jointName: string, angle: number): void {
        const statsManager = this.jointStats.get(jointName);
        if (statsManager) {
            statsManager.updateStats(jointName, angle);
        }
    }

    /**
     * Adds angle measurement to buffered data with timestamp conversion and size limit.
     */
    private updateMeasurementBuffer(jointId: string, timestamp: number, angle: number): void {
        let buffer = this.measurementBuffer.get(jointId);
        if (!buffer) {
            buffer = this.createNewBuffer(timestamp);
            this.measurementBuffer.set(jointId, buffer);
        }

        // For recording, we need to keep values but with reasonable limits
        buffer.values.push(angle);

        // Prevent infinite growth - keep reasonable recording window
        const MAX_BUFFER_SIZE = 5000; // ~50 seconds at 100Hz - reasonable for single recording
        if (buffer.values.length > MAX_BUFFER_SIZE) {
            // Remove oldest 20% to avoid frequent array operations
            const removeCount = Math.floor(MAX_BUFFER_SIZE * 0.2);
            buffer.values.splice(0, removeCount);
        }

        buffer.lastUpdate = convertSensorTimeToUTC(timestamp, this.recordingStartTime);
    }

    /**
     * Creates new measurement buffer with UTC timestamp initialization.
     */
    private createNewBuffer(timestamp: number): BufferedMeasurement {
        const utcTime = convertSensorTimeToUTC(timestamp, this.recordingStartTime);
        return {
            values: [],
            startTime: utcTime,
            lastUpdate: utcTime
        };
    }

    /**
     * Builds complete recording data structure from accumulated measurements and statistics.
     */
    private buildRecordingData(finalTimestamp: number): { joints: APIJoint[], measurements: APIMeasurement[] } {
        const joints: APIJoint[] = [];
        const measurements: APIMeasurement[] = [];

        this.jointIds.forEach((jointId, jointName) => {
            const joint = this.createJointData(jointName, jointId, finalTimestamp);
            const measurement = this.createMeasurementData(jointId);

            if (joint && measurement) {
                joints.push(joint);
                measurements.push(measurement);
            }
        });

        return { joints, measurements };
    }

    /**
     * Creates API joint object from statistical data and current angle.
     */
    private createJointData(jointName: string, jointId: string, finalTimestamp: number): APIJoint | null {
        const stats = this.jointStats.get(jointName);
        const buffer = this.measurementBuffer.get(jointId);

        if (!stats || !buffer || buffer.values.length === 0) return null;

        const currentAngle = buffer.values[buffer.values.length - 1];
        return stats.getAPIJoint(jointName, currentAngle, finalTimestamp, jointId);
    }

    /**
     * Creates API measurement object from buffered angle values.
     */
    private createMeasurementData(jointId: string): APIMeasurement | null {
        const buffer = this.measurementBuffer.get(jointId);
        if (!buffer || buffer.values.length === 0) return null;

        return {
            joint_id: jointId,
            start_time: new Date(buffer.startTime).toISOString(),
            values: [...buffer.values]
        };
    }

    /**
     * Creates complete API recording object with session context and timing metadata.
     */
    private createRecordingObject(
        context: SessionContext,
        finalTimestamp: number,
        joints: APIJoint[],
        measurements: APIMeasurement[]
    ): APIRecording {
        return {
            id: this.recordingId!,
            session_instance_id: context.sessionId,
            exercise_instance_id: context.exerciseId,
            set: context.setNumber,
            timestamp: new Date(this.recordingStartTime).toISOString(),
            duration: Math.round((finalTimestamp - this.recordingStartTime) / 1000),
            reps_completed: 0,
            joints_arr: joints,
            measurement_sequences: measurements
        };
    }

    /**
     * Stores completed recording in cache for potential retrieval.
     */
    private cacheRecording(recording: APIRecording): void {
        this.recordingCache.set(`${this.recordingId}-final`, recording);
    }
}