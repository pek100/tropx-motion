/**
 * Batch Synchronization Module
 *
 * TIME-GRID approach: Buffer samples as they arrive, output ONE match
 * per joint per timer tick at configured Hz for smooth, consistent output.
 */

// Main orchestrator
export { BatchSynchronizer } from './BatchSynchronizer';

// Core components (exported for testing)
export { SensorBuffer } from './SensorBuffer';
export { JointAligner } from './JointAligner';

// Types
export type {
    Sample,
    JointSamples,
    AlignedSampleSet,
    AlignedSampleCallback,
    BufferStats,
    SyncDebugStats,
} from './types';

// Enums and constants (not types)
export {
    DevicePosition,
    JointSide,
    DEVICE_MAPPING,
    SYNC_CONFIG,
} from './types';

// Legacy export (to be removed after integration complete)
export { JointSynchronizer, type SynchronizedJointPair } from './JointSynchronizer';
