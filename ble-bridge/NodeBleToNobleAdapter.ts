/**
 * Adapter to make node-ble Device look like a Noble Peripheral
 * This allows TropXDevice to work with both @abandonware/noble and node-ble
 */

import { EventEmitter } from 'events';

export class NodeBleToNobleAdapter extends EventEmitter {
  private nodeBleDevice: any;
  private gattServer: any;
  private services: Map<string, any> = new Map();
  public state: string = 'disconnected';
  public id: string;
  public address: string;
  public advertisement: any;
  public rssi: number;

  constructor(nodeBleDevice: any, deviceInfo: any) {
    super();
    this.nodeBleDevice = nodeBleDevice;
    this.id = deviceInfo.id;
    this.address = deviceInfo.address;
    this.rssi = deviceInfo.rssi;
    this.advertisement = {
      localName: deviceInfo.name
    };

    // Device is already physically connected, but GATT server not ready yet
    // Keep state as 'disconnected' until connect() gets GATT server
    this.state = 'disconnected';

    // CRITICAL: Set up disconnect handler for node-ble
    // TropXDevice registers a 'disconnect' handler in connect() (line 88-90)
    // We need to forward node-ble's disconnect events to match Noble's behavior
    this.setupDisconnectHandler();
  }

  // Set up disconnect event forwarding from node-ble to Noble-style events
  private setupDisconnectHandler(): void {
    // Note: node-ble devices don't have built-in disconnect events
    // We need to monitor the connection status or handle it at the service level
    // For now, we'll emit disconnect when disconnectAsync() is called
    console.log(`🔌 [NodeBleAdapter] Disconnect handler setup for ${this.advertisement.localName}`);
  }

  // Noble-compatible connect method (callback-based)
  // Device is already connected at BLE level, just get GATT server
  connect(callback: (error?: Error) => void): void {
    console.log(`🔗 [NodeBleAdapter] Getting GATT server for ${this.advertisement.localName}...`);

    // Device already connected at node-ble level, just get GATT server
    this.nodeBleDevice.gatt()
      .then((gattServer: any) => {
        this.gattServer = gattServer;
        this.state = 'connected';
        console.log(`✅ [NodeBleAdapter] GATT server ready for ${this.advertisement.localName}`);
        callback();
      })
      .catch((error: Error) => {
        console.error(`❌ [NodeBleAdapter] Failed to get GATT server for ${this.advertisement.localName}:`, error);
        callback(error);
      });
  }

  // Noble-compatible discoverServices method
  discoverServices(serviceUUIDs: string[], callback: (error: Error | null, services: any[]) => void): void {
    if (!this.gattServer) {
      callback(new Error('Not connected'), []);
      return;
    }

    console.log(`🔍 [NodeBleAdapter] Discovering services for ${this.advertisement.localName}...`);

    this.gattServer.services()
      .then(async (discoveredServiceUUIDs: string[]) => {
        console.log(`🔍 [NodeBleAdapter] Found ${discoveredServiceUUIDs.length} service UUIDs:`, discoveredServiceUUIDs);
        const services = [];

        for (const uuid of discoveredServiceUUIDs) {
          try {
            console.log(`🔍 [NodeBleAdapter] Getting service: ${uuid}`);
            const service = await this.gattServer.getPrimaryService(uuid);
            const serviceWrapper = new NodeBleServiceAdapter(service, uuid);
            this.services.set(uuid, serviceWrapper);
            services.push(serviceWrapper);
            console.log(`✅ [NodeBleAdapter] Service ${uuid} wrapped successfully`);
          } catch (e) {
            // Service not available, skip
            console.warn(`⚠️ [NodeBleAdapter] Failed to get service ${uuid}:`, e);
          }
        }

        console.log(`✅ [NodeBleAdapter] Service discovery complete: ${services.length} services`);
        callback(null, services);
      })
      .catch((error: Error) => {
        console.error(`❌ [NodeBleAdapter] Service discovery failed:`, error);
        callback(error, []);
      });
  }

  // Noble-compatible async version
  async discoverServicesAsync(serviceUUIDs: string[]): Promise<{ services: any[] }> {
    return new Promise((resolve, reject) => {
      this.discoverServices(serviceUUIDs, (error, services) => {
        if (error) reject(error);
        else resolve({ services });
      });
    });
  }

  // Noble-compatible disconnect
  async disconnectAsync(): Promise<void> {
    await this.nodeBleDevice.disconnect();
    this.state = 'disconnected';
    this.emit('disconnect');
  }
}

// Adapter for node-ble GattService to look like Noble Service
class NodeBleServiceAdapter extends EventEmitter {
  private nodeBleService: any;
  public uuid: string;
  public name: string | null = null;
  private characteristics: Map<string, any> = new Map();

  constructor(nodeBleService: any, uuid: string) {
    super();
    this.nodeBleService = nodeBleService;
    // Normalize UUID to match Noble format (remove dashes)
    this.uuid = uuid.replace(/-/g, '');
  }

  // Set max listeners to avoid warnings
  setMaxListeners(n: number): this {
    return super.setMaxListeners(n);
  }

