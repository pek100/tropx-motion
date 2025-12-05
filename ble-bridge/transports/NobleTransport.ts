/**
 * Noble Transport Implementation
 * Wraps @abandonware/noble for Windows/macOS BLE operations
 */

import { EventEmitter } from 'events';
import {
  ITransport,
  IPeripheral,
  IService,
  ICharacteristic,
  PeripheralState,
  DiscoveredDevice,
  TransportConfig,
  CharacteristicProperties,
} from '../interfaces/ITransport';
import { BLE_CONFIG } from '../BleBridgeConstants';

// Noble will be dynamically loaded
let noble: any = null;

// ─────────────────────────────────────────────────────────────────────────────
// Noble Characteristic Wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NobleCharacteristic extends EventEmitter implements ICharacteristic {
  readonly uuid: string;
  readonly properties: CharacteristicProperties;

  constructor(private nobleChar: any) {
    super();
    this.uuid = nobleChar.uuid;
    this.properties = {
      read: nobleChar.properties?.includes('read') ?? false,
      write: nobleChar.properties?.includes('write') ?? false,
      writeWithoutResponse: nobleChar.properties?.includes('writeWithoutResponse') ?? false,
      notify: nobleChar.properties?.includes('notify') ?? false,
      indicate: nobleChar.properties?.includes('indicate') ?? false,
    };

    // Forward data events
    this.nobleChar.on('data', (data: Buffer) => {
      this.emit('data', data);
    });
  }

  async read(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.nobleChar.read((error: Error | null, data: Buffer) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
  }

  async write(data: Buffer, withResponse: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.nobleChar.write(data, !withResponse, (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async subscribe(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.nobleChar.subscribe((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async unsubscribe(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.nobleChar.unsubscribe((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noble Service Wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NobleService implements IService {
  readonly uuid: string;
  private characteristics: Map<string, NobleCharacteristic> = new Map();

  constructor(private nobleService: any) {
    this.uuid = nobleService.uuid;
  }

  async discoverCharacteristics(): Promise<ICharacteristic[]> {
    return new Promise((resolve, reject) => {
      this.nobleService.discoverCharacteristics([], (error: Error | null, chars: any[]) => {
        if (error) {
          reject(error);
          return;
        }

        const wrapped = (chars || []).map(c => {
          const wrapper = new NobleCharacteristic(c);
          this.characteristics.set(c.uuid, wrapper);
          return wrapper;
        });
        resolve(wrapped);
      });
    });
  }

  async getCharacteristic(uuid: string): Promise<ICharacteristic | null> {
    // Normalize UUID (remove dashes)
    const normalizedUuid = uuid.replace(/-/g, '');

    // Check cache first
    if (this.characteristics.has(normalizedUuid)) {
      return this.characteristics.get(normalizedUuid)!;
    }

    // Discover if not cached
    await this.discoverCharacteristics();
    return this.characteristics.get(normalizedUuid) || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noble Peripheral Wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NoblePeripheral extends EventEmitter implements IPeripheral {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  private _rssi: number;
  private services: Map<string, NobleService> = new Map();

  constructor(private noblePeripheral: any) {
    super();
    this.id = noblePeripheral.id;
    this.name = noblePeripheral.advertisement?.localName || 'Unknown';
    this.address = noblePeripheral.address || noblePeripheral.id;
    this._rssi = noblePeripheral.rssi || -100;

    // Forward disconnect events
    this.noblePeripheral.on('disconnect', () => {
      this.emit('disconnect');
    });

    // Update RSSI on changes
    this.noblePeripheral.on('rssiUpdate', (rssi: number) => {
      this._rssi = rssi;
      this.emit('rssiUpdate', rssi);
    });
  }

  get rssi(): number {
    return this._rssi;
  }

  get state(): PeripheralState {
    return this.noblePeripheral.state as PeripheralState;
  }

  async connect(): Promise<void> {
    if (this.state === 'connected') return;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout (60s)'));
      }, 60000);

      this.noblePeripheral.connect((error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.state === 'disconnected') return;

    return new Promise((resolve, reject) => {
      this.noblePeripheral.disconnect((error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async discoverServices(): Promise<IService[]> {
    return new Promise((resolve, reject) => {
      this.noblePeripheral.discoverServices([], (error: Error | null, services: any[]) => {
        if (error) {
          reject(error);
          return;
        }

        const wrapped = (services || []).map(s => {
          const wrapper = new NobleService(s);
          this.services.set(s.uuid, wrapper);
          return wrapper;
        });
        resolve(wrapped);
      });
    });
  }

  async getService(uuid: string): Promise<IService | null> {
    // Normalize UUID (remove dashes)
    const normalizedUuid = uuid.replace(/-/g, '');

    // Check cache first
    if (this.services.has(normalizedUuid)) {
      return this.services.get(normalizedUuid)!;
    }

    // Discover if not cached
    await this.discoverServices();
    return this.services.get(normalizedUuid) || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noble Transport
// ─────────────────────────────────────────────────────────────────────────────

export class NobleTransport extends EventEmitter implements ITransport {
  private _isInitialized = false;
  private _isScanning = false;
  private discoveredPeripherals: Map<string, NoblePeripheral> = new Map();
  private scanTimer: NodeJS.Timeout | null = null;
  private config: TransportConfig;

  constructor(config?: Partial<TransportConfig>) {
    super();
    this.config = {
      deviceNamePatterns: config?.deviceNamePatterns ?? [...BLE_CONFIG.DEVICE_PATTERNS],
      minRssi: config?.minRssi ?? BLE_CONFIG.MIN_RSSI,
      scanTimeout: config?.scanTimeout ?? BLE_CONFIG.SCAN_TIMEOUT,
    };
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  get isScanning(): boolean {
    return this._isScanning;
  }

  async initialize(): Promise<boolean> {
    try {
      console.log('[NobleTransport] Initializing...');

      // Load Noble
      try {
        noble = require('@abandonware/noble');
        console.log('[NobleTransport] Noble library loaded');
      } catch (error) {
        console.error('[NobleTransport] Noble not available:', error);
        return false;
      }

      // Setup event handlers
      this.setupNobleEvents();

      // Wait for Bluetooth to be ready
      await this.waitForBluetoothReady();

      this._isInitialized = true;
      console.log('[NobleTransport] Initialized successfully');
      return true;

    } catch (error) {
      console.error('[NobleTransport] Initialization failed:', error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    console.log('[NobleTransport] Cleaning up...');

    if (this._isScanning) {
      await this.stopScan();
    }

    // Disconnect all peripherals
    for (const peripheral of this.discoveredPeripherals.values()) {
      try {
        if (peripheral.state === 'connected') {
          await peripheral.disconnect();
        }
      } catch (error) {
        console.warn('[NobleTransport] Error disconnecting peripheral:', error);
      }
    }

    this.discoveredPeripherals.clear();
    this._isInitialized = false;
    console.log('[NobleTransport] Cleanup complete');
  }

  async startScan(): Promise<void> {
    if (!this._isInitialized || !noble) {
      throw new Error('Transport not initialized');
    }

    if (this._isScanning) {
      console.log('[NobleTransport] Already scanning');
      return;
    }

    console.log(`[NobleTransport] Starting scan for: ${this.config.deviceNamePatterns.join(', ')}`);
    this._isScanning = true;

    await noble.startScanningAsync([], false);
    this.emit('scanStarted');

    // Auto-stop after timeout
    this.scanTimer = setTimeout(async () => {
      await this.stopScan();
    }, this.config.scanTimeout);
  }

  async stopScan(): Promise<void> {
    if (!this._isScanning || !noble) return;

    console.log('[NobleTransport] Stopping scan...');

    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }

    try {
      await noble.stopScanningAsync();
    } catch (error) {
      console.warn('[NobleTransport] Error stopping scan:', error);
    }

    this._isScanning = false;
    this.emit('scanStopped');
    console.log(`[NobleTransport] Scan stopped. Found ${this.discoveredPeripherals.size} devices`);
  }

  getDiscoveredDevices(): DiscoveredDevice[] {
    return Array.from(this.discoveredPeripherals.values()).map(p => ({
      id: p.id,
      name: p.name,
      address: p.address,
      rssi: p.rssi,
    }));
  }

  getPeripheral(deviceId: string): IPeripheral | null {
    return this.discoveredPeripherals.get(deviceId) || null;
  }

  forgetPeripheral(deviceId: string): void {
    const peripheral = this.discoveredPeripherals.get(deviceId);
    if (peripheral) {
      console.log(`[NobleTransport] Forgetting peripheral: ${peripheral.name} (${deviceId})`);
      this.discoveredPeripherals.delete(deviceId);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────

  private setupNobleEvents(): void {
    noble.on('stateChange', (state: string) => {
      console.log(`[NobleTransport] Bluetooth state: ${state}`);
      if (state !== 'poweredOn' && this._isScanning) {
        this.stopScan().catch(console.error);
      }
    });

    noble.on('discover', (peripheral: any) => {
      this.handleDeviceDiscovered(peripheral);
    });

    noble.on('scanStart', () => {
      console.log('[NobleTransport] Noble scan started');
    });

    noble.on('scanStop', () => {
      console.log('[NobleTransport] Noble scan stopped');
      this._isScanning = false;
    });
  }

  private handleDeviceDiscovered(noblePeripheral: any): void {
    const deviceName = noblePeripheral.advertisement?.localName || '';
    const nameLower = deviceName.toLowerCase();

    // Filter by name pattern
    const isTargetDevice = this.config.deviceNamePatterns.some(pattern =>
      nameLower.includes(pattern.toLowerCase())
    );

    if (!isTargetDevice) return;

    // Filter by RSSI
    if (noblePeripheral.rssi < this.config.minRssi) {
      console.log(`[NobleTransport] Weak signal: ${deviceName} (RSSI ${noblePeripheral.rssi})`);
      return;
    }

    console.log(`[NobleTransport] Discovered: ${deviceName} (${noblePeripheral.id}, RSSI: ${noblePeripheral.rssi})`);

    // Wrap and store
    const wrapped = new NoblePeripheral(noblePeripheral);
    this.discoveredPeripherals.set(noblePeripheral.id, wrapped);

    // Emit event
    this.emit('deviceDiscovered', {
      id: wrapped.id,
      name: wrapped.name,
      address: wrapped.address,
      rssi: wrapped.rssi,
    });
  }

  private waitForBluetoothReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (noble.state === 'poweredOn') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('Bluetooth adapter timeout (15s)'));
      }, 15000);

      const stateChangeHandler = (state: string) => {
        console.log(`[NobleTransport] Bluetooth state during init: ${state}`);
        if (state === 'poweredOn') {
          clearTimeout(timeout);
          noble.removeListener('stateChange', stateChangeHandler);
          resolve();
        }
      };

      noble.on('stateChange', stateChangeHandler);
    });
  }
}
