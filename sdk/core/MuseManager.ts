// MuseManager.ts
import { IMUData } from './MuseData';
import { MuseDataParser } from './MuseDataParser';
import { MuseHardware } from './MuseHardware';
import { MuseCommands } from './Commands';

// Bluetooth Web API types
interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRequestDeviceOptions {
  filters?: BluetoothLEScanFilter[];
  optionalServices?: string[];
}

interface BluetoothLEScanFilter {
  name?: string;
  namePrefix?: string;
  services?: string[];
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTCharacteristic {
  readValue(): Promise<DataView>;
  writeValue(value: ArrayBuffer): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener(type: string, listener: (event: Event) => void): void;
  value?: DataView;
}

interface Bluetooth {
  requestDevice(options?: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
  getDevices?(): Promise<BluetoothDevice[]>; // Optional newer method
}

interface WebMuseDevice {
  device: BluetoothDevice;
  server?: BluetoothRemoteGATTServer;
  dataParser?: MuseDataParser;
  characteristics?: {
    command: BluetoothRemoteGATTCharacteristic;
    data: BluetoothRemoteGATTCharacteristic;
  };
}

export class MuseManager {
  // Core state management
  private connectedDevices: Map<string, WebMuseDevice>;
  private scannedDevices: Map<string, BluetoothDevice>;
  private isStreaming: boolean;
  private batteryLevels: Map<string, number>;
  private dataCallback: ((deviceName: string, data: IMUData) => void) | null;
  private batteryUpdateCallbacks: Set<(levels: Map<string, number>) => void>;

  constructor() {
    this.connectedDevices = new Map();
    this.scannedDevices = new Map();
    this.isStreaming = false;
    this.batteryLevels = new Map();
    this.dataCallback = null;
    this.batteryUpdateCallbacks = new Set();
  }

  // Battery update subscription management
  onBatteryLevelsUpdate(callback: (levels: Map<string, number>) => void) {
    this.batteryUpdateCallbacks.add(callback);
    return () => this.batteryUpdateCallbacks.delete(callback);
  }

  private notifyBatteryUpdateListeners() {
    this.batteryUpdateCallbacks.forEach(callback => 
      callback(new Map(this.batteryLevels))
    );
  }

  // Device scanning (discovery without connection)
  // UPDATED: For Electron, scanning should be handled by main process
  async scanForDevices(): Promise<BluetoothDevice[]> {
    console.warn('⚠️ scanForDevices() should not be called directly in Electron');
    console.warn('⚠️ Use main process IPC to trigger scanning instead');
    
    // Return current scanned devices instead of triggering new scan
    return Array.from(this.scannedDevices.values());
  }

  // Device discovery and connection
  // UPDATED: For Electron, discovery should be handled by main process
  async discoverAndConnect(): Promise<boolean> {
    console.warn('⚠️ discoverAndConnect() should not be called directly in Electron');
    console.warn('⚠️ Use main process IPC to trigger device discovery instead');
    console.warn('⚠️ Then use connectToScannedDevice() with discovered devices');
    
    return false;
  }

