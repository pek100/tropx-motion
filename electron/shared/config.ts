// Core application configuration constants
export const CONFIG = {
  // WebSocket Configuration - Optimized for performance
  WEBSOCKET: {
    DEFAULT_PORT: 8080,
    PORT_SCAN_RANGE: 10,
    HEARTBEAT_INTERVAL: 30000,
    RECONNECT_MAX_ATTEMPTS: 5,
    RECONNECT_BASE_DELAY: 1000,
    RECONNECT_MAX_DELAY: 10000,
    CONNECTION_TIMEOUT: 5000,
    
    // Performance optimizations
    MAX_PAYLOAD_SIZE: 100 * 1024, // 100KB
    CONNECTION_BACKLOG: 511,
    DISABLE_COMPRESSION: true, // Better latency for real-time data
    BATCH_INTERVAL: 16, // ~60fps batching (16ms)
    MAX_BATCH_SIZE: 10,
    BUFFER_CLEANUP_THRESHOLD: 50,
    
    // Binary protocol settings
    BINARY_MESSAGE_SIZE: 32,
    USE_BINARY_FOR_MOTION: true,
  },

  // Bluetooth Configuration
  BLUETOOTH: {
    CONNECTION_TIMEOUT: 10000,
    GATT_OPERATION_TIMEOUT: 1200,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_BASE: 1000,
    DISCOVERY_TIMEOUT: 15000,
  },

  // Device Management
  DEVICES: {
    BATTERY_LOW_THRESHOLD: 20,
    RECENT_ACTIVITY_THRESHOLD: 5000,
    CONNECTION_CHECK_INTERVAL: 30000,
  },

  // Performance
  PERFORMANCE: {
    BATCH_SIZE: 1,
    BATCH_DELAY: 0,
    MAX_MESSAGE_BUFFER: 1000,
  },
} as const;

// Message type constants
export const MESSAGE_TYPES = {
  // System Messages
  HEARTBEAT: 'heartbeat',
  PONG: 'pong',
  STATUS_UPDATE: 'status_update',
  ERROR: 'error',

  // Device Messages  
  DEVICE_STATUS: 'device_status',
  DEVICE_SCAN_RESULT: 'device_scan_result',
  DEVICE_CONNECTED: 'device_connected',
  SCAN_REQUEST: 'scan_request',
  BATTERY_UPDATE: 'battery_update',

  // Bluetooth Messages
  BLUETOOTH_DEVICES: 'bluetooth_devices',
  BLUETOOTH_DEVICES_FOUND: 'bluetooth_devices_found',
  BLUETOOTH_PAIRING_REQUEST: 'bluetooth_pairing_request',

  // Recording Messages
  RECORDING_STATE: 'recording_state',

  // Motion Data Messages
  MOTION_DATA: 'motion_data',
  MOTION_DATA_BATCH: 'motion_data_batch',
} as const;

// Connection states
export const CONNECTION_STATES = {
  UNKNOWN: 'unknown',
  DISCONNECTED: 'disconnected',
  DISCOVERING: 'discovering',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  STREAMING: 'streaming',
  ERROR: 'error',
} as const;

// Device states for UI
export const DEVICE_STATES = {
  DISCOVERED: 'discovered',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  STREAMING: 'streaming',
  DISCONNECTED: 'disconnected',
  ERROR: 'error',
} as const;

// Bluetooth service identifiers
// Single source of truth for device identification patterns
export const DEVICE_PATTERNS = ['tropx', 'muse'] as const;

export const BLUETOOTH_CONFIG = {
  SERVICE_UUID: 'c8c0a708-e361-4b5e-a365-98fa6b0a836f',
  CMD_UUID: 'd5913036-2d8a-41ee-85b9-4e361aa5c8a7',
  DATA_UUID: '09bf2c52-d1d9-c0b7-4145-475964544307',
  DEVICE_PREFIX: 'tropx',
  DEVICE_PATTERNS, // Reference single source
} as const;

// Window configuration
export const WINDOW_CONFIG = {
  DEFAULT_WIDTH: 1600,
  DEFAULT_HEIGHT: 800,
  MIN_WIDTH: 800,
  MIN_HEIGHT: 600,
} as const;

// Error codes
export const ERROR_CODES = {
  BLUETOOTH_NOT_AVAILABLE: 'BLUETOOTH_NOT_AVAILABLE',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
  INVALID_DATA: 'INVALID_DATA',
  TIMEOUT: 'TIMEOUT',
} as const;

// Type exports for better type safety
export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];
export type ConnectionState = typeof CONNECTION_STATES[keyof typeof CONNECTION_STATES];
export type DeviceState = typeof DEVICE_STATES[keyof typeof DEVICE_STATES];
export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];