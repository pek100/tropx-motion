/**
 * TropX Time Sync Adapter
 *
 * Adapts TropXDevice BLE interface to TimeSyncDevice interface.
 * Handles command formatting and response parsing per Muse v3 protocol.
 */

import { TimeSyncDevice, DeviceTimestampMs, ClockOffsetMs, DeviceSystemState } from '../types';
import { TimeSyncCommand } from '../constants';
import { TropXDevice } from '../../ble-bridge/TropXDevice';

export class TropXTimeSyncAdapter implements TimeSyncDevice {
  constructor(private device: TropXDevice) {}

  get deviceId(): string {
    return this.device.deviceInfo.id;
  }

  get deviceName(): string {
    return this.device.deviceInfo.name;
  }

  async getSystemStatus(): Promise<DeviceSystemState> {
    // Command format: [CMD=0x82, LENGTH=0x00]
    const cmd = Buffer.from([0x82, 0x00]);
    const response = await this.device.sendRawCommand(cmd);

    console.log(`📊 [${this.deviceName}] GET_SYSTEM_STATUS response:`, {
      bytes: Array.from(response).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '),
      length: response.length
    });

    // Response format: [TYPE=0x00, LENGTH=0x03, ERROR_CODE=0x82, ERROR_STATUS=0x00, SYSTEM_STATE, ...]
    if (response.length < 5) {
      throw new Error('Invalid GET_SYSTEM_STATUS response: too short');
    }

    const errorCode = response[2];
    if (errorCode !== 0x82) {
      throw new Error(`GET_SYSTEM_STATUS invalid response: expected 0x82, got 0x${errorCode.toString(16)}`);
    }

    // Actual system state is at byte 4, not byte 3 (byte 3 is error status)
    const systemState = response[4] as DeviceSystemState;
    console.log(`📊 [${this.deviceName}] System state: 0x${systemState.toString(16).padStart(2, '0')}`);
    return systemState;
  }

  async setSystemStatus(state: DeviceSystemState): Promise<void> {
    // Command format: [CMD=0x02, LENGTH=0x01, STATE]
    const cmd = Buffer.from([0x02, 0x01, state]);
    const response = await this.device.sendRawCommand(cmd);

    // Response format: [TYPE=0x00, LENGTH=0x02, ERROR_CODE=0x02, ...]
    if (response.length < 3) {
      throw new Error('Invalid SET_SYSTEM_STATUS response: too short');
    }

    const errorCode = response[2];
    if (errorCode !== 0x02) {
      throw new Error(`SET_SYSTEM_STATUS invalid response: expected 0x02, got 0x${errorCode.toString(16)}`);
    }

    const statusCode = response.length >= 4 ? response[3] : 0;
    if (statusCode !== 0x00) {
      throw new Error(`SET_SYSTEM_STATUS failed with error code: 0x${statusCode.toString(16)}`);
    }
  }

  async enterTimeSyncMode(): Promise<void> {
    const cmd = Buffer.from([TimeSyncCommand.ENTER_TIMESYNC, 0x00]);
    const response = await this.device.sendRawCommand(cmd);

    // Validate response: [TYPE=0x00, LENGTH=0x02, ERROR_CODE=0x32, ...]
    if (response.length < 3 || response[2] !== TimeSyncCommand.ENTER_TIMESYNC) {
      throw new Error('Invalid ENTER_TIMESYNC response');
    }

    const errorCode = response[3];
    if (errorCode !== 0x00) {
      throw new Error(`ENTER_TIMESYNC failed with error code: 0x${errorCode.toString(16)}`);
    }
  }