  private async connectToDevice(device: BluetoothDevice): Promise<boolean> {
    try {
      if (!device || !device.gatt) {
        throw new Error('Invalid device - missing GATT interface');
      }

      const deviceName = device.name || `unknown_device_${device.id}`;
      console.log(`🔗 Connecting to device: ${deviceName}`);
      
      // Safety check: Don't connect if already connected
      if (this.connectedDevices.has(deviceName)) {
        console.log(`✅ Device ${deviceName} is already connected`);
        return true;
      }

      console.log(`🔗 Establishing GATT connection to ${deviceName}...`);
      const server = await device.gatt.connect();
      console.log(`✅ Connected to GATT server for ${deviceName}`);

      console.log(`🔍 Getting primary service for ${deviceName}...`);
      const service = await server.getPrimaryService(MuseHardware.BLEConfig.SERVICE_UUID);
      console.log(`✅ Got primary service for ${deviceName}`);
      
      console.log(`🔍 Getting characteristics for ${deviceName}...`);
      const commandChar = await service.getCharacteristic(MuseHardware.BLEConfig.CMD_UUID);
      const dataChar = await service.getCharacteristic(MuseHardware.BLEConfig.DATA_UUID);
      console.log(`✅ Got characteristics for ${deviceName}`);

      // Store device using its name as the key
      this.connectedDevices.set(deviceName, {
        device,
        server,
        characteristics: {
          command: commandChar,
          data: dataChar
        }
      });

      console.log(`✅ Device ${deviceName} stored in connected devices registry`);

      // Try to get battery level, but don't fail connection if it doesn't work
      try {
        await this.updateBatteryLevel(deviceName);
      } catch (batteryError) {
        console.warn(`⚠️ Could not get battery level for ${deviceName}:`, batteryError);
        // Continue anyway - battery level is not critical for connection
      }

      console.log(`🎉 Successfully connected to ${deviceName}`);
      return true;

    } catch (error) {
      console.error(`❌ Connection error:`, error);
      
      // Provide more helpful error messages
      if (error instanceof Error) {
        if (error.name === 'NetworkError') {
          console.error('❌ Network error - device may be out of range or turned off');
        } else if (error.name === 'NotFoundError') {
          console.error('❌ Service or characteristic not found - device may not be compatible');
        } else if (error.name === 'SecurityError') {
          console.error('❌ Security error - permission denied or insecure context');
        } else if (error.name === 'AbortError') {
          console.error('❌ Connection aborted - operation was cancelled');
        }
      }
      
      return false;
    }
  }

  async updateBatteryLevel(deviceName: string): Promise<void> {
    const device = this.connectedDevices.get(deviceName);
    if (!device?.characteristics?.command) {
      console.log(`🔋 No command characteristic for ${deviceName}`);
      return;
    }

    try {
      console.log(`🔋 Requesting battery level for ${deviceName}...`);
      const batteryCommand = MuseCommands.Cmd_GetBatteryCharge();
      await device.characteristics.command.writeValue(batteryCommand.buffer as ArrayBuffer);

      await new Promise(resolve => setTimeout(resolve, 200));
      
      const response = await device.characteristics.command.readValue();
      console.log(`🔋 Battery response for ${deviceName}:`, new Uint8Array(response.buffer));
      
      const batteryLevel = response.getUint8(4);
      
      this.batteryLevels.set(deviceName, batteryLevel);
      this.notifyBatteryUpdateListeners();
      
      console.log(`🔋 Battery level for ${deviceName}: ${batteryLevel}%`);
    } catch (error) {
      console.error(`🔋 Battery level read error for ${deviceName}:`, error);
    }
  }

  async startStreaming(callback: (deviceName: string, data: IMUData) => void): Promise<boolean> {
    try {
      if (this.isStreaming) {
        console.log('Already streaming');
        return false;
      }

      if (!callback || typeof callback !== 'function') {
        throw new Error('Valid callback function required');
      }

      this.dataCallback = callback;
      console.log('🔍 Starting streaming for all connected devices...');
      console.log('🔍 Connected devices map:', this.connectedDevices);
      console.log('🔍 Connected devices count:', this.connectedDevices.size);
      console.log('🔍 Connected device names:', Array.from(this.connectedDevices.keys()));

      for (const [deviceName, device] of this.connectedDevices.entries()) {
        console.log(`🔍 Processing streaming setup for device: ${deviceName}`);
        console.log(`🔍 Device object:`, device);
        console.log(`🔍 Device has characteristics:`, !!device.characteristics);
        console.log(`🔍 Device has data characteristic:`, !!device.characteristics?.data);
        console.log(`🔍 Device has command characteristic:`, !!device.characteristics?.command);
        if (!device.characteristics?.data || !device.characteristics?.command) {
          console.warn(`Device ${deviceName} missing required characteristics`);
          continue;
        }

        const dataChar = device.characteristics.data;
        await dataChar.startNotifications();
        
        dataChar.addEventListener('characteristicvaluechanged', 
          (event: Event) => {
            if (!this.dataCallback) return;

            const value = (event.target as unknown as BluetoothRemoteGATTCharacteristic).value;
            if (!value) return;

            try {
              const rawData = new Uint8Array(value.buffer);
              const data = MuseDataParser.decodePacket(
                rawData,
                Date.now(),
                0x10,
                null,
                null,
                null
              );

              console.log(`🔍 Data received from device: ${deviceName}`);
              this.dataCallback(deviceName, data);
            } catch (error) {
              console.error(`❌ Data processing error for ${deviceName}:`, error);
            }
          }
        );

        const streamCommand = new Uint8Array([
          0x02,
          0x05,
          0x08,
          0x10,
          0x00,
          0x00,
          0x10
        ]);

        await device.characteristics.command.writeValue(streamCommand.buffer);
        console.log(`Started streaming for device ${deviceName}`);
      }

      this.isStreaming = true;
      return true;

    } catch (error) {
      console.error('Error starting stream:', error);
      this.dataCallback = null;
      return false;
    }
  }

