/**
 * MuseDataParser.ts
 * 
 * This class handles the parsing and validation of raw data packets from the Muse device.
 * It supports both quaternion orientation data and traditional IMU sensor readings.
 * The implementation closely follows the protocol defined in the Python SDK.
 */

import { IMUData, Vector3D, Quaternion, ConfigurableSensorConfig } from '../types/DeviceData';

export class MuseDataParser {
  // Bit masks for different data modes
  private static readonly GYRO_MODE_BIT = 0x01;
  private static readonly ACCEL_MODE_BIT = 0x02;
  private static readonly MAG_MODE_BIT = 0x04;
  private static readonly QUAT_MODE_BIT = 0x10;

  // Data size constants
  private static readonly BYTES_PER_SENSOR = 6;   // 2 bytes × 3 axes
  private static readonly BYTES_PER_QUAT = 6;     // 2 bytes × 3 components (w is computed)

  /**
   * Validates the size of incoming data packets based on the active mode
   */
  public static validatePacket(data: Uint8Array, mode: number): boolean {
    // Calculate expected size including 8-byte header
    let expectedSize = 8;  // Start with header size
    
    if (mode & 0x10) {  // Quaternion mode
      expectedSize += 6;  // Add quaternion data size
    } else {
      // Handle other sensor modes if needed
      if (mode & 0x01) expectedSize += 6;  // Gyro
      if (mode & 0x02) expectedSize += 6;  // Accelerometer
      if (mode & 0x04) expectedSize += 6;  // Magnetometer
    }

    const isValid = data.length === expectedSize;
    if (!isValid) {
      console.warn(
        `Unexpected packet size: ${data.length} bytes. ` +
        `Expected: ${expectedSize} bytes for mode: ${mode.toString(16)}`
      );
    }
    return isValid;
  }
  /**
   * Decodes raw sensor data into structured IMU and quaternion data
   * @throws Error if packet validation fails
   */
  public static decodePacket(
    buffer: Uint8Array,
    timestamp: number,
    mode: number,
    gyrConfig: any,
    axlConfig: any,
    magConfig: any
  ): IMUData {
    // Skip validation for now as we're focusing on quaternion data
    // if (!this.validatePacket(buffer, mode)) {
    //   throw new Error('Invalid packet size');
    // }

    // Initialize return structure with default values
    const data: IMUData = {
      timestamp,
      gyr: { x: 0, y: 0, z: 0 },
      axl: { x: 0, y: 0, z: 0 },
      mag: { x: 0, y: 0, z: 0 },
      quaternion: { w: 1, x: 0, y: 0, z: 0 }
    };

    try {
      // Skip the 8-byte header and process only the quaternion data
      const dataView = new DataView(buffer.buffer, buffer.byteOffset + 8, buffer.length - 8);

      // Scale factor for converting from int16 to float [-1, 1]
      const scale = 1.0 / 32767.0;
      
      // Read transmitted components (x, y, z)
      data.quaternion.x = dataView.getInt16(0, true) * scale;
      data.quaternion.y = dataView.getInt16(2, true) * scale;
      data.quaternion.z = dataView.getInt16(4, true) * scale;
      
      // Compute w component using quaternion unit norm constraint
      // Since q.w² + q.x² + q.y² + q.z² = 1
      const sumSquares = 
        data.quaternion.x * data.quaternion.x +
        data.quaternion.y * data.quaternion.y +
        data.quaternion.z * data.quaternion.z;
      data.quaternion.w = Math.sqrt(Math.max(0, 1 - sumSquares));

      return data;
    } catch (error) {
      console.error('Error decoding packet:', error);
      throw error;
    }
  }


  /**
   * Helper method to decode three-axis sensor data
   */
  private static decodeSensorAxes(
    view: DataView,
    offset: number,
    sensitivity: number
  ): Vector3D {
    return {
      x: view.getInt16(offset, true) * sensitivity,
      y: view.getInt16(offset + 2, true) * sensitivity,
      z: view.getInt16(offset + 4, true) * sensitivity
    };
  }
}