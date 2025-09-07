/**
 * Simplified BLE Device Manager for Electron Integration
 * 
 * This version properly integrates with Electron's select-bluetooth-device handler
 * and uses WebSocket communication for device management.
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
import { museManager } from '../../muse_sdk/core/MuseManager';
import { streamDataManager } from './StreamDataManager';
import { ERROR_CODES } from './constants';

export interface SimpleBLEDeviceManagerConfig {
  enableAutoRetry: boolean;
  maxRetryAttempts: number;
  retryDelayMs: number;
  batteryUpdateIntervalMs: number;
  connectionTimeoutMs: number;
}

const DEFAULT_CONFIG: SimpleBLEDeviceManagerConfig = {
  enableAutoRetry: true,
  maxRetryAttempts: 3,
  retryDelayMs: 2000,
  batteryUpdateIntervalMs: 30000,
  connectionTimeoutMs: 15000,
};

export type DeviceStateListener = (deviceId: string, newState: DeviceState, context?: DeviceContext) => void;
export type DataListener = (deviceId: string, data: IMUData) => void;
export type ErrorListener = (deviceId: string, error: AppError) => void;

/**
 * Simplified BLE Device Manager that properly integrates with Electron
 */
export class SimpleBLEDeviceManager {
  private static instance: SimpleBLEDeviceManager | null = null;
  
  // Single source of truth for all device states
  private readonly devices = new Map<string, DeviceInfo>();
  private readonly config: SimpleBLEDeviceManagerConfig;
  private readonly connectionLocks = new Map<string, Promise<boolean>>();
  
  // Event listeners
  private readonly stateListeners = new Set<DeviceStateListener>();
  private readonly dataListeners = new Set<DataListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  
  // Internal state
  private isInitialized = false;
  private isScanning = false;
  private batteryUpdateInterval: NodeJS.Timeout | null = null;
  private recordingMode = false;
  
  // WebSocket connection for main process communication
  private ws: WebSocket | null = null;
  private wsPort = 8080;

  private constructor(config: Partial<SimpleBLEDeviceManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    console.log('🏗️ Simple BLE Device Manager created');
  }

  public static getInstance(config?: Partial<SimpleBLEDeviceManagerConfig>): SimpleBLEDeviceManager {
    if (!SimpleBLEDeviceManager.instance) {
      SimpleBLEDeviceManager.instance = new SimpleBLEDeviceManager(config);
    }
    return SimpleBLEDeviceManager.instance;
  }

  public static reset(): void {
    if (SimpleBLEDeviceManager.instance) {
      SimpleBLEDeviceManager.instance.cleanup();
      SimpleBLEDeviceManager.instance = null;
    }
  }

  /**
   * Initialize the BLE Device Manager
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('🔄 Simple BLE Device Manager already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing Simple BLE Device Manager...');
      
      // Validate Web Bluetooth availability
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth is not supported in this environment');
      }

      // Initialize WebSocket connection to main process
      await this.initializeWebSocket();
      
      // Initialize underlying managers
      await this.initializeSubsystems();
      
      // Start background services
      this.startBatteryUpdateService();
      
      this.isInitialized = true;
      console.log('✅ Simple BLE Device Manager initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize Simple BLE Device Manager:', error);
      throw error;
    }
  }

  /**
   * Initialize WebSocket connection to Electron main process
   */
  private async initializeWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Get WebSocket port from main process if available
        if (typeof window !== 'undefined' && (window as any).electronAPI?.getWebSocketPort) {
          this.wsPort = (window as any).electronAPI.getWebSocketPort();
        }

