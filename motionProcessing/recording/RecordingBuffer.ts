import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Quaternion } from '../shared/types';

/** Recording sample with quaternion data for both knees. */
export interface QuaternionSample {
    t: number;              // timestamp (ms)
    lq: Quaternion | null;  // left knee relative quaternion
    rq: Quaternion | null;  // right knee relative quaternion
}

/** Recording metadata. */
export interface RecordingMetadata {
    startTime: number;
    endTime: number;
    sampleCount: number;
    targetHz: number;
}

/** Recording state for IPC queries. */
export interface RecordingState {
    isRecording: boolean;
    sampleCount: number;
    durationMs: number;
    startTime: number | null;
}

// Constants
const MAX_BUFFER_SIZE = 60000;          // 10 min at 100Hz
const FLUSH_INTERVAL_MS = 10000;        // Flush every 10 seconds
const FLUSH_SAMPLE_THRESHOLD = 1000;    // Or every 1000 samples
const TEMP_FILE_NAME = 'tropx_recording_backup.json';

/**
 * Backend recording buffer for quaternion data with crash recovery.
 * Stores relative quaternions for SLERP interpolation on export.
 */
class RecordingBufferClass {
    private buffer: QuaternionSample[] = [];
    private isRecording = false;
    private startTime: number | null = null;
    private lastFlushTime = 0;
    private samplesSinceFlush = 0;
    private targetHz = 100;
    private tempFilePath: string;

    // Track latest quaternion per joint for sample assembly
    private pendingLeft: { t: number; q: Quaternion } | null = null;
    private pendingRight: { t: number; q: Quaternion } | null = null;

    // Track which joints are active (have sent data)
    private leftJointSeen = false;
    private rightJointSeen = false;

    constructor() {
        this.tempFilePath = path.join(os.tmpdir(), TEMP_FILE_NAME);
        this.tryRecoverFromDisk();
    }

    /** Start a new recording session. */
    start(targetHz: number = 100): void {
        this.clear();
        this.targetHz = targetHz;
        this.startTime = Date.now();
        this.isRecording = true;
        this.lastFlushTime = Date.now();
        // Reset joint tracking for new session
        this.leftJointSeen = false;
        this.rightJointSeen = false;
        // Reset debug counters for fresh logging
        RecordingBufferClass.pushCount = 0;
        RecordingBufferClass.lastPushTs = null;
        console.log(`🎬 [RecordingBuffer] Started recording at ${targetHz}Hz`);
    }

    /** Stop the current recording session. */
    stop(): void {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.flushToDisk();
        console.log(`🛑 [RecordingBuffer] Stopped recording, ${this.buffer.length} samples`);
    }

    private static pushCount = 0;
    private static lastPushTs: number | null = null;

    /** Push a joint angle sample with its relative quaternion. */
    pushJointSample(jointName: string, timestamp: number, relativeQuat: Quaternion): void {
        RecordingBufferClass.pushCount++;

        // Calculate delta from last push to verify timestamp spreading
        const delta = RecordingBufferClass.lastPushTs !== null
            ? timestamp - RecordingBufferClass.lastPushTs
            : 0;
        RecordingBufferClass.lastPushTs = timestamp;

        // Log first few calls with timestamp delta to verify spreading
        if (RecordingBufferClass.pushCount <= 20) {
            console.log(`📝 [RecordingBuffer] pushJointSample #${RecordingBufferClass.pushCount}: joint=${jointName}, ts=${timestamp}, delta=${delta.toFixed(1)}ms, isRecording=${this.isRecording}`);
        }

        if (!this.isRecording) {
            return;
        }

        const isLeft = jointName.toLowerCase().includes('left');

        if (isLeft) {
            this.pendingLeft = { t: timestamp, q: relativeQuat };
            this.leftJointSeen = true;
        } else {
            this.pendingRight = { t: timestamp, q: relativeQuat };
            this.rightJointSeen = true;
        }

        // Log first few samples for debugging
        if (this.buffer.length < 5) {
            console.log(`📝 [RecordingBuffer] Pending state: L=${!!this.pendingLeft} R=${!!this.pendingRight}, buffer=${this.buffer.length}`);
        }

        // Assemble sample when we have both joints or stale single-joint data
        this.tryAssembleSample();
    }

