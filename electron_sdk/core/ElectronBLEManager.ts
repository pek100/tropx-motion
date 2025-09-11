// electron_sdk/core/ElectronBLEManager.ts
// Main facade for unified Bluetooth Low Energy operations in Electron

import type { 
  IElectronBLEManager, 
  ElectronDevice,
  ElectronDeviceState,
  DeviceScanResult,
  DeviceConnectionResult,
  RecordingSessionData,
  RecordingResult,
  StreamingDataCallback,
  DeviceStateChangeCallback,
  BatteryUpdateCallback,
  ElectronBLEResult,
  ElectronBLEFeatureFlags
} from './types';

import { ElectronDeviceRegistry } from './ElectronDeviceRegistry';
import { ElectronIPCHandler } from './ElectronIPCHandler';
import { museManager } from '../../muse_sdk/core/MuseManager';
import { MotionProcessingCoordinator } from '../../motionProcessing/MotionProcessingCoordinator';

export class ElectronBLEManager implements IElectronBLEManager {
  private registry: ElectronDeviceRegistry;
  private ipcHandler: ElectronIPCHandler;
  private motionProcessingCoordinator: MotionProcessingCoordinator | null = null;
  
  // Callbacks
  private streamingDataCallback: StreamingDataCallback | null = null;
  private deviceStateChangeCallbacks: Set<DeviceStateChangeCallback> = new Set();
  private batteryUpdateCallbacks: Set<BatteryUpdateCallback> = new Set();
  
  // Internal state
  private isRecordingInternal: boolean = false;
  private recordingStartTime: Date | null = null;
  private batteryUpdateTimer: NodeJS.Timeout | null = null;
  private scanInProgress: boolean = false;
  
  // Feature flags for safe migration
  private featureFlags: ElectronBLEFeatureFlags;
  
  // Constants
  private readonly BATTERY_UPDATE_INTERVAL = 30000; // 30 seconds
  private readonly SCAN_COOLDOWN = 3000; // 3 seconds between scans
  private readonly CONSTANTS = {
    SERVICES: {
      TROPX_SERVICE_UUID: "c8c0a708-e361-4b5e-a365-98fa6b0a836f",
    },
    TIMEOUTS: {
      DEVICE_DISCOVERY_TRIGGER: 1000,
      FAST_CONNECTION_TIMEOUT: 5000,
      CONNECTION_CLEANUP: 1000,
      FINAL_RESET_WAIT: 2000,
    },
  };

  private lastScanTime: number = 0;

  constructor(featureFlags?: Partial<ElectronBLEFeatureFlags>) {
    console.log('🚀 ElectronBLEManager: Initializing...');
    
    this.registry = new ElectronDeviceRegistry();
    this.ipcHandler = new ElectronIPCHandler();
    
    // Initialize feature flags with defaults and apply custom flags
    this.featureFlags = {
      USE_ELECTRON_BLE_SCAN: false,
      USE_ELECTRON_BLE_CONNECT: false,
      USE_ELECTRON_BLE_RECORD: false,
      ...featureFlags
    };
    
    // Subscribe to registry changes to propagate to UI callbacks
    this.registry.onDeviceChange((deviceId, device) => {
      this.notifyDeviceStateChange(deviceId, device);
    });
    
    console.log('✅ ElectronBLEManager: Initialized successfully');
    console.log('🎛️ Feature flags:', this.featureFlags);
  }

