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

    // Read timestamps BEFORE SET_DATETIME
    console.log(`📖 Reading timestamps BEFORE SET_DATETIME...`);
    const timestampsBefore = await Promise.all(
      devices.map(async device => {
        await device.enterTimeSyncMode();
        const ts = await device.getDeviceTimestamp();
        await device.exitTimeSyncMode();
        console.log(`  [${device.deviceName}] BEFORE: ${ts}ms = ${new Date(ts).toISOString()}`);
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
        return { device: device.deviceName, timestamp: ts };
      })
    );

    console.log(`⏱️ Starting parallel sync for ${devices.length} devices...`);

    // Step 3: Read device timestamps to find relative offsets (device-to-device)
    // We DON'T use the master clock offset - just compare devices to each other
    console.log(`📖 Reading device timestamps for relative offset calculation...`);

    const deviceTimestamps = await Promise.all(
      devices.map(async device => {
        await device.enterTimeSyncMode();
        const ts = await device.getDeviceTimestamp();
        await device.exitTimeSyncMode();
        console.log(`  [${device.deviceName}] Current timestamp: ${ts}ms`);
        return { deviceId: device.deviceId, deviceName: device.deviceName, timestamp: ts };
      })
    );

    // Step 4: Calculate relative offsets and apply SET_CLOCK_OFFSET to hardware
    // Find device with minimum timestamp (most behind) - use as reference
    if (deviceTimestamps.length > 1) {
      const minTimestamp = Math.min(...deviceTimestamps.map(d => d.timestamp));
      const referenceDevice = deviceTimestamps.find(d => d.timestamp === minTimestamp)!;
      console.log(`⏱️ Reference device: ${referenceDevice.deviceName} at ${minTimestamp}ms`);

      // Apply clock offset corrections to each device
      await Promise.all(
        deviceTimestamps.map(async (deviceInfo, index) => {
          const relativeOffset = deviceInfo.timestamp - minTimestamp;
          console.log(`⏱️ [${deviceInfo.deviceName}] Relative offset: ${relativeOffset.toFixed(2)}ms (device is ${relativeOffset.toFixed(2)}ms ahead)`);

          if (relativeOffset > 0) {
            // Device is ahead, so apply NEGATIVE offset to bring it back
            const correctionMs = -relativeOffset;
            console.log(`⏱️ [${deviceInfo.deviceName}] Applying SET_CLOCK_OFFSET: ${correctionMs.toFixed(2)}ms`);

            const device = devices[index];
            await device.enterTimeSyncMode();
            await device.setClockOffset(correctionMs);
            await device.exitTimeSyncMode();
          } else {
            console.log(`⏱️ [${deviceInfo.deviceName}] No correction needed (reference device)`);
          }
        })
      );
    }

    // Step 5: Run sync sessions to collect RTT statistics (for reporting only)
    const syncPromises = devices.map(device => this.syncDevice(device, commonTimestampSeconds));
    const results = await Promise.all(syncPromises);

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
