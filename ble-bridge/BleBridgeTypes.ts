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

// Time synchronization states (prevents double-application of clock offset)
export type DeviceSyncState =
  | 'not_synced'           // Initial state, no sync performed
  | 'rtc_initialized'      // SET_DATETIME sent, coarse sync done
  | 'offset_computed'      // Time sync loop completed, offset calculated
  | 'fully_synced';        // SET_CLOCK_OFFSET sent, device fully synchronized

// TropX device information
export interface TropXDeviceInfo {
  id: string;
  name: string;
  address: string;
  rssi: number;
  state: DeviceConnectionState;
  batteryLevel: number | null;
  lastSeen: Date;
  clockOffset?: number;    // Hardware clock offset for timestamp synchronization (ms)
  syncState?: DeviceSyncState; // Time synchronization state (prevents double-sync)
  timestampUnit?: 'microseconds' | 'milliseconds'; // Timestamp unit used by this device's firmware
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

// Noble peripheral wrapper (legacy - for backwards compatibility)
export interface NoblePeripheralWrapper {
  peripheral: any; // Noble.Peripheral
  deviceInfo: TropXDeviceInfo;
  service: any | null; // Service reference
  commandCharacteristic: any | null;
  dataCharacteristic: any | null;
  isStreaming: boolean;
}

// Import interface types for the unified wrapper
import { IPeripheral, IService, ICharacteristic } from './interfaces/ITransport';

// Unified peripheral wrapper (uses IPeripheral interface)
export interface UnifiedPeripheralWrapper {
  peripheral: IPeripheral;
  deviceInfo: TropXDeviceInfo;
  service: IService | null;
  commandCharacteristic: ICharacteristic | null;
  dataCharacteristic: ICharacteristic | null;
  isStreaming: boolean;
}