/**
 * TropXCommands.ts
 *
 * This module handles the creation of properly formatted command buffers for
 * communicating with TropX devices. Commands follow the TropX protocol format
 * adapted from the proven Muse SDK implementation.
 */

import { TROPX_COMMANDS, TROPX_STATES, DATA_MODES, DATA_FREQUENCIES } from './BleBridgeConstants';

/**
 * Creates and manages TropX device commands following the TropX protocol
 */
export class TropXCommands {
  /**
   * Creates a command to start data streaming in quaternion mode
   * @param mode - The data acquisition mode (QUATERNION)
   * @param frequency - The sampling frequency (HZ_100, etc.)
   */
  static Cmd_StartStream(mode: number, frequency: number): Uint8Array {
    const buffer = new Uint8Array(7);

    // Command structure following TropX protocol
    buffer[0] = TROPX_COMMANDS.STATE;  // CMD_STATE (0x02)
    buffer[1] = 0x05;                  // Length (7-2 = 5 bytes payload)
    buffer[2] = TROPX_STATES.STREAMING; // Streaming state (0x08)

    // Convert mode to little-endian bytes
    const modeBuffer = new ArrayBuffer(4);
    const modeView = new DataView(modeBuffer);
    modeView.setUint32(0, mode, true);  // true for little-endian

    // Copy first 3 bytes of mode
    buffer[3] = modeView.getUint8(0);
    buffer[4] = modeView.getUint8(1);
    buffer[5] = modeView.getUint8(2);

    // Set frequency
    buffer[6] = frequency;

    console.log(`🔧 TropX Streaming command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    return buffer;
  }

  /**
   * Creates a command to set device mode (quaternion, etc.)
   */
  static Cmd_SetMode(mode: number): Uint8Array {
    const buffer = new Uint8Array(3);

    buffer[0] = TROPX_COMMANDS.STATE;  // CMD_STATE (0x02)
    buffer[1] = 0x01;                  // Length (1 byte payload)
    buffer[2] = mode;                  // Mode value

    console.log(`🔧 TropX Mode command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    return buffer;
  }

  /**
   * Creates a command to stop data streaming
   */
  static Cmd_StopStream(): Uint8Array {
    const buffer = new Uint8Array(3);

    buffer[0] = TROPX_COMMANDS.STATE;  // CMD_STATE (0x02)
    buffer[1] = 0x01;                  // Length (1 byte payload)
    buffer[2] = TROPX_STATES.IDLE;     // Idle state (0x02)

    console.log(`🔧 TropX Stop command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    return buffer;
  }

  /**
   * Creates a command to get battery level
   */
  static Cmd_GetBatteryCharge(): Uint8Array {
    const battery_read_cmd = TROPX_COMMANDS.BATTERY | TROPX_COMMANDS.READ_MASK;
    const buffer = new Uint8Array([battery_read_cmd, 0x00]);

    console.log(`🔧 TropX Battery command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    return buffer;
  }

  /**
   * Creates a command to get system state
   */
  static Cmd_GetSystemState(): Uint8Array {
    const state_read_cmd = TROPX_COMMANDS.STATE | TROPX_COMMANDS.READ_MASK;
    const buffer = new Uint8Array([state_read_cmd, 0x00]);

    console.log(`🔧 TropX State command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    return buffer;
  }

  /**
   * Creates a command to set device RTC (Real-Time Clock) to current time
   * This initializes the device's hardware clock to Unix epoch time
   * MUST be called before TimeSync for proper hardware synchronization
   *
   * Command format (per Muse v3 PDF):
   * - Byte 0: Command type (0x0b - TIME)
   * - Byte 1: Length (0x04 - 4 bytes payload)
   * - Bytes 2-5: Unix epoch timestamp (32-bit unsigned, little-endian, in seconds)
   *
   * @param unixEpochSeconds - Current time in Unix epoch seconds (Date.now() / 1000)
   */
  static Cmd_SetDateTime(unixEpochSeconds: number): Uint8Array {
    const buffer = new Uint8Array(6);

    buffer[0] = TROPX_COMMANDS.TIME;  // CMD_TIME (0x0b)
    buffer[1] = 0x04;                 // Length (4 bytes payload)

    // Convert Unix epoch seconds to 32-bit little-endian
    const timestampBuffer = new ArrayBuffer(4);
    const timestampView = new DataView(timestampBuffer);
    timestampView.setUint32(0, unixEpochSeconds, true); // true = little-endian

    // Copy 4 bytes of timestamp
    buffer[2] = timestampView.getUint8(0);
    buffer[3] = timestampView.getUint8(1);
    buffer[4] = timestampView.getUint8(2);
    buffer[5] = timestampView.getUint8(3);

    const date = new Date(unixEpochSeconds * 1000);
    console.log(`🕐 TropX Set DateTime command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}] = ${date.toISOString()}`);

    return buffer;
  }

  /**
   * Legacy command format for backward compatibility
   * @deprecated Use proper command methods instead
   */
  static LegacyCommand(command: number, value?: number): Uint8Array {
    const buffer = new Uint8Array(value !== undefined ? 2 : 1);
    buffer[0] = command;
    if (value !== undefined) {
      buffer[1] = value;
    }

    console.log(`⚠️  TropX Legacy command: [${Array.from(buffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);

    return buffer;
  }
}