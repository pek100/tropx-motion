// types.ts
export type BluetoothState = 'unknown' | 'resetting' | 'unsupported' | 'unauthorized' | 
                            'poweredOff' | 'poweredOn';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'streaming';

// Add SDK-specific connection state
export type SDKConnectionState = 'disconnected' | 'connecting' | 'connected' | 'authenticating' | 'streaming' | 'error';

// Add Web Bluetooth API types
declare global {
  interface BluetoothDevice {
    id: string;
    name?: string;
    gatt?: BluetoothRemoteGATTServer;
  }

  interface BluetoothRemoteGATTServer {
    device: BluetoothDevice;
    connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
    getPrimaryServices(service?: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService[]>;
  }

  interface BluetoothRemoteGATTService {
    device: BluetoothDevice;
    uuid: string;
    isPrimary: boolean;
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
    getCharacteristics(characteristic?: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic[]>;
  }

  interface BluetoothRemoteGATTCharacteristic {
    service: BluetoothRemoteGATTService;
    uuid: string;
    properties: BluetoothCharacteristicProperties;
    value?: DataView;
    readValue(): Promise<DataView>;
    writeValue(value: BufferSource): Promise<void>;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  }

  interface BluetoothCharacteristicProperties {
    broadcast: boolean;
    read: boolean;
    writeWithoutResponse: boolean;
    write: boolean;
    notify: boolean;
    indicate: boolean;
    authenticatedSignedWrites: boolean;
    reliableWrite: boolean;
    writableAuxiliaries: boolean;
  }

  type BluetoothServiceUUID = number | string;
  type BluetoothCharacteristicUUID = number | string;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  w: number;  // Real component
  x: number;  // i component
  y: number;  // j component
  z: number;  // k component
}

export interface IMUData {
  timestamp: number;
  // Keep existing sensor data
  axl: Vector3D;
  gyr: Vector3D;
  mag: Vector3D;
  // Add quaternion data
  quaternion: Quaternion;
}

export interface DeviceData {
  id: string;
  name: string;
  batteryLevel: number | null;
  connectionState: ConnectionState;
  imuData: IMUData | null;
}