  async getDeviceTimestamp(): Promise<DeviceTimestampMs> {
    const cmd = Buffer.from([TimeSyncCommand.GET_TIMESTAMP, 0x00]);
    const response = await this.device.sendRawCommand(cmd);

    console.log(`📊 [${this.deviceName}] GET_TIMESTAMP response:`, {
      bytes: Array.from(response).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '),
      length: response.length,
      timestampBytes: Array.from(response.slice(4, 10)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')
    });

    // Response format: [TYPE=0x00, LENGTH=0x0a, ERROR_CODE=0xb2, ERROR_STATUS=0x00, TIMESTAMP (6 bytes), ...]
    if (response.length < 10) {
      throw new Error('Invalid GET_TIMESTAMP response: too short');
    }

    const errorCode = response[2];
    if (errorCode !== 0xb2) {
      throw new Error(`GET_TIMESTAMP invalid response: expected 0xb2, got 0x${errorCode.toString(16)}`);
    }

    const errorStatus = response[3];
    if (errorStatus !== 0x00) {
      throw new Error(`GET_TIMESTAMP failed with error status: 0x${errorStatus.toString(16)}`);
    }

    // TropX firmware GET_TIMESTAMP: Always returns 48-bit timestamps in MILLISECONDS
    // 48-bit limit = 281 trillion microseconds = 8.9 years (too small!)
    // 48-bit limit = 281 trillion milliseconds = 8,925 years (perfect!)
    // Therefore: firmware MUST use milliseconds (only format that fits)

    // Parse as 48-bit little-endian unsigned integer
    const byte0 = response[4];
    const byte1 = response[5];
    const byte2 = response[6];
    const byte3 = response[7];
    const byte4 = response[8];
    const byte5 = response[9];

    const timestampMs = byte0 + (byte1 << 8) + (byte2 << 16) +
                        (byte3 * 0x1000000) + (byte4 * 0x100000000) + (byte5 * 0x10000000000);

    console.log(`📊 [${this.deviceName}] Raw 48-bit timestamp: ${timestampMs}ms`);
    console.log(`📊 [${this.deviceName}] = ${new Date(timestampMs).toISOString()}`);

    return timestampMs;
  }

  async exitTimeSyncMode(): Promise<void> {
    const cmd = Buffer.from([TimeSyncCommand.EXIT_TIMESYNC, 0x00]);
    const response = await this.device.sendRawCommand(cmd);

    // Validate response
    if (response.length < 3 || response[2] !== TimeSyncCommand.EXIT_TIMESYNC) {
      throw new Error('Invalid EXIT_TIMESYNC response');
    }

    const errorCode = response[3];
    if (errorCode !== 0x00) {
      throw new Error(`EXIT_TIMESYNC failed with error code: 0x${errorCode.toString(16)}`);
    }
  }

  async setDateTime(unixTimestampSeconds: number): Promise<void> {
    // Command format: [CMD=0x0b, LENGTH=0x04, TIMESTAMP (4 bytes little-endian)]
    // Per spec (AN_221e lines 132-175): 32-bit unsigned integer Unix epoch in seconds
    const cmd = Buffer.allocUnsafe(6);
    cmd[0] = TimeSyncCommand.SET_DATETIME;
    cmd[1] = 0x04;
    cmd.writeUInt32LE(unixTimestampSeconds, 2);

    console.log(`🕒 [${this.deviceName}] SET_DATETIME command:`, {
      timestamp: unixTimestampSeconds,
      date: new Date(unixTimestampSeconds * 1000).toISOString(),
      bytes: Array.from(cmd).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')
    });

    const response = await this.device.sendRawCommand(cmd);

    console.log(`🕒 [${this.deviceName}] SET_DATETIME response:`, {
      bytes: Array.from(response).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', '),
      length: response.length
    });

    // Validate response: [TYPE=0x00, LENGTH=0x02, ERROR_CODE=0x0b, ...]
    if (response.length < 4) {
      throw new Error('Invalid SET_DATETIME response: too short');
    }

    const errorCode = response[3];
    if (errorCode !== 0x00) {
      console.error(`❌ [${this.deviceName}] SET_DATETIME failed with error code: 0x${errorCode.toString(16)}`);
      throw new Error(`SET_DATETIME failed with error code: 0x${errorCode.toString(16)}`);
    }

    console.log(`✅ [${this.deviceName}] SET_DATETIME succeeded`);
  }

  async setClockOffset(offsetMs: ClockOffsetMs): Promise<void> {
    // Command format: [CMD=0x31, LENGTH=0x08, OFFSET (8 bytes little-endian)]
    // Per spec (Figure 7): Send ABSOLUTE VALUE as UInt64 - firmware subtracts from timestamps
    const cmd = Buffer.allocUnsafe(10);
    cmd[0] = TimeSyncCommand.SET_CLOCK_OFFSET;
    cmd[1] = 0x08;

    // Per spec: Use Math.Abs() and UInt64 (unsigned)
    // Device firmware uses MILLISECONDS for all timestamps
    const offsetValue = BigInt(Math.round(Math.abs(offsetMs)));
    console.log(`⏱️ [${this.deviceName}] Sending offset as UNSIGNED: ${offsetValue}ms (original: ${offsetMs.toFixed(2)}ms)`);

    cmd.writeBigUInt64LE(offsetValue, 2);  // Use UNSIGNED per spec

    console.log(`⏱️ [${this.deviceName}] SET_CLOCK_OFFSET: ${offsetValue}ms (unsigned, per spec)`);

    const response = await this.device.sendRawCommand(cmd);

    // Validate response
    if (response.length < 4) {
      throw new Error('Invalid SET_CLOCK_OFFSET response: too short');
    }

    const errorCode = response[3];
    if (errorCode !== 0x00) {
      throw new Error(`SET_CLOCK_OFFSET failed with error code: 0x${errorCode.toString(16)}`);
    }

    console.log(`✅ [${this.deviceName}] SET_CLOCK_OFFSET succeeded`);
  }
}
