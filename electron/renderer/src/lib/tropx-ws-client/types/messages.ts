// Message type constants for WebSocket communication
export const MESSAGE_TYPES = {
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  STATUS: 0x03,
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
  RECORD_START_REQUEST: 0x20,
  RECORD_START_RESPONSE: 0x21,
  RECORD_STOP_REQUEST: 0x22,
  RECORD_STOP_RESPONSE: 0x23,
  MOTION_DATA: 0x30,
  DEVICE_STATUS: 0x31,
  BATTERY_UPDATE: 0x32,
  SYNC_STARTED: 0x33,
  SYNC_PROGRESS: 0x34,
  SYNC_COMPLETE: 0x35,
  DEVICE_VIBRATING: 0x36,
  GET_DEVICES_STATE_REQUEST: 0x42,
  GET_DEVICES_STATE_RESPONSE: 0x43,
  ACK: 0xF0,
  PING: 0xF1,
  PONG: 0xF2,
} as const;

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// Protocol constants
export const PROTOCOL = {
  VERSION: 1,
  HEADER_SIZE: 16, // Increased from 12 to support 8-byte timestamp (Float64)
  MAX_PAYLOAD_SIZE: 65535,
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

// Base message structure
export interface BaseMessage {
  type: MessageType;
  timestamp: number;
  requestId?: number;
}

// Motion data structure
export interface MotionDataMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.MOTION_DATA;
  deviceName: string;
  data: {
    left: { current: number; max: number; min: number };
    right: { current: number; max: number; min: number };
    timestamp: number;
  };
}

// Device status message
export interface DeviceStatusMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.DEVICE_STATUS;
  deviceId: string;
  deviceName: string;
  state: 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';
  batteryLevel?: number;
}

// Battery update message
export interface BatteryUpdateMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.BATTERY_UPDATE;
  deviceId: string;
  deviceName: string;
  batteryLevel: number;
}

// Get devices state request
export interface GetDevicesStateRequest extends BaseMessage {
  type: typeof MESSAGE_TYPES.GET_DEVICES_STATE_REQUEST;
}

// Get devices state response
export interface GetDevicesStateResponse extends BaseMessage {
  type: typeof MESSAGE_TYPES.GET_DEVICES_STATE_RESPONSE;
  devices: Array<{
    id: string;
    name: string;
    address: string;
    rssi: number;
    state: 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';
    batteryLevel: number | null;
    isManaged: boolean;
  }>;
}

// Sync started message
export interface SyncStartedMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.SYNC_STARTED;
  deviceCount: number;
}

// Sync progress message (per device)
export interface SyncProgressMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.SYNC_PROGRESS;
  deviceId: string;
  deviceName: string;
  clockOffsetMs: number;
  deviceTimestampMs?: number;
  success: boolean;
  message?: string;
}

// Sync complete message
export interface SyncCompleteMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.SYNC_COMPLETE;
  totalDevices: number;
  successCount: number;
  failureCount: number;
}

// Device vibrating message (locate mode)
export interface DeviceVibratingMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.DEVICE_VIBRATING;
  vibratingDeviceIds: string[];
}

// Error message
export interface ErrorMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.ERROR;
  code: ErrorCode;
  message: string;
  details?: any;
}