  async stopStreaming(): Promise<void> {
    try {
      if (!this.isStreaming) {
        return;
      }

      console.log('Stopping streaming for all devices...');

      for (const [deviceName, device] of this.connectedDevices.entries()) {
        if (!device.characteristics?.command || !device.characteristics?.data) continue;

        const stopCommand = new Uint8Array([0x02, 0x01, 0x02]);
        await device.characteristics.command.writeValue(stopCommand.buffer);
        // Note: stopNotifications is not a standard method, removing call
        console.log(`Stopped streaming for device ${deviceName}`);
      }

      this.isStreaming = false;
      this.dataCallback = null;

    } catch (error) {
      console.error('Error stopping stream:', error);
      throw error;
    }
  }

  // Utility methods
  getBatteryLevel(deviceName: string): number | null {
    return this.batteryLevels.get(deviceName) ?? null;
  }

  getConnectedDevices(): Map<string, WebMuseDevice> {
    return new Map(this.connectedDevices);
  }

  getConnectedDeviceCount(): number {
    return this.connectedDevices.size;
  }

  /**
   * Check if a specific device is connected
   */
  isDeviceConnected(deviceName: string): boolean {
    return this.connectedDevices.has(deviceName);
  }

  getAllBatteryLevels(): Map<string, number> {
    return new Map(this.batteryLevels);
  }

  // Get all scanned devices
  getScannedDevices(): Map<string, BluetoothDevice> {
    return new Map(this.scannedDevices);
  }

  // Get all devices (both scanned and connected) in a unified format
  getAllDevices(): Array<{id: string, name: string, connected: boolean, batteryLevel: number | null, device?: BluetoothDevice}> {
    const devices: Array<{id: string, name: string, connected: boolean, batteryLevel: number | null, device?: BluetoothDevice}> = [];
    
    // Add all scanned devices
    this.scannedDevices.forEach((device, deviceKey) => {
      const isConnected = this.connectedDevices.has(deviceKey);
      devices.push({
        id: device.id,
        name: device.name || deviceKey,
        connected: isConnected,
        batteryLevel: this.batteryLevels.get(deviceKey) || null,
        device
      });
    });
    
    // Add any connected devices that might not be in scanned list
    this.connectedDevices.forEach((webMuseDevice, deviceName) => {
      if (!devices.find(d => d.name === deviceName)) {
        devices.push({
          id: webMuseDevice.device.id,
          name: deviceName,
          connected: true,
          batteryLevel: this.batteryLevels.get(deviceName) || null,
          device: webMuseDevice.device
        });
      }
    });
    
    return devices;
  }

  // Force battery level update for all connected devices
  async updateAllBatteryLevels(): Promise<void> {
    console.log('🔋 Manually updating battery levels for all connected devices...');
    const updatePromises: Promise<void>[] = [];
    
    this.connectedDevices.forEach((device, deviceName) => {
      updatePromises.push(this.updateBatteryLevel(deviceName));
    });
    
    await Promise.all(updatePromises);
    console.log('🔋 Battery update complete for all devices');
  }

