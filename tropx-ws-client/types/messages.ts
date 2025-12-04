// Message type constants for WebSocket communication
export const MESSAGE_TYPES = {
  // System messages (0x01-0x0F)
  HEARTBEAT: 0x01,
  ERROR: 0x02,
  STATUS: 0x03,
  // BLE operations (0x10-0x1F)
  BLE_SCAN_REQUEST: 0x10,
  BLE_SCAN_RESPONSE: 0x11,
  BLE_CONNECT_REQUEST: 0x12,
  BLE_CONNECT_RESPONSE: 0x13,
  BLE_DISCONNECT_REQUEST: 0x14,
  BLE_DISCONNECT_RESPONSE: 0x15,
  BLE_SYNC_REQUEST: 0x16,
  BLE_SYNC_RESPONSE: 0x17,
  // Recording operations (0x20-0x2F)
  RECORD_START_REQUEST: 0x20,
  RECORD_START_RESPONSE: 0x21,
  RECORD_STOP_REQUEST: 0x22,
  RECORD_STOP_RESPONSE: 0x23,
  // Streaming data (0x30-0x3F)
  MOTION_DATA: 0x30,
  DEVICE_STATUS: 0x31,
  BATTERY_UPDATE: 0x32,
  SYNC_STARTED: 0x33,
  SYNC_PROGRESS: 0x34,
  SYNC_COMPLETE: 0x35,
  DEVICE_VIBRATING: 0x36,
  // STATE_UPDATE (0x40) - Server→Client broadcast of full device state
  STATE_UPDATE: 0x40,
  // Client metadata protocol (0x60-0x6F)
  CLIENT_REGISTER: 0x60,
  CLIENT_METADATA_UPDATE: 0x61,
  CLIENT_ACTION_REGISTER: 0x62,
  CLIENT_ACTION_TRIGGER: 0x63,
  CLIENT_ACTION_RESULT: 0x64,
  CLIENT_LIST_UPDATE: 0x65,
  // Internal protocol (0xF0-0xFF)
  ACK: 0xF0,
  PING: 0xF1,
  PONG: 0xF2,
} as const;

export type MessageType = typeof MESSAGE_TYPES[keyof typeof MESSAGE_TYPES];

// Protocol constants
export const PROTOCOL = {
  VERSION: 1,
  HEADER_SIZE: 12,
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
  state: 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';
  batteryLevel?: number;
}

// Battery update message
export interface BatteryUpdateMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.BATTERY_UPDATE;
  deviceId: string;
  batteryLevel: number;
}

// Error message
export interface ErrorMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.ERROR;
  code: ErrorCode;
  message: string;
  details?: any;
}

// Client metadata protocol
export interface ClientAction {
  id: string;
  label: string;
  icon?: string;
  category?: string;
}

export interface ClientMetadata {
  clientId: string;
  name: string;
  type: 'main' | 'recording' | 'monitor' | 'custom';
  capabilities?: string[];
  actions?: ClientAction[];
}

// Client register message
export interface ClientRegisterMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CLIENT_REGISTER;
  metadata: ClientMetadata;
}

// Client metadata update message
export interface ClientMetadataUpdateMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CLIENT_METADATA_UPDATE;
  metadata: Partial<ClientMetadata>;
}

// Client action register message
export interface ClientActionRegisterMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CLIENT_ACTION_REGISTER;
  clientId: string;
  action: ClientAction;
}

// Client action trigger message
export interface ClientActionTriggerMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CLIENT_ACTION_TRIGGER;
  clientId: string;
  actionId: string;
  params?: any;
}

// Client action result message
export interface ClientActionResultMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CLIENT_ACTION_RESULT;
  clientId: string;
  actionId: string;
  success: boolean;
  result?: any;
  error?: string;
}

// Client list update message
export interface ClientListUpdateMessage extends BaseMessage {
  type: typeof MESSAGE_TYPES.CLIENT_LIST_UPDATE;
  clients: ClientMetadata[];
}
