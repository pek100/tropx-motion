/**
 * Batch Synchronization Module
 *
 * Two-stage processing:
 * 1. SHEAR ALIGNMENT: Hierarchical alignment of all sensors to scan line
 * 2. TIME-GRID INTERPOLATION: SLERP to uniform Hz output
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
