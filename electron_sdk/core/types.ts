// electron_sdk/core/types.ts
// Shared interfaces and types for the Electron BLE SDK

import type { DeviceInfo, ApiResponse } from '../shared/types';
import type { IMUData } from '../../muse_sdk/core/MuseData';

// Device states in the ElectronBLE system
export type ElectronDeviceState = 
  | "discovered" 
  | "connecting" 
  | "connected" 
  | "streaming" 
  | "disconnected" 
  | "error";

// Unified device representation in the ElectronBLE system
export interface ElectronDevice {
  id: string;
  name: string;
  state: ElectronDeviceState;
  batteryLevel: number | null;
  lastSeen: Date;
  errorMessage?: string;
}

// ElectronBLE operation results
export interface ElectronBLEResult {
  success: boolean;
  message?: string;
  data?: any;
}

// Device scanning result
export interface DeviceScanResult extends ElectronBLEResult {
  devices: ElectronDevice[];
}

// Device connection result
export interface DeviceConnectionResult extends ElectronBLEResult {
  deviceId: string;
  deviceName: string;
  connected: boolean;
}

// Recording session data
export interface RecordingSessionData {
  sessionId: string;
  exerciseId: string;
  setNumber: number;
}

// Recording operation result
export interface RecordingResult extends ElectronBLEResult {
  isRecording: boolean;
  startTime?: Date | null;
}

// Streaming data callback type
export type StreamingDataCallback = (deviceName: string, data: IMUData) => void;

// Device state change callback type  
export type DeviceStateChangeCallback = (deviceId: string, device: ElectronDevice) => void;

// Battery level update callback type
export type BatteryUpdateCallback = (deviceId: string, batteryLevel: number) => void;

// ElectronBLE Manager interface
export interface IElectronBLEManager {
  // Device discovery
  scanDevices(): Promise<DeviceScanResult>;
  cancelScan(): Promise<ElectronBLEResult>;
  
  // Device connection
  connectDevice(deviceId: string, deviceName: string): Promise<DeviceConnectionResult>;
  connectAllDevices(): Promise<ElectronBLEResult>;
  disconnectDevice(deviceId: string): Promise<ElectronBLEResult>;
  
  // Recording operations
  startRecording(sessionData: RecordingSessionData): Promise<RecordingResult>;
  stopRecording(): Promise<RecordingResult>;
  
  // Device state management
  getDevices(): Map<string, ElectronDevice>;
  getDevice(deviceId: string): ElectronDevice | null;
  isDeviceConnected(deviceId: string): boolean;
  
  // Event handling
  onDeviceStateChange(callback: DeviceStateChangeCallback): () => void;
  onBatteryUpdate(callback: BatteryUpdateCallback): () => void;
  onStreamingData(callback: StreamingDataCallback): () => void;
  
  // Cleanup
  cleanup(): Promise<void>;
}

// ElectronDevice Registry interface
export interface IElectronDeviceRegistry {
  // Device management
  addDevice(device: ElectronDevice): void;
  updateDevice(deviceId: string, updates: Partial<ElectronDevice>): void;
  removeDevice(deviceId: string): void;
  clearDevices(): void;
  
  // Device queries
  getDevice(deviceId: string): ElectronDevice | null;
  getDevices(): Map<string, ElectronDevice>;
  getDevicesByState(state: ElectronDeviceState): ElectronDevice[];
  getConnectedDevices(): ElectronDevice[];
  
  // State transitions
  transitionDeviceState(deviceId: string, newState: ElectronDeviceState): void;
  
  // Event handling
  onDeviceChange(callback: DeviceStateChangeCallback): () => void;
}

// ElectronIPC Handler interface
export interface IElectronIPCHandler {
  // Motion operations
  getWebSocketPort(): Promise<number>;
  startRecording(sessionData: RecordingSessionData): Promise<ApiResponse>;
  stopRecording(): Promise<ApiResponse>;
  
  // Bluetooth operations
  selectDevice(deviceId: string): Promise<ApiResponse>;
  
  // Window operations
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}

// Feature flags for incremental migration
export interface ElectronBLEFeatureFlags {
  USE_ELECTRON_BLE_SCAN: boolean;
  USE_ELECTRON_BLE_CONNECT: boolean;
  USE_ELECTRON_BLE_RECORD: boolean;
}

// Default feature flags (all disabled for safe rollout)
export const DEFAULT_FEATURE_FLAGS: ElectronBLEFeatureFlags = {
  USE_ELECTRON_BLE_SCAN: false,
  USE_ELECTRON_BLE_CONNECT: false,
  USE_ELECTRON_BLE_RECORD: false,
};