// electron/renderer/hooks/useElectronBLE.ts
// React hook providing unified BLE operations with feature flag support

import { useState, useEffect, useRef } from 'react';
import { ElectronBLEManager, DEFAULT_FEATURE_FLAGS, type ElectronBLEFeatureFlags } from '../../../electron_sdk';
import type { 
  ElectronDevice, 
  DeviceScanResult, 
  DeviceConnectionResult, 
  RecordingSessionData, 
  RecordingResult,
  ElectronBLEResult
} from '../../../electron_sdk';

interface UseElectronBLEOptions {
  featureFlags?: Partial<ElectronBLEFeatureFlags>;
  onDeviceStateChange?: (deviceId: string, device: ElectronDevice) => void;
  onBatteryUpdate?: (deviceId: string, batteryLevel: number) => void;
  onStreamingData?: (deviceName: string, data: any) => void;
}

interface UseElectronBLEReturn {
  // Device operations
  scanDevices: () => Promise<DeviceScanResult>;
  cancelScan: () => Promise<ElectronBLEResult>;
  connectDevice: (deviceId: string, deviceName: string) => Promise<DeviceConnectionResult>;
  connectAllDevices: () => Promise<ElectronBLEResult>;
  disconnectDevice: (deviceId: string) => Promise<ElectronBLEResult>;
  
  // Recording operations
  startRecording: (sessionData: RecordingSessionData) => Promise<RecordingResult>;
  stopRecording: () => Promise<RecordingResult>;
  
  // State
  devices: Map<string, ElectronDevice>;
  isScanning: boolean;
  isRecording: boolean;
  recordingStartTime: Date | null;
  
  // Utility
  getDevice: (deviceId: string) => ElectronDevice | null;
  isDeviceConnected: (deviceId: string) => boolean;
  getConnectedDevices: () => ElectronDevice[];
  addScannedDevices: (devices: Array<{deviceId: string, deviceName: string, batteryLevel?: number}>) => void;
  
  // Feature flags
  featureFlags: ElectronBLEFeatureFlags;
  
  // Cleanup
  cleanup: () => Promise<void>;
}

