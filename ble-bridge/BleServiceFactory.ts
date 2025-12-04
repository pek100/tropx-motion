/**
 * BLE Service Factory - Platform-aware BLE implementation selector
 *
 * Windows/Mac: Uses @abandonware/noble (HCI socket)
 * Linux/Raspberry Pi: Uses node-ble (BlueZ via DBus)
 */

import os from 'os';
import {
  MotionDataCallback,
  DeviceEventCallback,
  BleScanResult,
  BleConnectionResult,
  TropXDeviceInfo
} from './BleBridgeTypes';
import { TropXDevice } from './TropXDevice';

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
 */
export async function createBleService(
  motionCallback?: MotionDataCallback,
  eventCallback?: DeviceEventCallback
): Promise<IBleService> {
  const platform = os.platform();

  console.log(`🔍 Detecting platform: ${platform}`);

  if (platform === 'linux') {
    console.log('✅ Linux detected - using node-ble (BlueZ via DBus)');
    const { NodeBleService } = await import('./NodeBleService');
    return new NodeBleService(motionCallback, eventCallback);
  } else if (platform === 'darwin' || platform === 'win32') {
    console.log(`✅ ${platform === 'darwin' ? 'macOS' : 'Windows'} detected - using @abandonware/noble (HCI)`);
    const { NobleBluetoothService } = await import('./NobleBluetoothService');
    return new NobleBluetoothService(motionCallback, eventCallback);
  } else {
    throw new Error(`Unsupported platform: ${platform}`);
  }
}
