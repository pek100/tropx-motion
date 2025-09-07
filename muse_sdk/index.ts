/**
 * SDK Entry Point
 * 
 * This file serves as the main entry point for the Muse SDK, providing access
 * to all functionality through a well-organized interface. We carefully structure
 * our exports to ensure TypeScript can properly track types and dependencies.
 */

import { MuseHardware } from './core/MuseHardware';
import { MuseCommands } from './core/Commands';
import { DebugLogger } from './core/Debug';
import {
  Vector3D,
  IMUData,
  SensorConfig,
  ConnectionState,
  StreamCallback,
  BluetoothDeviceHook,
  MuseDataParser
} from './core/MuseData';

// First, we export all our types and interfaces as named exports
export type {
  Vector3D,
  IMUData,
  SensorConfig,
  ConnectionState,
  StreamCallback,
  BluetoothDeviceHook
};

// Next, we export the MuseDataParser as a named export
export { MuseDataParser };

/**
 * Main SDK class providing access to all Muse device functionality.
 * We'll export this as both a named export and the default export.
 */
export class MuseSDK {
  // Core functionality accessed as static properties
  public static readonly Hardware = MuseHardware;
  public static readonly Commands = MuseCommands;
  public static readonly Debug = DebugLogger;
  
  // We also expose the DataParser through the SDK class for convenience
  public static readonly DataParser = MuseDataParser;

  /**
   * Configuration settings used throughout the SDK
   */
  public static readonly Config = {
    BLE: MuseHardware.BLEConfig,
    Timing: MuseHardware.Timing,
    Sensors: MuseHardware.DefaultConfigs,
    DataModes: MuseHardware.DataMode,
    Frequencies: MuseHardware.DataFrequency
  } as const;

  /**
   * Helper functions for working with device data
   */
  public static readonly Helpers = {
    formatHexString(data: Uint8Array): string {
      return Array.from(data)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
    },
    validatePacket(data: Uint8Array, expectedSize: number): boolean {
      return data.length === expectedSize;
    }
  } as const;
}

// Finally, we export the MuseSDK class as the default export
export default MuseSDK;