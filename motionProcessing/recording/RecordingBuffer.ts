/**
 * RecordingBuffer - Stores raw per-device sensor data during recording.
 *
 * Raw samples are stored with original device timestamps.
 * Alignment and interpolation happens on export/save via GridSnapService + InterpolationService.
 *
 * This simplified buffer just stores raw samples - no real-time assembly needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Quaternion } from '../shared/types';
import { RawDeviceSample, RecordingMetadata, RecordingState } from './types';

// Constants
const MAX_BUFFER_SIZE = 240000;         // 10 min at 100Hz * 4 devices
const FLUSH_INTERVAL_MS = 10000;        // Flush every 10 seconds
const FLUSH_SAMPLE_THRESHOLD = 4000;    // Or every 4000 samples (1000 per device)
const TEMP_FILE_NAME = 'tropx_recording_backup.json';

/**
 * Backend recording buffer for raw quaternion data with crash recovery.
 * Stores raw per-device samples - alignment happens on export.
 */
class RecordingBufferClass {
    private rawBuffer: RawDeviceSample[] = [];
    private isRecording = false;
    private startTime: number | null = null;
    private latestTimestamp: number | null = null;  // Track latest for O(1) duration calc
    private lastFlushTime = 0;
    private samplesSinceFlush = 0;
    private targetHz = 100;
    private tempFilePath: string;

    // Debug counters
    private static pushCount = 0;
    private static lastPushTs: number | null = null;

    constructor() {
        this.tempFilePath = path.join(os.tmpdir(), TEMP_FILE_NAME);
        this.tryRecoverFromDisk();
    }

    /** Start a new recording session. */
    start(targetHz: number = 100): void {
        this.clear();
        this.targetHz = targetHz;
        // Don't set startTime here - use first sensor timestamp instead
        // This ensures startTime is in the same time base as sample timestamps
        this.startTime = null;
        this.isRecording = true;
        this.lastFlushTime = Date.now();
        // Reset debug counters
        RecordingBufferClass.pushCount = 0;
        RecordingBufferClass.lastPushTs = null;
        console.log(`[RecordingBuffer] Started recording at ${targetHz}Hz`);
    }

    /** Stop the current recording session. */
    stop(): void {
        if (!this.isRecording) return;
        this.isRecording = false;
        this.flushToDisk();
        console.log(`[RecordingBuffer] Stopped recording, ${this.rawBuffer.length} raw samples`);
    }

    /**
     * Push a raw sample from a device.
     * Called by DeviceProcessor for each incoming BLE sample.
     */
    pushRawSample(deviceId: number, timestamp: number, quaternion: Quaternion): void {
        if (!this.isRecording) return;

        RecordingBufferClass.pushCount++;

        // Set startTime from first sensor timestamp (same time base as samples)
        if (this.startTime === null) {
            this.startTime = timestamp;
            console.log(`[RecordingBuffer] Recording start time set from first sample: ${timestamp}`);
        }

        // Track latest timestamp for O(1) duration calculation
        if (this.latestTimestamp === null || timestamp > this.latestTimestamp) {
            this.latestTimestamp = timestamp;
        }

        // Debug logging for first few samples
        if (RecordingBufferClass.pushCount <= 20) {
            const delta = RecordingBufferClass.lastPushTs !== null
                ? timestamp - RecordingBufferClass.lastPushTs
                : 0;
            console.log(`[RecordingBuffer] pushRawSample #${RecordingBufferClass.pushCount}: device=0x${deviceId.toString(16)}, ts=${timestamp}, delta=${delta.toFixed(1)}ms`);
        }
        RecordingBufferClass.lastPushTs = timestamp;

        // Store raw sample
        this.rawBuffer.push({ deviceId, timestamp, quaternion });
        this.samplesSinceFlush++;

        // Log progress periodically
        if (this.rawBuffer.length <= 5 || this.rawBuffer.length % 400 === 0) {
            console.log(`[RecordingBuffer] Raw sample count: ${this.rawBuffer.length}`);
        }

        // Enforce max buffer size (FIFO)
        if (this.rawBuffer.length > MAX_BUFFER_SIZE) {
            this.rawBuffer.shift();
        }

        // Periodic flush for crash recovery
        this.checkFlush();
    }

    /**
     * Get all raw samples, sorted by timestamp.
     * Called by CSVExporter and UploadService before processing with GridSnapService.
     */
    getRawSamples(): RawDeviceSample[] {
        // Sort by timestamp to handle BLE out-of-order arrival
        return [...this.rawBuffer].sort((a, b) => a.timestamp - b.timestamp);
    }

    /** Get recording metadata. */
    getMetadata(): RecordingMetadata | null {
        if (this.rawBuffer.length === 0 || !this.startTime) return null;

        // Find the latest timestamp
        const timestamps = this.rawBuffer.map(s => s.timestamp);
        const endTime = Math.max(...timestamps);

        return {
            startTime: this.startTime,
            endTime,
            sampleCount: this.rawBuffer.length,
            targetHz: this.targetHz
        };
    }

    /** Get current recording state for IPC. */
    getState(): RecordingState {
        // Calculate duration using tracked sensor timestamps (O(1) instead of O(n))
        const durationMs = (this.startTime && this.latestTimestamp)
            ? this.latestTimestamp - this.startTime
            : 0;
        return {
            isRecording: this.isRecording,
            sampleCount: this.rawBuffer.length,
            durationMs,
            startTime: this.startTime
        };
    }

    /** Check if buffer is empty. */
    isEmpty(): boolean {
        return this.rawBuffer.length === 0;
    }

    /** Clear all data. */
    clear(): void {
        this.rawBuffer = [];
        this.startTime = null;
        this.latestTimestamp = null;
        this.isRecording = false;
        this.samplesSinceFlush = 0;
        this.deleteTempFile();
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
        if (this.rawBuffer.length === 0) return;

        try {
            const data = {
                version: 2,  // New raw format
                startTime: this.startTime,
                targetHz: this.targetHz,
                rawSamples: this.rawBuffer
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

            // Handle new raw format (version 2)
            if (data.version === 2 && data.rawSamples && Array.isArray(data.rawSamples) && data.rawSamples.length > 0) {
                this.rawBuffer = data.rawSamples;
                this.startTime = data.startTime || null;
                this.targetHz = data.targetHz || 100;
                console.log(`[RecordingBuffer] Recovered ${this.rawBuffer.length} raw samples from disk (v2)`);
            }
            // Ignore old format (version 1 / no version) - can't convert aligned to raw
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

// Re-export types for convenience
export type { RawDeviceSample, RecordingMetadata, RecordingState } from './types';

// Module load verification
console.log('[RecordingBuffer] Module loaded (v2 - raw storage)');
