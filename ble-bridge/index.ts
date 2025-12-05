/**
 * BLE Bridge - Platform-aware Bluetooth Low Energy implementation
 *
 * Windows/Mac: Uses @abandonware/noble (HCI socket) with ParallelStrategy
 * Linux/Raspberry Pi: Uses node-ble (BlueZ via DBus) with SequentialStrategy
 *
 * Public API exports for TropX device communication
 */

// ─────────────────────────────────────────────────────────────────────────────
// Unified BLE Service (main export)
// ─────────────────────────────────────────────────────────────────────────────

export { UnifiedBLEService } from './UnifiedBLEService';

// ─────────────────────────────────────────────────────────────────────────────
// Device protocol handler
// ─────────────────────────────────────────────────────────────────────────────

export { TropXDevice } from './TropXDevice';

// ─────────────────────────────────────────────────────────────────────────────
// Platform-aware factory (recommended way to create BLE service)
// ─────────────────────────────────────────────────────────────────────────────

export { createBleService } from './BleServiceFactory';
export type { IBleService } from './BleServiceFactory';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export type {
  ITransport,
  IPeripheral,
  IService,
  ICharacteristic,
  PeripheralState,
  DiscoveredDevice,
  TransportConfig,
} from './interfaces/ITransport';

export {
  ConnectionStrategyType,
  DEFAULT_STRATEGY_CONFIG,
} from './interfaces/IConnectionStrategy';

export type {
  IConnectionStrategy,
  ConnectionResult,
  StrategyConfig,
} from './interfaces/IConnectionStrategy';

// ─────────────────────────────────────────────────────────────────────────────
// Transports
// ─────────────────────────────────────────────────────────────────────────────

export { NobleTransport } from './transports/NobleTransport';
export { NodeBleTransport } from './transports/NodeBleTransport';

// ─────────────────────────────────────────────────────────────────────────────
// Connection strategies
// ─────────────────────────────────────────────────────────────────────────────

export { ParallelStrategy } from './strategies/ParallelStrategy';
export { SequentialStrategy } from './strategies/SequentialStrategy';

// ─────────────────────────────────────────────────────────────────────────────
// Platform configuration
// ─────────────────────────────────────────────────────────────────────────────

export {
  detectPlatform,
  isRaspberryPi,
  getPlatformConfig,
  getConfigForTransport,
  isNobleAvailable,
  isNodeBleAvailable,
} from './PlatformConfig';

export type {
  PlatformType,
  TransportType,
  BLEPlatformConfig,
} from './PlatformConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Type definitions
// ─────────────────────────────────────────────────────────────────────────────

export type {
  Quaternion,
  MotionData,
  TropXDeviceInfo,
  DeviceConnectionState,
  DeviceSyncState,
  BleScanResult,
  BleConnectionResult,
  MotionDataCallback,
  DeviceEventCallback,
  NoblePeripheralWrapper,
  UnifiedPeripheralWrapper,
} from './BleBridgeTypes';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Legacy exports (deprecated - will be removed in future versions)
// ─────────────────────────────────────────────────────────────────────────────

// Import types for legacy factory function
import type { MotionDataCallback, DeviceEventCallback } from './BleBridgeTypes';
import { createBleService } from './BleServiceFactory';

/**
 * @deprecated Use createBleService() instead
 */
export async function createNobleBluetoothService(
  motionCallback?: MotionDataCallback,
  eventCallback?: DeviceEventCallback
): Promise<any> {
  console.warn('[ble-bridge] createNobleBluetoothService is deprecated, use createBleService instead');
  return await createBleService(motionCallback, eventCallback);
}