    private static lastRecordedTs: number = 0;

    /**
     * Push a pre-synchronized pair from BatchSynchronizer.
     * This is the preferred method - both joints already have unified timestamp.
     */
    pushSynchronizedPair(timestamp: number, leftQuat: Quaternion, rightQuat: Quaternion): void {
        if (!this.isRecording) {
            return;
        }

        RecordingBufferClass.pushCount++;

        // Track timestamp deltas to detect bunching
        const tsDelta = timestamp - RecordingBufferClass.lastRecordedTs;
        RecordingBufferClass.lastRecordedTs = timestamp;

        // Log first 50 calls with timestamp delta
        if (RecordingBufferClass.pushCount <= 50) {
            console.log(`📝 [RecordingBuffer] #${RecordingBufferClass.pushCount}: ts=${timestamp}, delta=${tsDelta.toFixed(1)}ms`);
        }

        // Directly add synchronized sample - no assembly needed
        const sample: QuaternionSample = {
            t: timestamp,
            lq: leftQuat,
            rq: rightQuat
        };
        this.addSample(sample);

        // Mark both joints as seen
        this.leftJointSeen = true;
        this.rightJointSeen = true;
    }

    /** Get all recorded samples, sorted by timestamp. */
    getAllSamples(): QuaternionSample[] {
        // Sort by timestamp to fix BLE batching out-of-order arrival
        return [...this.buffer].sort((a, b) => a.t - b.t);
    }

    /** Get recording metadata. */
    getMetadata(): RecordingMetadata | null {
        if (this.buffer.length === 0 || !this.startTime) return null;

        const lastSample = this.buffer[this.buffer.length - 1];
        return {
            startTime: this.startTime,
            endTime: lastSample?.t || Date.now(),
            sampleCount: this.buffer.length,
            targetHz: this.targetHz
        };
    }

    /** Get current recording state for IPC. */
    getState(): RecordingState {
        return {
            isRecording: this.isRecording,
            sampleCount: this.buffer.length,
            durationMs: this.startTime ? Date.now() - this.startTime : 0,
            startTime: this.startTime
        };
    }

    /** Check if buffer is empty. */
    isEmpty(): boolean {
        return this.buffer.length === 0;
    }

    /** Clear all data. */
    clear(): void {
        this.buffer = [];
        this.pendingLeft = null;
        this.pendingRight = null;
        this.leftJointSeen = false;
        this.rightJointSeen = false;
        this.startTime = null;
        this.isRecording = false;
        this.samplesSinceFlush = 0;
        this.deleteTempFile();
    }

