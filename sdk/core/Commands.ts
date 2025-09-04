/**
 * Commands.ts
 * 
 * This module handles the creation of properly formatted command buffers for
 * communicating with Muse devices. Each command exactly matches the format
 * specified in the Python SDK to ensure compatibility.
 */

/**
 * Creates and manages device commands following the Muse protocol
 */
export class MuseCommands {
    /**
     * Creates a command to check the device's battery level
     * Combines the battery command (0x07) with the read bit mask (0x80)
     */
    static Cmd_GetBatteryCharge(): Uint8Array {
      return new Uint8Array([0x87, 0x00]);  // 0x87 = 0x07 | 0x80 (CMD_BATTERY | READ_MASK)
      
    }

  static Cmd_GetSensorsFullScale(): Uint8Array {
    // Command byte is 0x40 with READ_MASK (0x80)
    return new Uint8Array([0xC0, 0x00]);  // 0xC0 = 0x40 | 0x80
  }
  
    /**
     * Creates a command to start data streaming
     * @param mode - The data acquisition mode (e.g., 9DOF, IMU)
     * @param frequency - The sampling frequency
     * @param enableDirect - Whether to use direct streaming mode
     */
    static Cmd_StartStream(mode: number, frequency: number): Uint8Array {
      const buffer = new Uint8Array(7);
      
      // Command structure
      buffer[0] = 0x02;  // CMD_STATE
      buffer[1] = 0x05;  // Length (7-2)
      buffer[2] = 0x08;  // SYS_TX_DIRECT
      
      // Convert mode to little-endian bytes (exactly like Python's struct.pack)
      const modeBuffer = new ArrayBuffer(4);
      const modeView = new DataView(modeBuffer);
      modeView.setUint32(0, mode, true);  // true for little-endian
      
      // Copy first 3 bytes of mode
      buffer[3] = modeView.getUint8(0);
      buffer[4] = modeView.getUint8(1);
      buffer[5] = modeView.getUint8(2);
      
      // Set frequency
      buffer[6] = frequency;
      
      return buffer;
  }
  
    /**
     * Creates a command to stop data streaming
     */
    static Cmd_StopStream(): Uint8Array {
      return new Uint8Array([0x02, 0x01, 0x02]);  // CMD_STATE, length=1, SYS_IDLE
    }
  
    /**
     * Creates a command to get the current system state
     */
    static Cmd_GetSystemState(): Uint8Array {
      return new Uint8Array([0x82]);  // 0x82 = 0x02 | 0x80 (CMD_STATE | READ_MASK)
    }

    static Cmd_GetDeviceID(): Uint8Array {
      // Command byte is 0x0E with READ_MASK (0x80)
      return new Uint8Array([0x8E, 0x00]);  // 0x8E = 0x0E | 0x80
    }
    
  
    /**
     * Creates a command to synchronize the device time
     */
    static Cmd_SetTime(): Uint8Array {
      const buffer = new Uint8Array(6);
      buffer[0] = 0x0b;  // CMD_TIME
      buffer[1] = 0x04;  // Payload length
      
      // Current time in seconds since epoch
      const timeView = new DataView(buffer.buffer);
      timeView.setUint32(2, Math.floor(Date.now() / 1000), true);
      
      return buffer;
    }
  }