  /**
   * Connect to a device that was already discovered through scanning
   * This method avoids retriggering Web Bluetooth device selection dialogs
   * UPDATED: Works with Electron's device management approach
   */
  async connectToScannedDevice(deviceId: string, deviceName: string): Promise<boolean> {
    try {
      console.log(`🔗 Connecting to scanned device: ${deviceName} (${deviceId})`);

      // Check if already connected first
      if (this.connectedDevices.has(deviceName)) {
        console.log(`✅ Device ${deviceName} is already connected`);
        return true;
      }

      // Look for the device in our scanned devices registry
      let bluetoothDevice: BluetoothDevice | undefined;

      // Try to find by name first
      bluetoothDevice = this.scannedDevices.get(deviceName);

      if (!bluetoothDevice) {
        // Try to find by ID as backup
        for (const [key, device] of this.scannedDevices.entries()) {
          if (device.id === deviceId || key === deviceId) {
            bluetoothDevice = device;
            console.log(`🔍 Found device by ID: ${deviceId}`);
            break;
          }
        }
      }

      if (!bluetoothDevice) {
        console.error(`❌ Device ${deviceName} (${deviceId}) not found in scanned devices`);
        console.log('📋 Available scanned devices:');
        this.scannedDevices.forEach((device, key) => {
          console.log(`  - ${key}: ${device.name} (${device.id})`);
        });

        console.error('❌ Cannot connect - device must be discovered through main process first');
        return false;
      }

      // Now we have a valid bluetoothDevice from our scan registry
      console.log(`✅ Found scanned device: ${deviceName}`);

      // Check if the device has GATT and is connected
      if (bluetoothDevice.gatt?.connected) {
        console.log(`🔗 Device ${deviceName} GATT already connected, using existing connection...`);
        return await this.connectToDevice(bluetoothDevice);
      }

      // If GATT exists but not connected, try to connect
      if (bluetoothDevice.gatt) {
        console.log(`🔗 Connecting to existing GATT for ${deviceName}...`);
        return await this.connectToDevice(bluetoothDevice);
      } else {
        // For Electron-discovered devices without GATT, we need to get the GATT interface
        // This happens when devices are discovered through Electron's main process but need Web Bluetooth connection
        console.log(`🔧 Device ${deviceName} discovered via Electron, acquiring Web Bluetooth GATT interface...`);
        
        try {
          // Check if Web Bluetooth is available
          if (!navigator.bluetooth) {
            throw new Error('Web Bluetooth API not available');
          }

          // Use Web Bluetooth to get the GATT interface for this specific device
          // This is safe because we're targeting a specific device by name
          console.log(`🔍 Requesting Web Bluetooth access for device: ${deviceName}`);
          const webBluetoothDevice = await navigator.bluetooth.requestDevice({
            filters: [
              { name: deviceName }  // Exact name match
            ],
            optionalServices: [MuseHardware.BLEConfig.SERVICE_UUID]
          });

          if (webBluetoothDevice && webBluetoothDevice.name === deviceName) {
            console.log(`✅ Successfully acquired Web Bluetooth GATT for ${deviceName}`);

            // Update the stored device with the GATT interface
            const updatedDevice: BluetoothDevice = {
              id: webBluetoothDevice.id,
              name: webBluetoothDevice.name,
              gatt: webBluetoothDevice.gatt
            };

            // Update in registry
            this.scannedDevices.set(deviceName, updatedDevice);
            console.log(`📝 Updated device registry with GATT interface for ${deviceName}`);

            // Now connect using the updated device with GATT
            return await this.connectToDevice(updatedDevice);
          } else {
            console.error(`❌ Device name mismatch: expected ${deviceName}, got ${webBluetoothDevice?.name}`);
            return false;
          }
        } catch (error) {
          console.error(`❌ Failed to acquire Web Bluetooth GATT for ${deviceName}:`, error);

          // Handle specific error cases gracefully
          if (error instanceof Error) {
            switch (error.name) {
              case 'NotFoundError':
                console.log(`ℹ️ Device "${deviceName}" not found - it may be out of range or turned off`);
                break;
              case 'AbortError':
                console.log(`ℹ️ User cancelled Web Bluetooth dialog for "${deviceName}"`);
                break;
              case 'SecurityError':
                console.log(`ℹ️ Security error - Web Bluetooth access denied for "${deviceName}"`);
                break;
              case 'NotAllowedError':
                console.log(`ℹ️ Web Bluetooth access not allowed for "${deviceName}"`);
                break;
              default:
                console.error(`❌ Unexpected error acquiring GATT interface: ${error.message}`);
            }
          }

          return false;
        }
      }

    } catch (error) {
      console.error(`❌ Failed to connect to scanned device ${deviceName}:`, error);
      return false;
    }
  }

