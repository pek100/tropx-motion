import { useState, useEffect, useCallback, useRef } from 'react';
import { TropxWSClient } from '../lib/tropx-ws-client';
import type { DeviceInfo, Result } from '../lib/tropx-ws-client';
import { EVENT_TYPES } from '../lib/tropx-ws-client';

export interface KneeData {
  current: number;
  sensorTimestamp: number;
  velocity: number;
  acceleration: number;
  quality: number;
}

export interface WebSocketState {
  isConnected: boolean;
  devices: DeviceInfo[];
  leftKneeData: KneeData;
  rightKneeData: KneeData;
  isScanning: boolean;
  isSyncing: boolean;
}

export function useWebSocket() {
  const clientRef = useRef<TropxWSClient | null>(null);
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    devices: [],
    leftKneeData: {
      current: 0,
      sensorTimestamp: Date.now(),
      velocity: 0,
      acceleration: 0,
      quality: 100,
    },
    rightKneeData: {
      current: 0,
      sensorTimestamp: Date.now(),
      velocity: 0,
      acceleration: 0,
      quality: 100,
    },
    isScanning: false,
    isSyncing: false,
  });

  // Initialize WebSocket client on mount
  useEffect(() => {
    const initClient = async () => {
      try {
        // Create client
        const client = new TropxWSClient({
          reconnectDelay: 2000,
          maxReconnectAttempts: 5,
        });

        clientRef.current = client;

        // Setup event listeners
        client.on(EVENT_TYPES.CONNECTED, () => {
          setState(prev => ({ ...prev, isConnected: true }));
          console.log('✅ WebSocket connected');
        });

        client.on(EVENT_TYPES.DISCONNECTED, ({ code, reason }) => {
          setState(prev => ({ ...prev, isConnected: false }));
          console.log('❌ WebSocket disconnected:', code, reason);
        });

        client.on(EVENT_TYPES.RECONNECTING, ({ attempt, delay }) => {
          console.log(`🔄 Reconnecting (attempt ${attempt}, delay ${delay}ms)`);
        });

        client.on(EVENT_TYPES.ERROR, (error) => {
          console.error('WebSocket error:', error);
        });

        // Motion data handler
        client.on(EVENT_TYPES.MOTION_DATA, (message) => {
          const { data } = message;
          const timestamp = message.timestamp;

          // Update left knee data
          if (data.left) {
            setState(prev => ({
              ...prev,
              leftKneeData: {
                current: data.left.current,
                sensorTimestamp: data.timestamp || timestamp,
                velocity: 0, // TODO: Calculate from previous values
                acceleration: 0, // TODO: Calculate from velocity
                quality: 100, // TODO: Get from device
              },
            }));
          }

          // Update right knee data
          if (data.right) {
            setState(prev => ({
              ...prev,
              rightKneeData: {
                current: data.right.current,
                sensorTimestamp: data.timestamp || timestamp,
                velocity: 0,
                acceleration: 0,
                quality: 100,
              },
            }));
          }
        });

        // Device status handler
        client.on(EVENT_TYPES.DEVICE_STATUS, (status) => {
          console.log(`📱 [use-websocket] Device status received:`, status);
          setState(prev => ({
            ...prev,
            devices: prev.devices.map(d =>
              d.id === status.deviceId
                ? { ...d, state: status.state, batteryLevel: status.batteryLevel || d.batteryLevel }
                : d
            ),
          }));
        });

        // Battery update handler
        client.on(EVENT_TYPES.BATTERY_UPDATE, (battery) => {
          console.log(`🔋 [use-websocket] Battery update received:`, battery);
          setState(prev => ({
            ...prev,
            devices: prev.devices.map(d =>
              d.id === battery.deviceId
                ? { ...d, batteryLevel: battery.batteryLevel }
                : d
            ),
          }));
        });

        // Get WebSocket port from Electron main process
        const port = await window.electron.getWSPort();
        console.log(`🔌 Connecting to WebSocket on port ${port}`);

        // Connect to WebSocket server
        const result = await client.connect(`ws://localhost:${port}`);
        if (!result.success) {
          console.error('Failed to connect:', result.error);
        }
      } catch (error) {
        console.error('Failed to initialize WebSocket client:', error);
      }
    };

    initClient();

    // Cleanup on unmount
    return () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  // Scan for devices
  const scanDevices = useCallback(async (): Promise<Result<DeviceInfo[]>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    setState(prev => ({ ...prev, isScanning: true }));
    const result = await clientRef.current.scanDevices();
    setState(prev => ({ ...prev, isScanning: false }));

    if (result.success) {
      setState(prev => ({ ...prev, devices: result.data.devices }));
      return { success: true, data: result.data.devices };
    }

    return result;
  }, []);

  // Connect to device
  const connectDevice = useCallback(async (id: string, name: string): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    const result = await clientRef.current.connectDevice(id, name);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Connection failed' };
  }, []);

  // Disconnect device
  const disconnectDevice = useCallback(async (id: string): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    const result = await clientRef.current.disconnectDevice(id);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Disconnection failed' };
  }, []);

  // Connect all devices
  const connectAllDevices = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    const deviceList = state.devices.map(d => ({ id: d.id, name: d.name }));
    const result = await clientRef.current.connectDevices(deviceList);

    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Failed to connect all devices' };
  }, [state.devices]);

  // Sync all devices
  const syncAllDevices = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    setState(prev => ({ ...prev, isSyncing: true }));
    const result = await clientRef.current.syncAllDevices();
    setState(prev => ({ ...prev, isSyncing: false }));

    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Sync failed' };
  }, []);

  // Start recording
  const startRecording = useCallback(async (sessionId: string, exerciseId: string, setNumber: number): Promise<Result<string>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    const result = await clientRef.current.startRecording(sessionId, exerciseId, setNumber);
    return result.success && result.data.recordingId
      ? { success: true, data: result.data.recordingId }
      : { success: false, error: result.error || 'Failed to start recording' };
  }, []);

  // Stop recording
  const stopRecording = useCallback(async (): Promise<Result<string>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    const result = await clientRef.current.stopRecording();
    return result.success && result.data.recordingId
      ? { success: true, data: result.data.recordingId }
      : { success: false, error: result.error || 'Failed to stop recording' };
  }, []);

  // Ping server
  const ping = useCallback(async (): Promise<Result<number>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    return await clientRef.current.ping();
  }, []);

  return {
    // State
    isConnected: state.isConnected,
    devices: state.devices,
    leftKneeData: state.leftKneeData,
    rightKneeData: state.rightKneeData,
    isScanning: state.isScanning,
    isSyncing: state.isSyncing,

    // Operations
    scanDevices,
    connectDevice,
    disconnectDevice,
    connectAllDevices,
    syncAllDevices,
    startRecording,
    stopRecording,
    ping,

    // Client reference (for advanced usage)
    client: clientRef.current,
  };
}
