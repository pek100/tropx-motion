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
  private pendingSelections = new Set<string>(); // Track pending device selections

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
    console.log(`🔗 BluetoothService.selectDevice(${deviceId}) - Has callback: ${!!this.deviceCallback}`);
    console.log(`🔗 Pending selections: ${Array.from(this.pendingSelections).join(', ')}`);
    
    if (!this.deviceCallback) {
      return {
        success: false,
        message: 'No pending device selection'
      };
    }

    try {
      const callback = this.deviceCallback;
      this.deviceCallback = null; // Clear immediately to prevent reuse
      this.pendingSelections.delete(deviceId);
      
      callback(deviceId);
      console.log(`✅ Device ${deviceId} selection completed`);
      return {
        success: true,
        message: 'Device selected successfully'
      };
    } catch (error) {
      console.error('❌ Device selection error:', error);
      return {
        success: false,
        message: `Device selection failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }





  cleanup(): void {
    this.deviceCallback = null;
    this.pairingCallback = null;
    this.discoveredDevices.clear();
    this.pendingSelections.clear();
  }

  // Setup device selection event handler
  private setupDeviceSelectionHandler(webContents: Electron.WebContents): void {
    webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
      event.preventDefault();
      
      console.log(`🔗 select-bluetooth-device event - Has existing callback: ${!!this.deviceCallback}`);

      const validDevices = this.filterValidDevices(deviceList);
      
      // Clear any stale callback first
      if (this.deviceCallback) {
        console.log('⚠️ Clearing stale device callback');
        this.deviceCallback = null;
      }
      
      if (validDevices.length === 0) {
        this.deviceCallback = callback;
        console.log(`📋 Set callback for manual device entry`);
        return; // Allow manual entry
      }

      // Set the callback for this selection
      this.deviceCallback = callback;
      console.log(`📋 Set callback for device selection`);
      
      // Track pending selections
      validDevices.forEach(device => {
        this.pendingSelections.add(device.deviceId);
      });
      
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
      
      // Log available devices
      console.log(`🔍 Found ${validDevices.length} valid devices in this selection event`);
      validDevices.forEach(device => {
        console.log(`  - ${device.deviceName || 'Unknown'} (${device.deviceId})`);
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