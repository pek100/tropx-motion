/**
 * MuseHardware.ts
 * 
 * Defines hardware-specific constants and configurations for Muse devices.
 * This implementation includes support for both IMU sensors and quaternion data,
 * matching the specifications from the Python SDK.
 */

export class MuseHardware {
  /**
   * Data acquisition modes
   * Each mode represents a different combination of active sensors
   */
  static readonly DataMode = {
    NONE: 0x00000000,
    GYROSCOPE: 0x00000001,
    ACCELEROMETER: 0x00000002,
    IMU: 0x00000003,
    MAGNETOMETER: 0x00000004,
    NINE_AXIS: 0x00000007,
    QUATERNION: 0x00000010,    // Added quaternion mode
    
    // Alternative names to match Python SDK
    DATA_MODE_NONE: 0x00000000,
    DATA_MODE_GYRO: 0x00000001,
    DATA_MODE_AXL: 0x00000002,
    DATA_MODE_IMU: 0x00000003,
    DATA_MODE_MAGN: 0x00000004,
    DATA_MODE_9DOF: 0x00000007,
    DATA_MODE_QUATERNION: 0x00000010
  } as const;

  /**
   * Sampling frequencies in Hz
   */
  static readonly DataFrequency = {
    HZ_25: 0x01,    // 25 Hz
    HZ_50: 0x02,    // 50 Hz
    HZ_100: 0x04,   // 100 Hz
    HZ_200: 0x08,   // 200 Hz
    HZ_400: 0x10,   // 400 Hz
    HZ_800: 0x20,   // 800 Hz
    HZ_1600: 0x40   // 1600 Hz
  } as const;

  /**
   * Data packet sizes in bytes for each sensor type
   */
  static readonly DataSize = {
    GYROSCOPE: 6,      // 2 bytes × 3 axes
    ACCELEROMETER: 6,   // 2 bytes × 3 axes
    MAGNETOMETER: 6,    // 2 bytes × 3 axes
    QUATERNION: 6,      // 2 bytes × 3 components (w computed)
    TIMESTAMP: 6        // 6 bytes for timestamp
  } as const;

  /**
   * Hardware commands
   */
  static readonly Command = {
    NONE: 0xff,         // Not a command - software use only
    ACK: 0x00,          // Acknowledge
    STATE: 0x02,        // State get/set
    BATTERY: 0x07,      // Battery level
    TIME: 0x0b,         // Current time get/set
    READ_MASK: 0x80     // Bit mask for read commands
  } as const;

  /**
   * System states
   */
  static readonly SystemState = {
    NONE: 0x00,         // Software use only
    ERROR: 0xff,        // Error state
    STARTUP: 0x01,      // System starting up
    IDLE: 0x02,         // System idle
    STANDBY: 0x03,      // System in standby
    STREAMING: 0x08     // System streaming data
  } as const;

  /**
   * BLE service and characteristic UUIDs
   */
  static readonly BLEConfig = {
    SERVICE_UUID: "c8c0a708-e361-4b5e-a365-98fa6b0a836f",
    CMD_UUID: "d5913036-2d8a-41ee-85b9-4e361aa5c8a7",
    DATA_UUID: "09bf2c52-d1d9-c0b7-4145-475964544307",
    DEVICE_PREFIX: "tropx"
  } as const;

  /**
   * Default sensor configurations
   */
  static readonly DefaultConfigs = {
    Gyroscope: { 
      FullScale: 245,
      Sensitivity: 0.00875  // For ±245 dps range
    },
    Accelerometer: { 
      FullScale: 4,
      Sensitivity: 0.000244  // For ±4g range
    },
    Magnetometer: { 
      FullScale: 4,
      Sensitivity: 0.00014  // For ±4 gauss range
    }
  } as const;

  /**
   * Communication timing settings
   */
  static readonly Timing = {
    CONNECTION_TIMEOUT: 15000,     // 15 seconds
    STREAM_START_DELAY: 2000,      // 2 seconds
    RECONNECTION_DELAY: 4000,      // 4 seconds
    SCAN_TIMEOUT: 10000            // 10 seconds
  } as const;
}