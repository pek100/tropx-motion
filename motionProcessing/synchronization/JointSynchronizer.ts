import { JointAngleData, Quaternion } from '../shared/types';
import { JointName } from '../shared/config';

/**
 * "Latest value" fusion strategy (flight controller approach).
 * When ANY joint updates, emit COMPLETE pair with latest values for BOTH joints.
 * No buffering = zero added latency.
 * No waiting = every sensor update propagates immediately.
 */

/** Joint sample with angle data and quaternion */
interface JointSample {
    angleData: JointAngleData;
    relativeQuat: Quaternion;
}

/** Identity quaternion for defaults */
const IDENTITY_QUAT: Quaternion = { w: 1, x: 0, y: 0, z: 0 };

/**
 * Synchronized output containing BOTH joints at the same timestamp.
 * Never null - always complete pairs (using defaults if needed).
 */
export interface SynchronizedJointPair {
    timestamp: number;
    leftKnee: {
        angle: number;
        relativeQuat: Quaternion;
        deviceIds: string[];
    };
    rightKnee: {
        angle: number;
        relativeQuat: Quaternion;
        deviceIds: string[];
    };
}

type SyncCallback = (pair: SynchronizedJointPair) => void;

/**
 * JointSynchronizer - Central synchronization layer for joint data.
 *
 * Flight controller approach:
 * - When ANY joint updates, immediately emit COMPLETE pair
 * - Always includes BOTH joints (using last known or default values)
 * - No waiting for both joints to update
 * - Every sensor update flows through to all consumers
 */
export class JointSynchronizer {
    private static instance: JointSynchronizer | null = null;

    /** Latest sample per joint (no buffering) */
    private latestLeft: JointSample | null = null;
    private latestRight: JointSample | null = null;

    /** Subscribers for synchronized pairs */
    private subscribers = new Set<SyncCallback>();

    /** Debug counters */
    private static debugEmitCount = 0;
    private static debugPushCount = 0;

    private constructor() {
        console.log('✅ [JOINT_SYNC] JointSynchronizer initialized (flight controller mode - always emit complete pairs)');
    }

    static getInstance(): JointSynchronizer {
        if (!JointSynchronizer.instance) {
            JointSynchronizer.instance = new JointSynchronizer();
        }
        return JointSynchronizer.instance;
    }

    static reset(): void {
        if (JointSynchronizer.instance) {
            JointSynchronizer.instance.cleanup();
            JointSynchronizer.instance = null;
        }
    }

    /** Reset state for new recording session. */
    static resetForNewRecording(): void {
        if (JointSynchronizer.instance) {
            JointSynchronizer.instance.latestLeft = null;
            JointSynchronizer.instance.latestRight = null;
            // Reset debug counters
            JointSynchronizer.debugEmitCount = 0;
            JointSynchronizer.debugPushCount = 0;
            console.log('🔄 [JOINT_SYNC] Reset for new recording');
        }
    }

    /** Subscribe to synchronized joint pairs. */
    subscribe(callback: SyncCallback): () => void {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    /**
     * Push a joint sample with its relative quaternion.
     * Immediately emits COMPLETE synchronized pair using latest values for BOTH joints.
     */
    pushJointSample(angleData: JointAngleData, relativeQuat: Quaternion): void {
        JointSynchronizer.debugPushCount++;
        const isLeft = angleData.jointName === JointName.LEFT_KNEE;
        const sample: JointSample = { angleData, relativeQuat };

        // Store as latest for this joint
        if (isLeft) {
            this.latestLeft = sample;
        } else {
            this.latestRight = sample;
        }

        // Immediately emit COMPLETE synchronized pair
        this.emitCompletePair();

        // Debug logging at intervals
        if (JointSynchronizer.debugPushCount === 50 || JointSynchronizer.debugPushCount === 200) {
            console.log(`📊 [JOINT_SYNC_DEBUG] pushCount=${JointSynchronizer.debugPushCount}, emits=${JointSynchronizer.debugEmitCount}`);
        }
    }

    /** Get current state for debugging */
    getState(): { hasLeft: boolean; hasRight: boolean } {
        return {
            hasLeft: this.latestLeft !== null,
            hasRight: this.latestRight !== null
        };
    }

    /** Get debug stats for pipeline analysis */
    static getDebugStats(): { pushCount: number; emitCount: number } {
        return {
            pushCount: JointSynchronizer.debugPushCount,
            emitCount: JointSynchronizer.debugEmitCount
        };
    }

    private cleanup(): void {
        this.subscribers.clear();
        this.latestLeft = null;
        this.latestRight = null;
    }

    /**
     * Emit COMPLETE synchronized pair - ALWAYS includes both joints.
     * Uses last known values or defaults (0) for joints that haven't reported yet.
     * Flight controller approach: every update triggers emission.
     */
    private emitCompletePair(): void {
        JointSynchronizer.debugEmitCount++;

        // Get values for both joints (use last known or defaults)
        const leftAngle = this.latestLeft?.angleData.angle ?? 0;
        const leftQuat = this.latestLeft?.relativeQuat ?? IDENTITY_QUAT;
        const leftDevices = this.latestLeft?.angleData.deviceIds ?? [];
        const leftTs = this.latestLeft?.angleData.timestamp ?? 0;

        const rightAngle = this.latestRight?.angleData.angle ?? 0;
        const rightQuat = this.latestRight?.relativeQuat ?? IDENTITY_QUAT;
        const rightDevices = this.latestRight?.angleData.deviceIds ?? [];
        const rightTs = this.latestRight?.angleData.timestamp ?? 0;

        // Use MAX timestamp from available joints
        const emitTimestamp = Math.max(leftTs, rightTs);

        // Create COMPLETE synchronized pair - never null
        const pair: SynchronizedJointPair = {
            timestamp: emitTimestamp,
            leftKnee: {
                angle: leftAngle,
                relativeQuat: leftQuat,
                deviceIds: leftDevices
            },
            rightKnee: {
                angle: rightAngle,
                relativeQuat: rightQuat,
                deviceIds: rightDevices
            }
        };

        // Notify all subscribers
        this.notifySubscribers(pair);
    }

    private notifySubscribers(pair: SynchronizedJointPair): void {
        this.subscribers.forEach(callback => {
            try {
                callback(pair);
            } catch (error) {
                console.error('❌ [JOINT_SYNC] Subscriber error:', error);
            }
        });
    }
}
