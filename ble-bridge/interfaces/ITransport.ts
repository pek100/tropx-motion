/**
 * BLE Transport Interface
 * Platform-agnostic abstraction for BLE operations
 */

import { EventEmitter } from 'events';

// ─────────────────────────────────────────────────────────────────────────────
// Characteristic Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface CharacteristicProperties {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
}

export interface ICharacteristic extends EventEmitter {
  readonly uuid: string;
  readonly properties: CharacteristicProperties;

  read(): Promise<Buffer>;
  write(data: Buffer, withResponse: boolean): Promise<void>;
  subscribe(): Promise<void>;
  unsubscribe(): Promise<void>;

  // Events: 'data' (Buffer)
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface IService {
  readonly uuid: string;

  discoverCharacteristics(): Promise<ICharacteristic[]>;
  getCharacteristic(uuid: string): Promise<ICharacteristic | null>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Peripheral Interface
// ─────────────────────────────────────────────────────────────────────────────

export type PeripheralState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

export interface IPeripheral extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly rssi: number;
  readonly state: PeripheralState;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  discoverServices(): Promise<IService[]>;
  getService(uuid: string): Promise<IService | null>;

  // Events: 'disconnect', 'rssiUpdate'
}

// ─────────────────────────────────────────────────────────────────────────────
// Discovered Device Info
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveredDevice {
  id: string;
  name: string;
  address: string;
  rssi: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface TransportConfig {
  deviceNamePatterns: string[];
  minRssi: number;
  scanTimeout: number;
}

export interface ITransport extends EventEmitter {
  readonly isInitialized: boolean;
  readonly isScanning: boolean;

  // Lifecycle
  initialize(): Promise<boolean>;
  cleanup(): Promise<void>;

  // Scanning
  startScan(): Promise<void>;
  stopScan(): Promise<void>;

  // Device access
  getDiscoveredDevices(): DiscoveredDevice[];
  getPeripheral(deviceId: string): IPeripheral | null;
  forgetPeripheral(deviceId: string): void;

  // Events:
  // 'deviceDiscovered' (DiscoveredDevice)
  // 'scanStarted'
  // 'scanStopped'
  // 'error' (Error)
}

// ─────────────────────────────────────────────────────────────────────────────
// Transport Events (for type safety)
// ─────────────────────────────────────────────────────────────────────────────

export interface TransportEvents {
  deviceDiscovered: (device: DiscoveredDevice) => void;
  scanStarted: () => void;
  scanStopped: () => void;
  error: (error: Error) => void;
}

export interface PeripheralEvents {
  disconnect: () => void;
  rssiUpdate: (rssi: number) => void;
}

export interface CharacteristicEvents {
  data: (buffer: Buffer) => void;
}
