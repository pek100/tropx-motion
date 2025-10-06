// Message type constants for WebSocket communication
export const MESSAGE_TYPES = {
  // System messages
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  STATUS: 0x03,

  // BLE operations (reliable delivery required)
  BLE_SCAN_REQUEST: 0x10,
  BLE_SCAN_RESPONSE: 0x11,
  BLE_CONNECT_REQUEST: 0x12,
  BLE_CONNECT_RESPONSE: 0x13,
  BLE_DISCONNECT_REQUEST: 0x14,
  BLE_DISCONNECT_RESPONSE: 0x15,
  BLE_SYNC_REQUEST: 0x16,
  BLE_SYNC_RESPONSE: 0x17,
  BLE_LOCATE_START_REQUEST: 0x18,
  BLE_LOCATE_START_RESPONSE: 0x19,
  BLE_LOCATE_STOP_REQUEST: 0x1A,
  BLE_LOCATE_STOP_RESPONSE: 0x1B,
  BLE_BURST_SCAN_START_REQUEST: 0x1C,
  BLE_BURST_SCAN_STOP_REQUEST: 0x1D,

  // Broadcast messages (from original WebSocket service)
  SCAN_REQUEST: 0x40,

  // Recording operations (reliable delivery required)
  RECORD_START_REQUEST: 0x20,
  RECORD_START_RESPONSE: 0x21,
  RECORD_STOP_REQUEST: 0x22,
  RECORD_STOP_RESPONSE: 0x23,

  // Streaming data (fire-and-forget by default)
  MOTION_DATA: 0x30,
  DEVICE_STATUS: 0x31,
  BATTERY_UPDATE: 0x32,
  SYNC_STARTED: 0x33,
  SYNC_PROGRESS: 0x34,
  SYNC_COMPLETE: 0x35,
  DEVICE_VIBRATING: 0x36,  // Locate mode: array of device IDs currently being shaken

  // Device state query (for persistence/reconnect)
  GET_DEVICES_STATE_REQUEST: 0x42,
  GET_DEVICES_STATE_RESPONSE: 0x43,

  // Internal protocol
  ACK: 0xF0,
  PING: 0xF1,
  PONG: 0xF2,
} as const;

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// Message delivery modes
export const DELIVERY_MODES = {
  RELIABLE: 'reliable',
  FIRE_AND_FORGET: 'unreliable',
} as const;

export type DeliveryMode = typeof DELIVERY_MODES[keyof typeof DELIVERY_MODES];

// Protocol constants
export const PROTOCOL = {
  VERSION: 1,
  HEADER_SIZE: 16, // Increased from 12 to support 8-byte timestamp (Float64)
  MAX_PAYLOAD_SIZE: 65535,
  DEFAULT_TIMEOUT: 5000,
  MAX_REQUEST_ID: 0xFFFFFFFF,
} as const;

// Error codes
export const ERROR_CODES = {
  INVALID_MESSAGE: 0x01,
  TIMEOUT: 0x02,
  BLE_UNAVAILABLE: 0x03,
  DEVICE_NOT_FOUND: 0x04,
  CONNECTION_FAILED: 0x05,
  ALREADY_CONNECTED: 0x06,
  NOT_CONNECTED: 0x07,
  RECORDING_ACTIVE: 0x08,
  NO_RECORDING: 0x09,
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];