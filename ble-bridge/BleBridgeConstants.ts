/**
 * BLE Bridge Constants - TropX device protocol
 */

// Import single source of truth for device patterns
import { DEVICE_PATTERNS } from '../electron/shared/config';

export const BLE_CONFIG = {
  // TropX BLE service and characteristic UUIDs
  SERVICE_UUID: 'c8c0a708-e361-4b5e-a365-98fa6b0a836f',
  COMMAND_CHARACTERISTIC_UUID: 'd5913036-2d8a-41ee-85b9-4e361aa5c8a7',
  DATA_CHARACTERISTIC_UUID: '09bf2c52-d1d9-c0b7-4145-475964544307',

  // Device identification (single source of truth)
  DEVICE_PREFIX: 'tropx',
  DEVICE_PATTERNS,  // Import from shared config

  // Scanning parameters (BLE Best Practices - 2024)
  // Industry research shows:
  // - Most BLE devices advertise every 100-500ms
  // - 75% of devices discovered in 1s, 100% in 2s (iOS foreground)
  // - Scans > 5s show diminishing returns
  SCAN_TIMEOUT: 2000,         // 2 seconds (optimal for 100% discovery with minimal power)
  CONNECTION_TIMEOUT: 15000,  // 15 seconds (BLE connection can be slow)

  // RSSI threshold for device filtering
  // -80 dBm is ~10m range in typical indoor environment
  MIN_RSSI: -80,
  // Burst scanning (continuous short scan cycles to keep device list fresh)
  // Scan duty cycle: SCAN_TIMEOUT active, then SCAN_BURST_GAP idle, repeats while enabled
  // NOTE: Disabled to let frontend control scanning via burstScanDevices()
  SCAN_BURST_ENABLED: false,
  SCAN_BURST_GAP: 500, // 0.5s gap between bursts (keeps ~80% duty cycle with 2s scans)
} as const;

export const TROPX_COMMANDS = {
  // Hardware commands
  ACK: 0x00,
  STATE: 0x02,
  BATTERY: 0x07,
  TIME: 0x0b,
  READ_MASK: 0x80,

  // Time Synchronization Commands (Muse v3 TimeSync Protocol)
  // Based on: AN_221e_Muse_v3_Timesync_v1.0.pdf
  ENTER_TIMESYNC: 0x32,      // Enter time sync mode
  GET_TIMESTAMP: 0xb2,       // Request device timestamp (64-bit epoch ms)
  EXIT_TIMESYNC: 0x33,       // Exit time sync mode
  SET_CLOCK_OFFSET: 0x31,    // Set computed clock offset (8-byte signed int64)
} as const;

// Muse/TropX Reference Epoch (Sunday, January 26, 2020 00:53:20 UTC)
// Device timestamps use this as epoch instead of Unix epoch (1970)
export const REFERENCE_EPOCH = 1580000000; // seconds
export const REFERENCE_EPOCH_MS = REFERENCE_EPOCH * 1000; // milliseconds

export const TROPX_STATES = {
  NONE: 0x00,           // Not a state - used only on software side
  STARTUP: 0x01,        // Starting up
  IDLE: 0x02,           // Ready
  STANDBY: 0x03,        // Low power
  LOG: 0x04,            // Recording to memory
  READOUT: 0x05,        // Downloading files
  TX_BUFFERED: 0x06,    // Streaming (buffered)
  CALIB: 0x07,          // Calibrating
  TX_DIRECT: 0x08,      // Streaming (direct) - same as STREAMING
  STREAMING: 0x08,      // Alias for TX_DIRECT
  ERROR: 0xff,          // Error state
} as const;

// Human-readable state names
export const STATE_NAMES: Record<number, string> = {
  [TROPX_STATES.NONE]: 'None',
  [TROPX_STATES.STARTUP]: 'Starting Up',
  [TROPX_STATES.IDLE]: 'Ready',
  [TROPX_STATES.STANDBY]: 'Standby',
  [TROPX_STATES.LOG]: 'Recording',
  [TROPX_STATES.READOUT]: 'Downloading',
  [TROPX_STATES.TX_BUFFERED]: 'Streaming (Buffered)',
  [TROPX_STATES.CALIB]: 'Calibrating',
  [TROPX_STATES.TX_DIRECT]: 'Streaming (Direct)',
  [TROPX_STATES.ERROR]: 'Error',
};

export const DATA_MODES = {
  NONE: 0x00,
  GYRO: 0x01,                    // Gyroscope-only mode
  ACCELEROMETER: 0x02,           // Accelerometer-only mode (for device location detection)
  IMU: 0x03,                     // IMU: Gyroscope + Accelerometer
  MAGNETOMETER: 0x04,            // Magnetometer-only mode
  QUATERNION: 0x10,              // Quaternion-only mode (uses reception timestamps)
  TIMESTAMP: 0x20,               // Timestamp flag
  QUATERNION_TIMESTAMP: 0x30,    // Quaternion + embedded timestamps (0x10 | 0x20)
  ACCELEROMETER_TIMESTAMP: 0x22, // Accelerometer + timestamps (0x02 | 0x20)
} as const;

export const DATA_FREQUENCIES = {
  HZ_25: 0x01,
  HZ_50: 0x02,
  HZ_100: 0x04,   // Default frequency
  HZ_200: 0x08,
} as const;

export const PACKET_SIZES = {
  HEADER: 8,                  // 8-byte header (general packet header)
  ACCELEROMETER: 6,           // 6 bytes: 3 x int16 (x,y,z axes)
  QUATERNION: 6,              // 6 bytes: 3 x int16 (x,y,z components)
  TIMESTAMP: 6,               // 6 bytes: 48-bit timestamp (per Muse API)
  TOTAL_ACCELEROMETER: 14,    // Mode 0x02: 8-byte header + 6-byte accelerometer
  TOTAL_ACCELEROMETER_TIMESTAMP: 20,  // Mode 0x22: 8-byte header + 6-byte accel + 6-byte timestamp
  TOTAL_QUATERNION: 14,       // Mode 0x10: 8-byte header + 6-byte quaternion
  TOTAL_QUATERNION_TIMESTAMP: 20,  // Mode 0x30: 8-byte header + 6-byte quat + 6-byte timestamp
} as const;

export const QUATERNION_SCALE = 1.0 / 32767.0;  // Scale factor for int16 to float conversion

export const TIMING = {
  STREAM_START_DELAY: 0,        // No delay needed - Noble handles BLE timing
  RECONNECTION_DELAY: 4000,     // 4 seconds between reconnection attempts
  BATTERY_UPDATE_INTERVAL: 30000, // 30 seconds between battery reads
  BATTERY_UPDATE_INTERVAL_STREAMING: 60000, // 60 seconds during streaming (reduce BLE traffic)
} as const;