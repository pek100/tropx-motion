/**
 * Batch Synchronization Module
 *
 * Two synchronization implementations available:
 *
 * BatchSynchronizer (default):
 *   Three-stage hierarchical processing:
 *   1. INTRA-JOINT SHEAR: Align thigh↔shin within each joint
 *   2. INTER-JOINT SHEAR: Align left↔right joints to same scan line
 *   3. GRID INTERPOLATION: SLERP all 4 sensors to exact grid position
 *
 * GridSnapLiveService (alternative):
 *   Single-stage processing using recording-style alignment:
 *   1. Binary search for bracketing samples
 *   2. SLERP interpolation via GridSnapService + InterpolationService
 *   Same output format (AlignedSampleSet) - drop-in alternative
 */

// Main orchestrators (both available, switchable via config)
export { BatchSynchronizer } from './BatchSynchronizer';
export { GridSnapLiveService } from './GridSnapLiveService';

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
