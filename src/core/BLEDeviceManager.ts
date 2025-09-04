/**
 * Centralized BLE Device Manager - Single Source of Truth
 * 
 * This is the authoritative state manager for all BLE operations.
 * All device connections, state changes, and streaming operations
 * must go through this manager to ensure proper synchronization.
 */

import { 
  DeviceState, 
  DeviceEvent, 
  DeviceInfo, 
  DeviceContext,
  AppError,
  IMUData 
} from './types';
import { deviceStateMachine } from './DeviceStateMachine';
import { museManager } from '../../sdk/core/MuseManager';
import { streamDataManager } from './StreamDataManager';
import { ERROR_CODES, PERFORMANCE_CONSTANTS } from './constants';

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
}

export interface BLEDeviceManagerConfig {
  enableAutoRetry: boolean;
  maxRetryAttempts: number;
  retryDelayMs: number;
  batteryUpdateIntervalMs: number;
  connectionTimeoutMs: number;
}

const DEFAULT_CONFIG: BLEDeviceManagerConfig = {
  enableAutoRetry: true,
  maxRetryAttempts: 3,
  retryDelayMs: 2000,
  batteryUpdateIntervalMs: 30000,
  connectionTimeoutMs: 10000,
};

export type DeviceStateListener = (deviceId: string, newState: DeviceState, context?: DeviceContext) => void;
export type DataListener = (deviceId: string, data: IMUData) => void;
export type ErrorListener = (deviceId: string, error: AppError) => void;

/**
 * Centralized BLE Device Manager implementing the Single Source of Truth pattern
 * 
 * All BLE operations MUST go through this manager to ensure:
 * - Proper state synchronization
 * - Race condition prevention  
 * - Controlled streaming initiation
 * - Centralized error handling
 */
export class BLEDeviceManager {
  private static instance: BLEDeviceManager | null = null;
  
  // Single source of truth for all device states
  private readonly devices = new Map<string, DeviceInfo>();
  private readonly bluetoothDevices = new Map<string, BluetoothDevice>(); // Store actual BT devices
  private readonly config: BLEDeviceManagerConfig;
  private readonly connectionLocks = new Map<string, Promise<boolean>>();
  private readonly pendingOperations = new Map<string, Set<string>>();
  
  // Connection queue system for parallel connections
  private readonly connectionQueue = new Map<string, Promise<boolean>>();
  private readonly maxConcurrentConnections = 3; // Allow up to 3 simultaneous connections
  private activeConnections = 0;

  // Event listeners
  private readonly stateListeners = new Set<DeviceStateListener>();
  private readonly dataListeners = new Set<DataListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  
  // Internal state
  private isInitialized = false;
  private isScanning = false;
  private batteryUpdateInterval: NodeJS.Timeout | null = null;
  private recordingMode = false; // Critical: Controls when streaming is allowed
  
  // Singleton scan control
  private static activeScanPromise: Promise<DeviceInfo[]> | null = null;

  private constructor(config: Partial<BLEDeviceManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setupStateMachineIntegration();
    console.log('🏗️ BLE Device Manager created with config:', this.config);
  }

  public static getInstance(config?: Partial<BLEDeviceManagerConfig>): BLEDeviceManager {
    if (!BLEDeviceManager.instance) {
      BLEDeviceManager.instance = new BLEDeviceManager(config);
    }
    return BLEDeviceManager.instance;
  }

  public static reset(): void {
    if (BLEDeviceManager.instance) {
      BLEDeviceManager.instance.cleanup();
      BLEDeviceManager.instance = null;
    }
  }

