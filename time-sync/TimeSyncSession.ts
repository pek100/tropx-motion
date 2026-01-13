/**
 * Time Sync Session
 *
 * Orchestrates time synchronization for a single device:
 * 1. Enter timesync mode
 * 2. Collect N samples via GET_TIMESTAMP
 * 3. Compute median offset
 * 4. Exit timesync mode
 * 5. Apply elapsed time compensation
 * 6. Send final offset to device
 */

import { TimeSyncDevice, TimeSyncResult, SyncSampleCallback } from './types';
import { OffsetEstimator } from './OffsetEstimator';
import { SAMPLE_COUNT, SAMPLE_DELAY_MS, RETRY_MAX_ATTEMPTS, RETRY_DELAY_MS } from './constants';

export class TimeSyncSession {
  private estimator = new OffsetEstimator();

  constructor(
    private device: TimeSyncDevice,
    private sampleCount: number = SAMPLE_COUNT,
    private onSample?: SyncSampleCallback
  ) {}

  /**
   * Execute time sync session with retry logic
   * @param commonTimestampSeconds - Optional common timestamp already set by manager
   */
  async run(commonTimestampSeconds?: number): Promise<TimeSyncResult> {
    for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        return await this.executeSync(commonTimestampSeconds);
      } catch (error) {
        const isLastAttempt = attempt === RETRY_MAX_ATTEMPTS;
        if (isLastAttempt) {
          return this.createErrorResult(error);
        }
        console.warn(`⚠️ [${this.device.deviceName}] Sync attempt ${attempt} failed, retrying...`, error);
        await this.delay(RETRY_DELAY_MS * attempt);
      }
    }

    return this.createErrorResult(new Error('Max retries exceeded'));
  }

  private async executeSync(commonTimestampSeconds?: number): Promise<TimeSyncResult> {
    console.log(`⏱️ [${this.device.deviceName}] Starting time sync...`);

    // SET_DATETIME handled by TimeSyncManager for parallel execution
    // If not set by manager, set it now (single device sync)
    if (commonTimestampSeconds === undefined) {
      const currentTimeSeconds = Math.floor(Date.now() / 1000);
      console.log(`⏱️ [${this.device.deviceName}] Setting datetime: ${new Date(currentTimeSeconds * 1000).toISOString()}`);
      await this.device.setDateTime(currentTimeSeconds);
    }

    await this.device.enterTimeSyncMode();

    // Collect samples
    for (let i = 0; i < this.sampleCount; i++) {
      const T1 = Date.now();
      const { timestamp: deviceCounter, rtt, receiveTime } = await this.device.getDeviceTimestamp();
      const T4 = receiveTime;  // Use receive time from adapter for consistency

      this.estimator.addSample(T1, deviceCounter, T4);

      // Broadcast live device timestamp and progress for UI display
      if (this.onSample) {
        this.onSample(this.device.deviceId, this.device.deviceName, deviceCounter, i, this.sampleCount);
      }

      if (i < this.sampleCount - 1) {
        await this.delay(SAMPLE_DELAY_MS);
      }
    }

    // Compute median offset using NTP algorithm
    // IMPORTANT: Use median offset from ALL samples, not a single final measurement
    // This is more robust against BLE RTT variability
    const { medianOffset, avgRTT, sampleCount } = this.estimator.computeMedianOffset();
    console.log(`⏱️ [${this.device.deviceName}] NTP median offset: ${medianOffset.toFixed(2)}ms (RTT: ${avgRTT.toFixed(2)}ms, samples: ${sampleCount})`);

    // Exit timesync mode
    await this.device.exitTimeSyncMode();

    // NOTE: SET_CLOCK_OFFSET is applied by TimeSyncManager.syncDevices() during multi-device sync.
    // This session is run AFTER that to collect RTT statistics for reporting.
    // The offset returned here is informational only - hardware sync is already applied.
    console.log(`✅ [${this.device.deviceName}] Time sync stats: median offset=${medianOffset.toFixed(2)}ms (RTT: ${avgRTT.toFixed(2)}ms)`);

    const samples = this.estimator.getSamples();
    const RTTs = samples.map(s => s.RTT);
    const lastSample = samples[samples.length - 1];

    return {
      deviceId: this.device.deviceId,
      deviceName: this.device.deviceName,
      medianOffset: medianOffset,
      finalOffset: medianOffset,  // Use NTP median - more robust against BLE variability
      deviceTimestampMs: lastSample?.deviceCounter ?? 0,
      sampleCount,
      avgRTT,
      minRTT: Math.min(...RTTs),
      maxRTT: Math.max(...RTTs),
      success: true
    };
  }

  private createErrorResult(error: unknown): TimeSyncResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ [${this.device.deviceName}] Time sync failed: ${errorMessage}`);

    return {
      deviceId: this.device.deviceId,
      deviceName: this.device.deviceName,
      medianOffset: 0,
      finalOffset: 0,
      sampleCount: 0,
      avgRTT: 0,
      minRTT: 0,
      maxRTT: 0,
      success: false,
      error: errorMessage
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
