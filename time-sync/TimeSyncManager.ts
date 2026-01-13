/**
 * Time Sync Manager
 *
 * Synchronizes timestamps across multiple BLE motion sensor devices to achieve
 * sub-10ms alignment. Uses writeCompleteTime from SET_DATETIME to calculate
 * software offsets that are applied during streaming.
 *
 * Key insight: The SAME timing measurement that causes clock offset (sequential
 * BLE writes) is used to correct for it. No timing mismatch between measurement
 * and application.
 *
 * See docs/time-sync-refactor/multi-device-sync.md for detailed documentation
 * including problem analysis, rejected approaches, and debugging tips.
 */

import { TimeSyncDevice, TimeSyncResult, SyncSampleCallback } from './types';
import { TimeSyncSession } from './TimeSyncSession';
import { TimeSyncDebugLogger } from './TimeSyncDebugLogger';

export class TimeSyncManager {
  private results = new Map<string, TimeSyncResult>();
  private onSampleCallback?: SyncSampleCallback;

  /**
   * Set callback for live sync sample updates
   */
  setOnSampleCallback(callback: SyncSampleCallback): void {
    this.onSampleCallback = callback;
  }

  /**
   * Sync single device - applies measured offset directly
   */
  async syncDevice(device: TimeSyncDevice, commonTimestampSeconds?: number): Promise<TimeSyncResult> {
    const session = new TimeSyncSession(device, undefined, this.onSampleCallback);
    const result = await session.run(commonTimestampSeconds);

    this.results.set(device.deviceId, result);
    return result;
  }

  /**
   * Sync multiple devices in parallel
   *
   * Per spec (AN_221e Figure 1):
   * Step 1: Ensure all devices in IDLE state
   * Step 2: Set ALL devices to same datetime (rough baseline)
   * Step 3: Sync all devices in parallel (fine-tune with offsets)
   */
  async syncDevices(devices: TimeSyncDevice[]): Promise<TimeSyncResult[]> {
    if (devices.length === 0) {
      return [];
    }

    // Reset debug logger for new sync session
    TimeSyncDebugLogger.reset();

    // Step 1: Ensure all devices in IDLE state (per spec Figure 1)
    console.log(`⏱️ Checking system status for ${devices.length} devices...`);

    await Promise.all(
      devices.map(async device => {
        const status = await device.getSystemStatus();
        console.log(`📊 [${device.deviceName}] Current system status: 0x${status.toString(16).padStart(2, '0')} ${status === 0x02 ? '(IDLE)' : status === 0x04 ? '(STREAMING)' : status === 0x08 ? '(RECORDING)' : '(UNKNOWN)'}`);

        if (status !== 0x02) { // Not IDLE
          console.log(`⏱️ [${device.deviceName}] Setting to IDLE state (was 0x${status.toString(16)})`);
          await device.setSystemStatus(0x02); // Set to IDLE

          // Verify state changed
          const newStatus = await device.getSystemStatus();
          console.log(`✅ [${device.deviceName}] System status after SET: 0x${newStatus.toString(16).padStart(2, '0')}`);
        }
      })
    );

    // Step 2: SET_DATETIME on all devices (same timestamp)
    // Capture writeCompleteTime to calculate offsets
    console.log(`⏱️ Setting datetime on all devices...`);
    const baseTimestampSeconds = Math.floor(Date.now() / 1000);
    TimeSyncDebugLogger.logCommonDatetime(baseTimestampSeconds);

    const setDateTimeTimings: { device: TimeSyncDevice; writeCompleteTime: number }[] = [];
    let firstWriteCompleteTime: number | null = null;

    for (let i = 0; i < devices.length; i++) {
      const device = devices[i];
      console.log(`⏱️ [${device.deviceName}] SET_DATETIME: ts=${baseTimestampSeconds}`);

      const result = await device.setDateTime(baseTimestampSeconds);
      const writeCompleteTime = result?.writeCompleteTime ?? performance.now();

      if (firstWriteCompleteTime === null) {
        firstWriteCompleteTime = writeCompleteTime;
      }

      setDateTimeTimings.push({ device, writeCompleteTime });
      console.log(`✅ [${device.deviceName}] SET_DATETIME completed at ${writeCompleteTime.toFixed(0)}ms`);

      // Forward progress to UI callback
      if (this.onSampleCallback) {
        this.onSampleCallback(device.deviceId, device.deviceName, 0, i + 1, devices.length);
      }
    }

    // Small delay to let devices settle after SET_DATETIME
    await new Promise(resolve => setTimeout(resolve, 50));

    // Step 3: Calculate offsets from SET_DATETIME timing
    // Devices set LATER need POSITIVE offset to bring their timestamps forward
    console.log(`⏱️ Calculating offsets from SET_DATETIME timing...`);
    const results: TimeSyncResult[] = [];

    for (const { device, writeCompleteTime } of setDateTimeTimings) {
      // Offset = how much later this device was set compared to first
      // Positive offset means device was set later, its timestamps need to be moved forward
      const offset = writeCompleteTime - firstWriteCompleteTime!;

      console.log(`⏱️ [${device.deviceName}] SET_DATETIME at ${writeCompleteTime.toFixed(0)}ms, offset: +${offset.toFixed(0)}ms`);
      TimeSyncDebugLogger.logClockOffset(device.deviceName, offset, offset, false);

      // Build result
      const result: TimeSyncResult = {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        medianOffset: offset,
        finalOffset: offset,
        sampleCount: 1,
        avgRTT: 0,
        minRTT: 0,
        maxRTT: 0,
        success: true,
        deviceTimestampMs: 0,
      };
      this.results.set(device.deviceId, result);

      // Log sync result
      TimeSyncDebugLogger.logSyncResult(
        result.deviceName,
        result.deviceId,
        result.success,
        result.finalOffset,
        result.avgRTT
      );

      results.push(result);
    }

    // No hardware wait needed - using software sync instead

    // Flush debug log to file
    TimeSyncDebugLogger.flush();

    return results;
  }

  getResult(deviceId: string): TimeSyncResult | undefined {
    return this.results.get(deviceId);
  }

  getAllResults(): Map<string, TimeSyncResult> {
    return new Map(this.results);
  }

  /**
   * Reset manager for new sync session
   */
  reset(): void {
    this.results.clear();
  }
}
