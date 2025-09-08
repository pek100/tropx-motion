import { CONFIG, BLUETOOTH_CONFIG, CONNECTION_STATES, ERROR_CODES } from '../../shared/config';
import { DeviceInfo, ApiResponse } from '../../shared/types';

interface BluetoothDeviceCallback {
  (deviceId: string): void;
}

interface BluetoothPairingCallback {
  (response: any): void;
}

export class BluetoothService {
  private deviceCallback: BluetoothDeviceCallback | null = null;
  private pairingCallback: BluetoothPairingCallback | null = null;
  private discoveredDevices = new Map<string, DeviceInfo>();

  // Initialize Web Bluetooth handlers
  initialize(webContents: Electron.WebContents): void {
    this.setupDeviceSelectionHandler(webContents);
    this.setupPairingHandler(webContents);
  }

  // Trigger device discovery
  async discoverDevices(): Promise<{ devices: DeviceInfo[]; success: boolean; message: string }> {
    try {
      // Web Bluetooth discovery will be handled by renderer process
      // This method prepares the service for device selection
      this.discoveredDevices.clear();
      
      return {
        devices: [],
        success: true,
        message: 'Device discovery initiated'
      };
    } catch (error) {
      return {
        devices: [],
        success: false,
        message: `Discovery failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Handle device selection from user
  selectDevice(deviceId: string): ApiResponse {
    if (!this.deviceCallback) {
      return {
        success: false,
        message: 'No pending device selection'
      };
    }

    try {
      this.deviceCallback(deviceId);
      this.deviceCallback = null;
      return {
        success: true,
        message: 'Device selected successfully'
      };
    } catch (error) {
      return {
        success: false,
        message: `Device selection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Handle manual device connection
  connectManualDevice(deviceName: string): ApiResponse {
    if (!this.deviceCallback) {
      return {
        success: false,
        message: 'No pending connection request'
      };
    }

    try {
      this.deviceCallback(deviceName);
      this.deviceCallback = null;
      return {
        success: true,
        message: `Manual connection initiated for ${deviceName}`
      };
    } catch (error) {
      return {
        success: false,
        message: `Manual connection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Handle pairing response from user
  respondToPairing(response: unknown): ApiResponse {
    if (!this.pairingCallback) {
      return {
        success: false,
        message: 'No pending pairing request'
      };
    }

    try {
      this.pairingCallback(response);
      this.pairingCallback = null;
      return {
        success: true,
        message: 'Pairing response sent'
      };
    } catch (error) {
      return {
        success: false,
        message: `Pairing response failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Cancel current selection/pairing
  cancelOperation(): ApiResponse {
    if (this.deviceCallback) {
      this.deviceCallback('');
      this.deviceCallback = null;
      return { success: true, message: 'Selection cancelled' };
    }

    if (this.pairingCallback) {
      this.pairingCallback({ cancelled: true });
      this.pairingCallback = null;
      return { success: true, message: 'Pairing cancelled' };
    }

    return { success: false, message: 'No pending operation to cancel' };
  }

  getDiscoveredDevices(): DeviceInfo[] {
    return Array.from(this.discoveredDevices.values());
  }

  cleanup(): void {
    this.deviceCallback = null;
    this.pairingCallback = null;
    this.discoveredDevices.clear();
  }

  // Setup device selection event handler
  private setupDeviceSelectionHandler(webContents: Electron.WebContents): void {
    webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
      event.preventDefault();

      const validDevices = this.filterValidDevices(deviceList);
      
      if (validDevices.length === 0) {
        this.deviceCallback = callback;
        return; // Allow manual entry
      }

      this.deviceCallback = callback;
      
      // Convert to DeviceInfo format
      const devices: DeviceInfo[] = validDevices.map(device => ({
        id: device.deviceId,
        name: device.deviceName || 'Unknown Device',
        connected: false,
        batteryLevel: null
      }));

      // Store discovered devices
      devices.forEach(device => {
        this.discoveredDevices.set(device.id, device);
      });
    });
  }

  // Setup Bluetooth pairing handler
  private setupPairingHandler(webContents: Electron.WebContents): void {
    webContents.session.setBluetoothPairingHandler((details, callback) => {
      console.log('Bluetooth pairing requested:', details);
      this.pairingCallback = callback;
    });
  }

  // Filter devices for valid SDK devices
  private filterValidDevices(deviceList: any[]): any[] {
    return deviceList.filter(device => {
      const name = (device.deviceName || device.name || '').toLowerCase();
      return BLUETOOTH_CONFIG.DEVICE_PATTERNS.some(pattern => name.includes(pattern));
    });
  }
}