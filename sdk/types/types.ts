// types.ts
export type BluetoothState = 'unknown' | 'resetting' | 'unsupported' | 'unauthorized' | 
                            'poweredOff' | 'poweredOn';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'streaming';

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