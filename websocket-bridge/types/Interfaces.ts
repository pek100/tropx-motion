import { MessageType, DeliveryMode, ErrorCode } from './MessageTypes';

// Base message structure
export interface BaseMessage {
  type: MessageType;
  requestId?: number;
  timestamp: number;
}

// System messages
export interface HeartbeatMessage extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.HEARTBEAT;
}

export interface ErrorMessage extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.ERROR;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export interface StatusMessage extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.STATUS;
  isRecording: boolean;
  connectedDevices: DeviceInfo[];
  wsPort: number;
}

// BLE operation messages
export interface BLEScanRequest extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.BLE_SCAN_REQUEST;
}

export interface BLEScanResponse extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.BLE_SCAN_RESPONSE;
  success: boolean;
  devices: DeviceInfo[];
  message?: string;
}

export interface BLEConnectRequest extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.BLE_CONNECT_REQUEST;
  deviceId: string;
  deviceName: string;
}

export interface BLEConnectResponse extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.BLE_CONNECT_RESPONSE;
  success: boolean;
  deviceId: string;
  message?: string;
}

// Recording operation messages
export interface RecordStartRequest extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.RECORD_START_REQUEST;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
}

export interface RecordStartResponse extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.RECORD_START_RESPONSE;
  success: boolean;
  sessionId: string;
  message?: string;
}

// Streaming data messages (optimized for Float32Array)
// Motion data can be in Float32Array format (optimized) or object format (readable)
export interface MotionData {
  left: { current: number; max: number; min: number };
  right: { current: number; max: number; min: number };
  timestamp: number;
}

export interface MotionDataMessage extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.MOTION_DATA;
  deviceName?: string;
  data: Float32Array | MotionData; // Support both optimized binary and readable object formats
}

export interface DeviceStatusMessage extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.DEVICE_STATUS;
  deviceId: string;
  deviceName: string;
  connected: boolean;
  streaming: boolean;
}

export interface BatteryUpdateMessage extends BaseMessage {
  type: typeof import('./MessageTypes').MESSAGE_TYPES.BATTERY_UPDATE;
  deviceName: string;
  level: number;
}

// Device information
export interface DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  streaming: boolean;
  batteryLevel: number | null;
}

// Transport configuration
export interface TransportConfig {
  deliveryMode: DeliveryMode;
  timeout: number;
  maxRetries: number;
}

// Message routing
export type MessageHandler<T extends BaseMessage = BaseMessage> = (
  message: T,
  clientId: string
) => Promise<BaseMessage | void>;

export interface MessageRoute {
  messageType: MessageType;
  handler: MessageHandler;
  config: TransportConfig;
}

// Connection state
export interface ClientConnection {
  id: string;
  socket: import('ws').WebSocket;
  lastSeen: number;
  pendingRequests: Map<number, PendingRequest>;
}

export interface PendingRequest {
  resolve: (response: BaseMessage) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  timestamp: number;
}