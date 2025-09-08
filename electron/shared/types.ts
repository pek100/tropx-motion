import { MessageType, ConnectionState, DeviceState, ErrorCode } from './config';

// Core WebSocket message interface
export interface WSMessage {
  type: MessageType;
  data: unknown;
  timestamp: number;
  clientId?: string;
}

// Device information interface
export interface DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  batteryLevel: number | null;
  state?: DeviceState;
  lastUpdate?: number;
}

// Motion data structures
export interface MotionDataPoint {
  current: number;
  max: number;
  min: number;
  rom: number;
  devices?: string[];
}

export interface MotionDataUpdate {
  left: MotionDataPoint;
  right: MotionDataPoint;
  timestamp: number;
  frameId?: number;
}

// Recording session information
export interface RecordingSession {
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  patientId?: string;
  exerciseName?: string;
}

// Bluetooth device information
export interface BluetoothDeviceInfo {
  deviceId: string;
  deviceName: string;
  paired: boolean;
  available: boolean;
}

// Service status information
export interface ServiceStatus {
  isInitialized: boolean;
  isRecording: boolean;
  connectedDevices: DeviceInfo[];
  batteryLevels: Record<string, number>;
  recordingStartTime?: string;
  wsPort: number;
  clientCount: number;
  motionProcessingReady?: boolean;
  deviceManagerReady?: boolean;
}

// Specific message type interfaces
export interface HeartbeatMessage extends WSMessage {
  type: 'heartbeat';
  data: {
    timestamp: number;
    serverUptime?: number;
  };
}

export interface DeviceStatusMessage extends WSMessage {
  type: 'device_status';
  data: {
    connectedDevices: DeviceInfo[];
    batteryLevels: Record<string, number>;
    totalDevices?: number;
  };
}

export interface MotionDataMessage extends WSMessage {
  type: 'motion_data';
  data: MotionDataUpdate;
}

export interface RecordingStateMessage extends WSMessage {
  type: 'recording_state';
  data: {
    isRecording: boolean;
    startTime?: string;
    sessionId?: string;
    duration?: number;
  };
}

export interface BluetoothDevicesMessage extends WSMessage {
  type: 'bluetooth_devices';
  data: {
    devices: BluetoothDeviceInfo[];
    requestId?: string;
  };
}

export interface ErrorMessage extends WSMessage {
  type: 'error';
  data: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

// Client message interfaces
export interface ClientMessage {
  type: string;
  data?: unknown;
  timestamp?: number;
}

export interface PingMessage extends ClientMessage {
  type: 'ping';
}

export interface BluetoothSelectionMessage extends ClientMessage {
  type: 'select_bluetooth_device';
  data: {
    deviceId: string;
  };
}

export interface StatusRequestMessage extends ClientMessage {
  type: 'request_status';
}

export interface StartRecordingMessage extends ClientMessage {
  type: 'start_recording';
  data: RecordingSession;
}

export interface StopRecordingMessage extends ClientMessage {
  type: 'stop_recording';
}

// Device state machine interface
export interface DeviceStateMachine {
  id: string;
  name: string;
  state: DeviceState;
  batteryLevel: number | null;
  lastSeen: Date;
  errorMessage?: string;
}

// API response interfaces
export interface ApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface DeviceConnectionResponse extends ApiResponse {
  deviceName?: string;
}

export interface RecordingResponse extends ApiResponse {
  recordingId?: string;
}