    /** Try to assemble a sample from pending joint data. */
    private tryAssembleSample(): void {
        // Case 1: Both joints have data with close timestamps - create combined sample
        if (this.pendingLeft && this.pendingRight) {
            const timeDiff = Math.abs(this.pendingLeft.t - this.pendingRight.t);
            if (timeDiff <= 50) {
                // Both joints within 50ms tolerance - combine them
                const sample: QuaternionSample = {
                    t: Math.max(this.pendingLeft.t, this.pendingRight.t),
                    lq: this.pendingLeft.q,
                    rq: this.pendingRight.q
                };
                this.addSample(sample);
                this.pendingLeft = null;
                this.pendingRight = null;
                return;
            }

            // Timestamps too far apart - record older one as single-joint sample
            if (this.pendingLeft.t < this.pendingRight.t) {
                this.addSample({ t: this.pendingLeft.t, lq: this.pendingLeft.q, rq: null });
                this.pendingLeft = null;
            } else {
                this.addSample({ t: this.pendingRight.t, lq: null, rq: this.pendingRight.q });
                this.pendingRight = null;
            }
            return;
        }

        // Case 2: Single-joint mode - only one joint is active, record immediately
        // This handles the case where user only has one knee's sensors connected
        if (this.pendingLeft && !this.rightJointSeen) {
            // Only left knee is active - record immediately
            this.addSample({ t: this.pendingLeft.t, lq: this.pendingLeft.q, rq: null });
            this.pendingLeft = null;
            return;
        }

        if (this.pendingRight && !this.leftJointSeen) {
            // Only right knee is active - record immediately
            this.addSample({ t: this.pendingRight.t, lq: null, rq: this.pendingRight.q });
            this.pendingRight = null;
            return;
        }

        // Case 3: Both joints have been seen but one stopped - check staleness
        const now = Date.now();
        const staleThreshold = 100;

        if (this.pendingLeft && (now - this.pendingLeft.t) > staleThreshold) {
            this.addSample({ t: this.pendingLeft.t, lq: this.pendingLeft.q, rq: null });
            this.pendingLeft = null;
        }

        if (this.pendingRight && (now - this.pendingRight.t) > staleThreshold) {
            this.addSample({ t: this.pendingRight.t, lq: null, rq: this.pendingRight.q });
            this.pendingRight = null;
        }
    }

    /** Add a sample to the buffer. */
    private addSample(sample: QuaternionSample): void {
        this.buffer.push(sample);
        this.samplesSinceFlush++;

        // Log progress
        if (this.buffer.length <= 5 || this.buffer.length % 100 === 0) {
            console.log(`[RecordingBuffer] Sample added: count=${this.buffer.length}, hasLeft=${!!sample.lq}, hasRight=${!!sample.rq}`);
        }

        // Enforce max buffer size
        if (this.buffer.length > MAX_BUFFER_SIZE) {
            this.buffer.shift();
        }

        // Periodic flush for crash recovery
        this.checkFlush();
    }

    /** Check if we should flush to disk. */
    private checkFlush(): void {
        const now = Date.now();
        const shouldFlush =
            this.samplesSinceFlush >= FLUSH_SAMPLE_THRESHOLD ||
            (now - this.lastFlushTime) >= FLUSH_INTERVAL_MS;

        if (shouldFlush) {
            this.flushToDisk();
        }
    }

    /** Flush buffer to temp file for crash recovery. */
    private flushToDisk(): void {
        if (this.buffer.length === 0) return;

        try {
            const data = {
                startTime: this.startTime,
                targetHz: this.targetHz,
                samples: this.buffer
            };
            fs.writeFileSync(this.tempFilePath, JSON.stringify(data), 'utf-8');
            this.lastFlushTime = Date.now();
            this.samplesSinceFlush = 0;
        } catch (err) {
            console.error('[RecordingBuffer] Flush to disk failed:', err);
        }
    }

    /** Try to recover data from temp file on startup. */
    private tryRecoverFromDisk(): void {
        try {
            if (!fs.existsSync(this.tempFilePath)) return;

            const content = fs.readFileSync(this.tempFilePath, 'utf-8');
            const data = JSON.parse(content);

            if (data.samples && Array.isArray(data.samples) && data.samples.length > 0) {
                this.buffer = data.samples;
                this.startTime = data.startTime || null;
                this.targetHz = data.targetHz || 100;
                console.log(`🔄 [RecordingBuffer] Recovered ${this.buffer.length} samples from disk`);
            }
        } catch (err) {
            console.error('[RecordingBuffer] Recovery failed:', err);
        }
    }

    /** Delete temp file. */
    private deleteTempFile(): void {
        try {
            if (fs.existsSync(this.tempFilePath)) {
                fs.unlinkSync(this.tempFilePath);
            }
        } catch (err) {
            // Ignore deletion errors
        }
    }
}

// Singleton instance
export const RecordingBuffer = new RecordingBufferClass();

// Module load verification
console.log('🔧 [RecordingBuffer] Module loaded, singleton created');
