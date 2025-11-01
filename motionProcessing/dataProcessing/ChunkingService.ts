import { APIRecording } from '../shared/types';
import { ServerService } from './ServerService';
import { CHUNKING } from '../shared/constants';
import { safeArrayLength, safeJSONStringify } from '../shared/utils';
import { Logger } from '../shared/Logger';

interface ChunkMetadata {
    chunkId: string;
    recordingId: string;
    chunkNumber: number;
    measurementCount: number;
    estimatedSizeBytes: number;
    timestamp: number;
}

interface RecordingChunk {
    metadata: ChunkMetadata;
    partialRecording: APIRecording;
}

interface UploadResult {
    successful: number;
    failed: number;
    errors: string[];
}

/**
 * Manages large recording data by splitting into manageable chunks for upload.
 * Implements intelligent chunking based on measurement count and provides
 * failure recovery through persistent storage with automatic retry capability.
 */
export class ChunkingService {
    private readonly targetMeasurementsPerChunk: number;
    private readonly storagePrefix = 'motion_recording';

    constructor(
        private serverService: ServerService,
        targetMeasurementsPerChunk: number = CHUNKING.DEFAULT_MEASUREMENTS_PER_CHUNK
    ) {
        this.targetMeasurementsPerChunk = targetMeasurementsPerChunk;
    }

    /**
     * Splits large recording into smaller chunks based on measurement count.
     * Returns single chunk if recording is below threshold size.
     */
    splitRecordingIntoChunks(recording: APIRecording): RecordingChunk[] {
        if (!recording?.measurement_sequences) return [];

        const totalMeasurements = this.calculateTotalMeasurements(recording.measurement_sequences);

        if (totalMeasurements <= this.targetMeasurementsPerChunk) {
            return [this.createSingleChunk(recording, 0)];
        }

        return this.createMultipleChunks(recording);
    }

    /**
     * Attempts to upload all chunks with failure tracking and local storage fallback.
     */
    async uploadChunks(chunks: RecordingChunk[]): Promise<UploadResult> {
        const result: UploadResult = { successful: 0, failed: 0, errors: [] };

        for (const chunk of chunks) {
            try {
                await this.serverService.sendToServer(chunk.partialRecording);
                result.successful++;
            } catch (error) {
                result.failed++;
                result.errors.push(`Chunk ${chunk.metadata.chunkNumber}: Upload failed`);
                this.saveChunkToStorage(chunk);
            }
        }

        return result;
    }

    /**
     * Retrieves failed chunks from local storage for retry attempts.
     */
    getFailedChunks(recordingId: string): RecordingChunk[] {
        const chunks: RecordingChunk[] = [];

        for (let i = 0; i < CHUNKING.SAFETY_LIMIT_CHUNKS; i++) {
            const chunkKey = `${this.storagePrefix}_${recordingId}_${i}`;
            const stored = localStorage.getItem(chunkKey);
            if (!stored) continue;

            try {
                chunks.push(JSON.parse(stored));
            } catch {
                // Skip corrupted chunks and continue recovery
            }
        }

        return chunks;
    }

    /**
     * Removes chunk data from local storage after successful upload.
     */
    cleanupChunks(recordingId: string): void {
        for (let i = 0; i < CHUNKING.SAFETY_LIMIT_CHUNKS; i++) {
            const chunkKey = `${this.storagePrefix}_${recordingId}_${i}`;
            if (localStorage.getItem(chunkKey)) {
                localStorage.removeItem(chunkKey);
            }
        }
    }

    /**
     * Placeholder cleanup method for service consistency.
     */
    cleanup(): void {
        // No active cleanup required for chunking service
    }

    /**
     * Calculates total number of measurements across all sequences.
     */
    private calculateTotalMeasurements(sequences: any[]): number {
        return sequences.reduce((total, seq) => {
            return total + safeArrayLength(seq?.values);
        }, 0);
    }

    /**
     * Creates single chunk containing entire recording with metadata.
     */
    private createSingleChunk(recording: APIRecording, chunkNumber: number): RecordingChunk {
        const measurementCount = this.calculateTotalMeasurements(recording.measurement_sequences);
        const metadata = this.createChunkMetadata(recording.id, chunkNumber, measurementCount);

        return {
            metadata,
            partialRecording: { ...recording }
        };
    }