  // Device discovery operations
  async scanDevices(): Promise<DeviceScanResult> {
    console.log('\n🔍 ===== ELECTRON BLE SCAN OPERATION =====');
    console.log('🔍 Timestamp:', new Date().toISOString());
    
    try {
      // Prevent multiple simultaneous scans
      if (this.scanInProgress) {
        console.log('⚠️ Scan already in progress, skipping...');
        return {
          success: false,
          message: 'Scan already in progress',
          devices: []
        };
      }
      
      // Enforce cooldown period
      const now = Date.now();
      if (now - this.lastScanTime < this.SCAN_COOLDOWN) {
        const remainingCooldown = Math.ceil((this.SCAN_COOLDOWN - (now - this.lastScanTime)) / 1000);
        console.log(`⏳ Scan cooldown active (${remainingCooldown}s remaining)`);
        return {
          success: false,
          message: `Scan cooldown active, wait ${remainingCooldown} seconds`,
          devices: []
        };
      }
      
      this.lastScanTime = now;
      this.scanInProgress = true;
      
      console.log('🔍 Starting Web Bluetooth scan...');
      
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth not available');
      }
      
      // Create timeout promise to prevent hanging
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Scan timeout")), 5000);
      });
      
      // Race between Bluetooth scan and timeout
      await Promise.race([
        navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [this.CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
        }),
        timeoutPromise,
      ]);
      
      console.log('✅ Scan request completed - main process will handle device selection');
      
      // Note: The actual device discovery happens through WebSocket messages
      // This matches the current flow where scan triggers device selection
      // and discovered devices come back via WebSocket
      
      return {
        success: true,
        message: 'Device scan initiated successfully',
        devices: Array.from(this.registry.getDevices().values())
      };
      
    } catch (error: any) {
      console.log(`🔍 Scan trigger error: ${error.name} (expected for device selection pattern)`);
      
      // Handle timeout specifically
      if (error.message === "Scan timeout") {
        console.log('⏰ Scan timed out - this may be normal for auto-scans');
        return {
          success: false,
          message: 'Scan timed out',
          devices: Array.from(this.registry.getDevices().values())
        };
      }
      
      // Show user-friendly message for common Bluetooth issues
      const isCommonBluetoothIssue =
        error?.name === "NotFoundError" ||
        error?.name === "NotAllowedError" ||
        error?.name === "SecurityError" ||
        error?.message?.includes("chooser") ||
        error?.message?.includes("user gesture");
        
      if (isCommonBluetoothIssue) {
        console.log('📱 Expected Bluetooth interaction error (part of device selection flow)');
        return {
          success: true,
          message: 'Device selection triggered',
          devices: Array.from(this.registry.getDevices().values())
        };
      }
      
      console.error('❌ Unexpected scan error:', error);
      return {
        success: false,
        message: `Scan error: ${error?.message || "Unknown error"}`,
        devices: Array.from(this.registry.getDevices().values())
      };
      
    } finally {
      this.scanInProgress = false;
      console.log('🔍 =======================================\n');
    }
  }

  async cancelScan(): Promise<ElectronBLEResult> {
    console.log('🚫 Canceling current scan...');
    this.scanInProgress = false;
    
    return {
      success: true,
      message: 'Scan canceled successfully'
    };
  }

  // Device connection operations
  async connectDevice(deviceId: string, deviceName: string): Promise<DeviceConnectionResult> {
    console.log('\n🔗 ===== ELECTRON BLE CONNECT OPERATION =====');
    console.log('🔗 Timestamp:', new Date().toISOString());
    console.log('🔗 Device ID:', deviceId);
    console.log('🔗 Device Name:', deviceName);
    
    try {
      // Safety check: Prevent multiple simultaneous connection attempts
      const currentDevice = this.registry.getDevice(deviceId);
      if (currentDevice?.state === "connecting") {
        console.log('⚠️ Connection already in progress for device:', deviceName);
        return {
          success: false,
          message: 'Connection already in progress',
          deviceId,
          deviceName,
          connected: false
        };
      }
      
      // Set device to connecting state
      if (currentDevice) {
        this.registry.updateDevice(deviceId, { state: "connecting" });
      } else {
        // Add device if it doesn't exist
        this.registry.addDevice({
          id: deviceId,
          name: deviceName,
          state: "connecting",
          batteryLevel: null,
          lastSeen: new Date()
        });
      }
      
      console.log('🔗 Step 1: Acquire Web Bluetooth device via programmatic selection...');
      
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth not available');
      }
      
      // Kick off requestDevice FIRST to trigger select-bluetooth-device event in main
      const requestPromise = navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [this.CONSTANTS.SERVICES.TROPX_SERVICE_UUID],
      });
      
      // Immediately instruct main process to select our target deviceId
      try {
        await this.ipcHandler.selectDevice(deviceId);
      } catch (selectionError) {
        console.warn('🔗 Device selection warning (may be normal):', selectionError);
      }
      
      // Await the actual BluetoothDevice returned from requestDevice
      let webBtDevice: any = null;
      try {
        webBtDevice = (await requestPromise) as any;
        console.log('🔗 Web Bluetooth device acquired:', webBtDevice?.name, webBtDevice?.id);
      } catch (reqErr: any) {
        console.error('❌ requestDevice failed:', reqErr?.name || reqErr);
        // Fallbacks will handle pairing status below
      }
      
      console.log('🔗 Step 2: Connecting via MuseManager...');
      
      // If device already connected, clean up first
      if (museManager.isDeviceConnected(deviceName)) {
        console.log('🔗 Device already connected, cleaning up first...');
        await museManager.disconnectDevice(deviceName);
        await new Promise((resolve) => setTimeout(resolve, this.CONSTANTS.TIMEOUTS.CONNECTION_CLEANUP));
      }
      
      let connected = false;
      
      // Preferred: If we obtained a Web Bluetooth device from requestDevice, connect with it directly
      if (webBtDevice) {
        try {
          connected = await museManager.connectWebBluetoothDevice(
            webBtDevice,
            this.CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT,
          );
          console.log(
            `${connected ? "✅" : "❌"} Direct SDK connection via Web Bluetooth ${connected ? "successful" : "failed"}`,
          );
        } catch (directErr) {
          console.warn('⚠️ Direct SDK connection via Web Bluetooth failed, will try fallbacks:', directErr);
        }
      }
      
      // Fallback 1: Fast reconnection using previously authorized devices
      if (!connected) {
        try {
          const previousDevices = await museManager.reconnectToPreviousDevices();
          const targetDevice = previousDevices.find((d) => d.name === deviceName || d.id === deviceId);
          if (targetDevice) {
            console.log(`🚀 Attempting fast reconnection to ${deviceName}...`);
            connected = await museManager.connectWebBluetoothDevice(
              targetDevice as any,
              this.CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT,
            );
            console.log(`${connected ? "✅" : "❌"} Fast reconnection ${connected ? "successful" : "failed"}`);
          }
        } catch (reconnectError) {
          console.log('⚠️ Fast reconnection failed:', reconnectError);
        }
      }
      
      // Fallback 2: Standard SDK connection via registry + getDevices
      if (!connected) {
        console.log(`🔗 Trying standard SDK connection for ${deviceName}...`);
        // Clear any stale device state that might interfere
        if (museManager.isDeviceConnected(deviceName)) {
          await museManager.disconnectDevice(deviceName);
          await new Promise((resolve) => setTimeout(resolve, this.CONSTANTS.TIMEOUTS.CONNECTION_CLEANUP));
        }
        connected = await museManager.connectToScannedDevice(deviceId, deviceName);
        console.log(`${connected ? "✅" : "❌"} Standard SDK connection ${connected ? "successful" : "failed"}`);
      }
      
      if (connected) {
        console.log('✅ SDK connection established for:', deviceName);
        
        // Update battery levels
        await museManager.updateBatteryLevel(deviceName);
        const batteryLevel = museManager.getBatteryLevel(deviceName);
        
        // Update unified device state with successful connection
        this.registry.transitionFromConnecting(deviceId, "connected");
        this.registry.updateDevice(deviceId, { batteryLevel });
        
        // Start battery update timer if not already running
        this.startBatteryUpdateTimer();
        
        console.log('✅ SDK connection completed with battery info');
        
        return {
          success: true,
          message: 'Device connected successfully',
          deviceId,
          deviceName,
          connected: true
        };
        
      } else {
        console.log(`💥 Attempting final connection with full reset for ${deviceName}...`);
        try {
          // Nuclear option: clear all device state
          await museManager.forceResetAllDeviceState();
          await new Promise((resolve) => setTimeout(resolve, this.CONSTANTS.TIMEOUTS.FINAL_RESET_WAIT));
          
          // Re-add the device to scanned devices since we cleared everything
          museManager.addScannedDevices([{
            deviceId: deviceId,
            deviceName: deviceName,
          }]);
          
          const finalConnected = await museManager.connectToScannedDevice(deviceId, deviceName);
          if (finalConnected) {
            console.log(`✅ Final attempt successful for ${deviceName}`);
            this.registry.transitionFromConnecting(deviceId, "connected");
            return {
              success: true,
              message: 'Device connected after reset',
              deviceId,
              deviceName,
              connected: true
            };
          } else {
            throw new Error(`All connection attempts failed for ${deviceName}`);
          }
        } catch (finalError) {
          throw new Error(
            `All connection attempts failed: ${finalError instanceof Error ? finalError.message : finalError}`,
          );
        }
      }
      
    } catch (error) {
      console.error('❌ ElectronBLE connection error:', error);
      
      // 🔧 ENHANCED ERROR HANDLING: Check if device needs pairing
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('not found in paired devices') || errorMessage.includes('All connection attempts failed')) {
        console.log(`🔗 Device ${deviceName} needs pairing - attempting automatic pairing...`);
        
        try {
          // Attempt to pair the device using MuseManager's pairing method
          const pairResult = await museManager.pairNewDevice();
          
          if (pairResult.success && pairResult.deviceName === deviceName) {
            console.log(`✅ Successfully paired ${deviceName} - attempting connection again...`);
            
            // Add a small delay to ensure pairing is complete
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Retry connection after successful pairing
            try {
              const retryConnected = await museManager.connectToScannedDevice(deviceId, deviceName);
              
              if (retryConnected) {
                console.log(`✅ Connection successful after pairing: ${deviceName}`);
                
                // Update battery levels
                await museManager.updateBatteryLevel(deviceName);
                const batteryLevel = museManager.getBatteryLevel(deviceName);
                
                // Update unified device state with successful connection
                this.registry.transitionFromConnecting(deviceId, "connected");
                this.registry.updateDevice(deviceId, { batteryLevel });
                
                return {
                  success: true,
                  message: 'Device connected after pairing',
                  deviceId,
                  deviceName,
                  connected: true
                };
              }
            } catch (retryError) {
              console.warn('⚠️ Connection retry after pairing failed:', retryError);
            }
          } else {
            console.warn('⚠️ Pairing failed or paired different device:', pairResult);
          }
        } catch (pairError) {
          console.warn('⚠️ Automatic pairing failed:', pairError);
        }
      }
      
      // Clean up any partial state
      try {
        await museManager.disconnectDevice(deviceName);
      } catch (cleanupError) {
        console.warn('⚠️ Cleanup error:', cleanupError);
      }
      
      // Update device state to show connection failed
      const isConnectedNow = museManager.isDeviceConnected(deviceName);
      if (!isConnectedNow) {
        this.registry.updateDevice(deviceId, { state: "discovered" });
      }
      
      return {
        success: false,
        message: `Connection failed: ${errorMessage}`,
        deviceId,
        deviceName,
        connected: false
      };
      
    } finally {
      console.log('🔗 ======================================\n');
    }
  }

  async connectAllDevices(): Promise<ElectronBLEResult> {
    console.log('\n🔗 ===== CONNECT ALL DEVICES =====');
    
    const discoveredDevices = this.registry.getDevicesByState("discovered");
    if (discoveredDevices.length === 0) {
      return {
        success: false,
        message: 'No devices available to connect'
      };
    }
    
    console.log(`🔗 Connecting to ${discoveredDevices.length} devices...`);
    
    const results: DeviceConnectionResult[] = [];
    let successCount = 0;
    
    // Connect sequentially to avoid concurrent Web Bluetooth chooser conflicts
    for (const device of discoveredDevices) {
      try {
        // Let connectDevice handle the state management itself
        const result = await this.connectDevice(device.id, device.name);
        results.push(result);
        if (result.success) {
          successCount++;
        }
      } catch (error) {
        console.error(`❌ Connection failed for ${device.name}:`, error);
        results.push({
          success: false,
          message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
          deviceId: device.id,
          deviceName: device.name,
          connected: false
        });
        
        // Ensure device state is reset on error
        this.registry.updateDevice(device.id, { state: "discovered" });
      }
    }
    
    console.log(`✅ Connected ${successCount}/${discoveredDevices.length} devices`);
    console.log('🔗 ===============================\n');
    
    return {
      success: successCount > 0,
      message: `Connected ${successCount}/${discoveredDevices.length} devices`,
      data: results
    };
  }

  async disconnectDevice(deviceId: string): Promise<ElectronBLEResult> {
    console.log(`🔌 Disconnecting device: ${deviceId}`);
    
    const device = this.registry.getDevice(deviceId);
    if (!device) {
      return {
        success: false,
        message: 'Device not found in registry'
      };
    }
    
    try {
      // Disconnect via MuseManager
      await museManager.disconnectDevice(device.name);
      
      // Update device state
      this.registry.updateDevice(deviceId, { state: "discovered" });
      
      console.log(`✅ Device disconnected successfully: ${device.name}`);
      return {
        success: true,
        message: 'Device disconnected successfully'
      };
      
    } catch (error) {
      console.error(`❌ Failed to disconnect device:`, error);
      return {
        success: false,
        message: `Disconnect failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  // Recording operations
  async startRecording(sessionData: RecordingSessionData): Promise<RecordingResult> {
    console.log('\n🎬 ===== START RECORDING =====');
    console.log('🎬 Session Data:', sessionData);
    
    try {
      if (this.isRecordingInternal) {
        return {
          success: false,
          message: 'Recording already in progress',
          isRecording: true,
          startTime: this.recordingStartTime
        };
      }
      
      // Check connected devices
      const connectedDevices = museManager.getConnectedDevices();
      console.log('🔍 Connected devices for recording:', connectedDevices);
      
      if (connectedDevices.size === 0) {
        console.error('❌ No connected devices found for recording');
        return {
          success: false,
          message: 'No connected devices available for recording',
          isRecording: false,
          startTime: null
        };
      }
      
      // 1. Initialize motion processing coordinator if not already done
      if (!this.motionProcessingCoordinator) {
        console.log('🧠 Initializing MotionProcessingCoordinator...');
        this.motionProcessingCoordinator = MotionProcessingCoordinator.getInstance();
        console.log('✅ MotionProcessingCoordinator initialized successfully');
      }
      
      // 2. Start motion processing recording session
      const motionRecordingStarted = this.motionProcessingCoordinator.startRecording(
        sessionData.sessionId,
        sessionData.exerciseId,
        sessionData.setNumber,
      );
      
      if (!motionRecordingStarted) {
        console.error('❌ Failed to start motion processing recording');
        return {
          success: false,
          message: 'Failed to start motion processing recording',
          isRecording: false,
          startTime: null
        };
      }
      
      console.log('✅ Motion processing recording started');
      
      // 3. Start real quaternion streaming via GATT service
      const streamingSuccess = await museManager.startStreaming((deviceName: string, data: any) => {
        // Send data to motion processing pipeline
        if (this.motionProcessingCoordinator) {
          try {
            this.motionProcessingCoordinator.processNewData(deviceName, data);
          } catch (error) {
            console.error('❌ Error processing SDK motion data:', error);
          }
        }
        
        // Also propagate to external streaming callback if set
        if (this.streamingDataCallback) {
          try {
            this.streamingDataCallback(deviceName, data);
          } catch (error) {
            console.error('❌ Error in external streaming callback:', error);
          }
        }
      });
      
      if (streamingSuccess) {
        console.log('✅ SDK quaternion streaming started successfully');
        
        // Update internal recording state
        this.isRecordingInternal = true;
        this.recordingStartTime = new Date();
        
        // Update devices to show streaming state
        const streamingDeviceNames = museManager.getStreamingDeviceNames();
        console.log('📡 Devices now streaming:', streamingDeviceNames);
        
        // Update unified device state for streaming devices
        streamingDeviceNames.forEach(deviceName => {
          const device = Array.from(this.registry.getDevices().values())
            .find(d => d.name === deviceName && d.state === "connected");
          if (device) {
            this.registry.updateDevice(device.id, { state: "streaming" });
          }
        });
        
        // 4. Start recording in main process (for storage/backup)
        try {
          const ipcResult = await this.ipcHandler.startRecording(sessionData);
          console.log('✅ Main process recording result:', ipcResult);
        } catch (ipcError) {
          console.warn('⚠️ Main process recording start warning:', ipcError);
          // Don't fail the whole operation if IPC fails
        }
        
        console.log('✅ ElectronBLE: Recording with quaternion streaming started successfully');
        console.log('🎬 ============================\n');
        
        return {
          success: true,
          message: 'Recording started successfully',
          isRecording: true,
          startTime: this.recordingStartTime
        };
        
      } else {
        console.error('❌ Failed to start SDK quaternion streaming');
        
        // Clean up motion processing recording if streaming failed
        if (this.motionProcessingCoordinator) {
          await this.motionProcessingCoordinator.stopRecording();
        }
        
        return {
          success: false,
          message: 'Failed to start quaternion streaming',
          isRecording: false,
          startTime: null
        };
      }
      
    } catch (error) {
      console.error('❌ Recording start error:', error);
      
      // Ensure clean state on error
      this.isRecordingInternal = false;
      this.recordingStartTime = null;
      
      // Stop any partial streaming that might have started
      try {
        await museManager.stopStreaming();
      } catch (stopError) {
        console.warn('⚠️ Error stopping streaming during cleanup:', stopError);
      }
      
      console.log('🎬 ============================\n');
      
      return {
        success: false,
        message: `Recording start failed: ${error instanceof Error ? error.message : String(error)}`,
        isRecording: false,
        startTime: null
      };
    }
  }

  async stopRecording(): Promise<RecordingResult> {
    console.log('\n🛑 ===== STOP RECORDING =====');
    
    try {
      if (!this.isRecordingInternal) {
        return {
          success: false,
          message: 'No recording in progress',
          isRecording: false,
          startTime: null
        };
      }
      
      const currentStreamingState = museManager.getIsStreaming();
      console.log(`🛑 Current streaming state: ${currentStreamingState}`);
      
      // 1. Stop real quaternion streaming via GATT service
      if (currentStreamingState) {
        console.log('🛑 SDK streaming is active, stopping...');
        await museManager.stopStreaming();
        console.log('✅ SDK streaming stopped');
      } else {
        console.log('⚠️ SDK streaming was already stopped');
      }
      
      // 2. Stop motion processing coordinator recording
      if (this.motionProcessingCoordinator) {
        await this.motionProcessingCoordinator.stopRecording();
        console.log('✅ Motion processing recording stopped');
      }
      
      // 3. Stop recording in main process (if available)
      try {
        const ipcResult = await this.ipcHandler.stopRecording();
        console.log('✅ Main process stop recording result:', ipcResult);
      } catch (ipcError) {
        console.warn('⚠️ Main process recording stop warning:', ipcError);
        // Don't fail the whole operation if IPC fails
      }
      
      // Update internal recording state
      this.isRecordingInternal = false;
      const previousStartTime = this.recordingStartTime;
      this.recordingStartTime = null;
      
      // Update all devices to stop streaming state
      this.registry.getDevices().forEach((device, deviceId) => {
        if (device.state === "streaming") {
          this.registry.updateDevice(deviceId, { state: "connected" });
        }
      });
      
      console.log('✅ Recording and streaming stopped successfully');
      console.log('🛑 ==========================\n');
      
      return {
        success: true,
        message: 'Recording stopped successfully',
        isRecording: false,
        startTime: previousStartTime
      };
      
    } catch (error) {
      console.error('❌ Recording stop error:', error);
      console.log('🛑 ==========================\n');
      
      return {
        success: false,
        message: `Recording stop failed: ${error instanceof Error ? error.message : String(error)}`,
        isRecording: this.isRecordingInternal,
        startTime: this.recordingStartTime
      };
    }
  }

  // Device state management
  getDevices(): Map<string, ElectronDevice> {
    return this.registry.getDevices();
  }

  getDevice(deviceId: string): ElectronDevice | null {
    return this.registry.getDevice(deviceId);
  }

  isDeviceConnected(deviceId: string): boolean {
    const device = this.registry.getDevice(deviceId);
    return device ? (device.state === "connected" || device.state === "streaming") : false;
  }

  // Event handling
  onDeviceStateChange(callback: DeviceStateChangeCallback): () => void {
    this.deviceStateChangeCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.deviceStateChangeCallbacks.delete(callback);
    };
  }

  onBatteryUpdate(callback: BatteryUpdateCallback): () => void {
    this.batteryUpdateCallbacks.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.batteryUpdateCallbacks.delete(callback);
    };
  }

  onStreamingData(callback: StreamingDataCallback): () => void {
    this.streamingDataCallback = callback;
    
    // Return unsubscribe function
    return () => {
      this.streamingDataCallback = null;
    };
  }

  // Internal methods
  private notifyDeviceStateChange(deviceId: string, device: ElectronDevice): void {
    this.deviceStateChangeCallbacks.forEach(callback => {
      try {
        callback(deviceId, device);
      } catch (error) {
        console.error('❌ Error in device state change callback:', error);
      }
    });
  }

  private notifyBatteryUpdate(deviceId: string, batteryLevel: number): void {
    this.batteryUpdateCallbacks.forEach(callback => {
      try {
        callback(deviceId, batteryLevel);
      } catch (error) {
        console.error('❌ Error in battery update callback:', error);
      }
    });
  }

  private startBatteryUpdateTimer(): void {
    // Clear existing timer
    if (this.batteryUpdateTimer) {
      clearInterval(this.batteryUpdateTimer);
    }
    
    // Update battery levels periodically for connected devices
    this.batteryUpdateTimer = setInterval(async () => {
      try {
        await museManager.updateAllBatteryLevels();
        const allBatteryLevels = museManager.getAllBatteryLevels();
        
        // Update unified device state with new battery levels
        allBatteryLevels.forEach((batteryLevel, deviceName) => {
          // Find device by name and update its battery level
          const deviceEntry = Array.from(this.registry.getDevices().entries())
            .find(([_, device]) => device.name === deviceName);
          if (deviceEntry) {
            const [deviceId] = deviceEntry;
            this.registry.updateDevice(deviceId, { batteryLevel });
            this.notifyBatteryUpdate(deviceId, batteryLevel);
          }
        });
        
        console.log(`🔋 Updated battery levels for ${allBatteryLevels.size} devices`);
      } catch (error) {
        console.error('❌ Battery update timer error:', error);
      }
    }, this.BATTERY_UPDATE_INTERVAL);
    
    console.log('✅ Battery update timer started');
  }

  // Methods to handle external device updates (e.g., from WebSocket messages)
  addScannedDevices(devices: Array<{deviceId: string, deviceName: string, batteryLevel?: number}>): void {
    console.log(`📱 ElectronBLE: Adding ${devices.length} scanned devices to registry`);
    
    devices.forEach(device => {
      const existingDevice = this.registry.getDevice(device.deviceId);
      let deviceState: ElectronDeviceState = "discovered";
      
      if (existingDevice) {
        // Preserve existing connection states
        if (existingDevice.state === "connected" || existingDevice.state === "streaming") {
          const isActuallyConnected = museManager.isDeviceConnected(device.deviceName);
          const isActuallyStreaming = museManager.isDeviceStreaming(device.deviceName);
          if (isActuallyStreaming) deviceState = "streaming";
          else if (isActuallyConnected) deviceState = "connected";
          else deviceState = "discovered";
        } else if (existingDevice.state === "connecting") {
          deviceState = "connecting";
        } else {
          deviceState = "discovered";
        }
      }
      
      const electronDevice: ElectronDevice = {
        id: device.deviceId,
        name: device.deviceName,
        state: deviceState,
        batteryLevel: device.batteryLevel || existingDevice?.batteryLevel || null,
        lastSeen: new Date(),
      };
      
      this.registry.addDevice(electronDevice);
      
      // Also add to MuseManager registry for backward compatibility
      museManager.addScannedDevices([{
        deviceId: device.deviceId,
        deviceName: device.deviceName,
      }]);
    });
  }

  // Cleanup
  async cleanup(): Promise<void> {
    console.log('🧹 ElectronBLEManager: Starting cleanup...');
    
    // Stop any active recording
    if (this.isRecordingInternal) {
      await this.stopRecording();
    }
    
    // Stop streaming if active
    try {
      if (museManager.getIsStreaming()) {
        await museManager.stopStreaming();
      }
    } catch (error) {
      console.warn('⚠️ Error stopping streaming during cleanup:', error);
    }
    
    // Clear battery update timer
    if (this.batteryUpdateTimer) {
      clearInterval(this.batteryUpdateTimer);
      this.batteryUpdateTimer = null;
    }
    
    // Clean up callbacks
    this.deviceStateChangeCallbacks.clear();
    this.batteryUpdateCallbacks.clear();
    this.streamingDataCallback = null;
    
    // Clean up registry
    this.registry.cleanup();
    
    // Clean up IPC handler
    this.ipcHandler.cleanup();
    
    console.log('✅ ElectronBLEManager: Cleanup completed');
  }
}