  /**
   * Initialize the BLE Device Manager
   * Must be called before any BLE operations
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('🔄 BLE Device Manager already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing BLE Device Manager...');
      
      // Validate Web Bluetooth availability
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth is not supported in this environment');
      }

      // Initialize underlying managers
      await this.initializeSubsystems();
      
      // Start background services
      this.startBatteryUpdateService();
      
      this.isInitialized = true;
      console.log('✅ BLE Device Manager initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize BLE Device Manager:', error);
      throw error;
    }
  }

  /**
   * Scan for available BLE devices - properly integrated with Electron
   * This triggers the Web Bluetooth API, which will be handled by Electron's main process
   */
  public async scanForDevices(): Promise<DeviceInfo[]> {
    this.assertInitialized();
    
    // Singleton pattern: return existing scan promise if one is active
    if (BLEDeviceManager.activeScanPromise) {
      console.log('⚠️ Scan already in progress - returning existing scan promise');
      return await BLEDeviceManager.activeScanPromise;
    }

    console.log('🔍 Starting Electron-integrated BLE device scan...');
    
    // Create new scan promise and store it as active
    BLEDeviceManager.activeScanPromise = this.performElectronIntegratedScan();
    
    try {
      const result = await BLEDeviceManager.activeScanPromise;
      return result;
    } finally {
      // Clear active scan promise when done
      BLEDeviceManager.activeScanPromise = null;
    }
  }

