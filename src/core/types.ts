/**
 * Core type definitions for TropX Motion Capture System
 * All interfaces and types used across the application
 */

import { ERROR_CODES } from './constants';

// Device State Machine Types
export enum DeviceState {
  SCANNING = 'scanning',
  DISCONNECTED_AVAILABLE = 'disconnected_available',
  CONNECTING = 'connecting', 
  CONNECTED_IDLE = 'connected_idle',
  STREAMING = 'streaming',
  ERROR = 'error'
}

export enum DeviceEvent {
  SCAN_START = 'scan_start',
  DEVICE_FOUND = 'device_found',
  CONNECT_REQUEST = 'connect_request',
  CONNECTED = 'connected',
  STREAM_START = 'stream_start', 
  STREAM_STOP = 'stream_stop',
  DISCONNECT = 'disconnect',
  ERROR_OCCURRED = 'error_occurred',
  RETRY_CONNECTION = 'retry_connection'
}

// Core Data Structures
export interface IMUData {
  timestamp: number;
  quaternion: Quaternion;
  gyroscope: Vector3D;
  accelerometer: Vector3D;
  magnetometer: Vector3D;
}

export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

// Device Management
export interface DeviceInfo {
  id: string;
  name: string;
  state: DeviceState;
  batteryLevel: number | null;
  signalStrength?: number;
  lastUpdate: number;
  connectionAttempts: number;
  error?: AppError;
}

export interface DeviceConnection {
  device: BluetoothDevice;
  server?: BluetoothRemoteGATTServer;
  service?: BluetoothRemoteGATTService;
  characteristics?: {
    command: BluetoothRemoteGATTCharacteristic;
    data: BluetoothRemoteGATTCharacteristic;
  };
}

// State Machine
export interface StateTransition {
  from: DeviceState;
  to: DeviceState;
  event: DeviceEvent;
  guard?: (context: DeviceContext) => boolean;
  action?: (context: DeviceContext) => Promise<void> | void;
}

export interface DeviceContext {
  deviceId: string;
  device?: BluetoothDevice;
  connection?: DeviceConnection;
  error?: AppError;
  metadata?: Record<string, unknown>;
}

// WebRTC Data Channel
export interface WebRTCConfig {
  ordered: boolean;
  maxPacketLifeTime?: number;
  maxRetransmits?: number;
  protocol?: string;
  negotiated?: boolean;
  id?: number;
}

export interface WebRTCMessage {
  type: MessageType;
  deviceId: string;
  timestamp: number;
  data: unknown;
  sequence?: number;
}

export enum MessageType {
  IMU_DATA = 'imu_data',
  BATTERY_UPDATE = 'battery_update',
  DEVICE_STATUS = 'device_status',
  HEARTBEAT = 'heartbeat',
  ERROR = 'error',
  CONTROL = 'control'
}

// Motion Processing
export interface JointAngleData {
  jointName: string;
  angle: number;
  timestamp: number;
  confidence: number;
  deviceCount: number;
}

export interface MotionDataPoint {
  current: number;
  max: number;
  min: number;
  rom: number; // Range of motion
  velocity?: number;
  acceleration?: number;
}

export interface MotionData {
  left: MotionDataPoint;
  right: MotionDataPoint;
  timestamp: number;
  frameId: number;
  quality: DataQuality;
}

export enum DataQuality {
  EXCELLENT = 'excellent',
  GOOD = 'good', 
  FAIR = 'fair',
  POOR = 'poor',
  NO_DATA = 'no_data'
}

// High-Performance Data Structures
export interface CircularBuffer<T> {
  buffer: T[];
  head: number;
  tail: number;
  size: number;
  capacity: number;
  isFull: boolean;
}

export interface DataBatch<T> {
  data: T[];
  timestamp: number;
  sequenceStart: number;
  count: number;
}

export interface ObjectPool<T> {
  pool: T[];
  createFn: () => T;
  resetFn: (obj: T) => void;
  maxSize: number;
}

// Error Handling
export interface AppError {
  code: keyof typeof ERROR_CODES;
  message: string;
  timestamp: number;
  deviceId?: string;
  stack?: string;
  context?: Record<string, unknown>;
}

export interface ErrorContext {
  operation: string;
  deviceId?: string;
  additionalInfo?: Record<string, unknown>;
}

// Performance Monitoring
export interface PerformanceMetrics {
  latency: {
    ble: number[];
    webrtc: number[];
    processing: number[];
    ui: number[];
  };
  throughput: {
    samplesPerSecond: number;
    bytesPerSecond: number;
    packetsPerSecond: number;
  };
  quality: {
    packetLoss: number;
    jitter: number;
    outOfOrder: number;
  };
  resources: {
    memoryUsage: number;
    cpuUsage: number;
    batteryDrain: number;
  };
}

// React-specific Types
export interface UseDeviceStateReturn {
  devices: Map<string, DeviceInfo>;
  scanForDevices: () => Promise<void>;
  connectDevice: (deviceId: string) => Promise<void>;
  disconnectDevice: (deviceId: string) => Promise<void>;
  startStreaming: (deviceId: string) => Promise<void>;
  stopStreaming: (deviceId: string) => Promise<void>;
  isScanning: boolean;
  error: AppError | null;
}

export interface UseMotionDataReturn {
  motionData: MotionData | null;
  isStreaming: boolean;
  dataRate: number;
  quality: DataQuality;
  subscribe: (callback: (data: MotionData) => void) => () => void;
}

export interface UseWebRTCReturn {
  isConnected: boolean;
  dataChannel: RTCDataChannel | null;
  connectionState: RTCPeerConnectionState;
  sendData: (message: WebRTCMessage) => void;
  subscribe: (callback: (message: WebRTCMessage) => void) => () => void;
}

// Configuration Interfaces
export interface AppConfig {
  performance: {
    maxSensorHz: number;
    bufferSize: number;
    batchSize: number;
    enableWorkers: boolean;
  };
  ui: {
    updateThrottleMs: number;
    chartUpdateMs: number;
    maxChartPoints: number;
  };
  webrtc: {
    iceServers: RTCIceServer[];
    dataChannelConfig: WebRTCConfig;
  };
  bluetooth: {
    scanTimeout: number;
    connectionTimeout: number;
    maxRetries: number;
  };
}

// Utility Types
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

export type Callback<T> = (data: T) => void;
export type UnsubscribeFn = () => void;
export type AsyncCallback<T> = (data: T) => Promise<void>;

// Event Types for React
export interface DeviceConnectionEvent extends CustomEvent {
  detail: {
    deviceId: string;
    state: DeviceState;
    error?: AppError;
  };
}

export interface MotionDataEvent extends CustomEvent {
  detail: {
    data: MotionData;
    deviceId: string;
  };
}

// Type Guards
export const isIMUData = (data: unknown): data is IMUData => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'timestamp' in data &&
    'quaternion' in data &&
    'gyroscope' in data &&
    'accelerometer' in data &&
    'magnetometer' in data
  );
};

export const isWebRTCMessage = (data: unknown): data is WebRTCMessage => {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'deviceId' in data &&
    'timestamp' in data &&
    'data' in data
  );
};