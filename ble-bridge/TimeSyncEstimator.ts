/**
 * Time Synchronization Clock Offset Estimator
 *
 * Implements statistical estimation of clock offset between master (central) and peripheral devices.
 * Uses median filtering and outlier rejection for robust synchronization.
 *
 * Based on: AN_221e_Muse_v3_Timesync_v1.0.pdf
 * Algorithm: Minimum delay + median filter (NTP-style)
 */

interface TimeSyncSample {
  t1: number;       // Master timestamp before send (ms)
  t2: number;       // Device timestamp from response (ms)
  t3: number;       // Master timestamp after receive (ms)
  roundTrip: number; // Round-trip time (ms)
  offset: number;    // Estimated clock offset (ms)
}

export class TimeSyncEstimator {
  private samples: TimeSyncSample[] = [];
  private readonly MIN_SAMPLES = 50; // Per PDF recommendation

  /**
   * Add a time sync sample from one round-trip measurement
   *
   * @param t1 Master timestamp before sending command (ms since epoch)
   * @param t2 Device timestamp from response (ms since epoch)
   * @param t3 Master timestamp after receiving response (ms since epoch)
   */
  addSample(t1: number, t2: number, t3: number): void {
    const roundTrip = t3 - t1;

    // Clock offset calculation:
    // Assume symmetric delay: device time at midpoint = t2
    // Master time at midpoint = (t1 + t3) / 2
    // Offset = device_time - master_time
    const masterMidpoint = (t1 + t3) / 2;
    const offset = t2 - masterMidpoint;

    this.samples.push({
      t1,
      t2,
      t3,
      roundTrip,
      offset
    });
  }

  /**
   * Compute final clock offset using median filtering with outlier rejection
   *
   * Algorithm (based on NTP and research):
   * 1. Sort samples by round-trip time (lower = better)
   * 2. Keep best 80% (discard slowest 20% as outliers)
   * 3. Return median of remaining offsets (robust to asymmetric delays)
   *
   * @returns Clock offset in milliseconds (add to device timestamps to sync with master)
   */
  computeOffset(): number {
    if (this.samples.length < this.MIN_SAMPLES) {
      console.warn(`⚠️ Time sync: Only ${this.samples.length} samples collected, ${this.MIN_SAMPLES} recommended`);
    }

    if (this.samples.length === 0) {
      throw new Error('Cannot compute offset: no samples collected');
    }

    // Step 1: Sort by round-trip time (lowest latency = most accurate)
    const sortedByLatency = [...this.samples].sort((a, b) => a.roundTrip - b.roundTrip);

    // Step 2: Keep best 80% (remove outliers with high latency)
    const keepCount = Math.max(1, Math.floor(sortedByLatency.length * 0.8));
    const bestSamples = sortedByLatency.slice(0, keepCount);

    // Step 3: Extract offsets and compute median
    const offsets = bestSamples.map(s => s.offset);
    const medianOffset = this.median(offsets);

    // Log statistics for debugging
    const avgRoundTrip = bestSamples.reduce((sum, s) => sum + s.roundTrip, 0) / bestSamples.length;
    console.log(`⏱️ Time sync statistics:`, {
      totalSamples: this.samples.length,
      usedSamples: bestSamples.length,
      medianOffset: medianOffset.toFixed(2) + 'ms',
      avgRoundTrip: avgRoundTrip.toFixed(2) + 'ms',
      minRoundTrip: bestSamples[0].roundTrip.toFixed(2) + 'ms',
      maxRoundTrip: bestSamples[bestSamples.length - 1].roundTrip.toFixed(2) + 'ms'
    });

    return medianOffset;
  }

  /**
   * Calculate median value (50th percentile)
   * More robust to outliers than mean
   */
  private median(values: number[]): number {
    if (values.length === 0) {
      throw new Error('Cannot compute median of empty array');
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    // Even number of values: average of middle two
    // Odd number of values: middle value
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Get all samples (for debugging/analysis)
   */
  getSamples(): ReadonlyArray<TimeSyncSample> {
    return this.samples;
  }

  /**
   * Reset estimator for new sync session
   */
  reset(): void {
    this.samples = [];
  }
}
