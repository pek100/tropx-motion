/**
 * BLE Service Factory - Platform-aware BLE implementation selector
 *
 * Windows/Mac: Uses @abandonware/noble (HCI socket)
 * Linux/Raspberry Pi: Uses node-ble (BlueZ via DBus)
 */

import os from 'os';
import { MotionDataCallback, DeviceEventCallback } from './BleBridgeTypes';

export interface IBleService {
  initialize(): Promise<boolean>;
  startScanning(): Promise<any>;
  stopScanning(suppressNext?: boolean): Promise<void>;
  connectToDevice(deviceId: string): Promise<any>;
  connectToDevices(deviceIds: string[]): Promise<any[]>;
  disconnectDevice(deviceId: string): Promise<any>;
  getDiscoveredDevices(): any[];
  getConnectedDevices(): any[];
  startGlobalStreaming(): Promise<any>;
  stopGlobalStreaming(): Promise<any>;
  cleanup(): Promise<void>;
  // ... other common methods
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
