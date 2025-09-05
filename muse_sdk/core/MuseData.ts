/**
 * MuseData.ts
 * 
 * Core data structures and parsing logic for the Muse device.
 * This file handles both quaternion orientation data and IMU sensor data,
 * providing type-safe interfaces and efficient parsing functionality.
 */

// Bluetooth Web API types for TypeScript compatibility
interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  readValue(): Promise<DataView>;
  writeValue(value: ArrayBuffer): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  value?: DataView;
}

// Basic 3D vector interface used for IMU sensor readings
export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

// Quaternion interface for orientation data
// A quaternion represents 3D rotation using four components (w,x,y,z)
// where w is the scalar (real) component and (x,y,z) form the vector (imaginary) part
export interface Quaternion {
  w: number;  // Scalar component
  x: number;  // i component
  y: number;  // j component
  z: number;  // k component
}

// Combined data structure for all sensor readings
export interface IMUData {
  timestamp: number;  // Milliseconds since epoch
  // Traditional IMU sensors - make these required to avoid null safety issues
  gyr: Vector3D;      // Gyroscope data in degrees/sec
  axl: Vector3D;      // Accelerometer data in m/s²
  mag: Vector3D;      // Magnetometer data in μT
  // Orientation data
  quaternion?: Quaternion;  // Normalized quaternion representing device orientation
}

// Configuration for individual sensors
export interface SensorConfig {
  FullScale: number;    // Maximum measurable value
  Sensitivity: number;  // Conversion factor from raw to physical units
}

// Possible device connection states
export type ConnectionState = 
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn'
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'streaming';

// Web Bluetooth specific types
export interface WebBluetoothDevice {
  id: string;
  name: string | null;
  gatt?: BluetoothRemoteGATTServer;
}

// Callback type for streaming data updates
export type StreamCallback = (data: IMUData) => void;

// Main data parser class for handling device data
export class MuseDataParser {
  // Bit masks for different data modes
  private static readonly GYRO_MODE_BIT = 0x01;
  private static readonly ACCEL_MODE_BIT = 0x02;
  private static readonly MAG_MODE_BIT = 0x04;
  private static readonly QUAT_MODE_BIT = 0x10;  // Quaternion mode

  // Data size constants
  private static readonly BYTES_PER_SENSOR = 6;   // 2 bytes × 3 axes
  private static readonly BYTES_PER_QUAT = 6;     // 2 bytes × 3 components (w is computed)

  // Scaling factors for sensor data
  private static readonly GYRO_SCALE = 1.0 / 32768.0 * 2000.0; // ±2000 dps
  private static readonly ACCEL_SCALE = 1.0 / 32768.0 * 16.0;  // ±16g
  private static readonly MAG_SCALE = 1.0 / 32768.0 * 4912.0;  // ±4912 µT
  private static readonly QUAT_SCALE = 1.0 / 32768.0;          // Normalized quaternion

  /**
   * Validates incoming data packet size based on the active mode
   */
  public static validatePacket(data: Uint8Array, mode: number): boolean {
    let expectedSize = 0;
    
    // Quaternion mode uses a different packet structure
    if (mode & this.QUAT_MODE_BIT) {
      expectedSize = this.BYTES_PER_QUAT;
    } else {
      // For IMU mode, sum up the sizes of active sensors
      if (mode & this.GYRO_MODE_BIT) expectedSize += this.BYTES_PER_SENSOR;
      if (mode & this.ACCEL_MODE_BIT) expectedSize += this.BYTES_PER_SENSOR;
      if (mode & this.MAG_MODE_BIT) expectedSize += this.BYTES_PER_SENSOR;
    }

    const isValid = data.length === expectedSize;
    if (!isValid) {
      console.warn(
        `Invalid packet size: ${data.length} bytes. ` +
        `Expected: ${expectedSize} bytes for mode: ${mode.toString(16)}`
      );
    }
    return isValid;
  }

  /**
   * Decodes raw sensor data into structured IMU and quaternion data
   */
  public static decodePacket(
    buffer: Uint8Array,
    timestamp: number,
    mode: number,
    gyrConfig: SensorConfig,
    axlConfig: SensorConfig,
    magConfig: SensorConfig
  ): IMUData {
    // Validate packet before processing
    if (!this.validatePacket(buffer, mode)) {
      throw new Error('Invalid packet size');
    }

    // Initialize return structure with default values
    const data: IMUData = {
      timestamp,
      gyr: { x: 0, y: 0, z: 0 },
      axl: { x: 0, y: 0, z: 0 },
      mag: { x: 0, y: 0, z: 0 },
      quaternion: { w: 1, x: 0, y: 0, z: 0 }  // Identity quaternion by default
    };

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);

