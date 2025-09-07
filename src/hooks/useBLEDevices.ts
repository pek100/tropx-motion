/**
 * React Hook for BLE Device Management
 * 
 * This hook provides a clean interface to the BLE Device Manager
 * and ensures proper React integration with state synchronization.
 * 
 * Key Features:
 * - No race conditions through centralized state management
 * - Controlled streaming (only during recording mode)
 * - Proper error handling and recovery
 * - React-optimized state updates
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  DeviceState, 
  DeviceInfo, 
  AppError, 
  IMUData 
} from '../core/types';
import { simpleBLEDeviceManager, DeviceStateListener, DataListener, ErrorListener } from '../core/SimpleBLEDeviceManager';

export interface UseBLEDevicesReturn {
  // Device state
  devices: Map<string, DeviceInfo>;
  isScanning: boolean;
  isRecording: boolean;
  error: AppError | null;
  
  // Device operations
  scanForDevices: () => Promise<void>;
  connectDevice: (deviceId: string) => Promise<void>;
  disconnectDevice: (deviceId: string) => Promise<void>;
  
  // Recording operations (controls streaming)
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  
  // Utility functions
  getConnectedDevices: () => DeviceInfo[];
  getDeviceById: (deviceId: string) => DeviceInfo | undefined;
  clearError: () => void;
}

/**
 * Hook for managing BLE devices with the new centralized manager
 * 
 * This replaces useDeviceState and provides race-condition-free
 * device management with proper streaming control.
 */