  /**
   * REMOVED: attemptDirectConnection method to prevent Web Bluetooth conflicts
   * All connections now go through proper Electron device discovery flow
   */

  /**
   * Fast reconnection using getDevices() - Web Bluetooth 2025 best practice
   */
  async reconnectToPreviousDevices(): Promise<BluetoothDevice[]> {
    if (!navigator.bluetooth?.getDevices) {
      console.log('getDevices() not supported, falling back to discovery');
      return [];
    }

    try {
      console.log('🔍 Checking for previously paired devices...');
      const devices = await navigator.bluetooth.getDevices();
      
      const tropxDevices = devices.filter(device => 
        device.name && (
          device.name.toLowerCase().includes('tropx') || 
          device.name.toLowerCase().includes('muse')
        )
      );

      console.log(`✅ Found ${tropxDevices.length} previously paired Tropx devices`);
      return tropxDevices;
      
    } catch (error) {
      console.error('Error getting previous devices:', error);
      return [];
    }
  }

  /**
   * Connection with timeout and retry logic (Web Bluetooth 2025 best practice)
   */
  async connectToDeviceWithTimeout(device: BluetoothDevice, timeoutMs: number = 10000): Promise<boolean> {
    return this.retryWithExponentialBackoff(
      () => Promise.race([
        this.connectToDevice(device),
        new Promise<boolean>((_, reject) => 
          setTimeout(() => reject(new Error(`Connection timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]),
      3, // maxRetries
      device.name || 'Unknown Device'
    );
  }

  /**
   * Exponential backoff retry pattern for connection stability
   */
  private async retryWithExponentialBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    deviceName: string = 'Device'
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        console.log(`🔄 Connection attempt ${attempt + 1}/${maxRetries} for ${deviceName}`);
        const result = await operation();
        
        if (attempt > 0) {
          console.log(`✅ Connection succeeded on retry ${attempt + 1} for ${deviceName}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxRetries - 1) {
          console.error(`❌ Final connection attempt failed for ${deviceName}:`, lastError.message);
          break;
        }
        
        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️ Connection attempt ${attempt + 1} failed for ${deviceName}, retrying in ${delayMs}ms:`, lastError.message);
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    throw lastError!;
  }

  /**
   * Store devices from Electron's device discovery process
   * This allows us to connect to them later without retriggering scans
   */
  addScannedDevices(devices: Array<{deviceId: string, deviceName: string}>): void {
    console.log(`📋 Adding ${devices.length} devices to scanned device registry...`);

    devices.forEach(device => {
      // Create a mock BluetoothDevice object for devices discovered by Electron
      const bluetoothDevice: BluetoothDevice = {
        id: device.deviceId,
        name: device.deviceName,
        gatt: undefined // Will be populated during connection
      };

      this.scannedDevices.set(device.deviceName, bluetoothDevice);
      console.log(`📋 Added scanned device: ${device.deviceName} (${device.deviceId})`);
    });

    console.log(`✅ Scanned device registry now contains ${this.scannedDevices.size} devices`);
  }

  /**
   * Clear the scanned device registry
   */
  clearScannedDevices(): void {
    console.log('🗑️ Clearing scanned device registry...');
    this.scannedDevices.clear();
  }

  /**
   * Disconnect from a specific device
   */
  async disconnectDevice(deviceName: string): Promise<boolean> {
    try {
      const device = this.connectedDevices.get(deviceName);
      if (!device) {
        console.log(`ℹ️ Device ${deviceName} not found or already disconnected`);
        return true;
      }

      if (device.server && device.server.connected) {
        console.log(`🔌 Disconnecting from ${deviceName}...`);
        device.server.disconnect();
      }

      // Remove from connected devices
      this.connectedDevices.delete(deviceName);

      // Remove battery level
      this.batteryLevels.delete(deviceName);
      this.notifyBatteryUpdateListeners();

      console.log(`✅ Successfully disconnected from ${deviceName}`);
      return true;

    } catch (error) {
      console.error(`❌ Error disconnecting from ${deviceName}:`, error);
      return false;
    }
  }

  /**
   * Disconnect from all devices
   */
  async disconnectAll(): Promise<void> {
    console.log('🔌 Disconnecting from all devices...');

    const deviceNames = Array.from(this.connectedDevices.keys());
    const disconnectPromises = deviceNames.map(name => this.disconnectDevice(name));

    await Promise.all(disconnectPromises);

    // Stop streaming if active
    if (this.isStreaming) {
      await this.stopStreaming();
    }

    console.log('✅ Disconnected from all devices');
  }

  /**
   * Send start recording command to all connected devices
   */
  async startRecordingOnDevices(): Promise<boolean> {
    try {
      console.log('🎬 Sending start recording command to all connected devices...');

      if (this.connectedDevices.size === 0) {
        console.warn('⚠️ No connected devices to start recording on');
        return false;
      }

      const recordingPromises: Promise<boolean>[] = [];

      for (const [deviceName, device] of this.connectedDevices.entries()) {
        if (!device.characteristics?.command) {
          console.warn(`⚠️ Device ${deviceName} missing command characteristic`);
          continue;
        }

        const recordingPromise = (async () => {
          try {
            const startRecordCommand = MuseCommands.Cmd_StartRecording();
            await device.characteristics!.command.writeValue(startRecordCommand.buffer as ArrayBuffer);
            console.log(`✅ Start recording command sent to ${deviceName}`);
            return true;
          } catch (error) {
            console.error(`❌ Failed to send start recording command to ${deviceName}:`, error);
            return false;
          }
        })();

        recordingPromises.push(recordingPromise);
      }

      const results = await Promise.all(recordingPromises);
      const successCount = results.filter(r => r).length;

      console.log(`📋 Recording commands sent: ${successCount}/${this.connectedDevices.size} devices`);
      return successCount > 0;

    } catch (error) {
      console.error('❌ Error sending start recording commands:', error);
      return false;
    }
  }

  /**
   * Send stop recording command to all connected devices
   */
  async stopRecordingOnDevices(): Promise<boolean> {
    try {
      console.log('🛑 Sending stop recording command to all connected devices...');

      if (this.connectedDevices.size === 0) {
        console.warn('⚠️ No connected devices to stop recording on');
        return false;
      }

      const recordingPromises: Promise<boolean>[] = [];

      for (const [deviceName, device] of this.connectedDevices.entries()) {
        if (!device.characteristics?.command) {
          console.warn(`⚠️ Device ${deviceName} missing command characteristic`);
          continue;
        }

        const recordingPromise = (async () => {
          try {
            const stopRecordCommand = MuseCommands.Cmd_StopRecording();
            await device.characteristics!.command.writeValue(stopRecordCommand.buffer as ArrayBuffer);
            console.log(`✅ Stop recording command sent to ${deviceName}`);
            return true;
          } catch (error) {
            console.error(`❌ Failed to send stop recording command to ${deviceName}:`, error);
            return false;
          }
        })();

        recordingPromises.push(recordingPromise);
      }

      const results = await Promise.all(recordingPromises);
      const successCount = results.filter(r => r).length;

      console.log(`📋 Stop recording commands sent: ${successCount}/${this.connectedDevices.size} devices`);
      return successCount > 0;

    } catch (error) {
      console.error('❌ Error sending stop recording commands:', error);
      return false;
    }
  }
}