        const wsUrl = `ws://localhost:${this.wsPort}`;
        console.log(`🌐 Connecting to WebSocket at ${wsUrl}...`);
        
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('✅ WebSocket connection established');
          this.setupWebSocketHandlers();
          resolve();
        };

        this.ws.onerror = (error) => {
          console.error('❌ WebSocket connection error:', error);
          reject(new Error('Failed to connect to main process'));
        };

        this.ws.onclose = () => {
          console.log('🔌 WebSocket connection closed');
          // Attempt reconnection after delay
          setTimeout(() => this.initializeWebSocket().catch(console.error), 5000);
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Set up WebSocket message handlers
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return;

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleWebSocketMessage(message);
      } catch (error) {
        console.error('❌ Error parsing WebSocket message:', error);
      }
    };
  }

  /**
   * Handle messages from Electron main process
   */
  private handleWebSocketMessage(message: any): void {
    try {
      console.log('📨 Received WebSocket message:', message.type, message.data);
      
      switch (message.type) {
        case 'DEVICE_SCAN_RESULT':
          this.handleScanResult(message.data);
          break;
        
        case 'device_scan_result': // Also handle lowercase version
          this.handleScanResult(message.data);
          break;
        
        case 'DEVICE_SELECTION_COMPLETE':
          console.log('✅ Device selection completed:', message.data);
          break;
        
        default:
          console.log('📨 WebSocket message type:', message.type);
      }
    } catch (error) {
      console.error('❌ Error handling WebSocket message:', error);
    }
  }

  /**
   * Handle scan results from main process
   */
  private handleScanResult(data: any): void {
    console.log('📱 Received scan result from main process:', data);

    if (data.troubleshooting) {
      console.log('🔍 Troubleshooting mode - no devices found');
      console.log('🔍 Message:', data.message);
      return;
    }

    if (!data.devices || !Array.isArray(data.devices)) {
      console.error('❌ Invalid scan result data format, received:', typeof data.devices);
      return;
    }

    console.log(`📱 Processing ${data.devices.length} devices from main process`);
    console.log(`📱 Total devices found: ${data.totalDevices || data.devices.length}`);
    console.log(`📱 Preferred devices: ${data.preferredDevices || 'unknown'}`);

    // Clear previous devices first
    console.log('🗑️ Clearing previous scan results');
    this.clearDisconnectedDevices();

    data.devices.forEach((deviceData: any, index: number) => {
      console.log(`📱 Processing device ${index + 1}/${data.devices.length}:`, {
        id: deviceData.id,
        name: deviceData.name,
        isPreferred: deviceData.isPreferred,
        deviceType: deviceData.deviceType,
        paired: deviceData.paired
      });

      try {
        const deviceInfo = this.createDeviceInfo({
          id: deviceData.id,
          name: deviceData.name
        });

        // Add additional metadata from the enhanced device data
        if (deviceData.isPreferred) {
          console.log(`✅ Marking device ${deviceData.name} as preferred (Tropx/Muse)`);
        }

        this.devices.set(deviceInfo.id, deviceInfo);
        console.log(`✅ Added device to internal map: ${deviceInfo.name} (${deviceInfo.id})`);

        // Notify state change to trigger UI updates
        this.notifyStateChange(deviceInfo.id, DeviceState.DISCONNECTED_AVAILABLE);
        console.log(`✅ Notified state change for device: ${deviceInfo.id}`);

      } catch (error) {
        console.error(`❌ Error processing device ${deviceData.name}:`, error);
      }
    });

    const finalDeviceCount = this.devices.size;
    console.log(`📱 Successfully processed ${finalDeviceCount} total devices`);

    // Log all devices in the map for debugging
    console.log('📱 Current devices in map:');
    this.devices.forEach((device, id) => {
      console.log(`  - ${device.name} (${id}) - State: ${device.state}`);
    });
  }

  /**
   * Scan for available BLE devices - Non-blocking, immediate UI response
   */
  public async scanForDevices(): Promise<DeviceInfo[]> {
    this.assertInitialized();
    
    if (this.isScanning) {
      console.log('⚠️ Scan already in progress - returning current devices');
      return Array.from(this.devices.values());
    }

    try {
      this.isScanning = true;
      console.log('🔍 Starting non-blocking BLE device scan...');
      
      // Clear previous results
      this.clearDisconnectedDevices();
      
      // Start scan asynchronously - don't await, return immediately
      this.performAsyncScan().catch(error => {
        console.error('❌ Async scan error:', error);
        this.isScanning = false;
      });
      
      // Return immediately with current devices (may be empty initially)
      console.log('🔍 Scan initiated - UI can continue while scanning in background');
      return Array.from(this.devices.values())
        .filter(device => device.state === DeviceState.DISCONNECTED_AVAILABLE);
        
    } catch (error) {
      console.error('❌ Device scan failed:', error);
      this.isScanning = false;
      throw error;
    }
  }

  /**
   * Perform scan asynchronously in background
   */
  private async performAsyncScan(): Promise<void> {
    try {
      console.log('🔍 Performing background Bluetooth scan...');
      
      // Trigger Web Bluetooth API which will activate Electron's select-bluetooth-device handler
      await this.triggerBluetoothScan();
      
      // Wait for devices to be received via WebSocket (with shorter timeout)
      await this.waitForScanResults();
      
      console.log('🔍 Background scan completed');
      
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Trigger Web Bluetooth API to activate Electron's device selection
   * Uses standard single requestDevice call as per Electron best practices
   */
  private async triggerBluetoothScan(): Promise<void> {
    try {
      console.log('🔍 Triggering Web Bluetooth device discovery...');
      
      // Check if Bluetooth is available
      const isBluetoothAvailable = await navigator.bluetooth.getAvailability();
      console.log('🔍 Bluetooth availability:', isBluetoothAvailable);
      
      if (!isBluetoothAvailable) {
        throw new Error('Bluetooth is not available on this system');
      }

      // Standard approach: Single requestDevice call with broad filter
      // This triggers Electron's select-bluetooth-device event with all available devices
      console.log('🔍 Making Web Bluetooth API call to trigger device discovery...');
      try {
        await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"]
        });
        console.log('🔍 Web Bluetooth API call completed - device selection handled by Electron');
      } catch (error: any) {
        // These errors are expected when Electron intercepts the device selection
        if (error.name === 'NotFoundError') {
          console.log('🔍 No devices found or selection cancelled (expected)');
        } else if (error.name === 'AbortError') {
          console.log('🔍 Request aborted - likely handled by Electron select-bluetooth-device (expected)');
        } else {
          console.warn('🔍 Web Bluetooth API call error (may be expected):', error.message);
        }
      }

      console.log('🔍 Web Bluetooth scan trigger completed');
      
    } catch (error) {
      console.error('❌ Failed to trigger Web Bluetooth scan:', error);
      throw error;
    }
  }

  /**
   * Wait for scan results from main process
   * Allow more time for device discovery as per Electron best practices
   */
  private async waitForScanResults(): Promise<void> {
    return new Promise((resolve) => {
      let hasReceivedScanResult = false;
      
      // Listen for scan results via message handler
      const originalHandler = this.handleWebSocketMessage.bind(this);
      this.handleWebSocketMessage = (message: any) => {
        originalHandler(message);
        if (message.type === 'DEVICE_SCAN_RESULT') {
          hasReceivedScanResult = true;
        }
      };

      // Shorter timeout for responsive UI
      const timeout = setTimeout(() => {
        console.log('⏰ Scan timeout - finalizing with discovered devices');
        this.handleWebSocketMessage = originalHandler; // Restore original handler
        resolve();
      }, 10000); // 10 seconds for responsive operation

      const checkForResults = () => {
        if (hasReceivedScanResult) {
          console.log('✅ Scan results received from main process');
          clearTimeout(timeout);
          this.handleWebSocketMessage = originalHandler; // Restore original handler
          resolve();
        } else {
          setTimeout(checkForResults, 1000);
        }
      };

      // Start checking after a brief delay to allow the API call to complete
      setTimeout(checkForResults, 2000);
    });
  }

  /**
   * Connect to a specific device
   */
  public async connectDevice(deviceId: string): Promise<boolean> {
    this.assertInitialized();
    
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // Prevent concurrent connections
    if (this.connectionLocks.has(deviceId)) {
      return await this.connectionLocks.get(deviceId)!;
    }

    const connectionPromise = this.performConnection(deviceInfo);
    this.connectionLocks.set(deviceId, connectionPromise);

    try {
      return await connectionPromise;
    } finally {
      this.connectionLocks.delete(deviceId);
    }
  }

  /**
   * Perform the actual device connection
   */
  private async performConnection(deviceInfo: DeviceInfo): Promise<boolean> {
    try {
      console.log(`🔗 Connecting to device: ${deviceInfo.name}`);

      // Update state to connecting
      deviceInfo.state = DeviceState.CONNECTING;
      deviceInfo.lastUpdate = Date.now();
      this.notifyStateChange(deviceInfo.id, DeviceState.CONNECTING);

      // Send device selection to main process
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: 'select_bluetooth_device',
          data: { deviceId: deviceInfo.id }
        }));
      }

      // 🔧 FIX: Properly verify SDK connection before updating UI state
      console.log(`🎯 Attempting actual SDK connection for ${deviceInfo.name}...`);

      // First, ensure the device is registered in MuseManager
      museManager.addScannedDevices([{
        deviceId: deviceInfo.id,
        deviceName: deviceInfo.name
      }]);

      // Use MuseManager for actual connection
      const success = await museManager.connectToScannedDevice(deviceInfo.id, deviceInfo.name);
      
      if (success) {
        // 🔧 FIX: Verify the device is actually connected in MuseManager
        const connectedDevices = museManager.getConnectedDevices();
        const isActuallyConnected = connectedDevices.has(deviceInfo.name);

        if (isActuallyConnected) {
          deviceInfo.state = DeviceState.CONNECTED_IDLE;
          deviceInfo.lastUpdate = Date.now();
          this.notifyStateChange(deviceInfo.id, DeviceState.CONNECTED_IDLE);
          console.log(`✅ Device ${deviceInfo.name} is ACTUALLY connected via SDK`);

          // 🔵 Activate device discovery pattern right after successful connection
          this.triggerDeviceDiscoveryPattern();

          // Battery level will be updated automatically by SimpleBLEDeviceManager
          return true;
        } else {
          console.error(`❌ SDK reports success but device ${deviceInfo.name} is not in connected devices map`);
          throw new Error('SDK connection verification failed');
        }
      } else {
        throw new Error('MuseManager connection failed');
      }

    } catch (error) {
      console.error(`❌ Connection failed for ${deviceInfo.name}:`, error);
      deviceInfo.state = DeviceState.ERROR;
      deviceInfo.error = this.createError('CONNECTION_FAILED', error, deviceInfo.id);
      this.notifyStateChange(deviceInfo.id, DeviceState.ERROR);
      return false;
    }
  }

  /**
   * Trigger the device discovery pattern (GROSDODE PATTERN) after device connection
   */
  private triggerDeviceDiscoveryPattern(): void {
    try {
      console.log('🔵 Triggering device discovery pattern after successful connection...');

      // Use the EXACT same logic as the scan button - trigger Web Bluetooth API
      setTimeout(async () => {
        try {
          console.log('🔵 Making Web Bluetooth API call to trigger device discovery...');
          await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ["c8c0a708-e361-4b5e-a365-98fa6b0a836f"]
          });
          console.log('🔵 Device discovery pattern Web Bluetooth call completed');
        } catch (error: any) {
          // These errors are expected when Electron intercepts the device selection
          if (error.name === 'NotFoundError') {
            console.log('🔵 Device discovery pattern triggered successfully (NotFoundError expected)');
          } else if (error.name === 'AbortError') {
            console.log('🔵 Device discovery pattern triggered successfully (AbortError expected)');
          } else {
            console.log('🔵 Device discovery pattern triggered - error may be expected:', error.message);
          }
        }
      }, 500); // Small delay to ensure connection is fully established

    } catch (error) {
      console.error('❌ Failed to trigger device discovery pattern:', error);
    }
  }

  /**
   * Disconnect a device
   */
  public async disconnectDevice(deviceId: string): Promise<boolean> {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo) {
      console.warn(`⚠️ Device ${deviceId} not found for disconnection`);
      return false;
    }

    try {
      console.log(`🔌 Disconnecting device: ${deviceInfo.name}`);

      // Stop streaming if active
      if (deviceInfo.state === DeviceState.STREAMING) {
        await museManager.stopStreaming();
      }

      // Disconnect from MuseManager
      await museManager.disconnectDevice(deviceInfo.name);

      // Update device state
      deviceInfo.state = DeviceState.DISCONNECTED_AVAILABLE;
      deviceInfo.batteryLevel = null;
      deviceInfo.lastUpdate = Date.now();
      deviceInfo.error = undefined;

      this.notifyStateChange(deviceId, DeviceState.DISCONNECTED_AVAILABLE);
      console.log(`✅ Device ${deviceInfo.name} disconnected successfully`);
      return true;

    } catch (error) {
      console.error(`❌ Failed to disconnect device ${deviceId}:`, error);
      deviceInfo.state = DeviceState.ERROR;
      deviceInfo.error = this.createError('DEVICE_DISCONNECTED', error, deviceId);
      this.notifyStateChange(deviceId, DeviceState.ERROR);
      return false;
    }
  }

  /**
   * Stop recording mode
   */
  public async stopRecording(): Promise<void> {
    if (!this.recordingMode) return;

    try {
      console.log('🛑 Stopping recording mode...');

      // Stop streaming for all streaming devices
      const streamingDevices = Array.from(this.devices.values())
        .filter(d => d.state === DeviceState.STREAMING);

      for (const device of streamingDevices) {
        try {
          await museManager.stopStreaming();
          device.state = DeviceState.CONNECTED_IDLE;
          this.notifyStateChange(device.id, DeviceState.CONNECTED_IDLE);
        } catch (error) {
          console.error(`❌ Error stopping streaming for ${device.name}:`, error);
        }
      }

      this.recordingMode = false;
      console.log('✅ Recording mode stopped');

    } catch (error) {
      console.error('❌ Error stopping recording mode:', error);
      this.recordingMode = false;
    }
  }

  /**
   * Start recording mode (enables streaming)
   */
  public async startRecording(): Promise<boolean> {
    if (this.recordingMode) return true;

    try {
      this.recordingMode = true;
      
      const connectedDevices = Array.from(this.devices.values())
        .filter(d => d.state === DeviceState.CONNECTED_IDLE);

      const streamingPromises = connectedDevices.map(device => 
        this.startStreamingForDevice(device.id)
      );

      const results = await Promise.allSettled(streamingPromises);
      const successCount = results.filter(r => r.status === 'fulfilled').length;

      console.log(`✅ Recording started. ${successCount}/${connectedDevices.length} devices streaming`);
      return successCount > 0;

    } catch (error) {
      console.error('❌ Failed to start recording:', error);
      this.recordingMode = false;
      return false;
    }
  }

  /**
   * Start streaming for a specific device
   */
  private async startStreamingForDevice(deviceId: string): Promise<boolean> {
    const deviceInfo = this.devices.get(deviceId);
    if (!deviceInfo || deviceInfo.state !== DeviceState.CONNECTED_IDLE) {
      return false;
    }

    try {
      const success = await museManager.startStreaming((deviceName, imuData) => {
        this.notifyDataReceived(deviceId, imuData);
        streamDataManager.processIMUData(deviceId, deviceName, imuData);
      });

      if (success) {
        deviceInfo.state = DeviceState.STREAMING;
        this.notifyStateChange(deviceId, DeviceState.STREAMING);
      }

      return success;
    } catch (error) {
      console.error(`❌ Streaming failed for ${deviceId}:`, error);
      return false;
    }
  }

  // Utility methods
  public getDevices(): Map<string, DeviceInfo> {
    return new Map(this.devices);
  }

  public isRecording(): boolean {
    return this.recordingMode;
  }

  public onStateChange(listener: DeviceStateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  public onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  // Private helper methods
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

  private createError(code: keyof typeof ERROR_CODES, error: unknown, deviceId?: string): AppError {
    return {
      code,
      message: error instanceof Error ? error.message : String(error),
      timestamp: Date.now(),
      deviceId,
      context: { originalError: error }
    };
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

  private async initializeSubsystems(): Promise<void> {
    console.log('🔧 Initializing BLE subsystems...');
    
    if (!navigator.bluetooth) {
      throw new Error('Web Bluetooth API not supported');
    }
    
    console.log('✅ Web Bluetooth subsystems initialized');
  }

  private startBatteryUpdateService(): void {
    // Simplified battery updates
    this.batteryUpdateInterval = setInterval(async () => {
      const connectedDevices = Array.from(this.devices.values())
        .filter(d => d.state === DeviceState.CONNECTED_IDLE || d.state === DeviceState.STREAMING);

      for (const device of connectedDevices) {
        try {
          await museManager.updateBatteryLevel(device.name);
          const batteryLevel = museManager.getBatteryLevel(device.name);
          if (batteryLevel !== null) {
            device.batteryLevel = batteryLevel;
            device.lastUpdate = Date.now();
          }
        } catch (error) {
          console.warn(`Battery update failed for ${device.name}:`, error);
        }
      }
    }, this.config.batteryUpdateIntervalMs);
  }

  private assertInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('Simple BLE Device Manager not initialized');
    }
  }

  public async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up Simple BLE Device Manager...');
    
    if (this.batteryUpdateInterval) {
      clearInterval(this.batteryUpdateInterval);
    }

    if (this.ws) {
      this.ws.close();
    }

    this.devices.clear();
    this.connectionLocks.clear();
    this.stateListeners.clear();
    this.dataListeners.clear();
    this.errorListeners.clear();

    this.isInitialized = false;
    console.log('✅ Simple BLE Device Manager cleanup completed');
  }
}

// Export singleton instance
export const simpleBLEDeviceManager = SimpleBLEDeviceManager.getInstance({
  enableAutoRetry: true,
  maxRetryAttempts: 3,
  retryDelayMs: 2000,
  batteryUpdateIntervalMs: 30000,
  connectionTimeoutMs: 15000
});
