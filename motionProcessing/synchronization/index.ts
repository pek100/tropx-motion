/**
 * Batch Synchronization Module
 *
 * Three-stage hierarchical processing:
 * 1. INTRA-JOINT SHEAR: Align thigh↔shin within each joint
 * 2. INTER-JOINT SHEAR: Align left↔right joints to same scan line
 * 3. GRID INTERPOLATION: SLERP all 4 sensors to exact grid position
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