    /**
     * Creates multiple chunks by splitting measurement sequences across chunks.
     * Distributes data evenly while maintaining temporal continuity.
     */
    private createMultipleChunks(recording: APIRecording): RecordingChunk[] {
        const chunks: RecordingChunk[] = [];
        const measurementsPerJointPerChunk = Math.ceil(
            this.targetMeasurementsPerChunk / recording.measurement_sequences.length
        );

        const maxValuesLength = this.getMaxSequenceLength(recording.measurement_sequences);
        const chunksNeeded = Math.ceil(maxValuesLength / measurementsPerJointPerChunk);

        for (let i = 0; i < chunksNeeded; i++) {
            const chunk = this.createChunkAtIndex(recording, i, measurementsPerJointPerChunk, maxValuesLength);
            if (chunk) chunks.push(chunk);
        }

        return chunks;
    }

    /**
     * Finds the longest measurement sequence to determine chunking requirements.
     */
    private getMaxSequenceLength(sequences: any[]): number {
        return Math.max(...sequences.map(seq => safeArrayLength(seq?.values)));
    }

    /**
     * Creates chunk for specific index range with measurement validation.
     */
    private createChunkAtIndex(
        recording: APIRecording,
        index: number,
        measurementsPerJointPerChunk: number,
        maxValuesLength: number
    ): RecordingChunk | null {
        const startIndex = index * measurementsPerJointPerChunk;
        const endIndex = Math.min(startIndex + measurementsPerJointPerChunk, maxValuesLength);

        const chunkMeasurements = this.extractChunkMeasurements(
            recording.measurement_sequences,
            startIndex,
            endIndex
        );

        if (chunkMeasurements.length === 0) return null;

        return this.createChunkFromMeasurements(recording, chunkMeasurements, index);
    }

    /**
     * Extracts measurement data for specified index range across all sequences.
     */
    private extractChunkMeasurements(sequences: any[], startIndex: number, endIndex: number): any[] {
        return sequences
            .map(seq => this.createSequenceSlice(seq, startIndex, endIndex))
            .filter(seq => seq && safeArrayLength(seq.values) > 0);
    }

    /**
     * Creates sequence slice with proper boundary handling and metadata preservation.
     */
    private createSequenceSlice(seq: any, startIndex: number, endIndex: number): any | null {
        if (!seq?.values || !Array.isArray(seq.values)) return null;

        return {
            joint_id: seq.joint_id,
            start_time: seq.start_time,
            values: seq.values.slice(startIndex, endIndex)
        };
    }

    /**
     * Creates chunk object from extracted measurements with complete recording metadata.
     */
    private createChunkFromMeasurements(recording: APIRecording, measurements: any[], chunkNumber: number): RecordingChunk {
        const measurementCount = this.calculateTotalMeasurements(measurements);
        const metadata = this.createChunkMetadata(recording.id, chunkNumber, measurementCount);

        return {
            metadata,
            partialRecording: {
                ...recording,
                measurement_sequences: measurements
            }
        };
    }

    /**
     * Creates comprehensive metadata for chunk tracking and size estimation.
     */
    private createChunkMetadata(recordingId: string, chunkNumber: number, measurementCount: number): ChunkMetadata {
        return {
            chunkId: `${this.storagePrefix}_${recordingId}_${chunkNumber}`,
            recordingId,
            chunkNumber,
            measurementCount,
            estimatedSizeBytes: measurementCount * CHUNKING.BYTES_PER_MEASUREMENT_ESTIMATE,
            timestamp: Date.now()
        };
    }

    /**
     * Persists failed chunk to local storage for retry attempts.
     */
    private saveChunkToStorage(chunk: RecordingChunk): void {
        const serialized = safeJSONStringify(chunk);
        if (!serialized) return;

        try {
            localStorage.setItem(chunk.metadata.chunkId, serialized);
        } catch {
            Logger.error(`Could not save chunk from storage: ${chunk.metadata.chunkId}`);
        }
    }
}