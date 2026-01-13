/**
 * Time Sync Manager
 *
 * Coordinates time synchronization across multiple devices:
 * - Sets all devices to common datetime baseline (SET_DATETIME)
 * - Syncs devices in parallel for speed
 * - Applies measured clock offset independently per device
 * - Tracks sync results for all devices
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

    // Step 2: Set common datetime for all devices (rough baseline)
    const commonTimestampSeconds = Math.floor(Date.now() / 1000);
    console.log(`⏱️ Setting common datetime for ${devices.length} devices: ${new Date(commonTimestampSeconds * 1000).toISOString()} (${commonTimestampSeconds}s)`);
    TimeSyncDebugLogger.logCommonDatetime(commonTimestampSeconds);

    // Read timestamps BEFORE SET_DATETIME
    console.log(`📖 Reading timestamps BEFORE SET_DATETIME...`);
    const timestampsBefore = await Promise.all(
      devices.map(async device => {
        await device.enterTimeSyncMode();
        const { timestamp: ts } = await device.getDeviceTimestamp();
        await device.exitTimeSyncMode();
        console.log(`  [${device.deviceName}] BEFORE: ${ts}ms = ${new Date(ts).toISOString()}`);
        TimeSyncDebugLogger.logTimestampBefore(device.deviceName, device.deviceId, ts);
        return { device: device.deviceName, timestamp: ts };
      })
    );

    // SET_DATETIME for all devices
    await Promise.all(
      devices.map(device => device.setDateTime(commonTimestampSeconds))
    );

    // Read timestamps AFTER SET_DATETIME
    console.log(`📖 Reading timestamps AFTER SET_DATETIME...`);
    const timestampsAfter = await Promise.all(
      devices.map(async device => {
        await device.enterTimeSyncMode();
        const { timestamp: ts } = await device.getDeviceTimestamp();
        await device.exitTimeSyncMode();
        const expectedTs = commonTimestampSeconds * 1000;
        const diff = ts - expectedTs;
        console.log(`  [${device.deviceName}] AFTER: ${ts}ms = ${new Date(ts).toISOString()} (diff: ${diff > 0 ? '+' : ''}${diff}ms from expected)`);
        TimeSyncDebugLogger.logTimestampAfter(device.deviceName, device.deviceId, ts);
        return { device: device.deviceName, timestamp: ts };
      })
    );

    console.log(`⏱️ Starting sync for ${devices.length} devices...`);

    // Step 3: Read device timestamps in parallel
    // NOTE: On Windows/macOS, BLE operations may be serialized at the OS level.
    // We use relative offset comparison (device-to-device) rather than absolute offsets
    // to avoid RTT measurement errors from BLE queue delays.
    console.log(`📖 Reading device timestamps in parallel...`);

    // Enter timesync mode on all devices first
    await Promise.all(devices.map(device => device.enterTimeSyncMode()));

    // Capture reference time BEFORE starting reads
    // All counters will be adjusted back to this point for fair comparison
    const referenceTime = Date.now();

    // Read timestamps in parallel
    const deviceTimestamps = await Promise.all(
      devices.map(async device => {
        const { timestamp, rtt, receiveTime } = await device.getDeviceTimestamp();

        // Estimate when device actually sampled its counter
        const sampleTime = receiveTime - rtt / 2;

        // Adjust counter back to reference time
        // Counter ticks at ~1ms/ms, so we subtract elapsed time since reference
        const elapsedSinceReference = sampleTime - referenceTime;
        const counterAtReference = timestamp - elapsedSinceReference;

        console.log(`  [${device.deviceName}] counter=${timestamp}ms, RTT=${rtt}ms, elapsed=${elapsedSinceReference.toFixed(0)}ms, adjusted=${counterAtReference.toFixed(0)}ms`);

        return {
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          timestamp,
          rtt,
          receiveTime,
          counterAtReference
        };
      })
    );

    // Exit timesync mode on all devices
    await Promise.all(devices.map(device => device.exitTimeSyncMode()));

    // Step 4: Calculate offsets using time-adjusted counters
    // All counters are now adjusted to the same reference moment, so we can compare directly
    console.log(`📖 Calculating offsets (counters adjusted to reference time)...`);

    // Find the minimum adjusted counter - this device is the "reference" (most behind)
    const minCounter = Math.min(...deviceTimestamps.map(d => d.counterAtReference));
    const referenceDevice = deviceTimestamps.find(d => d.counterAtReference === minCounter)!;
    console.log(`⏱️ Reference device: ${referenceDevice.deviceName} (adjusted counter: ${minCounter.toFixed(0)}ms)`);
    TimeSyncDebugLogger.logReferenceDevice(referenceDevice.deviceName, minCounter);

    // Calculate how far ahead each device's counter is from the reference
    const adjustedTimestamps = deviceTimestamps.map(d => {
      // Positive = device counter is ahead, needs correction
      const offsetFromReference = d.counterAtReference - minCounter;
      console.log(`  [${d.deviceName}] adjusted=${d.counterAtReference.toFixed(0)}ms, ahead of reference by ${offsetFromReference.toFixed(2)}ms`);
      return {
        ...d,
        offsetFromReference
      };
    });

    console.log(`📖 Device offsets summary (relative to ${referenceDevice.deviceName}):`);
    adjustedTimestamps.forEach(d => {
      console.log(`  [${d.deviceName}] RTT=${d.rtt}ms, Offset from reference: ${d.offsetFromReference.toFixed(2)}ms`);
    });

    // Apply clock offset corrections to each device (except the reference)
    if (adjustedTimestamps.length > 1) {
      for (let i = 0; i < adjustedTimestamps.length; i++) {
        const deviceInfo = adjustedTimestamps[i];
        const correctionNeeded = deviceInfo.offsetFromReference;
        console.log(`⏱️ [${deviceInfo.deviceName}] Correction needed: ${correctionNeeded.toFixed(2)}ms`);

        if (correctionNeeded > 1) { // Only apply if correction > 1ms
          // Per spec (Figure 7): Send ABSOLUTE value - firmware subtracts it from timestamps
          const correctionMs = Math.abs(correctionNeeded);
          console.log(`⏱️ [${deviceInfo.deviceName}] Applying SET_CLOCK_OFFSET: ${correctionMs.toFixed(2)}ms`);
          TimeSyncDebugLogger.logClockOffset(deviceInfo.deviceName, correctionNeeded, -correctionMs, false);

          const device = devices[i];
          await device.enterTimeSyncMode();
          await device.setClockOffset(correctionMs);
          await device.exitTimeSyncMode();
        } else {
          console.log(`⏱️ [${deviceInfo.deviceName}] No correction needed (reference device or offset < 1ms)`);
          TimeSyncDebugLogger.logClockOffset(deviceInfo.deviceName, correctionNeeded, 0, correctionNeeded < 1);
        }
      }
    }

    // Step 5: Run sync sessions to collect RTT statistics (for reporting only)
    const syncPromises = devices.map(device => this.syncDevice(device, commonTimestampSeconds));
    const results = await Promise.all(syncPromises);

    // Log sync results
    for (const result of results) {
      TimeSyncDebugLogger.logSyncResult(
        result.deviceName,
        result.deviceId,
        result.success,
        result.finalOffset,
        result.avgRTT,
        result.error
      );
    }

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
