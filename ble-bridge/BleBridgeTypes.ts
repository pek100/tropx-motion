/**
 * Simplified BLE Bridge Types - Quaternion-only data streaming
 */

// Quaternion interface for orientation data
export interface Quaternion {
  w: number;  // Scalar component
  x: number;  // i component
  y: number;  // j component
  z: number;  // k component
}

// Simplified motion data - quaternion + timestamp only
export interface MotionData {
  timestamp: number;
  quaternion: Quaternion;
}

// Device connection states
export type DeviceConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'discovered'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'error';

// TropX device information
export interface TropXDeviceInfo {
  id: string;
  name: string;
  address: string;
  rssi: number;
  state: DeviceConnectionState;
  batteryLevel: number | null;
  lastSeen: Date;
}

// BLE scan result
export interface BleScanResult {
  success: boolean;
  devices: TropXDeviceInfo[];
  message?: string;
}

// BLE connection result
export interface BleConnectionResult {
  success: boolean;
  deviceId: string;
  message?: string;
}

// Data streaming callback
export type MotionDataCallback = (deviceId: string, data: MotionData) => void;

// Device event callback
export type DeviceEventCallback = (deviceId: string, event: string, data?: any) => void;

// Noble peripheral wrapper
export interface NoblePeripheralWrapper {
  peripheral: any; // Noble.Peripheral
  deviceInfo: TropXDeviceInfo;
  service: any | null; // Service reference
  commandCharacteristic: any | null;
  dataCharacteristic: any | null;
  isStreaming: boolean;
}