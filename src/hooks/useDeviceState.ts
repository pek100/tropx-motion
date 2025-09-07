/**
 * High-performance React hook for device state management
 * Integrates with state machine and BLE operations
 */

import { useRef, useCallback, useMemo, useEffect } from 'react';
import { 
  DeviceState, 
  DeviceEvent, 
  DeviceInfo, 
  AppError, 
  UseDeviceStateReturn,
  DeviceContext 
} from '../core/types';
import { deviceStateMachine } from '../core/DeviceStateMachine';
import { simpleBLEDeviceManager } from '../core/SimpleBLEDeviceManager';
import { streamDataManager } from '../core/StreamDataManager';
import { PERFORMANCE_CONSTANTS, ERROR_CODES } from '../core/constants';
import { useForceUpdate } from './useForceUpdate';

/**
 * Custom hook for managing BLE device connections with state machine
 */
export const useDeviceState = (): UseDeviceStateReturn => {
  const forceUpdate = useForceUpdate();
  const devicesRef = useRef<Map<string, DeviceInfo>>(new Map());
  const scanningRef = useRef<boolean>(false);
  const errorRef = useRef<AppError | null>(null);
  const connectionAttemptsRef = useRef<Map<string, number>>(new Map());

  // 🔵 Track connected devices to detect new connections
  const connectedDevicesRef = useRef<Set<string>>(new Set());
  const lastConnectionTimeRef = useRef<number>(0);

  // Initialize SimpleBLEDeviceManager on first use
  useEffect(() => {
    simpleBLEDeviceManager.initialize().catch(error => {
      console.error('Failed to initialize SimpleBLEDeviceManager:', error);
      errorRef.current = {
        code: ERROR_CODES.BLUETOOTH_NOT_AVAILABLE,
        message: 'Failed to initialize Bluetooth manager',
        timestamp: Date.now(),
      };
      forceUpdate();
    });

    // Set up device state listeners
    const unsubscribeStateChange = simpleBLEDeviceManager.onStateChange((deviceId, newState, context) => {
      console.log(`📱 State change received for device ${deviceId}: ${newState}`);
      
      let deviceInfo = devicesRef.current.get(deviceId);
      
      if (deviceInfo) {
        // Update existing device state
        deviceInfo.state = newState;
        deviceInfo.lastUpdate = Date.now();
        console.log(`📱 Updated existing device ${deviceInfo.name} state to ${newState}`);
        forceUpdate();
      } else {
        // New device discovered - get it from SimpleBLEDeviceManager
        const managerDevices = simpleBLEDeviceManager.getDevices();
        const discoveredDevice = managerDevices.get(deviceId);
        
        if (discoveredDevice) {
          // Create a copy for our local state management
          deviceInfo = {
            id: discoveredDevice.id,
            name: discoveredDevice.name,
            state: newState,
            batteryLevel: discoveredDevice.batteryLevel,
            lastUpdate: Date.now(),
            connectionAttempts: 0
          };
          
          devicesRef.current.set(deviceId, deviceInfo);
          console.log(`📱 New device discovered and added: ${deviceInfo.name} (${deviceId}) - State: ${newState}`);
          forceUpdate();
        } else {
          console.warn(`📱 State change for unknown device: ${deviceId}`);
        }
      }
    });

    return () => {
      unsubscribeStateChange();
    };
  }, [forceUpdate]);

  // Non-blocking device scan with immediate UI response
  const scanForDevices = useCallback(async (): Promise<void> => {
    if (scanningRef.current) {
      console.log('Scan already in progress');
      return;
    }

    try {
      scanningRef.current = true;
      errorRef.current = null;
      forceUpdate(); // Update UI immediately to show scanning state

      console.log('🔍 Starting non-blocking BLE device scan via SimpleBLEDeviceManager...');
      
      // This returns immediately while scanning continues in background
      const immediateDevices = await simpleBLEDeviceManager.scanForDevices();
      
      // Update our local devices map with any immediate results
      immediateDevices.forEach(device => {
        const deviceInfo = {
          id: device.id,
          name: device.name,
          state: device.state,
          batteryLevel: device.batteryLevel,
          lastUpdate: Date.now(),
          connectionAttempts: 0
        };
        devicesRef.current.set(device.id, deviceInfo);
      });

      console.log(`✅ Scan initiated, found ${immediateDevices.length} devices immediately`);
      forceUpdate(); // Update UI with immediate results

      // Wait for background scanning to complete (give it time to populate via WebSocket)
      setTimeout(async () => {
        try {
          const allManagerDevices = simpleBLEDeviceManager.getDevices();
          console.log(`🔄 Syncing all devices from manager: ${allManagerDevices.size} devices`);
          
          allManagerDevices.forEach((managerDevice, deviceId) => {
            if (!devicesRef.current.has(deviceId)) {
              const deviceInfo = {
                id: managerDevice.id,
                name: managerDevice.name,
                state: managerDevice.state,
                batteryLevel: managerDevice.batteryLevel,
                lastUpdate: Date.now(),
                connectionAttempts: 0
              };
              devicesRef.current.set(deviceId, deviceInfo);
              console.log(`🔄 Synced background discovered device: ${deviceInfo.name}`);
            }
          });
          
          forceUpdate(); // Final UI update with all devices
        } catch (error) {
          console.error('Error syncing devices:', error);
        }
      }, 3000); // Wait 3 seconds for background scanning

    } catch (error) {
      console.error('Device scan failed:', error);
      errorRef.current = {
        code: ERROR_CODES.BLUETOOTH_NOT_AVAILABLE,
        message: error instanceof Error ? error.message : 'Unknown scan error',
        timestamp: Date.now(),
      };
      forceUpdate();
    } finally {
      // Reset scanning flag after a short delay to allow background scanning
      setTimeout(() => {
        scanningRef.current = false;
        forceUpdate();
      }, 2000); // 2 seconds to show scanning state
    }
  }, [forceUpdate]);

  const connectDevice = useCallback(async (deviceId: string): Promise<void> => {
    const deviceInfo = devicesRef.current.get(deviceId);
    if (!deviceInfo) {
      throw new Error(`Device ${deviceId} not found`);
    }

    if (deviceInfo.state === DeviceState.CONNECTING || deviceInfo.state === DeviceState.STREAMING) {
      console.log(`Device ${deviceId} is already connecting/connected`);
      return;
    }

    try {
      console.log(`Connecting to device: ${deviceInfo.name}`);
      
      // Update connection attempts
      const attempts = connectionAttemptsRef.current.get(deviceId) || 0;
      connectionAttemptsRef.current.set(deviceId, attempts + 1);

      // Update device state to connecting
      deviceInfo.state = DeviceState.CONNECTING;
      deviceInfo.connectionAttempts = attempts + 1;
      deviceInfo.lastUpdate = Date.now();
      forceUpdate();

      // State machine transition
      const context: DeviceContext = {
        deviceId,
        metadata: { retryCount: attempts },
      };

      await deviceStateMachine.transition(
        DeviceState.DISCONNECTED_AVAILABLE,
        DeviceEvent.CONNECT_REQUEST,
        context
      );

      // Actual BLE connection via SimpleBLEDeviceManager
      const success = await simpleBLEDeviceManager.connectDevice(deviceId);
      
      if (success) {
        // Update to connected state
        deviceInfo.state = DeviceState.CONNECTED_IDLE;
        deviceInfo.lastUpdate = Date.now();
        
        await deviceStateMachine.transition(
          DeviceState.CONNECTING,
          DeviceEvent.CONNECTED,
          context
        );

        // Battery level will be updated automatically by SimpleBLEDeviceManager

        console.log(`Successfully connected to ${deviceInfo.name}`);
        forceUpdate();

      } else {
        throw new Error('BLE connection failed');
      }

    } catch (error) {
      console.error(`Connection failed for device ${deviceId}:`, error);
      
      const appError: AppError = {
        code: ERROR_CODES.CONNECTION_FAILED,
        message: error instanceof Error ? error.message : 'Unknown connection error',
        timestamp: Date.now(),
        deviceId,
      };

      deviceInfo.error = appError;
      deviceInfo.state = DeviceState.ERROR;
      errorRef.current = appError;
      
      await deviceStateMachine.transition(
        DeviceState.CONNECTING,
        DeviceEvent.ERROR_OCCURRED,
        { deviceId, error: appError }
      );

      forceUpdate();
      throw error;
    }
  }, [forceUpdate]);

  const disconnectDevice = useCallback(async (deviceId: string): Promise<void> => {
    const deviceInfo = devicesRef.current.get(deviceId);
    if (!deviceInfo) return;

    try {
      console.log(`Disconnecting device: ${deviceInfo.name}`);

      // Stop streaming if active
      if (deviceInfo.state === DeviceState.STREAMING) {
        await stopStreaming(deviceId);
      }

      // Disconnect BLE via SimpleBLEDeviceManager
      await simpleBLEDeviceManager.disconnectDevice(deviceId);

      // Update state
      deviceInfo.state = DeviceState.DISCONNECTED_AVAILABLE;
      deviceInfo.batteryLevel = null;
      deviceInfo.lastUpdate = Date.now();
      deviceInfo.error = undefined;

      await deviceStateMachine.transition(
        DeviceState.CONNECTED_IDLE,
        DeviceEvent.DISCONNECT,
        { deviceId }
      );

      console.log(`Disconnected from ${deviceInfo.name}`);
      forceUpdate();

    } catch (error) {
      console.error(`Disconnect failed for device ${deviceId}:`, error);
      
      const appError: AppError = {
        code: ERROR_CODES.DEVICE_DISCONNECTED,
        message: error instanceof Error ? error.message : 'Disconnect error',
        timestamp: Date.now(),
        deviceId,
      };

      deviceInfo.error = appError;
      deviceInfo.state = DeviceState.ERROR;
      errorRef.current = appError;
      forceUpdate();
    }
  }, [forceUpdate]);

  const startStreaming = useCallback(async (deviceId: string): Promise<void> => {
    const deviceInfo = devicesRef.current.get(deviceId);
    if (!deviceInfo) return;

    if (deviceInfo.state !== DeviceState.CONNECTED_IDLE) {
      console.warn(`Device ${deviceId} not ready for streaming (state: ${deviceInfo.state})`);
      return;
    }

    try {
      console.log(`Starting streaming for device: ${deviceInfo.name}`);

      // Update state to streaming
      deviceInfo.state = DeviceState.STREAMING;
      deviceInfo.lastUpdate = Date.now();
      forceUpdate();

      // State machine transition
      await deviceStateMachine.transition(
        DeviceState.CONNECTED_IDLE,
        DeviceEvent.STREAM_START,
        { deviceId }
      );

      // Start BLE streaming via SimpleBLEDeviceManager
      const success = await simpleBLEDeviceManager.startRecording();

      if (!success) {
        throw new Error('Failed to start BLE streaming');
      }

      // Start streaming session in data manager
      await streamDataManager.startStreamingSession(`session_${Date.now()}`, [deviceId]);

      console.log(`Streaming started for ${deviceInfo.name}`);

    } catch (error) {
      console.error(`Streaming failed for device ${deviceId}:`, error);
      
      const appError: AppError = {
        code: ERROR_CODES.STREAM_FAILED,
        message: error instanceof Error ? error.message : 'Streaming error',
        timestamp: Date.now(),
        deviceId,
      };

      deviceInfo.error = appError;
      deviceInfo.state = DeviceState.ERROR;
      errorRef.current = appError;
      
      await deviceStateMachine.transition(
        DeviceState.STREAMING,
        DeviceEvent.ERROR_OCCURRED,
        { deviceId, error: appError }
      );

      forceUpdate();
      throw error;
    }
  }, [forceUpdate]);

  const stopStreaming = useCallback(async (deviceId: string): Promise<void> => {
    const deviceInfo = devicesRef.current.get(deviceId);
    if (!deviceInfo) return;

    if (deviceInfo.state !== DeviceState.STREAMING) {
      console.log(`Device ${deviceId} is not streaming`);
      return;
    }

    try {
      console.log(`Stopping streaming for device: ${deviceInfo.name}`);

      // Stop BLE streaming via SimpleBLEDeviceManager
      await simpleBLEDeviceManager.stopRecording();

      // Update state
      deviceInfo.state = DeviceState.CONNECTED_IDLE;
      deviceInfo.lastUpdate = Date.now();

      await deviceStateMachine.transition(
        DeviceState.STREAMING,
        DeviceEvent.STREAM_STOP,
        { deviceId }
      );

      console.log(`Streaming stopped for ${deviceInfo.name}`);
      forceUpdate();

    } catch (error) {
      console.error(`Stop streaming failed for device ${deviceId}:`, error);
      
      const appError: AppError = {
        code: ERROR_CODES.STREAM_FAILED,
        message: error instanceof Error ? error.message : 'Stop streaming error',
        timestamp: Date.now(),
        deviceId,
      };

      deviceInfo.error = appError;
      errorRef.current = appError;
      forceUpdate();
    }
  }, [forceUpdate]);

  // Setup state machine listeners
  useEffect(() => {
    const unsubscribeMap = new Map<DeviceState, () => void>();

    // Listen to all state changes
    Object.values(DeviceState).forEach(state => {
      const unsubscribe = deviceStateMachine.onStateChange(state, (context) => {
        const deviceInfo = devicesRef.current.get(context.deviceId);
        if (deviceInfo) {
          deviceInfo.state = state;
          deviceInfo.lastUpdate = Date.now();
          forceUpdate();
        }
      });
      unsubscribeMap.set(state, unsubscribe);
    });

    return () => {
      unsubscribeMap.forEach(unsubscribe => unsubscribe());
    };
  }, [forceUpdate]);

  // Battery level monitoring is now handled by SimpleBLEDeviceManager automatically

  // Memoized return object to prevent unnecessary re-renders
  const returnValue = useMemo((): UseDeviceStateReturn => ({
    devices: devicesRef.current,
    scanForDevices,
    connectDevice,
    disconnectDevice,
    startStreaming,
    stopStreaming,
    isScanning: scanningRef.current,
    error: errorRef.current,
  }), [
    scanForDevices,
    connectDevice,
    disconnectDevice,
    startStreaming,
    stopStreaming,
    // These refs are included for completeness but won't trigger re-renders
    scanningRef.current,
    errorRef.current,
  ]);

  // 🔵 Monitor for newly connected devices and trigger device discovery pattern
  useEffect(() => {
    const checkForNewConnections = () => {
      const currentTime = Date.now();
      const currentlyConnectedDevices = new Set<string>();

      // Find all currently SUCCESSFULLY connected devices (not just attempting)
      devicesRef.current.forEach((device, deviceId) => {
        // Only count as connected if:
        // 1. State is CONNECTED_IDLE or STREAMING (success states)
        // 2. No recent error (within last 5 seconds)
        // 3. Connection was updated recently (within last 30 seconds)
        const isInSuccessState = device.state === DeviceState.CONNECTED_IDLE || device.state === DeviceState.STREAMING;
        const hasNoRecentError = !device.error || (currentTime - device.error.timestamp) > 5000;
        const wasRecentlyUpdated = (currentTime - device.lastUpdate) < 30000;

        if (isInSuccessState && hasNoRecentError && wasRecentlyUpdated) {
          currentlyConnectedDevices.add(deviceId);
          console.log(`📱 Device ${device.name} confirmed as successfully connected (state: ${device.state})`);
        }
      });

      // Check for newly connected devices (devices that weren't in the previous connected set)
      const newlyConnectedDevices = new Set<string>();
      currentlyConnectedDevices.forEach(deviceId => {
        if (!connectedDevicesRef.current.has(deviceId)) {
          const device = devicesRef.current.get(deviceId);
          if (device) {
            console.log(`🔵 NEW successful connection detected: ${device.name} (${deviceId})`);
            newlyConnectedDevices.add(deviceId);
          }
        }
      });

      // If we have newly successfully connected devices and enough cooldown time has passed
      if (newlyConnectedDevices.size > 0 && (currentTime - lastConnectionTimeRef.current) > 3000) {
        console.log(`🔵 Detected ${newlyConnectedDevices.size} newly SUCCESSFULLY connected devices:`, Array.from(newlyConnectedDevices));

        newlyConnectedDevices.forEach(deviceId => {
          const device = devicesRef.current.get(deviceId);
          if
