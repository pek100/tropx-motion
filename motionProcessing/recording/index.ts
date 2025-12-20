export {
    RecordingBuffer,
    type QuaternionSample,
    type RecordingMetadata,
    type RecordingState
} from './RecordingBuffer';

export {
    InterpolationService,
    type InterpolatedAngleSample
} from './InterpolationService';

export {
    CSVExporter,
    type ExportOptions,
    type ExportResult
} from './CSVExporter';

// New quaternion storage exports
export {
    validateSamples,
    calculateExpectedTimestamps,
    generateTimeGrid,
    GapType,
    type Gap,
    type ValidationResult
} from './GapValidator';

export {
    resample,
    type ResampleOptions,
    type ResampleResult
} from './GapFiller';

export {
    chunkSamples,
    chunkAndCompress,
    generateSessionId,
    estimateCompressedSize,
    calculateChunkCount,
    getCompressionStats,
    SAMPLES_PER_CHUNK,
    PREVIEW_POINTS,
    type ChunkMetadata,
    type PreparedChunk,
    type ChunkingResult,
    type CompressedChunk,
    type SessionData,
    type CompressedChunkingResult
} from './Chunker';
