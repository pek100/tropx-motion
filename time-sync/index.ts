/**
 * Time Sync Module - Public API
 *
 * Clean, modular time synchronization for multi-sensor systems.
 * Uses NTP-style algorithm with statistical filtering.
 */

export { TimeSyncManager } from './TimeSyncManager';
export { TimeSyncSession } from './TimeSyncSession';
export { OffsetEstimator } from './OffsetEstimator';
export { TimeSyncDebugLogger } from './TimeSyncDebugLogger';

export {
  REFERENCE_EPOCH_MS,
  TimeSyncCommand,
  SAMPLE_COUNT,
  OUTLIER_REMOVAL_PERCENT,
  SAMPLE_DELAY_MS,
  RETRY_MAX_ATTEMPTS,
  RETRY_DELAY_MS
} from './constants';

export type {
  TimeSyncDevice,
  TimeSyncSample,
  TimeSyncResult,
  DeviceTimestampMs,
  MasterTimestampMs,
  ClockOffsetMs
} from './types';
