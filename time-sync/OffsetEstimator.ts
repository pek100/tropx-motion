/**
 * Clock Offset Estimator
 *
 * Implements NTP-style offset calculation with statistical filtering:
 * - Collects multiple samples with round-trip time measurements
 * - Removes outliers based on RTT (keeps best 80%)
 * - Returns median offset (robust to asymmetric delays)
 */

import { TimeSyncSample, ClockOffsetMs, MasterTimestampMs, DeviceTimestampMs } from './types';
import { REFERENCE_EPOCH_MS, OUTLIER_REMOVAL_PERCENT } from './constants';

export class OffsetEstimator {
  private samples: TimeSyncSample[] = [];

  /**
   * Add sample from three-way handshake
   * Uses NTP midpoint formula: offset = masterMidpoint - deviceCounter
   */
  addSample(T1: MasterTimestampMs, deviceCounter: DeviceTimestampMs, T4: MasterTimestampMs): void {
    const RTT = T4 - T1;
    const masterMidpoint = (T1 + T4) / 2;
    const offset = masterMidpoint - deviceCounter;

    this.samples.push({ T1, T4, deviceCounter, RTT, offset });
  }

  /**
   * Compute median offset with outlier removal
   * Sorts by RTT, removes worst 20%, returns median of remaining offsets
   */
  computeMedianOffset(): { medianOffset: ClockOffsetMs; avgRTT: number; sampleCount: number } {
    if (this.samples.length === 0) {
      throw new Error('No samples collected');
    }

    // Sort by RTT (lowest = best quality)
    const sorted = [...this.samples].sort((a, b) => a.RTT - b.RTT);

    // Remove outliers (top/bottom 10% each)
    const removeCount = Math.floor(sorted.length * OUTLIER_REMOVAL_PERCENT / 2);
    const kept = sorted.slice(removeCount, sorted.length - removeCount);

    // Compute median offset
    const offsets = kept.map(s => s.offset).sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    const medianOffset = offsets.length % 2 === 0
      ? (offsets[mid - 1] + offsets[mid]) / 2
      : offsets[mid];

    // Compute average RTT
    const avgRTT = kept.reduce((sum, s) => sum + s.RTT, 0) / kept.length;

    return { medianOffset, avgRTT, sampleCount: kept.length };
  }

  getSamples(): ReadonlyArray<TimeSyncSample> {
    return this.samples;
  }

  reset(): void {
    this.samples = [];
  }
}
