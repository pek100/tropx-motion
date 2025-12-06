/**
 * Noble Transport Implementation
 * Wraps @abandonware/noble for Windows/macOS BLE operations
 *
 * ARCHITECTURE NOTE:
 * This file contains Noble API adapters that follow the same pattern as
 * NodeBleToNobleAdapter.ts. Both transports expose a Noble-compatible API
 * that TropXDevice expects:
 *
 * - NodeBleToNobleAdapter: Adapts node-ble (Linux/Pi) → Noble API
 * - NobleTransport wrappers: Wrap native Noble with unified interface
 *
 * TropXDevice uses Noble's native patterns:
 * - Callback-style methods: connect(callback), discoverServices([], callback)
 * - Async methods: discoverServicesAsync(), writeAsync(), readAsync()
 * - EventEmitter: on('data'), on('disconnect')
 *
 * The wrapper classes (NoblePeripheral, NobleService, NobleCharacteristic)
 * implement IPeripheral/IService/ICharacteristic for internal transport
 * abstraction while also exposing Noble-compatible methods for TropXDevice.
 *
 * @see NodeBleToNobleAdapter.ts for the equivalent node-ble adapter
 * @see TropXDevice.ts for the consumer of these Noble-compatible APIs
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
// Noble Characteristic Adapter
// Wraps native Noble characteristic with unified interface + Noble API compat
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a native Noble characteristic to implement ICharacteristic interface
 * while maintaining Noble API compatibility for TropXDevice.
 *
 * Provides:
 * - ICharacteristic interface (Promise-based): read(), write(), subscribe()
 * - Noble API compat (TropXDevice expects): readAsync(), writeAsync(), subscribeAsync()
 * - EventEmitter: forwards 'data' and 'error' events from native characteristic
 */
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

    // Forward data events from native Noble characteristic
    this.nobleChar.on('data', (data: Buffer) => {
      this.emit('data', data);
    });

    // Forward error events
    this.nobleChar.on('error', (error: Error) => {
      this.emit('error', error);
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

  // ─────────────────────────────────────────────────────────────────────────
  // Noble API compatibility methods (TropXDevice expects these)
  // ─────────────────────────────────────────────────────────────────────────

  async readAsync(): Promise<Buffer> {
    return this.read();
  }

  async writeAsync(data: Buffer, withoutResponse: boolean): Promise<void> {
    // Note: Noble's write() takes withoutResponse as second param
    // withResponse = !withoutResponse
    return this.write(data, !withoutResponse);
  }

  async subscribeAsync(): Promise<void> {
    return this.subscribe();
  }

  async unsubscribeAsync(): Promise<void> {
    return this.unsubscribe();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noble Service Adapter
// Wraps native Noble service with unified interface + Noble API compat
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a native Noble service to implement IService interface
 * while maintaining Noble API compatibility for TropXDevice.
 *
 * Provides:
 * - IService interface (Promise-based): discoverCharacteristics(), getCharacteristic()
 * - Noble API compat: discoverCharacteristics([], callback), discoverCharacteristicsAsync()
 * - Caches discovered characteristics for reuse
 */
class NobleService implements IService {
  readonly uuid: string;
  private characteristics: Map<string, NobleCharacteristic> = new Map();

  constructor(private nobleService: any) {
    this.uuid = nobleService.uuid;
  }

  /**
   * Discover characteristics on the service.
   * Supports both callback-style (for TropXDevice compatibility) and Promise-style.
   * Always returns a Promise to satisfy IService interface, but also calls callback if provided.
   */
  discoverCharacteristics(uuids?: string[], callback?: (error: Error | null, chars: ICharacteristic[]) => void): Promise<ICharacteristic[]> {
    // Handle overloaded signatures
    if (typeof uuids === 'function') {
      callback = uuids as unknown as (error: Error | null, chars: ICharacteristic[]) => void;
      uuids = [];
    }

    const promise = new Promise<ICharacteristic[]>((resolve, reject) => {
      this.nobleService.discoverCharacteristics(uuids || [], (error: Error | null, chars: any[]) => {
        if (error) {
          reject(error);
          return;
        }

        const wrapped = (chars || []).map((c: any) => {
          const wrapper = new NobleCharacteristic(c);
          this.characteristics.set(c.uuid, wrapper);
          return wrapper;
        });
        resolve(wrapped);
      });
    });

    // If callback provided, also call it
    if (callback) {
      const cb = callback;
      promise
        .then(chars => cb(null, chars))
        .catch(error => cb(error, []));
    }

    return promise;
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

  /**
   * Async version of discoverCharacteristics for Noble API compatibility.
   * TropXDevice expects this method signature.
   */
  async discoverCharacteristicsAsync(uuids: string[]): Promise<{ characteristics: ICharacteristic[] }> {
    console.log(`[NobleService] ${this.uuid}: discoverCharacteristicsAsync called`);
    const characteristics = await this.discoverCharacteristics();
    return { characteristics };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Noble Peripheral Adapter
// Wraps native Noble peripheral with unified interface + Noble API compat
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wraps a native Noble peripheral to implement IPeripheral interface
 * while maintaining Noble API compatibility for TropXDevice.
 *
 * Provides:
 * - IPeripheral interface (Promise-based): connect(), disconnect(), discoverServices()
 * - Noble API compat: connect(callback), discoverServices([], callback)
 * - Noble async API: discoverServicesAsync(), disconnectAsync()
 * - EventEmitter: forwards 'disconnect' and 'rssiUpdate' events
 * - Caches discovered services for reuse
 *
 * This is analogous to NodeBleToNobleAdapter but for native Noble peripherals.
 * While NodeBleToNobleAdapter converts node-ble's API to Noble's API,
 * this class wraps Noble's API to satisfy both IPeripheral and Noble patterns.
 */
class NoblePeripheral extends EventEmitter implements IPeripheral {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  private _rssi: number;
  private services: Map<string, NobleService> = new Map();
  private connectionAttemptCount = 0;

  constructor(private noblePeripheral: any) {
    super();
    this.id = noblePeripheral.id;
    this.name = noblePeripheral.advertisement?.localName || 'Unknown';
    this.address = noblePeripheral.address || noblePeripheral.id;
    this._rssi = noblePeripheral.rssi || -100;

    // Forward disconnect events
    this.noblePeripheral.on('disconnect', () => {
      console.log(`[NoblePeripheral] ${this.name}: disconnect event received`);
      this.emit('disconnect');
    });

    // Update RSSI on changes
    this.noblePeripheral.on('rssiUpdate', (rssi: number) => {
      this._rssi = rssi;
      this.emit('rssiUpdate', rssi);
    });

    // Log initial state for debugging
    console.log(`[NoblePeripheral] Created wrapper for ${this.name} (${this.id}), initial state: ${this.noblePeripheral.state}`);
  }

  get rssi(): number {
    return this._rssi;
  }

  get state(): PeripheralState {
    return this.noblePeripheral.state as PeripheralState;
  }

  /** Get underlying Noble peripheral state for debugging */
  getDebugInfo(): { state: string; connectable: boolean; addressType: string } {
    return {
      state: this.noblePeripheral.state,
      connectable: this.noblePeripheral.connectable ?? true,
      addressType: this.noblePeripheral.addressType || 'unknown',
    };
  }

  /**
   * Connect to the peripheral.
   * Supports both callback-style (for TropXDevice compatibility) and Promise-style.
   * Always returns a Promise to satisfy IPeripheral interface, but also calls callback if provided.
   */
  connect(callback?: (error?: Error) => void): Promise<void> {
    this.connectionAttemptCount++;
    const attemptNum = this.connectionAttemptCount;

    console.log(`[NoblePeripheral] ${this.name}: connect() attempt #${attemptNum}, current state: ${this.state}, hasCallback: ${!!callback}`);

    if (this.state === 'connected') {
      console.log(`[NoblePeripheral] ${this.name}: already connected, skipping`);
      if (callback) {
        callback();
      }
      return Promise.resolve();
    }

    // Log if peripheral is in an unexpected state
    if (this.state !== 'disconnected') {
      console.warn(`[NoblePeripheral] ${this.name}: unexpected state before connect: ${this.state}`);
    }

    const promise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error(`[NoblePeripheral] ${this.name}: connection timeout (30s) on attempt #${attemptNum}, state: ${this.state}`);
        reject(new Error(`Connection timeout (30s), state: ${this.state}`));
      }, 30000);

      console.log(`[NoblePeripheral] ${this.name}: calling noble.connect()...`);

      this.noblePeripheral.connect((error?: Error) => {
        clearTimeout(timeout);
        if (error) {
          console.error(`[NoblePeripheral] ${this.name}: connect callback error on attempt #${attemptNum}:`, error.message);
          reject(error);
        } else {
          console.log(`[NoblePeripheral] ${this.name}: connect callback success, new state: ${this.state}`);
          resolve();
        }
      });
    });

    // If callback provided, also call it
    if (callback) {
      promise
        .then(() => callback())
        .catch(err => callback(err));
    }

    return promise;
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

  /**
   * Async version of disconnect for Noble API compatibility.
   * TropXDevice expects this method signature.
   */
  async disconnectAsync(): Promise<void> {
    console.log(`[NoblePeripheral] ${this.name}: disconnectAsync called, state: ${this.state}`);
    return this.disconnect();
  }

  /**
   * Discover services on the peripheral.
   * Supports both callback-style (for TropXDevice compatibility) and Promise-style.
   * Always returns a Promise to satisfy IPeripheral interface, but also calls callback if provided.
   */
  discoverServices(uuids?: string[], callback?: (error: Error | null, services: IService[]) => void): Promise<IService[]> {
    // Handle overloaded signatures
    if (typeof uuids === 'function') {
      callback = uuids as unknown as (error: Error | null, services: IService[]) => void;
      uuids = [];
    }

    const promise = new Promise<IService[]>((resolve, reject) => {
      this.noblePeripheral.discoverServices(uuids || [], (error: Error | null, services: any[]) => {
        if (error) {
          reject(error);
          return;
        }

        const wrapped = (services || []).map((s: any) => {
          const wrapper = new NobleService(s);
          this.services.set(s.uuid, wrapper);
          return wrapper;
        });
        resolve(wrapped);
      });
    });

    // If callback provided, also call it
    if (callback) {
      const cb = callback;
      promise
        .then(services => cb(null, services))
        .catch(error => cb(error, []));
    }

    return promise;
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

  /**
   * Async version of discoverServices for Noble API compatibility.
   * TropXDevice expects this method signature.
   */
  async discoverServicesAsync(uuids: string[]): Promise<{ services: IService[] }> {
    console.log(`[NoblePeripheral] ${this.name}: discoverServicesAsync called`);
    const services = await this.discoverServices();
    return { services };
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

  /**
   * Forget a peripheral - attempts clean disconnect before removing from cache.
   * This helps prevent stale Noble peripheral state on Windows.
   */
  async forgetPeripheral(deviceId: string): Promise<void> {
    const peripheral = this.discoveredPeripherals.get(deviceId);
    if (!peripheral) {
      console.log(`[NobleTransport] forgetPeripheral: ${deviceId} not in cache`);
      return;
    }

    const debugInfo = (peripheral as any).getDebugInfo?.() || { state: peripheral.state };
    console.log(`[NobleTransport] Forgetting peripheral: ${peripheral.name} (${deviceId}), state: ${debugInfo.state}`);

    // Try to disconnect if not already disconnected
    // This helps clean up Noble's internal state
    if (peripheral.state !== 'disconnected') {
      try {
        console.log(`[NobleTransport] ${peripheral.name}: disconnecting before forget (state: ${peripheral.state})`);
        await peripheral.disconnect();
        console.log(`[NobleTransport] ${peripheral.name}: disconnect complete`);
      } catch (error) {
        console.warn(`[NobleTransport] ${peripheral.name}: disconnect before forget failed:`, error);
        // Continue with removal even if disconnect fails
      }
    }

    this.discoveredPeripherals.delete(deviceId);
    console.log(`[NobleTransport] ${peripheral.name}: removed from cache`);
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

    // Check if device is already discovered (Noble fires discover for every advertisement)
    const existingPeripheral = this.discoveredPeripherals.get(noblePeripheral.id);
    if (existingPeripheral) {
      // Already known - just update RSSI, don't re-emit deviceDiscovered
      // This prevents the ERROR → DISCOVERED loop on Windows
      return;
    }

    console.log(`[NobleTransport] Discovered: ${deviceName} (${noblePeripheral.id}, RSSI: ${noblePeripheral.rssi})`);

    // Wrap and store
    const wrapped = new NoblePeripheral(noblePeripheral);
    this.discoveredPeripherals.set(noblePeripheral.id, wrapped);

    // Emit event only for NEW discoveries
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
