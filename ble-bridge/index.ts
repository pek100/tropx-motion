/**
 * BLE Bridge - Noble-based Bluetooth Low Energy implementation
 *
 * Public API exports for TropX device communication
 */

// Main service class
export { NobleBluetoothService } from './NobleBluetoothService';

// Device protocol handler
export { TropXDevice } from './TropXDevice';

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

// Import types and class for factory function
import type { MotionDataCallback, DeviceEventCallback } from './BleBridgeTypes';
import { NobleBluetoothService } from './NobleBluetoothService';

// Factory function for easy initialization
export function createNobleBluetoothService(
  motionCallback?: MotionDataCallback,
  eventCallback?: DeviceEventCallback
): NobleBluetoothService {
  return new NobleBluetoothService(motionCallback, eventCallback);
}