    // Handle quaternion mode
    if (mode & this.QUAT_MODE_BIT) {
      // Convert from int16 [-32768, 32767] to float [-1, 1]
      const scale = 1.0 / 32767.0;
      
      // Read transmitted components (x, y, z) - quaternion is guaranteed to exist
      data.quaternion!.x = view.getInt16(0, true) * scale;
      data.quaternion!.y = view.getInt16(2, true) * scale;
      data.quaternion!.z = view.getInt16(4, true) * scale;

      // Compute w component using quaternion unit norm constraint
      // Since q.w² + q.x² + q.y² + q.z² = 1
      const sumSquares = 
        data.quaternion!.x * data.quaternion!.x +
        data.quaternion!.y * data.quaternion!.y +
        data.quaternion!.z * data.quaternion!.z;
      data.quaternion!.w = Math.sqrt(Math.max(0, 1 - sumSquares));

      return data;  // Early return for quaternion mode
    }

    // Handle IMU sensor data
    let offset = 0;

    // Process gyroscope data if present
    if (mode & this.GYRO_MODE_BIT) {
      data.gyr = this.decodeSensorAxes(view, offset, gyrConfig.Sensitivity);
      offset += this.BYTES_PER_SENSOR;
    }

    // Process accelerometer data if present
    if (mode & this.ACCEL_MODE_BIT) {
      data.axl = this.decodeSensorAxes(view, offset, axlConfig.Sensitivity);
      offset += this.BYTES_PER_SENSOR;
    }

    // Process magnetometer data if present
    if (mode & this.MAG_MODE_BIT) {
      data.mag = this.decodeSensorAxes(view, offset, magConfig.Sensitivity);
    }

    return data;
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

  /**
   * Parse raw sensor data into structured IMU format
   */
  static parseIMUData(rawData: Uint8Array, mode: number): IMUData {
    const view = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);
    const timestamp = performance.now();

    const data: IMUData = {
      timestamp,
      gyr: { x: 0, y: 0, z: 0 },
      axl: { x: 0, y: 0, z: 0 },
      mag: { x: 0, y: 0, z: 0 }
    };

    let offset = 0;

    // Parse gyroscope data
    if (mode & this.GYRO_MODE_BIT) {
      data.gyr.x = view.getInt16(offset, true) * this.GYRO_SCALE;
      data.gyr.y = view.getInt16(offset + 2, true) * this.GYRO_SCALE;
      data.gyr.z = view.getInt16(offset + 4, true) * this.GYRO_SCALE;
      offset += 6;
    }

    // Parse accelerometer data
    if (mode & this.ACCEL_MODE_BIT) {
      data.axl.x = view.getInt16(offset, true) * this.ACCEL_SCALE;
      data.axl.y = view.getInt16(offset + 2, true) * this.ACCEL_SCALE;
      data.axl.z = view.getInt16(offset + 4, true) * this.ACCEL_SCALE;
      offset += 6;
    }

    // Parse magnetometer data
    if (mode & this.MAG_MODE_BIT) {
      data.mag.x = view.getInt16(offset, true) * this.MAG_SCALE;
      data.mag.y = view.getInt16(offset + 2, true) * this.MAG_SCALE;
      data.mag.z = view.getInt16(offset + 4, true) * this.MAG_SCALE;
      offset += 6;
    }

    // Parse quaternion data with null safety
    if (mode & this.QUAT_MODE_BIT && rawData.length >= offset + 6) {
      // Initialize quaternion if not present
      if (!data.quaternion) {
        data.quaternion = { w: 1, x: 0, y: 0, z: 0 };
      }

      const scale = this.QUAT_SCALE;
      data.quaternion.x = view.getInt16(offset, true) * scale;
      data.quaternion.y = view.getInt16(offset + 2, true) * scale;
      data.quaternion.z = view.getInt16(offset + 4, true) * scale;

      // Calculate W component from X, Y, Z with null safety
      const sumSquares =
        data.quaternion.x * data.quaternion.x +
        data.quaternion.y * data.quaternion.y +
        data.quaternion.z * data.quaternion.z;
      data.quaternion.w = Math.sqrt(Math.max(0, 1 - sumSquares));
    }

    return data;
  }
}

// Interface for Bluetooth device hook (Web Bluetooth integration)
export interface BluetoothDeviceHook {
  isInitialized: boolean;
  isScanning: boolean;
  isStreaming: boolean;
  devices: WebBluetoothDevice[];
  connectedDevice: WebBluetoothDevice | null;
  sensorData: IMUData[];
  error: string | null;
  batteryLevel: number | null;
  bluetoothState: ConnectionState;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connectToDevice: (deviceId: string) => Promise<boolean>;
  disconnectDevice: () => Promise<void>;
  startStreaming: () => Promise<boolean>;
  stopStreaming: () => Promise<void>;
  getBatteryLevel: () => Promise<number | null>;
}