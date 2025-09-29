/**
 * BLE Bridge Constants - TropX device protocol
 */

export const BLE_CONFIG = {
  // TropX BLE service and characteristic UUIDs
  SERVICE_UUID: 'c8c0a708-e361-4b5e-a365-98fa6b0a836f',
  COMMAND_CHARACTERISTIC_UUID: 'd5913036-2d8a-41ee-85b9-4e361aa5c8a7',
  DATA_CHARACTERISTIC_UUID: '09bf2c52-d1d9-c0b7-4145-475964544307',

  // Device identification
  DEVICE_PREFIX: 'tropx',

  // Scanning parameters
  SCAN_TIMEOUT: 10000,        // 10 seconds
  CONNECTION_TIMEOUT: 15000,  // 15 seconds

  // RSSI threshold for device filtering
  MIN_RSSI: -80,
} as const;

export const TROPX_COMMANDS = {
  // Hardware commands
  ACK: 0x00,
  STATE: 0x02,
  BATTERY: 0x07,
  TIME: 0x0b,
  READ_MASK: 0x80,
} as const;

export const TROPX_STATES = {
  NONE: 0x00,
  ERROR: 0xff,
  STARTUP: 0x01,
  IDLE: 0x02,
  STANDBY: 0x03,
  STREAMING: 0x08,
} as const;

export const DATA_MODES = {
  NONE: 0x00,
  QUATERNION: 0x10,  // Quaternion-only mode
} as const;

export const DATA_FREQUENCIES = {
  HZ_25: 0x01,
  HZ_50: 0x02,
  HZ_100: 0x04,   // Default frequency
  HZ_200: 0x08,
} as const;

export const PACKET_SIZES = {
  HEADER: 8,        // 8-byte header
  QUATERNION: 6,    // 6 bytes: 3 x int16 (x,y,z components)
  TOTAL: 14,        // Total packet size for quaternion mode
} as const;

export const QUATERNION_SCALE = 1.0 / 32767.0;  // Scale factor for int16 to float conversion

export const TIMING = {
  STREAM_START_DELAY: 0,        // No delay needed - Noble handles BLE timing
  RECONNECTION_DELAY: 4000,     // 4 seconds between reconnection attempts
  BATTERY_UPDATE_INTERVAL: 30000, // 30 seconds between battery reads
} as const;