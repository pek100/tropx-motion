/**
 * BLE Bridge - Platform-aware Bluetooth Low Energy implementation
 *
 * Windows/Mac: Uses @abandonware/noble (HCI socket)
 * Linux/Raspberry Pi: Uses node-ble (BlueZ via DBus)
 *
 * Public API exports for TropX device communication
 */

// Main service classes
export { NobleBluetoothService } from './NobleBluetoothService';
export { NodeBleService } from './NodeBleService';

// Device protocol handler
export { TropXDevice } from './TropXDevice';

// Platform-aware factory
export { createBleService } from './BleServiceFactory';
export type { IBleService } from './BleServiceFactory';

// Type definitions
export type {
  Quaternion,
  MotionData,
  TropXDeviceInfo,
  DeviceConnectionState,
  BleScanResult,
  BleConnectionResult,
  MotionDataCallback,
  DeviceEventCallback,
  NoblePeripheralWrapper
} from './BleBridgeTypes';

// Constants
export {
  BLE_CONFIG,
  TROPX_COMMANDS,
  TROPX_STATES,
  DATA_MODES,
  DATA_FREQUENCIES,
  PACKET_SIZES,
  QUATERNION_SCALE,
  TIMING
} from './BleBridgeConstants';

// Import types for legacy factory function
import type { MotionDataCallback, DeviceEventCallback } from './BleBridgeTypes';
import { createBleService } from './BleServiceFactory';

// Legacy factory function - now uses platform-aware factory
export async function createNobleBluetoothService(
  motionCallback?: MotionDataCallback,
  eventCallback?: DeviceEventCallback
): Promise<any> {
  return await createBleService(motionCallback, eventCallback);
}