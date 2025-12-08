/**
 * node-ble Transport Implementation
 * Wraps node-ble (BlueZ via DBus) for Linux/Raspberry Pi BLE operations
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

// node-ble will be dynamically loaded
const { createBluetooth } = require('node-ble');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const GATT_RETRY_ATTEMPTS = 3;
const GATT_RETRY_DELAY_MS = 500;
const GATT_STABILIZATION_MS = 200;
const POLL_INTERVAL_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// node-ble Characteristic Wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NodeBleCharacteristic extends EventEmitter implements ICharacteristic {
  readonly uuid: string;
  private _properties: CharacteristicProperties;

  constructor(private nodeBleChar: any, uuid: string) {
    super();
    // Normalize UUID (remove dashes for consistency with Noble)
    this.uuid = uuid.replace(/-/g, '');
    this._properties = {
      read: false,
      write: false,
      writeWithoutResponse: false,
      notify: false,
      indicate: false,
    };

    // Get properties async
    this.initProperties();
  }

  get properties(): CharacteristicProperties {
    return this._properties;
  }

  private async initProperties(): Promise<void> {
    try {
      const flags = await this.nodeBleChar.getFlags();
      this._properties = {
        read: flags.includes('read'),
        write: flags.includes('write'),
        writeWithoutResponse: flags.includes('write-without-response'),
        notify: flags.includes('notify'),
        indicate: flags.includes('indicate'),
      };
    } catch (error) {
      // Default properties on error
      this._properties = { read: true, write: true, writeWithoutResponse: true, notify: true, indicate: false };
    }
  }

  // ICharacteristic interface methods (Promise-based)
  async read(): Promise<Buffer> {
    return await this.nodeBleChar.readValue();
  }

  async write(data: Buffer, withResponse: boolean): Promise<void> {
    console.log(`📝 [NodeBleChar] write: uuid=${this.uuid}, withResponse=${withResponse}`);
    try {
      if (withResponse) {
        console.log(`📝 [NodeBleChar] Calling writeValueWithResponse...`);
        await this.nodeBleChar.writeValueWithResponse(data);
      } else {
        console.log(`📝 [NodeBleChar] Calling writeValueWithoutResponse...`);
        await this.nodeBleChar.writeValueWithoutResponse(data);
      }
      console.log(`✅ [NodeBleChar] write completed for uuid=${this.uuid}`);
    } catch (error) {
      console.error(`❌ [NodeBleChar] write failed for uuid=${this.uuid}:`, error);
      throw error;
    }
  }

  async subscribe(): Promise<void> {
    console.log(`🔔 [NodeBleChar] subscribe: Starting notifications for uuid=${this.uuid}...`);
    try {
      await this.nodeBleChar.startNotifications();
      console.log(`✅ [NodeBleChar] startNotifications completed for uuid=${this.uuid}`);

      // Forward value changes as 'data' events
      this.nodeBleChar.removeAllListeners('valuechanged');
      this.nodeBleChar.on('valuechanged', (buffer: Buffer) => {
        console.log(`📨 [NodeBleChar] valuechanged event for uuid=${this.uuid}, ${buffer.length} bytes`);
        this.emit('data', buffer);
      });
      console.log(`🎧 [NodeBleChar] Event listener attached for uuid=${this.uuid}`);
    } catch (error) {
      console.error(`❌ [NodeBleChar] subscribe failed for uuid=${this.uuid}:`, error);
      throw error;
    }
  }

  async unsubscribe(): Promise<void> {
    try {
      await this.nodeBleChar.stopNotifications();
    } catch (error) {
      // Ignore errors when stopping notifications
    }
    this.nodeBleChar.removeAllListeners('valuechanged');
    this.removeAllListeners('data');
  }

  // Noble-compatible async methods (for TropXDevice compatibility)
  async readAsync(): Promise<Buffer> {
    return await this.read();
  }

  async writeAsync(data: Buffer, withoutResponse: boolean): Promise<void> {
    // Note: Noble uses withoutResponse, interface uses withResponse (inverted!)
    console.log(`📝 [NodeBleChar] writeAsync: uuid=${this.uuid}, withoutResponse=${withoutResponse}, bytes=[${Array.from(data).map(b => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`);
    try {
      await this.write(data, !withoutResponse);
      console.log(`✅ [NodeBleChar] writeAsync completed for uuid=${this.uuid}`);
    } catch (error) {
      console.error(`❌ [NodeBleChar] writeAsync failed for uuid=${this.uuid}:`, error);
      throw error;
    }
  }

  async subscribeAsync(): Promise<void> {
    await this.subscribe();
  }

  async unsubscribeAsync(): Promise<void> {
    await this.unsubscribe();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// node-ble Service Wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NodeBleService extends EventEmitter implements IService {
  readonly uuid: string;
  private characteristics: Map<string, NodeBleCharacteristic> = new Map();

  constructor(private nodeBleService: any, uuid: string) {
    super();
    // Normalize UUID
    this.uuid = uuid.replace(/-/g, '');
  }

  // Internal characteristic discovery implementation
  private async discoverCharacteristicsInternal(): Promise<NodeBleCharacteristic[]> {
    const charUUIDs = await this.nodeBleService.characteristics();
    const wrapped: NodeBleCharacteristic[] = [];

    for (const uuid of charUUIDs) {
      try {
        const char = await this.nodeBleService.getCharacteristic(uuid);
        const wrapper = new NodeBleCharacteristic(char, uuid);
        this.characteristics.set(wrapper.uuid, wrapper);
        wrapped.push(wrapper);
      } catch (error) {
        console.warn(`[NodeBleService] Failed to get characteristic ${uuid}:`, error);
      }
    }

    return wrapped;
  }

  // IService interface method - supports both Promise and callback patterns
  // Noble calls: discoverCharacteristics(uuids, callback) or discoverCharacteristicsAsync(uuids)
  // Interface calls: discoverCharacteristics() returning Promise
  discoverCharacteristics(
    uuids?: string[],
    callback?: (error: Error | null, characteristics: NodeBleCharacteristic[]) => void
  ): Promise<ICharacteristic[]> {
    const promise = this.discoverCharacteristicsInternal();

    // If callback provided (Noble pattern), call it when promise resolves/rejects
    if (typeof callback === 'function') {
      promise
        .then(chars => callback(null, chars))
        .catch(error => callback(error, []));
    }

    return promise;
  }

  // Noble-compatible async version (for TropXDevice)
  async discoverCharacteristicsAsync(uuids: string[]): Promise<{ characteristics: NodeBleCharacteristic[] }> {
    const chars = await this.discoverCharacteristicsInternal();
    return { characteristics: chars as NodeBleCharacteristic[] };
  }

  async getCharacteristic(uuid: string): Promise<ICharacteristic | null> {
    const normalizedUuid = uuid.replace(/-/g, '');

    if (this.characteristics.has(normalizedUuid)) {
      return this.characteristics.get(normalizedUuid)!;
    }

    // Discover if not cached
    await this.discoverCharacteristicsInternal();
    return this.characteristics.get(normalizedUuid) || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// node-ble Peripheral Wrapper
// ─────────────────────────────────────────────────────────────────────────────

class NodeBlePeripheral extends EventEmitter implements IPeripheral {
  readonly id: string;
  readonly address: string;
  private _name: string;
  private _rssi: number;
  private _state: PeripheralState = 'disconnected';
  private gattServer: any = null;
  private services: Map<string, NodeBleService> = new Map();

  // Noble-compatible advertisement object
  readonly advertisement: { localName: string };

  constructor(
    private nodeBleDevice: any,
    id: string,
    name: string,
    rssi: number
  ) {
    super();
    this.id = id;
    this.address = id;
    this._name = name;
    this._rssi = rssi;
    this.advertisement = { localName: name };

    // Setup disconnect handler
    this.nodeBleDevice.on('disconnect', () => {
      this._state = 'disconnected';
      this.gattServer = null;
      this.services.clear();
      this.emit('disconnect');
    });
  }

  get name(): string {
    return this._name;
  }

  get rssi(): number {
    return this._rssi;
  }

  get state(): PeripheralState {
    return this._state;
  }

  updateRssi(rssi: number): void {
    if (this._rssi !== rssi) {
      this._rssi = rssi;
      this.emit('rssiUpdate', rssi);
    }
  }

  // IPeripheral interface method - supports both Promise and callback patterns
  // Returns Promise<void> to satisfy interface, but also calls callback if provided (Noble compatibility)
  connect(callback?: (error?: Error) => void): Promise<void> {
    const promise = this.connectInternal();

    // If callback provided (Noble pattern), call it when promise resolves/rejects
    if (typeof callback === 'function') {
      promise.then(() => callback()).catch(error => callback(error));
    }

    return promise;
  }

  // Internal async connect implementation
  private async connectInternal(): Promise<void> {
    if (this._state === 'connected') return;

    this._state = 'connecting';
    console.log(`[NodeBlePeripheral] Connecting to ${this._name}...`);

    try {
      // Step 1: BLE connection
      await this.nodeBleDevice.connect();
      console.log(`[NodeBlePeripheral] BLE connection established for ${this._name}`);

      // Step 2: Get GATT server with retry
      await this.acquireGattServer();

      this._state = 'connected';
      console.log(`[NodeBlePeripheral] Fully connected to ${this._name}`);

    } catch (error) {
      this._state = 'disconnected';
      throw error;
    }
  }

  private async acquireGattServer(): Promise<void> {
    for (let attempt = 0; attempt < GATT_RETRY_ATTEMPTS; attempt++) {
      try {
        // Wait for BlueZ stabilization
        await this.delay(GATT_STABILIZATION_MS);

        console.log(`[NodeBlePeripheral] Getting GATT server (attempt ${attempt + 1}/${GATT_RETRY_ATTEMPTS})...`);
        this.gattServer = await this.nodeBleDevice.gatt();
        console.log(`[NodeBlePeripheral] GATT server acquired`);
        return;

      } catch (error: any) {
        console.warn(`[NodeBlePeripheral] GATT attempt ${attempt + 1} failed:`, error.message || error);

        if (attempt < GATT_RETRY_ATTEMPTS - 1) {
          console.log(`[NodeBlePeripheral] Retrying in ${GATT_RETRY_DELAY_MS}ms...`);
          await this.delay(GATT_RETRY_DELAY_MS);
        } else {
          throw new Error(`Failed to acquire GATT server after ${GATT_RETRY_ATTEMPTS} attempts: ${error.message || error}`);
        }
      }
    }
  }

  // IPeripheral interface method
  async disconnect(): Promise<void> {
    if (this._state === 'disconnected') return;

    this._state = 'disconnecting';
    console.log(`[NodeBlePeripheral] Disconnecting from ${this._name}...`);

    try {
      await this.nodeBleDevice.disconnect();
    } catch (error: any) {
      // "Not Connected" is actually success
      if (!error.type?.includes('NotConnected') && !error.text?.includes('Not Connected')) {
        throw error;
      }
    }

    this._state = 'disconnected';
    this.gattServer = null;
    this.services.clear();
    console.log(`[NodeBlePeripheral] Disconnected from ${this._name}`);
  }

  // Noble-compatible async disconnect
  async disconnectAsync(): Promise<void> {
    return this.disconnect();
  }

  // Internal service discovery implementation
  private async discoverServicesInternal(): Promise<NodeBleService[]> {
    if (!this.gattServer) {
      throw new Error('Not connected - GATT server not available');
    }

    const serviceUUIDs = await this.gattServer.services();
    const wrapped: NodeBleService[] = [];

    for (const uuid of serviceUUIDs) {
      try {
        const service = await this.gattServer.getPrimaryService(uuid);
        const wrapper = new NodeBleService(service, uuid);
        this.services.set(wrapper.uuid, wrapper);
        wrapped.push(wrapper);
      } catch (error) {
        console.warn(`[NodeBlePeripheral] Failed to get service ${uuid}:`, error);
      }
    }

    return wrapped;
  }

  // IPeripheral interface method - supports both Promise and callback patterns
  // Noble calls: discoverServices(uuids, callback) or discoverServicesAsync(uuids)
  // Interface calls: discoverServices() returning Promise
  discoverServices(
    uuids?: string[],
    callback?: (error: Error | null, services: NodeBleService[]) => void
  ): Promise<IService[]> {
    const promise = this.discoverServicesInternal();

    // If callback provided (Noble pattern), call it when promise resolves/rejects
    if (typeof callback === 'function') {
      promise
        .then(services => callback(null, services))
        .catch(error => callback(error, []));
    }

    return promise;
  }

  // Noble-compatible async version (for TropXDevice compatibility)
  async discoverServicesAsync(uuids: string[]): Promise<{ services: NodeBleService[] }> {
    const services = await this.discoverServicesInternal();
    return { services: services as NodeBleService[] };
  }

  async getService(uuid: string): Promise<IService | null> {
    const normalizedUuid = uuid.replace(/-/g, '');

    if (this.services.has(normalizedUuid)) {
      return this.services.get(normalizedUuid)!;
    }

    // Try to get directly if GATT server available
    if (this.gattServer) {
      try {
        const service = await this.gattServer.getPrimaryService(uuid);
        const wrapper = new NodeBleService(service, uuid);
        this.services.set(wrapper.uuid, wrapper);
        return wrapper;
      } catch (error) {
        // Service not found
        return null;
      }
    }

    // Discover all and check
    await this.discoverServicesInternal();
    return this.services.get(normalizedUuid) || null;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// node-ble Transport
// ─────────────────────────────────────────────────────────────────────────────

export class NodeBleTransport extends EventEmitter implements ITransport {
  private bluetooth: any = null;
  private destroy: (() => void) | null = null;
  private adapter: any = null;
  private _isInitialized = false;
  private _isScanning = false;
  private discoveredPeripherals: Map<string, NodeBlePeripheral> = new Map();
  private nodeBleDevices: Map<string, any> = new Map(); // Raw node-ble devices
  private scanTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
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
      console.log('[NodeBleTransport] Initializing...');

      // Create bluetooth instance
      const result = createBluetooth();
      this.bluetooth = result.bluetooth;
      this.destroy = result.destroy;

      // Get default adapter
      this.adapter = await this.bluetooth.defaultAdapter();
      const adapterName = await this.adapter.getName();
      const adapterAddress = await this.adapter.getAddress();

      console.log(`[NodeBleTransport] Adapter: ${adapterName} (${adapterAddress})`);

      // Cleanup zombie devices from previous session
      await this.cleanupZombieDevices();

      this._isInitialized = true;
      console.log('[NodeBleTransport] Initialized successfully');
      return true;

    } catch (error) {
      console.error('[NodeBleTransport] Initialization failed:', error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    console.log('[NodeBleTransport] Cleaning up...');

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
        console.warn('[NodeBleTransport] Error disconnecting peripheral:', error);
      }
    }

    this.discoveredPeripherals.clear();
    this.nodeBleDevices.clear();

    // Destroy bluetooth instance
    if (this.destroy) {
      this.destroy();
      this.destroy = null;
    }

    this._isInitialized = false;
    console.log('[NodeBleTransport] Cleanup complete');
  }

  async startScan(): Promise<void> {
    if (!this._isInitialized || !this.adapter) {
      throw new Error('Transport not initialized');
    }

    if (this._isScanning) {
      console.log('[NodeBleTransport] Already scanning');
      return;
    }

    console.log(`[NodeBleTransport] Starting scan for: ${this.config.deviceNamePatterns.join(', ')}`);

    // Stop any existing discovery
    try {
      await this.adapter.stopDiscovery();
      await this.delay(500);
    } catch (error: any) {
      if (!error.type?.includes('DoesNotExist')) {
        console.warn('[NodeBleTransport] Error stopping existing discovery:', error);
      }
    }

    // Start fresh discovery
    await this.adapter.startDiscovery();
    this._isScanning = true;
    this.emit('scanStarted');

    // Start polling for devices
    this.startPolling();

    // Auto-stop after timeout
    this.scanTimer = setTimeout(async () => {
      await this.stopScan();
    }, this.config.scanTimeout);
  }

  async stopScan(): Promise<void> {
    if (!this._isScanning || !this.adapter) return;

    console.log('[NodeBleTransport] Stopping scan...');

    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }

    this.stopPolling();

    try {
      await this.adapter.stopDiscovery();
    } catch (error) {
      console.warn('[NodeBleTransport] Error stopping discovery:', error);
    }

    this._isScanning = false;
    this.emit('scanStopped');
    console.log(`[NodeBleTransport] Scan stopped. Found ${this.discoveredPeripherals.size} devices`);
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
      console.log(`[NodeBleTransport] Forgetting peripheral: ${peripheral.name} (${deviceId})`);
      this.discoveredPeripherals.delete(deviceId);
      this.nodeBleDevices.delete(deviceId);
    }
  }

  /**
   * Clear GATT cache for a device (Linux/Pi implementation)
   * Removes device from BlueZ adapter to force cache clear on next connection
   */
  async clearDeviceCache(bleAddress: string): Promise<boolean> {
    if (!this.adapter) {
      console.warn('[NodeBleTransport] clearDeviceCache: Adapter not initialized');
      return false;
    }

    try {
      console.log(`[NodeBleTransport] Clearing GATT cache for ${bleAddress}...`);

      // Get device object from BlueZ
      const device = this.nodeBleDevices.get(bleAddress) || await this.adapter.getDevice(bleAddress);
      if (!device) {
        console.warn(`[NodeBleTransport] Device ${bleAddress} not found in BlueZ`);
        return false;
      }

      // Get device name for logging
      let deviceName = bleAddress;
      try {
        deviceName = await device.getName();
      } catch (e) {
        try {
          deviceName = await device.getAlias();
        } catch (e2) {
          // Use address
        }
      }

      // Check if connected
      let isConnected = false;
      try {
        isConnected = await device.getProperty('Connected');
      } catch (e) {
        // Assume not connected
      }

      // Disconnect if connected
      if (isConnected) {
        console.log(`[NodeBleTransport] Disconnecting ${deviceName} before cache clear...`);
        try {
          await device.disconnect();
          await this.delay(500); // Wait for clean disconnect
        } catch (error: any) {
          // Ignore "Not Connected" errors
          if (!error.type?.includes('NotConnected') && !error.text?.includes('Not Connected')) {
            console.warn(`[NodeBleTransport] Disconnect failed for ${deviceName}:`, error);
          }
        }
      }

      // CRITICAL: Remove device from BlueZ adapter
      // This forces BlueZ to clear all cached GATT data (services, characteristics, connection params)
      try {
        console.log(`[NodeBleTransport] Removing ${deviceName} from BlueZ adapter (forces cache clear)...`);
        await this.adapter.removeDevice(device);
        console.log(`[NodeBleTransport] ✅ Device ${deviceName} removed from adapter - cache cleared`);
      } catch (error: any) {
        console.error(`[NodeBleTransport] Failed to remove device ${deviceName} from adapter:`, error);
        return false;
      }

      // Remove from internal caches
      this.discoveredPeripherals.delete(bleAddress);
      this.nodeBleDevices.delete(bleAddress);

      console.log(`[NodeBleTransport] Cache cleared successfully for ${deviceName}`);
      return true;

    } catch (error) {
      console.error(`[NodeBleTransport] clearDeviceCache failed for ${bleAddress}:`, error);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────

  private startPolling(): void {
    if (this.pollTimer) return;

    const poll = async () => {
      if (!this._isScanning) return;

      try {
        await this.pollForDevices();
      } catch (error) {
        console.error('[NodeBleTransport] Polling error:', error);
      }

      if (this._isScanning) {
        this.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollForDevices(): Promise<void> {
    const deviceAddresses = await this.adapter.devices();

    for (const address of deviceAddresses) {
      // Skip already processed
      if (this.discoveredPeripherals.has(address)) {
        // Update RSSI for existing device
        try {
          const device = this.nodeBleDevices.get(address);
          if (device) {
            const rssi = parseInt(await device.getRSSI());
            this.discoveredPeripherals.get(address)?.updateRssi(rssi);
          }
        } catch (e) {
          // RSSI not available
        }
        continue;
      }

      try {
        const device = await this.adapter.getDevice(address);
        this.nodeBleDevices.set(address, device);

        // Get device name
        let name: string;
        try {
          name = await device.getName();
        } catch (e) {
          try {
            name = await device.getAlias();
          } catch (e2) {
            continue; // No name available
          }
        }

        // Filter by name pattern
        const nameLower = name.toLowerCase();
        const isTargetDevice = this.config.deviceNamePatterns.some(pattern =>
          nameLower.includes(pattern.toLowerCase())
        );

        if (!isTargetDevice) continue;

        // Get RSSI
        let rssi = -100;
        try {
          rssi = parseInt(await device.getRSSI());
        } catch (e) {
          // RSSI not available
        }

        // Filter by RSSI
        if (rssi < this.config.minRssi) {
          console.log(`[NodeBleTransport] Weak signal: ${name} (RSSI ${rssi})`);
          continue;
        }

        console.log(`[NodeBleTransport] Discovered: ${name} (${address}, RSSI: ${rssi})`);

        // Create peripheral wrapper
        const peripheral = new NodeBlePeripheral(device, address, name, rssi);
        this.discoveredPeripherals.set(address, peripheral);

        // Emit event
        this.emit('deviceDiscovered', {
          id: peripheral.id,
          name: peripheral.name,
          address: peripheral.address,
          rssi: peripheral.rssi,
        });

      } catch (error) {
        console.warn(`[NodeBleTransport] Error processing device ${address}:`, error);
      }
    }
  }

  private async cleanupZombieDevices(): Promise<void> {
    try {
      console.log('[NodeBleTransport] Cleaning up zombie devices...');

      const deviceAddresses = await this.adapter.devices();
      let cleanedCount = 0;

      for (const address of deviceAddresses) {
        try {
          const device = await this.adapter.getDevice(address);

          // Get device name
          let name = address;
          try {
            name = await device.getName();
          } catch (e) {
            try {
              name = await device.getAlias();
            } catch (e2) {
              // Use address
            }
          }

          // Check if TropX device
          const nameLower = name.toLowerCase();
          const isTropXDevice = this.config.deviceNamePatterns.some(pattern =>
            nameLower.includes(pattern.toLowerCase())
          );

          if (!isTropXDevice) continue;

          // Force disconnect
          try {
            await device.disconnect();
            cleanedCount++;
            console.log(`[NodeBleTransport] Cleaned: ${name}`);
          } catch (error: any) {
            if (error.type?.includes('NotConnected') || error.text?.includes('Not Connected')) {
              // Already disconnected - good
            } else {
              console.warn(`[NodeBleTransport] Failed to clean ${name}:`, error.message || error);
            }
          }

        } catch (error) {
          // Ignore individual device errors
        }
      }

      console.log(`[NodeBleTransport] Zombie cleanup complete (${cleanedCount} devices)`);

    } catch (error) {
      console.error('[NodeBleTransport] Zombie cleanup error:', error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
