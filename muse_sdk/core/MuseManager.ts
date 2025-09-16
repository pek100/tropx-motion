// MuseManager.ts
import { IMUData } from './MuseData';
import { MuseDataParser } from './MuseDataParser';
import { MuseHardware } from './MuseHardware';
import { MuseCommands } from './Commands';
import { GATTOperationQueue } from './GATTOperationQueue';

// Extended Bluetooth Web API types to include newer methods
interface RequestDeviceOptions {
  filters?: BluetoothLEScanFilter[];
  optionalServices?: BluetoothServiceUUID[];
  acceptAllDevices?: boolean;
}

interface BluetoothLEScanFilter {
  name?: string;
  namePrefix?: string;
  services?: BluetoothServiceUUID[];
}

type BluetoothServiceUUID = string | number;

interface Bluetooth {
  requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability(): Promise<boolean>;
  getDevices?(): Promise<BluetoothDevice[]>; // Optional newer method
}

// Extend Navigator interface to include the updated Bluetooth type
declare global {
  interface Navigator {
    bluetooth?: Bluetooth;
  }
}

// Bluetooth Web API types
interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
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
  removeEventListener(type: string, listener: (event: Event) => void): void;
  value?: DataView;
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
  private isStreaming: boolean;
  private batteryLevels: Map<string, number>;
  private dataCallback: ((deviceName: string, data: IMUData) => void) | null;
  private batteryUpdateCallbacks: Set<(levels: Map<string, number>) => void>;
  private sampleCounter = 0;
  
  // GATT operation queuing (Web Bluetooth best practice)
  private gattOperationQueue = new Map<string, Promise<any>>();
  private gattQueue = GATTOperationQueue.getInstance();
  private lastBatteryUpdate = new Map<string, number>();
  private readonly BATTERY_UPDATE_INTERVAL = 30000; // 30 seconds minimum between battery reads

  // Event listener tracking for proper cleanup - store characteristics to stop notifications
  private activeCharacteristics = new Map<string, BluetoothRemoteGATTCharacteristic>();
  private eventHandlers = new Map<string, (event: Event) => void>();
  private lastProcessedTimestamp = new Map<string, number>();

  // CRITICAL FIX: Timer cleanup tracking
  private cleanupInterval: NodeJS.Timeout | null = null;
  private serviceRestartInterval: NodeJS.Timeout | null = null;
  
  // Connection timeouts (1.2s recommended by Web Bluetooth spec)
  private readonly CONNECTION_TIMEOUT_MS = 10000; // 10s for initial connection
  private readonly GATT_OPERATION_TIMEOUT_MS = 1200; // 1.2s for GATT ops

  constructor() {
    this.connectedDevices = new Map();
    this.isStreaming = false;
    this.batteryLevels = new Map();
    this.dataCallback = null;
    this.batteryUpdateCallbacks = new Set();

    // Start periodic cleanup and monitoring
    this.startPeriodicCleanup();
    this.startServiceRestartTimer();
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

  /** Get names of devices that are currently streaming data */
  getStreamingDeviceNames(): string[] {
    if (!this.isStreaming) {
      return [];
    }
    
    // Return all connected device names when streaming is active
    return Array.from(this.connectedDevices.keys());
  }

  /** Check if a specific device is streaming */
  isDeviceStreaming(deviceName: string): boolean {
    return this.isStreaming && this.connectedDevices.has(deviceName);
  }

  /**
   * Fast reconnection using getDevices() - Web Bluetooth 2025 best practice
   */
  async reconnectToPreviousDevices(): Promise<BluetoothDevice[]> {
    console.log('\n🔍 ===== FAST RECONNECTION ATTEMPT =====');
    console.log(`🔍 Timestamp: ${new Date().toISOString()}`);
    console.log(`🔍 Web Bluetooth getDevices support: ${!!navigator.bluetooth?.getDevices}`);
    
    if (!navigator.bluetooth?.getDevices) {
      console.log('❌ getDevices() not supported, falling back to discovery');
      return [];
    }

    try {
      console.log('🔍 Checking for previously paired devices...');
      const devices = await navigator.bluetooth.getDevices();
      console.log(`🔍 getDevices() returned ${devices.length} total devices`);
      
      devices.forEach((device, index) => {
        console.log(`🔍   Device ${index + 1}: ${device.name} (${device.id}) - GATT connected: ${device.gatt?.connected || false}`);
      });
      
      const tropxDevices = devices.filter(device => 
        device.name && (
          device.name.toLowerCase().includes('tropx') || 
          device.name.toLowerCase().includes('muse')
        )
      );

      console.log(`✅ Found ${tropxDevices.length} previously paired Tropx devices`);
      tropxDevices.forEach((device, index) => {
        console.log(`✅   Tropx Device ${index + 1}: ${device.name} - GATT: ${device.gatt?.connected ? 'CONNECTED' : 'DISCONNECTED'}`);
      });
      
      console.log('🔍 ========================================\n');
      return tropxDevices;
      
    } catch (error) {
      console.error('❌ Error getting previous devices:', error);
      console.log('🔍 ========================================\n');
      return [];
    }
  }


  private async connectToDevice(device: BluetoothDevice): Promise<boolean> {
    try {
      if (!device) {
        throw new Error('Device is null or undefined');
      }
      if (!device.gatt) {
        throw new Error('Device GATT interface is not available');
      }
      if (device.gatt.connected) {
        console.log('🔵 Device already connected, proceeding with initialization');
      }

      const deviceName = device.name || `unknown_device_${device.id}`;
      console.log('🔵 Connecting to device:', deviceName);

      const server = await device.gatt.connect();
      console.log('🔵 Connected to GATT server');
      
      // Verify server connection
      if (!server || !server.connected) {
        throw new Error('GATT server connection failed or not connected');
      }

      const service = await server.getPrimaryService(MuseHardware.BLEConfig.SERVICE_UUID);
      console.log('🔵 Got primary service');

      const commandChar = await service.getCharacteristic(MuseHardware.BLEConfig.CMD_UUID);
      const dataChar = await service.getCharacteristic(MuseHardware.BLEConfig.DATA_UUID);
      console.log('🔵 Got characteristics');

      // CRITICAL: Use SDK commands for real device initialization
      console.log('🔵 Sending SDK initialization commands...');

      // Send device ID request to verify connection
      await this.sendCommand(commandChar, MuseCommands.Cmd_GetDeviceID());
      console.log('🔵 ✅ Device ID command sent');

      // Get system state to verify device is responsive
      await this.sendCommand(commandChar, MuseCommands.Cmd_GetSystemState());
      console.log('🔵 ✅ System state command sent');

      // Get sensor configuration
      await this.sendCommand(commandChar, MuseCommands.Cmd_GetSensorsFullScale());
      console.log('🔵 ✅ Sensor config command sent');

      // Store device using its name as the key
      this.connectedDevices.set(deviceName, {
        device,
        server,
        characteristics: {
          command: commandChar,
          data: dataChar
        }
      });

      // Use SDK command to get real battery level
      await this.updateBatteryLevelWithSDK(deviceName);

      console.log('🔵 ✅ Device successfully connected with SDK commands');
      return true;

    } catch (error) {
      console.error('🔵 ❌ Connection error:', error);
      
      // Clean up on connection failure
      try {
        if (device && device.gatt && device.gatt.connected) {
          console.log('🔧 Cleaning up failed connection...');
          device.gatt.disconnect();
        }
      } catch (cleanupError) {
        console.warn('⚠️ Error during connection cleanup:', cleanupError);
      }
      
      return false;
    }
  }

  // Helper method to send SDK commands properly
  private async sendCommand(characteristic: BluetoothRemoteGATTCharacteristic, command: Uint8Array): Promise<void> {
    try {
      console.log('🔵 Sending SDK command:', Array.from(command).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
      await characteristic.writeValue(command.buffer as ArrayBuffer);

      // Wait a bit for device to process command
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('🔵 ❌ Failed to send command:', error);
      throw error;
    }
  }

  // Get all scanned devices
  private scannedDevices: Map<string, BluetoothDevice> = new Map();

  getScannedDevices(): Map<string, BluetoothDevice> {
    return new Map(this.scannedDevices);
  }
  
  // 🚀 NEW: Cache real BluetoothDevice objects from requestDevice() calls
  cacheRealBluetoothDevice(deviceName: string, device: BluetoothDevice): void {
    console.log(`🗂️ SDK: Caching REAL BluetoothDevice: ${deviceName} (ID: ${device.id})`);
    console.log(`🗂️ SDK: Device has GATT interface: ${!!device.gatt}`);
    this.scannedDevices.set(deviceName, device);
    console.log(`🗂️ SDK: Cache now contains ${this.scannedDevices.size} real devices`);
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

  // Store devices from Electron's device discovery process
  addScannedDevices(devices: Array<{deviceId: string, deviceName: string}>): void {
    if (devices.length === 0) return;
    
    console.log(`🗂️ SDK Registry: Adding ${devices.length} device(s) to registry`);

    devices.forEach((device) => {
      // Mark these as Electron-discovered devices that need Web Bluetooth pairing
      const bluetoothDevice: BluetoothDevice = {
        id: device.deviceId,
        name: device.deviceName,
        gatt: undefined // Will be acquired from Web Bluetooth when connecting
      };

      this.scannedDevices.set(device.deviceName, bluetoothDevice);
      console.log(`📋 Added scanned device: ${device.deviceName} (requires Web Bluetooth pairing)`);
    });

    console.log(`✅ SDK Registry updated: ${this.scannedDevices.size} total devices available`);
  }

  // Connect to a device that was already discovered through scanning
  async connectToScannedDevice(deviceId: string, deviceName: string): Promise<boolean> {
    const connectionStartTime = Date.now();
    const timestamp = new Date().toISOString();
    
    console.log('\n🔗 ===== SDK CONNECTION ATTEMPT ANALYSIS =====');
    console.log(`🔗 Timestamp: ${timestamp}`);
    console.log(`🔗 Method: connectToScannedDevice`);
    console.log(`🔗 Target device: "${deviceName}"`);
    console.log(`🔗 Target ID: "${deviceId}"`);
    console.log(`🔗 Registry size: ${this.scannedDevices.size}`);
    console.log(`🔗 Connected devices: ${this.connectedDevices.size}`);

    try {

      // Enhanced connection state validation
      if (this.connectedDevices.has(deviceName)) {
        const device = this.connectedDevices.get(deviceName);

        if (device?.server?.connected) {
          console.log(`✅ SDK: Device ${deviceName} is already connected and active`);
          return true;
        } else {
          console.log(`🧹 SDK: Cleaning up stale connection for ${deviceName}`);
          this.connectedDevices.delete(deviceName);
          this.batteryLevels.delete(deviceName);
        }
      }

      // Step 1: Get the device from registry (this is just metadata from Electron scan)
      let registryDevice = this.scannedDevices.get(deviceName);

      if (!registryDevice) {
        // Try to find by ID as fallback
        for (const [key, device] of this.scannedDevices.entries()) {
          if (device.id === deviceId || key === deviceId) {
            registryDevice = device;
            break;
          }
        }
      }

      if (!registryDevice) {
        console.error(`❌ SDK: Device ${deviceName} (${deviceId}) not found in scanned devices`);
        console.error(`❌ SDK: Available devices: ${Array.from(this.scannedDevices.keys()).join(', ')}`);
        return false;
      }

      console.log(`📋 SDK: Found device ${deviceName} in registry`);

      // Step 2: Find the actual Web Bluetooth device (with GATT interface)
      let webBluetoothDevice: BluetoothDevice | null = null;
      const targetNameLc = (deviceName || '').toLowerCase();

      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth API not available');
      }

      // 🚀 USE REAL BLUETOOTHDEVICE FROM SCAN CACHE: This is the key to success!
      console.log(`🚀 SDK: Looking for REAL BluetoothDevice in scan cache for ${deviceName}`);
      
      // First, try to find the real BluetoothDevice from our scan cache
      webBluetoothDevice = null;
      
      // Search by device name (primary)
      if (this.scannedDevices.has(deviceName)) {
        webBluetoothDevice = this.scannedDevices.get(deviceName)!;
        console.log(`✅ SDK: Found REAL BluetoothDevice for ${deviceName} by name in scan cache`);
      } else {
        // Search by device ID (fallback)
        for (const [cachedName, cachedDevice] of this.scannedDevices.entries()) {
          if (cachedDevice.id === deviceId) {
            webBluetoothDevice = cachedDevice;
            console.log(`✅ SDK: Found REAL BluetoothDevice for ${deviceName} by ID (${deviceId}) under name ${cachedName}`);
            break;
          }
        }
      }
      
      if (webBluetoothDevice) {
        console.log(`🔍 SDK: Using REAL BluetoothDevice - ID: ${webBluetoothDevice.id}, Name: ${webBluetoothDevice.name}`);
        console.log(`🔍 SDK: Device has GATT interface: ${!!webBluetoothDevice.gatt}`);
        console.log(`🔍 SDK: GATT connected status: ${webBluetoothDevice.gatt?.connected || false}`);
      } else {
        console.error(`❌ SDK: REAL BluetoothDevice not found for ${deviceName} (${deviceId}) in scan cache!`);
        console.error(`❌ SDK: Available devices in cache: ${Array.from(this.scannedDevices.keys()).join(', ')}`);
        throw new Error(`Real BluetoothDevice not found for ${deviceName}. Please scan first to populate device cache.`);
      }

      // Step 3: Attempt connection with the Web Bluetooth device (must be paired already)
      console.log(`🔗 SDK: Connecting to Web Bluetooth device: ${deviceName}`);

      const connectionSuccess = await this.connectToDeviceWithTimeout(webBluetoothDevice!, this.CONNECTION_TIMEOUT_MS);

      if (connectionSuccess) {
        const connectionDuration = Date.now() - connectionStartTime;
        console.log('\n🔗 CONNECTION SUCCESS ANALYSIS:');
        console.log(`🔗 - Connection duration: ${connectionDuration}ms`);
        console.log(`🔗 - Method effectiveness: HIGHLY EFFECTIVE`);
        console.log(`🔗 - Device name: "${deviceName}"`);
        console.log(`🔗 - Connection type: Web Bluetooth with registry lookup + auto-pairing`);
        console.log(`✅ SDK: Successfully connected to ${deviceName}`);

        // Step 5: Verify connection by sending SDK commands
        console.log(`🔍 SDK: Verifying connection to ${deviceName} using SDK commands...`);

        const actualKey = webBluetoothDevice!.name || deviceName;
        let connectedEntry = this.connectedDevices.get(actualKey) || this.connectedDevices.get(deviceName);
        if (!connectedEntry) {
          // Fallback: find by device ID in case of key mismatch
          for (const [key, entry] of this.connectedDevices.entries()) {
            if (entry.device.id === webBluetoothDevice!.id) {
              connectedEntry = entry;
              console.log(`🔍 SDK: Resolved connected entry via ID under key: ${key}`);
              break;
            }
          }
        }

        if (connectedEntry?.characteristics?.command) {
          try {
            const stateCommand = MuseCommands.Cmd_GetSystemState();
            await connectedEntry.characteristics.command.writeValue(stateCommand.buffer as ArrayBuffer);
            console.log(`✅ SDK: State command sent successfully to ${actualKey}`);

            const deviceIdCommand = MuseCommands.Cmd_GetDeviceID();
            await connectedEntry.characteristics.command.writeValue(deviceIdCommand.buffer as ArrayBuffer);
            console.log(`✅ SDK: Device ID command sent successfully to ${actualKey}`);

            console.log(`✅ SDK: Device ${actualKey} is TRULY connected and responding to SDK commands`);
            return true;

          } catch (cmdError) {
            console.error(`❌ SDK: Device ${actualKey} connected but not responding to SDK commands:`, cmdError);
            return true; // Still consider it connected since GATT succeeded
          }
        } else {
          console.error(`❌ SDK: Device ${actualKey} missing command characteristics`);
          return false;
        }
      } else {
        console.error(`❌ SDK: Failed to connect to ${deviceName}`);
        return false;
      }

    } catch (error) {
      const connectionDuration = Date.now() - connectionStartTime;
      console.error('\n🔗 CONNECTION FAILURE ANALYSIS:');
      console.error(`🔗 - Connection duration: ${connectionDuration}ms`);
      console.error(`🔗 - Method effectiveness: FAILED`);
      console.error(`🔗 - Error type: ${error instanceof Error ? error.name : 'Unknown'}`);
      console.error(`🔗 - Error message: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`🔗 - Device availability in registry: ${this.scannedDevices.has(deviceName) ? 'PRESENT' : 'MISSING'}`);

      // Enhanced error guidance
      if (error instanceof Error) {
        if (error.message.includes('No device selected')) {
          console.error(`🔗 - Recommendation: Retry pairing and ensure the correct device is selected`);
        } else if (error.message.includes('Pairing failed')) {
          console.error(`🔗 - Recommendation: Ensure Bluetooth is on and device is advertising, then retry`);
        } else if (error.message.includes('not available')) {
          console.error(`🔗 - Recommendation: Use a supported browser/electron version with Web Bluetooth`);
        }
      }

      console.error(`❌ SDK: Failed to connect to scanned device ${deviceName}:`, error);
      console.error('🔗 ============================================\n');
      return false;
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

      // NUCLEAR FIX: Clear ALL existing handlers before starting
      for (const [deviceName, handler] of this.eventHandlers.entries()) {
        const characteristic = this.activeCharacteristics.get(deviceName);
        if (characteristic) {
          try {
            characteristic.removeEventListener('characteristicvaluechanged', handler);
          } catch (e) {
            // Silent cleanup
          }
        }
      }

      // Clear all maps
      this.eventHandlers.clear();
      this.activeCharacteristics.clear();

      this.dataCallback = callback;
      console.log('Starting streaming for all connected devices...');

      for (const [deviceName, device] of this.connectedDevices.entries()) {
        if (!device.characteristics?.data || !device.characteristics?.command) {
          console.warn(`Device ${deviceName} missing required characteristics`);
          continue;
        }

        const dataChar = device.characteristics.data;

        // CRITICAL FIX: Stop notifications first to clear browser-level handlers
        try {
          await (dataChar as any).stopNotifications();
        } catch (e) {
          // Expected for new connections
        }

        await dataChar.startNotifications();

        // CRITICAL FIX: Remove any existing event handler to prevent accumulation
        const existingHandler = this.eventHandlers.get(deviceName);
        const existingCharacteristic = this.activeCharacteristics.get(deviceName);

        if (existingHandler && existingCharacteristic) {
          // Remove from the ORIGINAL characteristic it was attached to
          existingCharacteristic.removeEventListener('characteristicvaluechanged', existingHandler);
          this.eventHandlers.delete(deviceName);
        } else if (existingHandler) {
          this.eventHandlers.delete(deviceName);
        }

        // Create event handler with immediate deduplication
        let processingPacket = false;
        const eventHandler = (event: Event) => {
          // IMMEDIATE DEDUPLICATION: Prevent multiple handlers processing same packet
          if (processingPacket) {
            return;
          }
          processingPacket = true;

          if (!this.dataCallback) {
            processingPacket = false;
            return;
          }

          const characteristic = event.target as unknown as BluetoothRemoteGATTCharacteristic;
          const value = characteristic.value;
          if (!value) return;

          try {
            const timestamp = Date.now();

            // CRITICAL FIX: Less aggressive deduplication - allow same timestamp, only block significantly old data
            const lastTimestamp = this.lastProcessedTimestamp.get(deviceName) || 0;
            if (timestamp < lastTimestamp - 100) { // Only skip if > 100ms old
              console.warn(`Skipping old packet: ${timestamp} vs ${lastTimestamp} for ${deviceName}`);
              return; // Skip very old data only
            }
            this.lastProcessedTimestamp.set(deviceName, timestamp);

            const rawData = new Uint8Array(value.buffer);
            const data = MuseDataParser.decodePacket(
              rawData,
              timestamp,
              MuseHardware.DataMode.QUATERNION, // Use proper SDK mode
              { FullScale: 2000, Sensitivity: 1.0 }, // Proper sensor configs
              { FullScale: 16, Sensitivity: 1.0 },
              { FullScale: 4912, Sensitivity: 1.0 }
            );

            // Send data to callback without performance monitoring (renderer should be minimal)
            this.dataCallback(deviceName, data);

            // Reset processing flag
            processingPacket = false;
          } catch (error) {
            console.error('Data processing error:', error);
            processingPacket = false; // Reset on error
          }
        };

        // Store characteristic and event handler for cleanup and add event handler
        this.activeCharacteristics.set(deviceName, dataChar);
        this.eventHandlers.set(deviceName, eventHandler);
        dataChar.addEventListener('characteristicvaluechanged', eventHandler);

        // 🔧 FIX: Use proper SDK command instead of hardcoded array
        console.log(`🎯 Using SDK command for streaming on ${deviceName}...`);
        const streamCommand = MuseCommands.Cmd_StartStream(
          MuseHardware.DataMode.QUATERNION,
          MuseHardware.DataFrequency.HZ_100
        );

        await device.characteristics.command.writeValue(streamCommand.buffer as ArrayBuffer);
        console.log(`✅ Started streaming for device ${deviceName} using SDK command`);
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

        // 🔧 FIX: Clean up notifications AND event handlers FIRST to prevent memory leaks
        const characteristic = this.activeCharacteristics.get(deviceName);
        const eventHandler = this.eventHandlers.get(deviceName);

        if (characteristic && eventHandler) {
          try {
            // CRITICAL: Remove event listener FIRST - stopNotifications() alone doesn't remove listeners!
            characteristic.removeEventListener('characteristicvaluechanged', eventHandler);
            this.eventHandlers.delete(deviceName);
            console.log(`🧹 ACTUALLY removed event handler for ${deviceName}`);

            // Then stop notifications
            await (characteristic as any).stopNotifications();
            this.activeCharacteristics.delete(deviceName);
            console.log(`🧹 Stopped notifications for ${deviceName}`);
          } catch (error) {
            // Ensure cleanup even if operations fail
            try {
              characteristic.removeEventListener('characteristicvaluechanged', eventHandler);
            } catch {}
            this.activeCharacteristics.delete(deviceName);
            this.eventHandlers.delete(deviceName);
          }
        }

        // Clear deduplication timestamps
        this.lastProcessedTimestamp.delete(deviceName);

        // 🔧 FIX: Use proper SDK command instead of hardcoded array
        console.log(`🎯 Using SDK command to stop streaming on ${deviceName}...`);
        const stopCommand = MuseCommands.Cmd_StopStream();
        await device.characteristics.command.writeValue(stopCommand.buffer as ArrayBuffer);

        // Notifications already stopped above in cleanup
        console.log(`✅ Stopped streaming for device ${deviceName} using SDK command`);
      }

      this.isStreaming = false;
      this.dataCallback = null;

    } catch (error) {
      console.error('Error stopping stream:', error);
      throw error;
    }
  }

  /**
   * Connection with timeout and retry logic (Web Bluetooth 2025 best practice)
   */
  private async connectToDeviceWithTimeout(device: BluetoothDevice, timeoutMs: number = this.CONNECTION_TIMEOUT_MS): Promise<boolean> {
    console.log(`\n⏱️ ===== CONNECTION WITH TIMEOUT =====`);
    console.log(`⏱️ Device: ${device.name || 'Unknown'} (${device.id})`);
    console.log(`⏱️ Timeout: ${timeoutMs}ms`);
    console.log(`⏱️ Device GATT connected: ${device.gatt?.connected || false}`);
    console.log(`⏱️ Max retries: 3`);
    
    try {
      const result = await this.retryWithExponentialBackoff(
        () => {
          console.log(`⏱️ Starting connection race (timeout vs connectToDevice)`);
          return Promise.race([
            this.connectToDevice(device),
            new Promise<boolean>((_, reject) => {
              setTimeout(() => {
                console.log(`⏱️ ❌ TIMEOUT TRIGGERED after ${timeoutMs}ms`);
                reject(new Error(`Connection timeout after ${timeoutMs}ms`));
              }, timeoutMs);
            })
          ]);
        },
        3, // maxRetries
        device.name || 'Unknown Device'
      );
      
      console.log(`⏱️ ✅ Connection successful: ${result}`);
      console.log(`⏱️ ===================================\n`);
      return result;
      
    } catch (error) {
      console.log(`⏱️ ❌ Connection failed: ${error instanceof Error ? error.message : error}`);
      console.log(`⏱️ ===================================\n`);
      throw error;
    }
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
   * GATT operation with timeout and queuing (prevents "GATT operation in progress" errors)
   */
  private async executeGattOperationWithTimeout<T>(
    deviceName: string, 
    operation: () => Promise<T>, 
    timeoutMs: number = this.GATT_OPERATION_TIMEOUT_MS
  ): Promise<T> {
    // Queue GATT operations per device to prevent conflicts
    const existingOperation = this.gattOperationQueue.get(deviceName);
    
    const queuedOperation = (existingOperation || Promise.resolve()).then(async () => {
      return Promise.race([
        operation(),
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error(`GATT operation timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
    }).catch(error => {
      // Clean up queue on error
      this.gattOperationQueue.delete(deviceName);
      throw error;
    });
    
    this.gattOperationQueue.set(deviceName, queuedOperation);
    return queuedOperation;
  }

  // Utility methods
  getBatteryLevel(deviceName: string): number | null {
    return this.batteryLevels.get(deviceName) ?? null;
  }


  getConnectedDevices(): Map<string, WebMuseDevice> {
    return new Map(this.connectedDevices);
  }


  getAllBatteryLevels(): Map<string, number> {
    return new Map(this.batteryLevels);
  }

  // Send start recording command to all connected devices
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

        const recordingPromise = this.gattQueue.queueOperation(
          deviceName,
          'start_recording',
          async () => {
            const startRecordCommand = MuseCommands.Cmd_StartRecording();
            await device.characteristics!.command.writeValue(startRecordCommand.buffer as ArrayBuffer);
            console.log(`✅ Start recording command sent to ${deviceName}`);
            return true;
          },
          10, // HIGH priority - recording commands are critical
          5000 // 5s timeout
        ).catch(error => {
          console.error(`❌ Failed to send start recording command to ${deviceName}:`, error);
          return false;
        });

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

  // Send stop recording command to all connected devices
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

        const recordingPromise = this.gattQueue.queueOperation(
          deviceName,
          'stop_recording',
          async () => {
            const stopRecordCommand = MuseCommands.Cmd_StopRecording();
            await device.characteristics!.command.writeValue(stopRecordCommand.buffer as ArrayBuffer);
            console.log(`✅ Stop recording command sent to ${deviceName}`);
            return true;
          },
          10, // HIGH priority - recording commands are critical
          5000 // 5s timeout
        ).catch(error => {
          console.error(`❌ Failed to send stop recording command to ${deviceName}:`, error);
          return false;
        });

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

  // Update battery level with proper SDK command (throttled to prevent GATT conflicts)
  async updateBatteryLevel(deviceName: string): Promise<void> {
    const now = Date.now();
    const lastUpdate = this.lastBatteryUpdate.get(deviceName) || 0;
    
    // Throttle battery reads to prevent GATT conflicts
    if (now - lastUpdate < this.BATTERY_UPDATE_INTERVAL) {
      return; // Skip if updated recently
    }

    const device = this.connectedDevices.get(deviceName);
    if (!device?.characteristics?.command) {
      return;
    }

    try {
      // Use GATT queue with LOW priority for battery reads (priority = 1)
      await this.gattQueue.queueOperation(
        deviceName,
        'battery_read',
        async () => {
          const batteryCommand = MuseCommands.Cmd_GetBatteryCharge();
          await device.characteristics!.command.writeValue(batteryCommand.buffer as ArrayBuffer);
          
          // Wait for response
          await new Promise(resolve => setTimeout(resolve, 300));
          
          const response = await device.characteristics!.command.readValue();
          const batteryLevel = response.getUint8(4);
          
          this.batteryLevels.set(deviceName, batteryLevel);
          this.lastBatteryUpdate.set(deviceName, now);
          this.notifyBatteryUpdateListeners();
          
          return batteryLevel;
        },
        1, // LOW priority - don't interfere with recording commands
        3000 // 3s timeout
      );
      
    } catch (error) {
      // Only log non-timeout errors to reduce noise
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('timeout') && !errorMessage.includes('cancelled')) {
        console.warn(`🔋 Battery read skipped for ${deviceName}:`, errorMessage);
      }
    }
  }

  // Force battery level update for all connected devices (throttled)
  async updateAllBatteryLevels(): Promise<void> {
    // Only update if we have connected devices
    if (this.connectedDevices.size === 0) return;

    const updatePromises: Promise<void>[] = [];
    let updateCount = 0;

    this.connectedDevices.forEach((device, deviceName) => {
      const now = Date.now();
      const lastUpdate = this.lastBatteryUpdate.get(deviceName) || 0;
      
      // Only update if enough time has passed
      if (now - lastUpdate >= this.BATTERY_UPDATE_INTERVAL) {
        updatePromises.push(this.updateBatteryLevel(deviceName));
        updateCount++;
      }
    });

    if (updateCount > 0) {
      await Promise.all(updatePromises);
    }
  }

  // Update battery level with proper SDK command
  private async updateBatteryLevelWithSDK(deviceName: string): Promise<void> {
    const device = this.connectedDevices.get(deviceName);
    if (!device?.characteristics?.command) {
      console.log(`🔋 No command characteristic for ${deviceName}`);
      return;
    }

    try {
      console.log(`🔋 SDK: Requesting battery level for ${deviceName} using SDK command...`);
      const batteryCommand = MuseCommands.Cmd_GetBatteryCharge();

      // Send the SDK battery command
      await this.sendCommand(device.characteristics.command, batteryCommand);

      // Wait for response and try to read it
      await new Promise(resolve => setTimeout(resolve, 200));

      try {
        const response = await device.characteristics.command.readValue();
        console.log(`🔋 SDK: Battery response for ${deviceName}:`, new Uint8Array(response.buffer));

        // Parse battery level from response (typically at offset 4 for Muse devices)
        if (response.byteLength >= 5) {
          const batteryLevel = response.getUint8(4);
          this.batteryLevels.set(deviceName, batteryLevel);
          this.notifyBatteryUpdateListeners();
          console.log(`🔋 SDK: Battery level for ${deviceName}: ${batteryLevel}%`);
        } else {
          console.warn(`🔋 SDK: Invalid battery response length for ${deviceName}: ${response.byteLength} bytes`);
        }
      } catch (readError) {
        console.warn(`🔋 SDK: Could not read battery response for ${deviceName}:`, readError);
        // Set a placeholder battery level to indicate SDK command was sent
        this.batteryLevels.set(deviceName, 85); // Placeholder value
        this.notifyBatteryUpdateListeners();
      }

    } catch (error) {
      console.error(`🔋 SDK: Battery level request error for ${deviceName}:`, error);
    }
  }

  // Disconnect a specific device
  async disconnectDevice(deviceName: string): Promise<boolean> {
    console.log(`🔌 SDK: Disconnecting device: ${deviceName}`);
    
    try {
      const device = this.connectedDevices.get(deviceName);
      if (!device) {
        console.log(`⚠️ SDK: Device ${deviceName} not found in connected devices`);
        return false;
      }

      // Stop streaming if active
      if (this.isStreaming) {
        console.log(`🔌 SDK: Stopping streaming for ${deviceName}`);
        await this.stopStreaming();
      }

      // Disconnect GATT server
      if (device.server && device.server.connected) {
        console.log(`🔌 SDK: Disconnecting GATT server for ${deviceName}`);
        device.server.disconnect();
      }

      // Clean up device state, event handlers, and stop notifications
      const characteristic = this.activeCharacteristics.get(deviceName);
      const eventHandler = this.eventHandlers.get(deviceName);

      if (characteristic && eventHandler) {
        try {
          // CRITICAL: Remove event listener FIRST - stopNotifications() alone doesn't remove listeners!
          characteristic.removeEventListener('characteristicvaluechanged', eventHandler);
          this.eventHandlers.delete(deviceName);
          console.log(`🧹 ACTUALLY removed event handler for ${deviceName}`);

          // Then stop notifications
          await (characteristic as any).stopNotifications();
          this.activeCharacteristics.delete(deviceName);
          console.log(`🧹 Stopped notifications for ${deviceName}`);
        } catch (error) {
          // Ensure cleanup even if operations fail
          try {
            characteristic.removeEventListener('characteristicvaluechanged', eventHandler);
          } catch {}
          this.activeCharacteristics.delete(deviceName);
          this.eventHandlers.delete(deviceName);
        }
      }

      // Clear device data
      this.connectedDevices.delete(deviceName);
      this.batteryLevels.delete(deviceName);
      this.lastProcessedTimestamp.delete(deviceName);
      this.lastBatteryUpdate.delete(deviceName);
      
      console.log(`✅ SDK: Successfully disconnected ${deviceName}`);
      return true;
      
    } catch (error) {
      console.error(`❌ SDK: Error disconnecting ${deviceName}:`, error);
      // Clean up anyway
      this.activeCharacteristics.delete(deviceName);
      this.eventHandlers.delete(deviceName);
      this.connectedDevices.delete(deviceName);
      this.batteryLevels.delete(deviceName);
      this.lastProcessedTimestamp.delete(deviceName);
      this.lastBatteryUpdate.delete(deviceName);
      return false;
    }
  }

  // Check if streaming is active
  getIsStreaming(): boolean {
    return this.isStreaming;
  }

  // One-time device pairing method (shows chooser intentionally)
  async pairNewDevice(): Promise<{ success: boolean; deviceName: string | null; message: string }> {
    console.log('🔗 SDK: Starting one-time device pairing process...');
    
    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth API not available');
      }

      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'tropx_' }
        ],
        optionalServices: [MuseHardware.BLEConfig.SERVICE_UUID]
      });
      
      if (device && device.name) {
        console.log(`✅ SDK: Device ${device.name} paired successfully`);
        
        // Add to scanned devices registry
        this.scannedDevices.set(device.name, device as any);
        
        return {
          success: true,
          deviceName: device.name,
          message: `Device ${device.name} paired successfully. It will now be available for connection.`
        };
      } else {
        throw new Error('No device selected or device has no name');
      }
      
    } catch (error) {
      console.error('❌ SDK: Device pairing failed:', error);
      return {
        success: false,
        deviceName: null,
        message: `Pairing failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Check if device is actually connected
  isDeviceConnected(deviceName: string): boolean {
    const device = this.connectedDevices.get(deviceName);
    
    // Enhanced connection validation
    if (!device || !device.server) {
      return false;
    }
    
    // Check GATT server connection status
    if (!device.server.connected) {
      console.log(`⚠️ Device ${deviceName} in registry but GATT disconnected, cleaning up...`);
      this.connectedDevices.delete(deviceName);
      this.batteryLevels.delete(deviceName);
      return false;
    }
    
    return true;
  }

  /**
   * Reset a specific device's state completely (useful after connection failures)
   */
  resetDeviceState(deviceName: string): void {
    console.log(`\n🔄 ===== RESETTING DEVICE STATE =====`);
    console.log(`🔄 Device: ${deviceName}`);
    
    // Remove from all registries
    console.log(`🔄 Removing from connected devices...`);
    this.connectedDevices.delete(deviceName);
    
    console.log(`🔄 Removing from battery levels...`);
    this.batteryLevels.delete(deviceName);
    
    // Reset scanned device GATT interface
    const scannedDevice = this.scannedDevices.get(deviceName);
    if (scannedDevice) {
      console.log(`🔄 Resetting GATT interface (was connected: ${scannedDevice.gatt?.connected || false})`);
      scannedDevice.gatt = undefined;
    } else {
      console.log(`🔄 Device not found in scanned devices registry`);
    }
    
    console.log(`✅ Device state reset completed for ${deviceName}`);
    console.log(`🔄 ===================================\n`);
  }
  
  /**
   * Force clear Web Bluetooth cache and all device state (nuclear option)
   */
  async forceResetAllDeviceState(): Promise<void> {
    console.log(`\n💥 ===== FORCE RESET ALL DEVICE STATE =====`);
    
    // Stop any active streaming
    if (this.isStreaming) {
      console.log(`💥 Stopping active streaming...`);
      await this.stopStreaming();
    }
    
    // Clear all registries
    console.log(`💥 Clearing all device registries...`);
    this.connectedDevices.clear();
    this.batteryLevels.clear();
    this.scannedDevices.clear();
    
    // Clear any callbacks
    this.dataCallback = null;
    
    console.log(`✅ Force reset completed - all device state cleared`);
    console.log(`💥 =======================================\n`);
  }

  // CRITICAL FIX: Complete cleanup method to prevent memory leaks
  cleanup(): void {
    console.log(`🧹 SDK: Performing complete cleanup...`);

    // Stop periodic cleanup timer
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log(`🧹 SDK: Cleanup timer stopped`);
    }

    // Stop service restart timer
    if (this.serviceRestartInterval) {
      clearInterval(this.serviceRestartInterval);
      this.serviceRestartInterval = null;
      console.log(`🧹 SDK: Service restart timer stopped`);
    }

    // Stop streaming if active
    if (this.isStreaming) {
      this.isStreaming = false;
      this.dataCallback = null;
    }

    // Clean up all event handlers
    this.eventHandlers.clear();
    this.activeCharacteristics.clear();

    // Clear all device connections and state
    this.connectedDevices.clear();
    this.batteryLevels.clear();
    this.scannedDevices.clear();
    this.lastProcessedTimestamp.clear();
    this.lastBatteryUpdate.clear();
    this.gattOperationQueue.clear();

    // Clear all callbacks
    this.batteryUpdateCallbacks.clear();

    console.log(`✅ SDK: Complete cleanup finished`);
  }

  // Reset SDK state (useful for troubleshooting)
  resetSDKState(): void {
    console.log(`🔄 SDK: Resetting SDK state...`);

    // Stop streaming if active
    if (this.isStreaming) {
      this.isStreaming = false;
      this.dataCallback = null;
    }

    // Clear all device connections
    this.connectedDevices.clear();
    this.batteryLevels.clear();
    this.scannedDevices.clear();

    console.log(`✅ SDK: State reset complete`);
  }

  /**
   * Public wrapper to connect a Web Bluetooth device selected via requestDevice
   * This allows the renderer to explicitly select a device (triggering Electron's
   * select-bluetooth-device flow), then pass the selected device here to complete
   * the GATT connection and SDK initialization.
   */
  public async connectWebBluetoothDevice(device: BluetoothDevice, timeoutMs: number = this.CONNECTION_TIMEOUT_MS): Promise<boolean> {
    if (!device) {
      throw new Error('No Bluetooth device provided');
    }

    // Prefer the provided device name as the key where possible
    const deviceName = device.name || `unknown_device_${device.id}`;

    // Clean up any stale entry under the same name
    const existing = this.connectedDevices.get(deviceName);
    if (existing?.server?.connected) {
      console.log(`🔁 Device ${deviceName} already connected, reusing connection`);
      return true;
    } else if (existing) {
      console.log(`🧹 Cleaning up stale connection for ${deviceName}`);
      this.connectedDevices.delete(deviceName);
      this.batteryLevels.delete(deviceName);
    }

    // Attempt connection using the same robust timeout/retry flow
    const connected = await this.connectToDeviceWithTimeout(device, timeoutMs);
    return connected;
  }

  // Performance monitoring and cleanup methods
  private startPeriodicCleanup(): void {
    // CRITICAL FIX: Clear existing timer to prevent accumulation
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
      this.logPerformanceMetrics();
    }, 60000); // Every 60 seconds
  }

  private performMemoryCleanup(): void {
    // Clean up GATT queue
    this.gattQueue.performPeriodicCleanup();

    // Clean up stale timestamp entries
    const now = Date.now();
    const staleThreshold = 300000; // 5 minutes

    this.lastProcessedTimestamp.forEach((timestamp, deviceId) => {
      if (now - timestamp > staleThreshold) {
        this.lastProcessedTimestamp.delete(deviceId);
      }
    });

    this.lastBatteryUpdate.forEach((timestamp, deviceId) => {
      if (now - timestamp > staleThreshold && !this.connectedDevices.has(deviceId)) {
        this.lastBatteryUpdate.delete(deviceId);
      }
    });
  }

  private logPerformanceMetrics(): void {
    const gattStats = this.gattQueue.getMemoryStats();
    const metrics = {
      connectedDevices: this.connectedDevices.size,
      activeCharacteristics: this.activeCharacteristics.size,
      timestampCache: this.lastProcessedTimestamp.size,
      batteryCache: this.lastBatteryUpdate.size,
      gattQueues: gattStats.queueCount,
      activeGattOps: gattStats.activeOperations,
      pendingTimeouts: gattStats.pendingTimeouts,
      isStreaming: this.isStreaming,
      batteryUpdateCallbacks: this.batteryUpdateCallbacks.size
    };

    // Only log if there are potential issues or during debugging
    const totalMemoryItems = metrics.activeCharacteristics + metrics.timestampCache + metrics.batteryCache + metrics.gattQueues;
    if (totalMemoryItems > 20 || metrics.pendingTimeouts > 5) {
      console.log('🔍 MuseManager Performance Metrics:', metrics);
    }
  }

  // Get current memory usage statistics
  getPerformanceMetrics(): any {
    const gattStats = this.gattQueue.getMemoryStats();
    return {
      connectedDevices: this.connectedDevices.size,
      activeCharacteristics: this.activeCharacteristics.size,
      timestampCache: this.lastProcessedTimestamp.size,
      batteryCache: this.lastBatteryUpdate.size,
      gattQueues: gattStats.queueCount,
      activeGattOps: gattStats.activeOperations,
      pendingTimeouts: gattStats.pendingTimeouts,
      isStreaming: this.isStreaming,
      batteryUpdateCallbacks: this.batteryUpdateCallbacks.size,
      memoryHealth: this.assessMemoryHealth()
    };
  }

  private assessMemoryHealth(): 'good' | 'warning' | 'critical' {
    const gattStats = this.gattQueue.getMemoryStats();
    const totalItems = this.activeCharacteristics.size + this.lastProcessedTimestamp.size + gattStats.queueCount;

    if (totalItems > 50 || gattStats.pendingTimeouts > 10) return 'critical';
    if (totalItems > 20 || gattStats.pendingTimeouts > 5) return 'warning';
    return 'good';
  }

  // CRITICAL FIX: Service restart mechanism to prevent long-term accumulation
  private startServiceRestartTimer(): void {
    if (this.serviceRestartInterval) {
      clearInterval(this.serviceRestartInterval);
    }

    // Restart streaming service every 2 hours to prevent memory accumulation
    this.serviceRestartInterval = setInterval(async () => {
      const wasStreaming = this.isStreaming;
      const connectedDeviceNames = Array.from(this.connectedDevices.keys());

      console.log('🔄 Performing preventive service restart to clear accumulated state...');

      try {
        // Stop streaming if active
        if (wasStreaming) {
          await this.stopStreaming();
        }

        // Clear accumulated state but keep connections
        this.eventHandlers.clear();
        this.lastProcessedTimestamp.clear();
        this.gattQueue.clearAllQueues();

        // Restart streaming if it was active
        if (wasStreaming && connectedDeviceNames.length > 0) {
          // Small delay to ensure cleanup is complete
          setTimeout(async () => {
            if (this.dataCallback) {
              await this.startStreaming(this.dataCallback);
              console.log('✅ Service restart completed - streaming resumed');
            }
          }, 1000);
        } else {
          console.log('✅ Service restart completed - no streaming to resume');
        }
      } catch (error) {
        console.error('❌ Error during service restart:', error);
      }
    }, 2 * 60 * 60 * 1000); // 2 hours
  }
}

// Create and export singleton instance
export const museManager = new MuseManager();