  /**
   * Perform Electron-integrated scan that works with main process select-bluetooth-device handler
   * This will return ALL available devices instead of just one
   */
  private async performElectronIntegratedScan(): Promise<DeviceInfo[]> {
    try {
      this.isScanning = true;
      
      // Clear previous scan results
      this.clearDisconnectedDevices();
      
      console.log('🔍 Setting up device list listener...');

      // Set up promise to receive device list from Electron main process
      return new Promise<DeviceInfo[]>((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;

        // Set up listener for device list from WebSocket or Window messages
        const handleDeviceList = (event: MessageEvent | any) => {
          try {
            let message;

            // Handle both WebSocket and Window message events
            if (event.data) {
              if (typeof event.data === 'string') {
                message = JSON.parse(event.data);
              } else {
                message = event.data;
              }
            } else {
              return; // Ignore invalid events
            }

            if (message.type === 'DEVICE_SCAN_RESULT') {
              console.log('🔍 Received device scan result:', message.data);

              // Clear timeout and remove listener
              clearTimeout(timeoutId);
              if (typeof window !== 'undefined' && window.removeEventListener) {
                window.removeEventListener('message', handleDeviceList);
              }
              
              // Process ALL devices from the scan result
              const devices = (message.data.devices || []).map((device: any) => this.createDeviceInfo(device));

              // Add all devices to our device map
              devices.forEach(device => {
                this.devices.set(device.id, device);
                this.notifyStateChange(device.id, DeviceState.DISCONNECTED_AVAILABLE);
              });
              
              console.log(`✅ Received ${devices.length} devices from Electron scan`);
              console.log('🔍 Device details:', devices.map(d => ({ id: d.id, name: d.name })));

              resolve(devices);
            }
          } catch (error) {
            console.error('❌ Error processing device list:', error);
            clearTimeout(timeoutId);
            if (typeof window !== 'undefined' && window.removeEventListener) {
              window.removeEventListener('message', handleDeviceList);
            }
            reject(error);
          }
        };

        // Listen for device list from main process
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('message', handleDeviceList);
        }

        // Set timeout for scan (increased to 20 seconds for better reliability)
        timeoutId = setTimeout(() => {
          console.log('⏱️ Device scan timeout - no response from Electron main process');
          if (typeof window !== 'undefined' && window.removeEventListener) {
            window.removeEventListener('message', handleDeviceList);
          }
          resolve([]); // Return empty array if timeout
        }, 20000);

        // Trigger the Web Bluetooth API call - this will activate Electron's select-bluetooth-device handler
        this.triggerElectronBluetoothScan()
          .then(() => {
            console.log('🔍 Bluetooth scan triggered successfully, waiting for device list...');
          })
          .catch(error => {
            console.error('❌ Failed to trigger Bluetooth scan:', error);
            clearTimeout(timeoutId);
            if (typeof window !== 'undefined' && window.removeEventListener) {
              window.removeEventListener('message', handleDeviceList);
            }
            reject(error);
          });
      });

    } catch (error) {
      console.error('❌ Electron-integrated device scan failed:', error);
      this.notifyError('scan_operation', this.createError('BLUETOOTH_NOT_AVAILABLE', error));
      throw error;
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Trigger the Web Bluetooth API scan that will be handled by Electron's main process
   */
  private async triggerElectronBluetoothScan(): Promise<void> {
    try {
      if (!navigator?.bluetooth) {
        throw new Error('Web Bluetooth API not available');
      }

      console.log('🔍 Triggering Web Bluetooth API scan...');
      
      // This call will trigger Electron's select-bluetooth-device event in the main process
      // We use a simple filter to let Electron handle device filtering
      try {
        await navigator.bluetooth.requestDevice({
          filters: [
            { services: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"] },
            { namePrefix: "tropx" },
            { namePrefix: "muse" }
          ],
          optionalServices: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"]
        });
      } catch (error: any) {
        // It's expected that this might fail since we're intercepting the selection in main process
        if (error.name === 'NotFoundError' || error.name === 'AbortError') {
          console.log('🔍 Web Bluetooth scan triggered successfully (expected error)');
        } else {
          console.warn('🔍 Web Bluetooth scan error (may be expected):', error.message);
        }
      }
    } catch (error) {
      console.error('❌ Failed to trigger Web Bluetooth scan:', error);
      throw error;
    }
  }

  /**
   * Legacy method - kept for compatibility but replaced with Electron-integrated approach
   */
  private async performUserInitiatedScan(): Promise<DeviceInfo[]> {
    try {
      if (!navigator?.bluetooth) {
        throw new Error('Web Bluetooth API not available');
      }

      console.log('🔍 User-initiated Bluetooth scan starting...');
      console.log('🔍 Scanning for ALL available Bluetooth devices first...');
      
      // First, check Bluetooth availability
      const isAvailable = await navigator.bluetooth.getAvailability();
      if (!isAvailable) {
        console.error('❌ Bluetooth adapter not available');
        throw new Error('Bluetooth adapter is not available or turned off');
      }
      
      console.log('✅ Bluetooth adapter is available');
      
      // First attempt: Try to find devices with specific service UUID
      console.log('🔍 Attempt 1: Scanning for devices with Tropx/Muse service UUID...');
      try {
        const serviceDevice = await navigator.bluetooth.requestDevice({
          filters: [
            { services: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"] }
          ],
          optionalServices: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"]
        });
        
        console.log(`✅ Found service-specific device: ${serviceDevice.name} (${serviceDevice.id})`);
        return this.processFoundDevice(serviceDevice);
        
      } catch (serviceError: any) {
        console.log('⚠️ Service-specific scan failed:', serviceError.message);
      }
      
      // Second attempt: Try name prefix filtering
      console.log('🔍 Attempt 2: Scanning for devices with Tropx/Muse name prefixes...');
      try {
        const prefixDevice = await navigator.bluetooth.requestDevice({
          filters: [
            { namePrefix: "tropx" },
            { namePrefix: "muse" },
            { namePrefix: "Tropx" },
            { namePrefix: "Muse" },
            { namePrefix: "TROPX" },
            { namePrefix: "MUSE" }
          ],
          optionalServices: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"]
        });
        
        console.log(`✅ Found name-filtered device: ${prefixDevice.name} (${prefixDevice.id})`);
        return this.processFoundDevice(prefixDevice);
        
      } catch (prefixError: any) {
        console.log('⚠️ Name prefix scan failed:', prefixError.message);
      }
      
      // Third attempt: Broad scan to see what devices are actually available
      console.log('🔍 Attempt 3: Broad scan for ALL available Bluetooth devices...');
      console.log('🔍 This will show you ALL discoverable devices for testing...');
      
      try {
        const broadDevice = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"]
        });
        
        console.log(`📱 User selected device: ${broadDevice.name} (${broadDevice.id})`);
        console.log(`🔍 Device details:`, {
          name: broadDevice.name,
          id: broadDevice.id,
          gatt: broadDevice.gatt?.connected
        });
        
        // Check if this looks like a target device
        const deviceName = (broadDevice.name || '').toLowerCase();
        const isTropxMuse = deviceName.includes('tropx') || 
                           deviceName.includes('muse') || 
                           deviceName.includes('imu') ||
                           deviceName.includes('sensor');
        
        if (!isTropxMuse) {
          console.warn(`⚠️ Selected device "${broadDevice.name}" may not be a motion sensor`);
          console.log('🔬 Allowing connection for testing purposes');
        } else {
          console.log(`✅ Device "${broadDevice.name}" appears to be a motion sensor`);
        }
        
        return this.processFoundDevice(broadDevice);
        
      } catch (broadError: any) {
        console.error('❌ Broad device scan also failed:', broadError.message);
        
        if (broadError.name === 'NotFoundError') {
          console.log('🔍 No Bluetooth devices found or user cancelled');
          return [];
        }
        
        if (broadError.name === 'NotAllowedError') {
          console.log('🔍 User cancelled device selection');
          return [];
        }
        
        throw broadError;
      }
      
    } catch (error) {
      console.error('❌ All scanning attempts failed:', error);
      
      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes('Must be handling a user gesture')) {
          console.error('🚫 Web Bluetooth requires user gesture - scan must be triggered by button click');
          throw new Error('Bluetooth scan must be initiated by user action (button click)');
        }
        
        if (error.message.includes('not available') || error.message.includes('not supported')) {
          console.error('🚫 Bluetooth adapter or Web Bluetooth API issue');
          throw new Error('Bluetooth not available. Please check if Bluetooth is enabled and Web Bluetooth is supported.');
        }
      }
      
      return [];
    }
  }
  
  /**
   * Process a found Bluetooth device and add it to managed devices
   */
  private processFoundDevice(bluetoothDevice: BluetoothDevice): DeviceInfo[] {
    console.log(`✅ Processing device: ${bluetoothDevice.name} (ID: ${bluetoothDevice.id})`);
    
    const deviceInfo = this.createDeviceInfo({
      id: bluetoothDevice.id,
      name: bluetoothDevice.name || `Unknown-${bluetoothDevice.id.slice(-4)}`
    });
    
    this.devices.set(deviceInfo.id, deviceInfo);
    
    // Notify listeners for real-time UI updates
    this.notifyStateChange(deviceInfo.id, DeviceState.DISCONNECTED_AVAILABLE);
    
    console.log(`✅ Added device to scan results: ${deviceInfo.name}`);
    return [deviceInfo];
  }


  /**
   * Connect to a specific device using Electron-integrated approach
   * This method prevents race conditions through connection locking
   */
  public async connectDevice(deviceId: string): Promise<boolean> {
    this.assertInitialized();
    
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error(`Device ${deviceId} not found. Run scanForDevices() first.`);
    }

    // Prevent concurrent connections to the same device
    if (this.connectionLocks.has(deviceId)) {
      console.log(`⏳ Connection to ${deviceId} already in progress, waiting...`);
      return await this.connectionLocks.get(deviceId)!;
    }

    // Create connection lock to prevent race conditions
    const connectionPromise = this.performElectronIntegratedConnection(deviceInfo);
    this.connectionLocks.set(deviceId, connectionPromise);

    try {
      const result = await connectionPromise;
      return result;
    } finally {
      this.connectionLocks.delete(deviceId);
    }
  }

  /**
   * Perform Electron-integrated device connection using MuseManager
   */
  private async performElectronIntegratedConnection(deviceInfo: DeviceInfo): Promise<boolean> {
    const operationId = `connect_${Date.now()}`;
    this.addPendingOperation(deviceInfo.id, operationId);

    try {
      console.log(`🔗 Starting Electron-integrated connection to: ${deviceInfo.name}`);

      // Update state to connecting
      deviceInfo.state = DeviceState.CONNECTING;
      deviceInfo.connectionAttempts++;
      deviceInfo.lastUpdate = Date.now();
      this.notifyStateChange(deviceInfo.id, DeviceState.CONNECTING);

      // State machine transition
      await this.transitionDeviceState(
        deviceInfo.id,
        DeviceState.DISCONNECTED_AVAILABLE,
        DeviceEvent.CONNECT_REQUEST,
        { 
          deviceId: deviceInfo.id,
          metadata: { retryCount: deviceInfo.connectionAttempts }
        }
      );

      // Use MuseManager to connect to the scanned device
      // MuseManager will handle the Web Bluetooth API calls properly in Electron context
      console.log(`🔗 Using MuseManager to connect to device: ${deviceInfo.name}`);
      const bleSuccess = await museManager.connectToScannedDevice(deviceInfo.id, deviceInfo.name);
      
      if (!bleSuccess) {
        throw new Error('MuseManager connection failed');
      }

      // Update to connected state (IDLE, not streaming)
      deviceInfo.state = DeviceState.CONNECTED_IDLE;
      deviceInfo.lastUpdate = Date.now();
      deviceInfo.error = undefined;

      // State machine transition to connected
      await this.transitionDeviceState(
        deviceInfo.id,
        DeviceState.CONNECTING,
        DeviceEvent.CONNECTED,
        { 
          deviceId: deviceInfo.id,
          connection: { server: { connected: true } }
        }
      );

      // Update battery level (non-blocking)
      this.debouncedBatteryUpdate(deviceInfo.id).catch(error => {
        console.warn(`Battery update failed for ${deviceInfo.name}:`, error);
      });

      console.log(`✅ Successfully connected to ${deviceInfo.name}`);
      this.notifyStateChange(deviceInfo.id, DeviceState.CONNECTED_IDLE);
      
      return true;

    } catch (error) {
      console.error(`❌ Electron-integrated connection failed for ${deviceInfo.name}:`, error);
      const appError = this.createError('CONNECTION_FAILED', error, deviceInfo.id);
      this.handleDeviceError(deviceInfo.id, appError);
      return false;
    } finally {
      this.removePendingOperation(deviceInfo.id, operationId);
    }
  }


  /**
   * Disconnect a device
   */
  public async disconnectDevice(deviceId: string): Promise<boolean> {
    this.assertInitialized();
    
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      console.warn(`⚠️ Device ${deviceId} not found for disconnection`);
      return false;
    }

    try {
      console.log(`🔌 Disconnecting device: ${deviceInfo.name}`);

      // Stop streaming if active
      if (deviceInfo.state === DeviceState.STREAMING) {
        await this.stopStreamingInternal(deviceId, false);
      }

      // Disconnect from MuseManager
      await museManager.disconnectDevice(deviceInfo.name);

      // Update device state
      deviceInfo.state = DeviceState.DISCONNECTED_AVAILABLE;
      deviceInfo.batteryLevel = null;
      deviceInfo.lastUpdate = Date.now();
      deviceInfo.error = undefined;

      // State machine transition
      await this.transitionDeviceState(
        deviceId,
        DeviceState.CONNECTED_IDLE,
        DeviceEvent.DISCONNECT,
        { deviceId }
      );

      console.log(`✅ Device ${deviceInfo.name} disconnected successfully`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to disconnect device ${deviceId}:`, error);
      const appError = this.createError('DEVICE_DISCONNECTED', error, deviceId);
      this.handleDeviceError(deviceId, appError);
      return false;
    }
  }

  /**
   * Start recording mode
   * CRITICAL: Only in recording mode can devices stream data
   */
  public async startRecording(): Promise<boolean> {
    this.assertInitialized();
    
    if (this.recordingMode) {
      console.warn('⚠️ Recording mode already active');
      return true;
    }

    try {
      console.log('🎬 Starting recording mode - enabling streaming...');
      this.recordingMode = true;

      // Start streaming for all connected devices
      const connectedDevices = Array.from(this.devices.values())
        .filter(d => d.state === DeviceState.CONNECTED_IDLE);

      console.log(`📡 Starting streaming for ${connectedDevices.length} connected devices`);

      const streamingPromises = connectedDevices.map(device => 
        this.startStreamingInternal(device.id)
      );

      const results = await Promise.allSettled(streamingPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      console.log(`✅ Recording mode started. ${successCount}/${connectedDevices.length} devices streaming`);
      return successCount > 0;

    } catch (error) {
      console.error('❌ Failed to start recording mode:', error);
      this.recordingMode = false;
      return false;
    }
  }

  /**
   * Stop recording mode
   * Stops all streaming but maintains device connections
   */
  public async stopRecording(): Promise<void> {
    this.assertInitialized();
    
    if (!this.recordingMode) {
      console.log('ℹ️ Recording mode not active');
      return;
    }

    try {
      console.log('🛑 Stopping recording mode...');

      // Stop streaming for all streaming devices
      const streamingDevices = Array.from(this.devices.values())
        .filter(d => d.state === DeviceState.STREAMING);

      const stopPromises = streamingDevices.map(device => 
        this.stopStreamingInternal(device.id, false)
      );

      await Promise.allSettled(stopPromises);

      this.recordingMode = false;
      console.log('✅ Recording mode stopped. All devices returned to idle state.');

    } catch (error) {
      console.error('❌ Error stopping recording mode:', error);
      this.recordingMode = false;
    }
  }

  /**
   * Get all devices with current states
   */
  public getDevices(): Map<string, DeviceInfo> {
    return new Map(this.devices);
  }

  /**
   * Get a specific device
   */
  public getDevice(deviceId: string): DeviceInfo | undefined {
    return this.devices.get(deviceId);
  }

  /**
   * Check if recording mode is active
   */
  public isRecording(): boolean {
    return this.recordingMode;
  }

  /**
   * Subscribe to device state changes
   */
  public onStateChange(listener: DeviceStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Subscribe to device data
   */
  public onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  /**
   * Subscribe to errors
   */
  public onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // Private implementation methods



  /**
   * Debounced battery update to prevent excessive battery queries
   */
  private debouncedBatteryUpdate = this.debounce(async (deviceId: string) => {
    const deviceInfo = this.devices.get(deviceId);
    if (deviceInfo) {
      await this.updateDeviceBattery(deviceId);
    }
  }, 1000);

  /**
   * Debounce utility to prevent excessive function calls
   */
  private debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
    let timeoutId: NodeJS.Timeout;
    return ((...args: any[]) => {
      clearTimeout(timeoutId);
      return new Promise((resolve, reject) => {
        timeoutId = setTimeout(async () => {
          try {
            const result = await func(...args);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        }, delay);
      });
    }) as T;
  }

  private async startStreamingInternal(deviceId: string): Promise<boolean> {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      console.error(`❌ Device ${deviceId} not found for streaming`);
      return false;
    }

    if (deviceInfo.state !== DeviceState.CONNECTED_IDLE) {
      console.warn(`⚠️ Device ${deviceId} not ready for streaming (state: ${deviceInfo.state})`);
      return false;
    }

    try {
      console.log(`📡 Starting streaming for device: ${deviceInfo.name}`);

      // Update state to streaming
      deviceInfo.state = DeviceState.STREAMING;
      deviceInfo.lastUpdate = Date.now();
      this.notifyStateChange(deviceId, DeviceState.STREAMING);

      // State machine transition
      await this.transitionDeviceState(
        deviceId,
        DeviceState.CONNECTED_IDLE,
        DeviceEvent.STREAM_START,
        { deviceId }
      );

      // For Electron apps, coordinate streaming through the main process
      // to avoid conflicts with the native Bluetooth system
      const success = await this.startElectronStreaming(deviceId, deviceInfo.name);

      if (!success) {
        throw new Error('Failed to start BLE streaming');
      }

      console.log(`✅ Streaming started for ${deviceInfo.name}`);
      return true;

    } catch (error) {
      console.error(`❌ Streaming failed for device ${deviceId}:`, error);
      const appError = this.createError('STREAM_FAILED', error, deviceId);
      this.handleDeviceError(deviceId, appError);
      return false;
    }
  }

  /**
   * Start streaming through Electron's coordinated system
   */
  private async startElectronStreaming(deviceId: string, deviceName: string): Promise<boolean> {
    try {
      // Use MuseManager but with coordination
      const success = await museManager.startStreaming((receivedDeviceName, imuData) => {
        // Forward to registered data listeners
        this.notifyDataReceived(deviceId, imuData);
        
        // Forward to stream data manager for processing
        streamDataManager.processIMUData(deviceId, receivedDeviceName, imuData);
      });

      return success;
    } catch (error) {
      console.error(`❌ Electron streaming failed for ${deviceName}:`, error);
      return false;
    }
  }

  private async stopStreamingInternal(deviceId: string, errorCondition = false): Promise<boolean> {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      console.warn(`⚠️ Device ${deviceId} not found for stream stop`);
      return false;
    }

    if (deviceInfo.state !== DeviceState.STREAMING) {
      console.log(`ℹ️ Device ${deviceId} is not streaming`);
      return true;
    }

    try {
      console.log(`🛑 Stopping streaming for device: ${deviceInfo.name}`);

      // Stop BLE streaming
      await museManager.stopStreaming();

      // Update state back to connected idle
      deviceInfo.state = DeviceState.CONNECTED_IDLE;
      deviceInfo.lastUpdate = Date.now();

      // State machine transition
      await this.transitionDeviceState(
        deviceId,
        DeviceState.STREAMING,
        DeviceEvent.STREAM_STOP,
        { deviceId }
      );

      console.log(`✅ Streaming stopped for ${deviceInfo.name}`);
      this.notifyStateChange(deviceId, DeviceState.CONNECTED_IDLE);
      
      return true;

    } catch (error) {
      if (!errorCondition) {
        console.error(`❌ Stop streaming failed for device ${deviceId}:`, error);
        const appError = this.createError('STREAM_FAILED', error, deviceId);
        this.handleDeviceError(deviceId, appError);
      }
      return false;
    }
  }

  private async initializeSubsystems(): Promise<void> {
    console.log('🔧 Initializing BLE subsystems...');
    
    // Initialize Web Bluetooth API availability checks
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API not supported in this environment');
    }
    
    // Set up Web Bluetooth event listeners for device disconnection
    if (typeof window !== 'undefined') {
      navigator.bluetooth.addEventListener('advertisementreceived', (event) => {
        console.log('📡 Advertisement received from:', event.device.name);
      });
    }
    
    console.log('✅ Web Bluetooth subsystems initialized');
  }

  private setupStateMachineIntegration(): void {
    console.log('🔗 Setting up state machine integration...');
    
    // Listen to all state changes from the state machine
    Object.values(DeviceState).forEach(state => {
      deviceStateMachine.onStateChange(state, (context) => {
        const deviceInfo = this.devices.get(context.deviceId);
        if (deviceInfo) {
          deviceInfo.state = state;
          deviceInfo.lastUpdate = Date.now();
          this.notifyStateChange(context.deviceId, state, context);
        }
      });
    });
  }

  private startBatteryUpdateService(): void {
    if (this.batteryUpdateInterval) {
      clearInterval(this.batteryUpdateInterval);
    }

    this.batteryUpdateInterval = setInterval(async () => {
      const connectedDevices = Array.from(this.devices.values())
        .filter(d => d.state === DeviceState.CONNECTED_IDLE || d.state === DeviceState.STREAMING);

      const updatePromises = connectedDevices.map(device => 
        this.updateDeviceBattery(device.id)
      );

      await Promise.allSettled(updatePromises);
    }, this.config.batteryUpdateIntervalMs);

    console.log('🔋 Battery update service started');
  }

  private async updateDeviceBattery(deviceId: string): Promise<void> {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) return;

    try {
      await museManager.updateBatteryLevel(deviceInfo.name);
      const batteryLevel = museManager.getBatteryLevel(deviceInfo.name);
      
      if (batteryLevel !== null) {
        deviceInfo.batteryLevel = batteryLevel;
        deviceInfo.lastUpdate = Date.now();
        
        // Notify state change to trigger UI updates
        this.notifyStateChange(deviceId, deviceInfo.state);
      }
    } catch (error) {
      console.warn(`Battery update failed for ${deviceInfo.name}:`, error);
    }
  }

  private async transitionDeviceState(
    deviceId: string,
    currentState: DeviceState,
    event: DeviceEvent,
    context: DeviceContext
  ): Promise<void> {
    try {
      await deviceStateMachine.transition(currentState, event, context);
    } catch (error) {
      console.error(`State transition failed for ${deviceId}:`, error);
      // Don't throw - state machine errors shouldn't break the flow
    }
  }

  private createDeviceInfo(bluetoothDevice: { id: string; name?: string }): DeviceInfo {
    return {
      id: bluetoothDevice.id,
      name: bluetoothDevice.name || `Unknown-${bluetoothDevice.id.slice(-4)}`,
      state: DeviceState.DISCONNECTED_AVAILABLE,
      batteryLevel: null,
      lastUpdate: Date.now(),
      connectionAttempts: 0,
    };
  }

  private clearDisconnectedDevices(): void {
    const toRemove: string[] = [];
    this.devices.forEach((device, deviceId) => {
      if (device.state === DeviceState.DISCONNECTED_AVAILABLE) {
        toRemove.push(deviceId);
      }
    });
    
    toRemove.forEach(deviceId => this.devices.delete(deviceId));
    console.log(`🗑️ Cleared ${toRemove.length} previous scan results`);
  }

  private handleDeviceError(deviceId: string, error: AppError): void {
    const deviceInfo = this.devices.get(deviceId);
    if (deviceInfo) {
      deviceInfo.error = error;
      deviceInfo.state = DeviceState.ERROR;
      deviceInfo.lastUpdate = Date.now();
      
      this.notifyStateChange(deviceId, DeviceState.ERROR);
      this.notifyError(deviceId, error);
    }
  }

  private createError(code: keyof typeof ERROR_CODES, error: unknown, deviceId?: string): AppError {
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
      deviceId,
      context: { originalError: error }
    };
  }

  private addPendingOperation(deviceId: string, operationId: string): void {
    if (!this.pendingOperations.has(deviceId)) {
      this.pendingOperations.set(deviceId, new Set());
    }
    this.pendingOperations.get(deviceId)!.add(operationId);
  }

  private removePendingOperation(deviceId: string, operationId: string): void {
    const operations = this.pendingOperations.get(deviceId);
    if (operations) {
      operations.delete(operationId);
      if (operations.size === 0) {
        this.pendingOperations.delete(deviceId);
      }
    }
  }

  private notifyStateChange(deviceId: string, newState: DeviceState, context?: DeviceContext): void {
    this.stateListeners.forEach(listener => {
      try {
        listener(deviceId, newState, context);
      } catch (error) {
        console.error('State change listener error:', error);
      }
    });
  }

  private notifyDataReceived(deviceId: string, data: IMUData): void {
    this.dataListeners.forEach(listener => {
      try {
        listener(deviceId, data);
      } catch (error) {
        console.error('Data listener error:', error);
      }
    });
  }

  private notifyError(deviceId: string, error: AppError): void {
    this.errorListeners.forEach(listener => {
      try {
        listener(deviceId, error);
      } catch (error) {
        console.error('Error listener error:', error);
      }
    });
  }

  private assertInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('BLE Device Manager not initialized. Call initialize() first.');
    }
  }

  public async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up BLE Device Manager...');
    
    try {
      // Stop recording if active
      if (this.recordingMode) {
        await this.stopRecording();
      }

      // Disconnect all devices
      const disconnectPromises = Array.from(this.devices.keys()).map(deviceId =>
        this.disconnectDevice(deviceId)
      );
      await Promise.allSettled(disconnectPromises);

      // Clear intervals
      if (this.batteryUpdateInterval) {
        clearInterval(this.batteryUpdateInterval);
        this.batteryUpdateInterval = null;
      }

      // Clean up Web Bluetooth event listeners
      if (typeof window !== 'undefined' && navigator.bluetooth) {
        // Remove any global bluetooth event listeners if needed
        // navigator.bluetooth.removeEventListener(...); // Add specific cleanup if needed
      }

      // Clear all data
      this.devices.clear();
      this.connectionLocks.clear();
      this.pendingOperations.clear();
      this.stateListeners.clear();
      this.dataListeners.clear();
      this.errorListeners.clear();

      // Reset state machine
      deviceStateMachine.reset();

      this.isInitialized = false;
      console.log('✅ BLE Device Manager cleanup completed');

    } catch (error) {
      console.error('❌ Error during BLE Device Manager cleanup:', error);
    }
  }
}

// Export singleton instance
// Export singleton instance with Electron-optimized configuration
export const bleDeviceManager = BLEDeviceManager.getInstance({
  enableAutoRetry: true,
  maxRetryAttempts: 3,
  retryDelayMs: 2000,
  batteryUpdateIntervalMs: 30000,
  connectionTimeoutMs: 15000 // Longer timeout for Electron's Bluetooth coordination
});

