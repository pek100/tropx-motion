/**
 * BLE Service Factory - Platform-aware BLE implementation selector
 *
 * Windows/Mac: Uses @abandonware/noble (HCI socket) with ParallelStrategy
 * Linux/Raspberry Pi: Uses node-ble (BlueZ via DBus) with SequentialStrategy
 */

import {
  MotionDataCallback,
  DeviceEventCallback,
  BleScanResult,
  BleConnectionResult,
  TropXDeviceInfo
} from './BleBridgeTypes';
import { TropXDevice } from './TropXDevice';
import { getPlatformConfig, isNobleAvailable, isNodeBleAvailable } from './PlatformConfig';
import { ConnectionStrategyType } from './interfaces/IConnectionStrategy';

export interface IBleService {
  // Core lifecycle
  initialize(): Promise<boolean>;
  cleanup(): Promise<void>;

  // Scanning
  startScanning(): Promise<BleScanResult>;
  stopScanning(suppressNext?: boolean): Promise<void>;
  isScanningActive(): boolean;

  // Device discovery & connection
  getDiscoveredDevices(): TropXDeviceInfo[];
  connectToDevice(deviceId: string): Promise<BleConnectionResult>;
  connectToDevices(deviceIds: string[]): Promise<BleConnectionResult[]>;
  disconnectDevice(deviceId: string): Promise<BleConnectionResult>;
  removeDevice(deviceId: string): Promise<{ success: boolean; message?: string }>;

  // Connected devices
  getConnectedDevices(): TropXDeviceInfo[];
  getDeviceInstance(deviceId: string): TropXDevice | null;
  isDeviceActuallyConnected(bleAddress: string): boolean;

  // Streaming
  startGlobalStreaming(): Promise<{
    success: boolean;
    started: number;
    total: number;
    results: any[];
    error?: string;
  }>;
  stopGlobalStreaming(): Promise<{
    success: boolean;
    stopped: number;
    total: number;
  }>;
  stopStreamingAll(): Promise<void>;

  // Battery & diagnostics
  getAllBatteryLevels(): Promise<Map<string, number>>;
  getDeviceState(deviceId: string): {
    state: number;
    stateName: string;
    lastUpdate: number;
  } | null;

  // State polling
  startStatePolling(): void;
  stopStatePolling(): void;

  // Auto-reconnect handled by ReconnectionManager singleton
  // See: ble-management/ReconnectionManager.ts

  // Burst scanning
  enableBurstScanningFor(durationMs: number): void;
  disableBurstScanning(): void;
  setBurstScanningEnabled(enabled: boolean): void;
  isBurstScanningEnabled: boolean;
  isBluetoothReady: boolean;
}

/**
 * Factory function to create appropriate BLE service based on platform
 * Uses UnifiedBLEService with platform-specific transport and strategy
 */
export async function createBleService(
  motionCallback?: MotionDataCallback,
  eventCallback?: DeviceEventCallback
): Promise<IBleService> {
  const config = getPlatformConfig();

  console.log(`[BleServiceFactory] Platform: ${config.platform}`);
  console.log(`[BleServiceFactory] Transport: ${config.transportType}`);
  console.log(`[BleServiceFactory] Strategy: ${config.strategyType}`);

  // Import UnifiedBLEService (always needed)
  const { UnifiedBLEService } = await import('./UnifiedBLEService');

  // Create transport based on platform config
  let transport;
  if (config.transportType === 'noble') {
    if (!isNobleAvailable()) {
      throw new Error('Noble is not available on this system');
    }
    console.log('[BleServiceFactory] Loading NobleTransport...');
    const { NobleTransport } = await import('./transports/NobleTransport');
    transport = new NobleTransport();
  } else {
    if (!isNodeBleAvailable()) {
      throw new Error('node-ble is not available on this system');
    }
    console.log('[BleServiceFactory] Loading NodeBleTransport...');
    const { NodeBleTransport } = await import('./transports/NodeBleTransport');
    transport = new NodeBleTransport();
  }

  // Create strategy based on platform config
  let strategy;
  if (config.strategyType === ConnectionStrategyType.PARALLEL) {
    console.log('[BleServiceFactory] Using ParallelStrategy');
    const { ParallelStrategy } = await import('./strategies/ParallelStrategy');
    strategy = new ParallelStrategy({
      maxRetries: config.timing.gattRetryAttempts,
      retryDelayMs: config.timing.gattRetryDelayMs,
      interConnectionDelayMs: config.timing.interConnectionDelayMs,
    });
  } else {
    console.log('[BleServiceFactory] Using SequentialStrategy');
    const { SequentialStrategy } = await import('./strategies/SequentialStrategy');
    strategy = new SequentialStrategy({
      maxRetries: config.timing.gattRetryAttempts,
      retryDelayMs: config.timing.gattRetryDelayMs,
      interConnectionDelayMs: config.timing.interConnectionDelayMs,
    });
  }

  console.log('[BleServiceFactory] Creating UnifiedBLEService...');
  return new UnifiedBLEService(transport, strategy, motionCallback, eventCallback);
}
