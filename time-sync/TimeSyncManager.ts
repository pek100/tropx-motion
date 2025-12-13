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
        const ts = await device.getDeviceTimestamp();
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
        const ts = await device.getDeviceTimestamp();
        await device.exitTimeSyncMode();
        const expectedTs = commonTimestampSeconds * 1000;
        const diff = ts - expectedTs;
        console.log(`  [${device.deviceName}] AFTER: ${ts}ms = ${new Date(ts).toISOString()} (diff: ${diff > 0 ? '+' : ''}${diff}ms from expected)`);
        TimeSyncDebugLogger.logTimestampAfter(device.deviceName, device.deviceId, ts);
        return { device: device.deviceName, timestamp: ts };
      })
    );

    console.log(`⏱️ Starting parallel sync for ${devices.length} devices...`);

    // Step 3: Read device timestamps SIMULTANEOUSLY to get accurate relative offsets
    // Reading sequentially causes timing errors - we need to read as close together as possible
    console.log(`📖 Reading device timestamps simultaneously for relative offset calculation...`);

    // Enter timesync mode on all devices first
    await Promise.all(devices.map(device => device.enterTimeSyncMode()));

    // Read timestamps as simultaneously as possible
    const readStart = Date.now();
    const deviceTimestamps = await Promise.all(
      devices.map(async device => {
        const ts = await device.getDeviceTimestamp();
        const readTime = Date.now() - readStart;
        console.log(`  [${device.deviceName}] Timestamp: ${ts}ms (read after ${readTime}ms)`);
        return { deviceId: device.deviceId, deviceName: device.deviceName, timestamp: ts, readDelayMs: readTime };
      })
    );

    // Exit timesync mode on all devices
    await Promise.all(devices.map(device => device.exitTimeSyncMode()));

    // Step 4: Use WALL CLOCK as reference (consistent across recordings)
    // Calculate expected device timestamp based on wall clock elapsed time since SET_DATETIME
    const wallClockNow = readStart; // Wall clock time when reads started
    const elapsedSinceSetDatetime = wallClockNow - (commonTimestampSeconds * 1000);
    const expectedDeviceTimestamp = (commonTimestampSeconds * 1000) + elapsedSinceSetDatetime;

    console.log(`⏱️ Wall clock reference: ${wallClockNow}ms`);
    console.log(`⏱️ Elapsed since SET_DATETIME: ${elapsedSinceSetDatetime}ms`);
    console.log(`⏱️ Expected device timestamp: ${expectedDeviceTimestamp}ms`);

    // Adjust timestamps for read delay and calculate offset from expected
    const adjustedTimestamps = deviceTimestamps.map(d => {
      // Device timestamp was sampled at readStart + RTT/2 (one-way latency)
      const adjustedTimestamp = d.timestamp - (d.readDelayMs / 2);
      // How far is this device from expected? Positive = ahead, negative = behind
      const offsetFromExpected = adjustedTimestamp - expectedDeviceTimestamp;
      return {
        ...d,
        adjustedTimestamp,
        offsetFromExpected
      };
    });

    console.log(`📖 Device offsets from wall clock reference:`);
    adjustedTimestamps.forEach(d => {
      console.log(`  [${d.deviceName}] Adjusted: ${d.adjustedTimestamp}ms, Offset from expected: ${d.offsetFromExpected.toFixed(2)}ms`);
    });

    // Find the minimum offset (most behind device) - we can only subtract, not add
    // All devices will be brought down to this level
    const minOffset = Math.min(...adjustedTimestamps.map(d => d.offsetFromExpected));
    console.log(`⏱️ Target offset (minimum): ${minOffset.toFixed(2)}ms - all devices will align to this`);
    TimeSyncDebugLogger.logReferenceDevice('WALL_CLOCK', expectedDeviceTimestamp + minOffset);

    // Apply clock offset corrections to each device
    if (adjustedTimestamps.length > 1) {
      for (let i = 0; i < adjustedTimestamps.length; i++) {
        const deviceInfo = adjustedTimestamps[i];
        // How much is this device ahead of the target (minimum)?
        const correctionNeeded = deviceInfo.offsetFromExpected - minOffset;
        console.log(`⏱️ [${deviceInfo.deviceName}] Offset: ${deviceInfo.offsetFromExpected.toFixed(2)}ms, Correction needed: ${correctionNeeded.toFixed(2)}ms`);

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
          console.log(`⏱️ [${deviceInfo.deviceName}] No correction needed (at target or offset < 1ms)`);
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