  // Noble-compatible discoverCharacteristics (callback)
  discoverCharacteristics(characteristicUUIDs: string[], callback: (error: Error | null, characteristics: any[]) => void): void {
    this.nodeBleService.characteristics()
      .then(async (charUUIDs: string[]) => {
        const characteristics = [];

        for (const uuid of charUUIDs) {
          try {
            const char = await this.nodeBleService.getCharacteristic(uuid);
            // Normalize UUID to match Noble format (remove dashes)
            // node-ble returns: d5913036-2d8a-41ee-85b9-4e361aa5c8a7
            // Noble returns:    d59130362d8a41ee85b94e361aa5c8a7
            const normalizedUuid = uuid.replace(/-/g, '');
            const charWrapper = new NodeBleCharacteristicAdapter(char, normalizedUuid);
            this.characteristics.set(normalizedUuid, charWrapper);
            characteristics.push(charWrapper);
          } catch (e) {
            // Characteristic not available, skip
          }
        }

        callback(null, characteristics);
      })
      .catch((error: Error) => {
        callback(error, []);
      });
  }

  // Noble-compatible async version
  async discoverCharacteristicsAsync(characteristicUUIDs: string[]): Promise<{ characteristics: any[] }> {
    return new Promise((resolve, reject) => {
      this.discoverCharacteristics(characteristicUUIDs, (error, characteristics) => {
        if (error) reject(error);
        else resolve({ characteristics });
      });
    });
  }
}

// Adapter for node-ble GattCharacteristic to look like Noble Characteristic
class NodeBleCharacteristicAdapter extends EventEmitter {
  private nodeBleChar: any;
  public uuid: string;
  public properties: string[] = [];

  constructor(nodeBleChar: any, uuid: string) {
    super();
    this.nodeBleChar = nodeBleChar;
    this.uuid = uuid;

    // Get properties
    nodeBleChar.getFlags()
      .then((flags: string[]) => {
        this.properties = flags;
      })
      .catch(() => {
        // Default properties
        this.properties = ['read', 'write', 'notify'];
      });
  }

  // Noble-compatible write (callback)
  write(data: Buffer, withoutResponse: boolean, callback: (error?: Error) => void): void {
    const writeMethod = withoutResponse
      ? this.nodeBleChar.writeValueWithoutResponse.bind(this.nodeBleChar)
      : this.nodeBleChar.writeValueWithResponse.bind(this.nodeBleChar);

    writeMethod(data)
      .then(() => callback())
      .catch((error: Error) => callback(error));
  }

  // Noble-compatible async write
  async writeAsync(data: Buffer, withoutResponse: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.write(data, withoutResponse, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  // Noble-compatible read (callback)
  read(callback: (error: Error | null, data: Buffer) => void): void {
    this.nodeBleChar.readValue()
      .then((buffer: Buffer) => callback(null, buffer))
      .catch((error: Error) => callback(error, Buffer.alloc(0)));
  }

  // Noble-compatible async read
  async readAsync(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.read((error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });
  }

  // Noble-compatible subscribe
  subscribe(callback: (error?: Error) => void): void {
    console.log(`🔔 [NodeBleCharAdapter] Starting notifications for ${this.uuid}`);

    this.nodeBleChar.startNotifications()
      .then(() => {
        console.log(`✅ [NodeBleCharAdapter] Notifications started for ${this.uuid}`);

        // CRITICAL: Listen for value changes and emit as 'data' event (Noble style)
        // Remove any existing listeners first to prevent duplicates
        this.nodeBleChar.removeAllListeners('valuechanged');

        this.nodeBleChar.on('valuechanged', (buffer: Buffer) => {
          console.log(`📨 [NodeBleCharAdapter] Value changed for ${this.uuid}, emitting 'data' event`);
          this.emit('data', buffer);
        });

        console.log(`🎧 [NodeBleCharAdapter] Event listener attached for ${this.uuid}`);
        callback();
      })
      .catch((error: Error) => {
        console.error(`❌ [NodeBleCharAdapter] Failed to start notifications for ${this.uuid}:`, error);
        callback(error);
      });
  }

  // Noble-compatible async subscribe
  async subscribeAsync(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.subscribe((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  // Noble-compatible unsubscribe
  async unsubscribeAsync(): Promise<void> {
    console.log(`🔕 [NodeBleCharAdapter] Stopping notifications for ${this.uuid}`);
    try {
      await this.nodeBleChar.stopNotifications();
      console.log(`✅ [NodeBleCharAdapter] Notifications stopped for ${this.uuid}`);
    } catch (error) {
      console.warn(`⚠️ [NodeBleCharAdapter] Error stopping notifications for ${this.uuid}:`, error);
    }

    // Clean up event listeners
    this.nodeBleChar.removeAllListeners('valuechanged');
    this.removeAllListeners('data');
    console.log(`🧹 [NodeBleCharAdapter] Event listeners cleaned up for ${this.uuid}`);
  }

  // Noble event forwarding
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    return super.removeListener(event, listener);
  }

  removeAllListeners(event?: string): this {
    return super.removeAllListeners(event);
  }
}
