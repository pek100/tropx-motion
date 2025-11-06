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
  }

  // Noble-compatible connect method (callback-based)
  connect(callback: (error?: Error) => void): void {
    this.nodeBleDevice.connect()
      .then(async () => {
        this.state = 'connected';
        // Get GATT server for later use
        this.gattServer = await this.nodeBleDevice.gatt();
        callback();
      })
      .catch((error: Error) => {
        callback(error);
      });
  }

  // Noble-compatible discoverServices method
  discoverServices(serviceUUIDs: string[], callback: (error: Error | null, services: any[]) => void): void {
    if (!this.gattServer) {
      callback(new Error('Not connected'), []);
      return;
    }

    this.gattServer.services()
      .then(async (serviceUUIDs: string[]) => {
        const services = [];

        for (const uuid of serviceUUIDs) {
          try {
            const service = await this.gattServer.getPrimaryService(uuid);
            const serviceWrapper = new NodeBleServiceAdapter(service, uuid);
            this.services.set(uuid, serviceWrapper);
            services.push(serviceWrapper);
          } catch (e) {
            // Service not available, skip
          }
        }

        callback(null, services);
      })
      .catch((error: Error) => {
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
    this.uuid = uuid;
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
            const charWrapper = new NodeBleCharacteristicAdapter(char, uuid);
            this.characteristics.set(uuid, charWrapper);
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
    this.nodeBleChar.startNotifications()
      .then(() => {
        // Listen for value changes and emit as 'data' event (Noble style)
        this.nodeBleChar.on('valuechanged', (buffer: Buffer) => {
          this.emit('data', buffer);
        });
        callback();
      })
      .catch((error: Error) => callback(error));
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
    await this.nodeBleChar.stopNotifications();
    this.nodeBleChar.removeAllListeners('valuechanged');
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