export const useBLEDevices = (): UseBLEDevicesReturn => {
  // React state
  const [devices, setDevices] = useState<Map<string, DeviceInfo>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  
  // Refs for stable references
  const mountedRef = useRef(true);
  const initializationRef = useRef<Promise<void> | null>(null);

  // Initialize BLE Device Manager
  const initializeBLEManager = useCallback(async () => {
    if (initializationRef.current) {
      // Already initializing or initialized
      return await initializationRef.current;
    }

    initializationRef.current = (async () => {
      try {
        console.log('🔧 Initializing Simple BLE Device Manager from React hook...');
        await simpleBLEDeviceManager.initialize();
        
        if (mountedRef.current) {
          setDevices(simpleBLEDeviceManager.getDevices());
          setIsRecording(simpleBLEDeviceManager.isRecording());
          console.log('✅ Simple BLE Device Manager initialized successfully');
        }
      } catch (initError) {
        console.error('❌ Failed to initialize BLE Device Manager:', initError);
        if (mountedRef.current) {
          setError({
            code: 'BLUETOOTH_NOT_AVAILABLE',
            message: initError instanceof Error ? initError.message : 'Initialization failed',
            timestamp: Date.now()
          });
        }
        throw initError;
      }
    })();

    return await initializationRef.current;
  }, []);

  // Device operations
  const scanForDevices = useCallback(async () => {
    try {
      setIsScanning(true);
      setError(null);
      
      await initializeBLEManager();
      
      console.log('🔍 Starting device scan...');
      await simpleBLEDeviceManager.scanForDevices();
      
      // State will be updated via listeners
      console.log('✅ Device scan completed');
      
    } catch (scanError) {
      console.error('❌ Device scan failed:', scanError);
      setError({
        code: 'BLUETOOTH_NOT_AVAILABLE',
        message: scanError instanceof Error ? scanError.message : 'Scan failed',
        timestamp: Date.now()
      });
    } finally {
      setIsScanning(false);
    }
  }, [initializeBLEManager]);

  const connectDevice = useCallback(async (deviceId: string) => {
    try {
      setError(null);
      console.log(`🔗 [useBLEDevices] Connecting to device: ${deviceId}`);

      await simpleBLEDeviceManager.connectDevice(deviceId);
      
      console.log(`✅ [useBLEDevices] Device ${deviceId} connected successfully`);

      // 🔵 Trigger device discovery pattern after successful connection
      console.log('🔵 [useBLEDevices] Triggering device discovery pattern after connection...');
      try {
        // Try to trigger via WebSocket
        const ws = new WebSocket('ws://localhost:8080');
        ws.onopen = () => {
          ws.send(JSON.stringify({
            type: 'scan_request',
            data: {
              action: 'trigger_bluetooth_scan',
              message: 'Post-connection device discovery from useBLEDevices'
            },
            timestamp: Date.now()
          }));
          console.log('🔵 [useBLEDevices] Device discovery pattern message sent');
          ws.close();
        };
        ws.onerror = (error) => {
          console.warn('⚠️ [useBLEDevices] WebSocket failed for device discovery:', error);
        };
      } catch (error) {
        console.error('❌ [useBLEDevices] Failed to trigger device discovery:', error);
      }

    } catch (connectError) {
      console.error(`❌ Failed to connect to device ${deviceId}:`, connectError);
      setError({
        code: 'CONNECTION_FAILED',
        message: connectError instanceof Error ? connectError.message : 'Connection failed',
        timestamp: Date.now(),
        deviceId
      });
      throw connectError;
    }
  }, []);

  const disconnectDevice = useCallback(async (deviceId: string) => {
    try {
      console.log(`🔌 Disconnecting device: ${deviceId}`);
      
      await simpleBLEDeviceManager.disconnectDevice(deviceId);
      
      console.log(`✅ Device ${deviceId} disconnected successfully`);
      
    } catch (disconnectError) {
      console.error(`❌ Failed to disconnect device ${deviceId}:`, disconnectError);
      setError({
        code: 'DEVICE_DISCONNECTED',
        message: disconnectError instanceof Error ? disconnectError.message : 'Disconnect failed',
        timestamp: Date.now(),
        deviceId
      });
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      console.log('🎬 Starting recording mode...');
      
      const success = await simpleBLEDeviceManager.startRecording();
      
      if (success) {
        setIsRecording(true);
        console.log('✅ Recording started successfully');
      } else {
        throw new Error('Failed to start recording - no connected devices');
      }
      
    } catch (recordError) {
      console.error('❌ Failed to start recording:', recordError);
      setError({
        code: 'STREAM_FAILED',
        message: recordError instanceof Error ? recordError.message : 'Recording start failed',
        timestamp: Date.now()
      });
      throw recordError;
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      console.log('🛑 Stopping recording mode...');
      
      await simpleBLEDeviceManager.stopRecording();
      setIsRecording(false);
      
      console.log('✅ Recording stopped successfully');
      
    } catch (stopError) {
      console.error('❌ Failed to stop recording:', stopError);
      setError({
        code: 'STREAM_FAILED',
        message: stopError instanceof Error ? stopError.message : 'Recording stop failed',
        timestamp: Date.now()
      });
    }
  }, []);

  // Utility functions
  const getConnectedDevices = useCallback((): DeviceInfo[] => {
    return Array.from(devices.values()).filter(
      device => device.state === DeviceState.CONNECTED_IDLE || device.state === DeviceState.STREAMING
    );
  }, [devices]);

  const getDeviceById = useCallback((deviceId: string): DeviceInfo | undefined => {
    return devices.get(deviceId);
  }, [devices]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Set up listeners for BLE Device Manager events
  useEffect(() => {
    const unsubscribers: Array<() => void> = [];

    // State change listener
    const stateChangeListener: DeviceStateListener = (deviceId, newState, context) => {
      if (!mountedRef.current) return;
      
      console.log(`📱 Device ${deviceId} state changed to: ${newState}`);
      
      // Update devices state
      setDevices(prev => {
        const newDevices = new Map(prev);
        const deviceInfo = newDevices.get(deviceId);
        
        if (deviceInfo) {
          deviceInfo.state = newState;
          deviceInfo.lastUpdate = Date.now();
          newDevices.set(deviceId, { ...deviceInfo });
        }
        
        return newDevices;
      });
    };

    // Data listener
    const dataListener: DataListener = (deviceId, data) => {
      // Data is automatically forwarded to motion processing
      // This listener is mainly for debugging and metrics
      console.log(`📊 Data received from ${deviceId}:`, data);
    };

    // Error listener
    const errorListener: ErrorListener = (deviceId, error) => {
      if (!mountedRef.current) return;
      
      console.error(`❌ Device error for ${deviceId}:`, error);
      setError(error);
    };

    // Initialize manager and set up listeners
    initializeBLEManager()
      .then(() => {
        if (!mountedRef.current) return;

        // Subscribe to events
        unsubscribers.push(simpleBLEDeviceManager.onStateChange(stateChangeListener));
        unsubscribers.push(simpleBLEDeviceManager.onData(dataListener));
        unsubscribers.push(simpleBLEDeviceManager.onError(errorListener));

        // Initial state sync
        setDevices(simpleBLEDeviceManager.getDevices());
        setIsRecording(simpleBLEDeviceManager.isRecording());

        console.log('🔗 BLE Device Manager listeners set up successfully');
      })
      .catch(error => {
        console.error('❌ Failed to set up BLE Device Manager listeners:', error);
      });

    // Cleanup function
    return () => {
      console.log('🧹 Cleaning up BLE device listeners...');
      mountedRef.current = false;
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [initializeBLEManager]);

  // Sync recording state periodically
  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (mountedRef.current) {
        const currentRecordingState = simpleBLEDeviceManager.isRecording();
        setIsRecording(currentRecordingState);
      }
    }, 5000); // Sync every 5 seconds

    return () => clearInterval(syncInterval);
  }, []);

  return {
    devices,
    isScanning,
    isRecording,
    error,
    scanForDevices,
    connectDevice,
    disconnectDevice,
    startRecording,
    stopRecording,
    getConnectedDevices,
    getDeviceById,
    clearError
  };
};

/**
 * Hook for accessing BLE device data stream
 * Provides access to real-time IMU data from connected devices
 */
export const useBLEDeviceData = (deviceId?: string) => {
  const [latestData, setLatestData] = useState<IMUData | null>(null);
  const [dataHistory, setDataHistory] = useState<Array<{ timestamp: number; data: IMUData }>>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!deviceId) return;

    const dataListener: DataListener = (id, data) => {
      if (deviceId && id !== deviceId) return;
      if (!mountedRef.current) return;

      const timestampedData = { timestamp: Date.now(), data };
      
      setLatestData(data);
      setDataHistory(prev => {
        const updated = [...prev, timestampedData];
        // Keep only last 1000 data points to prevent memory issues
        return updated.slice(-1000);
      });
    };

    const unsubscribe = simpleBLEDeviceManager.onData(dataListener);

    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [deviceId]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearHistory = useCallback(() => {
    setDataHistory([]);
    setLatestData(null);
  }, []);

  return {
    latestData,
    dataHistory,
    clearHistory
  };
};