/**
 * TypeScript definitions for Electron Bluetooth device objects
 * These interfaces define the structure of device objects returned by Electron's
 * select-bluetooth-device event handler.
 */

/**
 * Electron Bluetooth Device as provided by select-bluetooth-device event
 * This represents the raw device object from Electron's Bluetooth discovery
 */
export interface ElectronBluetoothDevice {
  /** Device name (may be undefined for unnamed devices) */
  deviceName?: string;
  
  /** Unique device identifier */
  deviceId: string;
  
  /** Whether the device is already paired with the system */
  paired?: boolean;
  
  /** Device type classification (e.g., 'LE', 'Classic', etc.) */
  deviceType?: string;
}

/**
 * Processed device information sent to renderer process
 * This is our enhanced version with additional metadata for UI display
 */
export interface ProcessedDeviceInfo {
  /** Device ID */
  id: string;
  
  /** Device display name */
  name: string;
  
  /** Whether device is currently connected */
  connected: boolean;
  
  /** Battery level if available */
  batteryLevel: number | null;
  
  /** Whether this is a preferred device type (Tropx/Muse) */
  isPreferred?: boolean;
  
  /** Original device type from Electron */
  deviceType?: string;
  
  /** Whether device was paired */
  paired?: boolean;
}

/**
 * Device scan result data sent via WebSocket
 */
export interface DeviceScanResult {
  /** Array of discovered devices */
  devices: ProcessedDeviceInfo[];
  
  /** Whether scan was successful */
  success: boolean;
  
  /** Human-readable message about scan results */
  message: string;
  
  /** Whether multiple selection is supported */
  multipleSelection: boolean;
  
  /** Whether waiting for user selection */
  awaitingUserSelection: boolean;
  
  /** Total number of devices found (before filtering) */
  totalDevices?: number;
  
  /** Number of preferred devices found */
  preferredDevices?: number;
  
  /** Whether this is a troubleshooting/error response */
  troubleshooting?: boolean;
}