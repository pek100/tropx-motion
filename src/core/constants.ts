/**
 * Centralized performance and configuration constants
 * All magic numbers and configuration values are defined here
 */

export const PERFORMANCE_CONSTANTS = {
  // Sensor performance limits
  MAX_SENSOR_HZ: 16000,
  MIN_SENSOR_HZ: 25,
  DEFAULT_SENSOR_HZ: 100,
  
  // Timing constraints (microseconds for precision)
  MIN_SAMPLE_INTERVAL_US: 62.5, // 1/16000 * 1000000
  MAX_SAMPLE_INTERVAL_US: 40000, // 1/25 * 1000000
  
  // Buffer and batching
  WEBRTC_BUFFER_SIZE: 65536,
  CIRCULAR_BUFFER_SIZE: 32768,
  MAX_BATCH_SIZE: 100,
  MIN_BATCH_SIZE: 1,
  
  // UI performance
  UI_UPDATE_THROTTLE_MS: 16, // 60fps
  CHART_UPDATE_THROTTLE_MS: 33, // 30fps for charts
  MAX_CHART_POINTS: 1000,
  
  // Connection management
  CONNECTION_TIMEOUT_MS: 5000,
  RECONNECT_BASE_DELAY_MS: 1000,
  MAX_RECONNECT_DELAY_MS: 30000,
  MAX_RETRY_ATTEMPTS: 3,
  HEARTBEAT_INTERVAL_MS: 1000,
  
  // Memory management
  OBJECT_POOL_SIZE: 1000,
  GC_PREVENTION_INTERVAL_MS: 100,
  
  // WebRTC specific
  WEBRTC_ICE_TIMEOUT_MS: 10000,
  WEBRTC_DATA_CHANNEL_BUFFER_SIZE: 16777216, // 16MB
  WEBRTC_MAX_RETRANSMITS: 0, // For lowest latency
  
  // Battery and device management
  BATTERY_UPDATE_INTERVAL_MS: 30000,
  DEVICE_SCAN_TIMEOUT_MS: 10000,
} as const;

export const BLE_CONSTANTS = {
  // Service and characteristic UUIDs
  SERVICE_UUID: 'c8c0a708-e361-4b5e-a365-98fa6b0a836f',
  CMD_UUID: 'd5913036-2d8a-41ee-85b9-4e361aa5c8a7',
  DATA_UUID: '09bf2c52-d1d9-c0b7-4145-475964544307',
  BATTERY_SERVICE_UUID: '180f',
  
  // Device filtering
  DEVICE_NAME_PREFIXES: ['tropx', 'muse'],
  
  // Commands (hex values)
  BATTERY_COMMAND: [0x87, 0x00],
  STREAM_START_COMMAND: [0x02, 0x05, 0x08, 0x10, 0x00, 0x00, 0x10],
  STREAM_STOP_COMMAND: [0x02, 0x01, 0x02],
  
  // Data modes and frequencies
  DATA_MODES: {
    NONE: 0x00000000,
    GYROSCOPE: 0x00000001,
    ACCELEROMETER: 0x00000002,
    IMU: 0x00000003,
    MAGNETOMETER: 0x00000004,
    NINE_AXIS: 0x00000007,
    QUATERNION: 0x00000010,
  },
  
  SAMPLING_FREQUENCIES: {
    HZ_25: 0x01,
    HZ_50: 0x02,
    HZ_100: 0x04,
    HZ_200: 0x08,
    HZ_400: 0x10,
    HZ_800: 0x20,
    HZ_1600: 0x40,
  },
} as const;

export const UI_CONSTANTS = {
  // Component dimensions
  CHART_HEIGHT: 300,
  CHART_WIDTH: 600,
  DEVICE_CARD_HEIGHT: 120,
  
  // Animation durations
  TRANSITION_DURATION_MS: 200,
  LOADING_ANIMATION_DURATION_MS: 1500,
  
  // Colors (using CSS custom properties for theming)
  COLORS: {
    PRIMARY: '#FF4D35',
    SUCCESS: '#10B981',
    WARNING: '#F59E0B',
    ERROR: '#EF4444',
    INFO: '#3B82F6',
    BACKGROUND: '#F9FAFB',
  },
  
  // Z-index layers
  Z_INDEX: {
    MODAL: 1000,
    TOOLTIP: 999,
    DROPDOWN: 998,
    OVERLAY: 997,
  },
} as const;

export const ERROR_CODES = {
  // Device connection errors
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  DEVICE_DISCONNECTED: 'DEVICE_DISCONNECTED',
  
  // Bluetooth errors
  BLUETOOTH_NOT_SUPPORTED: 'BLUETOOTH_NOT_SUPPORTED',
  BLUETOOTH_NOT_AVAILABLE: 'BLUETOOTH_NOT_AVAILABLE',
  USER_CANCELLED: 'USER_CANCELLED',
  
  // Data streaming errors
  STREAM_FAILED: 'STREAM_FAILED',
  DATA_CORRUPTION: 'DATA_CORRUPTION',
  BUFFER_OVERFLOW: 'BUFFER_OVERFLOW',
  
  // WebRTC errors
  WEBRTC_CONNECTION_FAILED: 'WEBRTC_CONNECTION_FAILED',
  WEBRTC_DATA_CHANNEL_ERROR: 'WEBRTC_DATA_CHANNEL_ERROR',
  WEBRTC_ICE_FAILED: 'WEBRTC_ICE_FAILED',
  
  // Motion processing errors
  MOTION_PROCESSING_FAILED: 'MOTION_PROCESSING_FAILED',
  INVALID_SENSOR_DATA: 'INVALID_SENSOR_DATA',
} as const;

// Type exports for compile-time safety
export type PerformanceConstant = keyof typeof PERFORMANCE_CONSTANTS;
export type BLEConstant = keyof typeof BLE_CONSTANTS;
export type UIConstant = keyof typeof UI_CONSTANTS;
export type ErrorCode = keyof typeof ERROR_CODES;