export function useElectronBLE(options: UseElectronBLEOptions = {}): UseElectronBLEReturn {
  const {
    featureFlags: customFeatureFlags = {},
    onDeviceStateChange,
    onBatteryUpdate,
    onStreamingData
  } = options;

  // Merge feature flags with defaults
  const featureFlags: ElectronBLEFeatureFlags = {
    ...DEFAULT_FEATURE_FLAGS,
    ...customFeatureFlags
  };

  // State
  const [devices, setDevices] = useState<Map<string, ElectronDevice>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);

  // Refs
  const bleManagerRef = useRef<ElectronBLEManager | null>(null);
  const unsubscribersRef = useRef<(() => void)[]>([]);

  // Initialize ElectronBLEManager
  useEffect(() => {
    console.log('🎣 useElectronBLE: Initializing ElectronBLEManager...');
    console.log('🎛️ Feature flags:', JSON.stringify(featureFlags, null, 2));
    
    try {
      bleManagerRef.current = new ElectronBLEManager(featureFlags);
      
      // Set up event listeners
      const deviceStateUnsubscribe = bleManagerRef.current.onDeviceStateChange((deviceId, device) => {
        console.log(`🎣 Device state change: ${device.name} → ${device.state}`);
        
        // Update local state
        setDevices(prevDevices => {
          const newDevices = new Map(prevDevices);
          newDevices.set(deviceId, device);
          return newDevices;
        });
        
        // Notify external callback
        if (onDeviceStateChange) {
          onDeviceStateChange(deviceId, device);
        }
      });
      
      const batteryUpdateUnsubscribe = bleManagerRef.current.onBatteryUpdate((deviceId, batteryLevel) => {
        console.log(`🔋 Battery update: ${deviceId} → ${batteryLevel}%`);
        
        // Update local state
        setDevices(prevDevices => {
          const newDevices = new Map(prevDevices);
          const device = newDevices.get(deviceId);
          if (device) {
            newDevices.set(deviceId, { ...device, batteryLevel });
          }
          return newDevices;
        });
        
        // Notify external callback
        if (onBatteryUpdate) {
          onBatteryUpdate(deviceId, batteryLevel);
        }
      });
      
      const streamingDataUnsubscribe = bleManagerRef.current.onStreamingData((deviceName, data) => {
        console.log(`📡 Streaming data from ${deviceName}`);
        
        // Notify external callback
        if (onStreamingData) {
          onStreamingData(deviceName, data);
        }
      });
      
      // Store unsubscribers
      unsubscribersRef.current = [
        deviceStateUnsubscribe,
        batteryUpdateUnsubscribe,
        streamingDataUnsubscribe
      ];
      
      // Initialize devices from manager
      setDevices(bleManagerRef.current.getDevices());
      
      console.log('✅ useElectronBLE: ElectronBLEManager initialized successfully');
      
    } catch (error) {
      console.error('❌ useElectronBLE: Failed to initialize ElectronBLEManager:', error);
    }

    // Cleanup on unmount
    return () => {
      console.log('🧹 useElectronBLE: Cleaning up...');
      
      // Unsubscribe from events
      unsubscribersRef.current.forEach(unsubscribe => unsubscribe());
      unsubscribersRef.current = [];
      
      // Cleanup manager
      if (bleManagerRef.current) {
        bleManagerRef.current.cleanup().catch(error => {
          console.warn('⚠️ Error during ElectronBLEManager cleanup:', error);
        });
        bleManagerRef.current = null;
      }
    };
  }, []); // Empty dependency array - initialize once

  // Device operations
  const scanDevices = async (): Promise<DeviceScanResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized',
        devices: []
      };
    }

    console.log('🎣 useElectronBLE: Starting device scan...');
    setIsScanning(true);

    try {
      const result = await bleManagerRef.current.scanDevices();
      
      // Update devices state with scan results
      if (result.success && result.devices) {
        const newDevicesMap = new Map<string, ElectronDevice>();
        result.devices.forEach(device => {
          newDevicesMap.set(device.id, device);
        });
        setDevices(newDevicesMap);
      }
      
      console.log(`🎣 Scan result: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.devices?.length || 0} devices`);
      return result;
      
    } catch (error) {
      console.error('❌ useElectronBLE: Scan error:', error);
      return {
        success: false,
        message: `Scan failed: ${error instanceof Error ? error.message : String(error)}`,
        devices: []
      };
    } finally {
      setIsScanning(false);
    }
  };

  const cancelScan = async (): Promise<ElectronBLEResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized'
      };
    }

    console.log('🎣 useElectronBLE: Canceling scan...');
    setIsScanning(false);
    
    return bleManagerRef.current.cancelScan();
  };

  const connectDevice = async (deviceId: string, deviceName: string): Promise<DeviceConnectionResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized',
        deviceId,
        deviceName,
        connected: false
      };
    }

    console.log(`🎣 useElectronBLE: Connecting to device: ${deviceName} (${deviceId})`);
    
    const result = await bleManagerRef.current.connectDevice(deviceId, deviceName);
    
    // Update devices state after connection attempt
    setDevices(bleManagerRef.current.getDevices());
    
    return result;
  };

  const connectAllDevices = async (): Promise<ElectronBLEResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized'
      };
    }

    console.log('🎣 useElectronBLE: Connecting to all devices...');
    
    const result = await bleManagerRef.current.connectAllDevices();
    
    // Update devices state after connection attempts
    setDevices(bleManagerRef.current.getDevices());
    
    return result;
  };

  const disconnectDevice = async (deviceId: string): Promise<ElectronBLEResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized'
      };
    }

    const device = devices.get(deviceId);
    console.log(`🎣 useElectronBLE: Disconnecting device: ${device?.name || deviceId}`);
    
    const result = await bleManagerRef.current.disconnectDevice(deviceId);
    
    // Update devices state after disconnection
    setDevices(bleManagerRef.current.getDevices());
    
    return result;
  };

  // Recording operations
  const startRecording = async (sessionData: RecordingSessionData): Promise<RecordingResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized',
        isRecording: false,
        startTime: null
      };
    }

    console.log('🎣 useElectronBLE: Starting recording...', sessionData);
    
    const result = await bleManagerRef.current.startRecording(sessionData);
    
    // Update local recording state
    setIsRecording(result.isRecording);
    setRecordingStartTime(result.startTime || null);
    
    // Update devices state (streaming states may have changed)
    setDevices(bleManagerRef.current.getDevices());
    
    return result;
  };

  const stopRecording = async (): Promise<RecordingResult> => {
    if (!bleManagerRef.current) {
      return {
        success: false,
        message: 'ElectronBLEManager not initialized',
        isRecording: false,
        startTime: null
      };
    }

    console.log('🎣 useElectronBLE: Stopping recording...');
    
    const result = await bleManagerRef.current.stopRecording();
    
    // Update local recording state
    setIsRecording(result.isRecording);
    setRecordingStartTime(result.startTime || null);
    
    // Update devices state (streaming states may have changed)
    setDevices(bleManagerRef.current.getDevices());
    
    return result;
  };

  // Utility functions
  const getDevice = (deviceId: string): ElectronDevice | null => {
    return devices.get(deviceId) || null;
  };

  const isDeviceConnected = (deviceId: string): boolean => {
    const device = devices.get(deviceId);
    return device ? (device.state === 'connected' || device.state === 'streaming') : false;
  };

  const getConnectedDevices = (): ElectronDevice[] => {
    return Array.from(devices.values()).filter(device => 
      device.state === 'connected' || device.state === 'streaming'
    );
  };

  const addScannedDevices = (devices: Array<{deviceId: string, deviceName: string, batteryLevel?: number}>): void => {
    if (!bleManagerRef.current) {
      console.warn('🎣 useElectronBLE: Cannot add scanned devices - manager not initialized');
      return;
    }
    
    console.log(`🎣 useElectronBLE: Adding ${devices.length} scanned devices to ElectronBLE system`);
    bleManagerRef.current.addScannedDevices(devices);
    
    // Update local state with the new devices
    setDevices(bleManagerRef.current.getDevices());
  };

  const cleanup = async (): Promise<void> => {
    console.log('🎣 useElectronBLE: Manual cleanup requested...');
    
    if (bleManagerRef.current) {
      await bleManagerRef.current.cleanup();
    }
    
    // Reset local state
    setDevices(new Map());
    setIsScanning(false);
    setIsRecording(false);
    setRecordingStartTime(null);
  };

  return {
    // Operations
    scanDevices,
    cancelScan,
    connectDevice,
    connectAllDevices,
    disconnectDevice,
    startRecording,
    stopRecording,
    
    // State
    devices,
    isScanning,
    isRecording,
    recordingStartTime,
    
    // Utility
    getDevice,
    isDeviceConnected,
    getConnectedDevices,
    addScannedDevices,
    
    // Feature flags
    featureFlags,
    
    // Cleanup
    cleanup
  };
}