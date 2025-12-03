/**
 * @deprecated This hook is deprecated. Use useDevices from '@/hooks/useDevices' instead.
 * useDevices is the unified single source of truth for device state management.
 *
 * Migration guide:
 * - Replace: import { useWebSocket } from '@/hooks/use-websocket'
 * - With:    import { useDevices } from '@/hooks/useDevices'
 *
 * Key differences:
 * - useDevices uses Map<number, BLEDevice> internally for O(1) lookups
 * - uiDevices provides the mapped format for App.tsx (same as old devices array)
 * - Server owns truth -> broadcasts STATE_UPDATE -> hook reflects -> UI renders
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { TropxWSClient } from '../lib/tropx-ws-client';
import type { DeviceInfo, Result } from '../lib/tropx-ws-client';
import { EVENT_TYPES, MESSAGE_TYPES } from '../lib/tropx-ws-client';
import type { ClientMetadata } from '../lib/tropx-ws-client/types/messages';

// Debug trace logging toggle
const DEBUG_TRACE = true;
const trace = (component: string, msg: string, data?: any) => {
  if (!DEBUG_TRACE) return;
  const timestamp = Date.now();
  if (data !== undefined) {
    console.log(`[TRACE:${component}] ${msg}`, data);
  } else {
    console.log(`[TRACE:${component}] ${msg}`);
  }
};

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
  connectedClients: ClientMetadata[];
  leftKneeData: KneeData;
  rightKneeData: KneeData;
  isScanning: boolean;
  isSyncing: boolean;
  syncProgress: Record<string, { deviceName: string; offsetMs: number; deviceTimestampMs?: number }>;
  vibratingDeviceIds: string[];
}

/** @deprecated Use useDevices from '@/hooks/useDevices' instead */
export function useWebSocket() {
  const clientRef = useRef<TropxWSClient | null>(null);
  const hasConnectedOnceRef = useRef(false);
  const lastMotionDataTimeRef = useRef<number>(Date.now());
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    devices: [],
    connectedClients: [],
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
    syncProgress: {},
    vibratingDeviceIds: [],
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
        client.on(EVENT_TYPES.CONNECTED, async () => {
          const isReconnection = hasConnectedOnceRef.current;
          setState(prev => ({ ...prev, isConnected: true }));
          console.log(isReconnection ? '✅ WebSocket reconnected' : '✅ WebSocket connected');

          // CRITICAL: Re-query all backend state on reconnection
          if (isReconnection) {
            console.log('🔄 Reconnection detected - re-querying all backend state...');
            try {
              const stateResult = await client.getDevicesState();
              if (stateResult.success && stateResult.data.length > 0) {
                console.log(`✅ Re-synced ${stateResult.data.length} devices from backend`);
                setState(prev => ({ ...prev, devices: stateResult.data }));
              } else {
                console.log('📭 No devices to restore from backend');
              }
            } catch (error) {
              console.error('❌ Failed to re-sync state on reconnection:', error);
            }
          }

          hasConnectedOnceRef.current = true;
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

        // Motion data handler - single state update for both knees
        client.on(EVENT_TYPES.MOTION_DATA, (message) => {
          const now = Date.now();

          // Update heartbeat timestamp for health monitoring
          lastMotionDataTimeRef.current = now;

          trace('WS', `Motion data received: ts=${now}`);

          const raw = (message as any).data;
          let dataArray: Float32Array;
          if (raw instanceof Float32Array) {
            dataArray = raw;
          } else if (Array.isArray(raw)) {
            dataArray = new Float32Array(raw);
          } else if (raw && typeof raw === 'object' && 'left' in raw && 'right' in raw) {
            const leftObj = (raw as any).left || {};
            const rightObj = (raw as any).right || {};
            dataArray = new Float32Array([
              leftObj.current ?? 0,
              rightObj.current ?? 0,
            ]);
          } else {
            dataArray = new Float32Array([0, 0]);
          }
          const timestamp = (message as any).timestamp || Date.now();

          const leftCurrent = dataArray[0] || 0;
          const rightCurrent = dataArray[1] || 0;

          trace('WS', `Parsed data: left=${leftCurrent.toFixed(1)}, right=${rightCurrent.toFixed(1)}, msgTs=${timestamp}`);
          trace('WS', `Calling setState: ts=${now}`);

          const setStateStartTime = Date.now();
          setState(prev => ({
            ...prev,
            leftKneeData: {
              current: leftCurrent,
              sensorTimestamp: timestamp,
              velocity: 0,
              acceleration: 0,
              quality: 100,
            },
            rightKneeData: {
              current: rightCurrent,
              sensorTimestamp: timestamp,
              velocity: 0,
              acceleration: 0,
              quality: 100,
            }
          }));

          trace('WS', `setState completed: elapsed=${Date.now() - setStateStartTime}ms`);
        });

        // Device status handler - handles both single device (0x31) and STATE_UPDATE (0x40) formats
        client.on(EVENT_TYPES.DEVICE_STATUS, (status: any) => {
          console.log(`📱 [use-websocket] Device status received:`, JSON.stringify(status, null, 2));

          // Check if this is a STATE_UPDATE (0x40) with devices array
          if (status.devices && Array.isArray(status.devices)) {
            console.log(`📱 [use-websocket] STATE_UPDATE format detected: ${status.devices.length} devices`);

            setState(prev => {
              // Build new devices array from STATE_UPDATE
              const updatedDevices: DeviceInfo[] = status.devices.map((d: any) => ({
                id: d.bleAddress || d.id,
                name: d.bleName || d.displayName || d.name,
                state: d.state,
                batteryLevel: d.batteryLevel ?? null,
                rssi: d.rssi ?? 0,
                address: d.bleAddress || '',
                lastSeen: Date.now(),
                isReconnecting: d.reconnectAttempts > 0,
                reconnectAttempts: d.reconnectAttempts ?? 0,
                // Additional fields from STATE_UPDATE
                deviceId: d.deviceId,
                displayName: d.displayName,
                shortName: d.shortName,
                joint: d.joint,
                placement: d.placement,
                syncState: d.syncState,
                clockOffset: d.clockOffset,
              }));

              return {
                ...prev,
                devices: updatedDevices,
              };
            });
            return;
          }

          // Handle single device status (legacy 0x31 format)
          setState(prev => {
            const existingDevice = prev.devices.find(d => d.id === status.deviceId);

            if (existingDevice) {
              return {
                ...prev,
                devices: prev.devices.map(d =>
                  d.id === status.deviceId
                    ? {
                        ...d,
                        name: status.deviceName,
                        state: status.state,
                        batteryLevel: status.batteryLevel ?? d.batteryLevel,
                        lastSeen: Date.now(),
                        rssi: (status as any).rssi ?? d.rssi,
                        isReconnecting: (status as any).isReconnecting ?? false,
                        reconnectAttempts: (status as any).reconnectAttempts ?? 0,
                      }
                    : d
                ),
              };
            } else {
              const newDevice: DeviceInfo = {
                id: status.deviceId,
                name: status.deviceName,
                state: status.state,
                batteryLevel: status.batteryLevel || null,
                rssi: (status as any).rssi ?? 0,
                address: (status as any).deviceAddress || '',
                lastSeen: Date.now(),
                isReconnecting: (status as any).isReconnecting ?? false,
                reconnectAttempts: (status as any).reconnectAttempts ?? 0,
              } as DeviceInfo;
              return {
                ...prev,
                devices: [...prev.devices, newDevice]
              };
            }
          });
        });

        // Battery update handler
        client.on(EVENT_TYPES.BATTERY_UPDATE, (battery) => {
          console.log(`🔋 [use-websocket] Battery update received:`, JSON.stringify(battery, null, 2));
          setState(prev => ({
            ...prev,
            devices: prev.devices.map(d =>
              d.id === battery.deviceId
                ? { ...d, batteryLevel: battery.batteryLevel }
                : d
            ),
          }));
        });

        // Sync event handlers
        client.on(EVENT_TYPES.SYNC_STARTED, (sync) => {
          console.log(`🔄 [use-websocket] Sync started:`, JSON.stringify(sync, null, 2));
          // Keep previous syncProgress values instead of clearing
          setState(prev => ({ ...prev, isSyncing: true }));
        });

        client.on(EVENT_TYPES.SYNC_PROGRESS, (progress) => {
          console.log(`⏱️ [use-websocket] Sync progress:`, JSON.stringify(progress, null, 2));
          setState(prev => ({
            ...prev,
            syncProgress: {
              ...prev.syncProgress,
              [progress.deviceId]: {
                deviceName: progress.deviceName,
                offsetMs: progress.clockOffsetMs,
                deviceTimestampMs: progress.deviceTimestampMs
              }
            }
          }));
        });

        client.on(EVENT_TYPES.SYNC_COMPLETE, (complete) => {
          console.log(`✅ [use-websocket] Sync complete:`, JSON.stringify(complete, null, 2));
          setState(prev => ({ ...prev, isSyncing: false }));
        });

        // Device vibrating handler (locate mode)
        client.on(EVENT_TYPES.DEVICE_VIBRATING, (vibrating) => {
          console.log(`📳 [use-websocket] Device vibrating:`, vibrating.vibratingDeviceIds);
          setState(prev => ({ ...prev, vibratingDeviceIds: vibrating.vibratingDeviceIds }));
        });

        // Client list update handler
        client.on(EVENT_TYPES.CLIENT_LIST_UPDATE, (update) => {
          console.log('👥 Client list update:', update.clients);
          setState(prev => ({ ...prev, connectedClients: update.clients }));
        });

        // Get WebSocket port from Electron main process
        const port = await window.electron.getWSPort();
        console.log(`🔌 Connecting to WebSocket on port ${port}`);

        // Connect to WebSocket server
        const result = await client.connect(`ws://localhost:${port}`);
        if (!result.success) {
          console.error('Failed to connect:', result.error);
          return;
        }

        // Query current device state from backend (for persistence)
        console.log('🔄 Querying backend for current device state...');
        const stateResult = await client.getDevicesState();
        if (stateResult.success && stateResult.data.length > 0) {
          console.log(`✅ Restored ${stateResult.data.length} devices from backend state`);
          setState(prev => ({ ...prev, devices: stateResult.data }));
        }
      } catch (error) {
        console.error('Failed to initialize WebSocket client:', error);
      }
    };

    initClient();

    // Cleanup on unmount
    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
        healthCheckIntervalRef.current = null;
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  // Connection health monitoring - separate effect with access to current state
  useEffect(() => {
    if (!state.isConnected) return;

    trace('HEALTH', 'Health monitor started');

    const healthCheckInterval = setInterval(() => {
      if (!clientRef.current?.isConnected()) {
        trace('HEALTH', 'Health check skipped - client not connected');
        return;
      }

      // Check if any devices are streaming
      const streamingDevices = state.devices.filter(d => d.state === 'streaming');
      if (streamingDevices.length === 0) {
        trace('HEALTH', 'Health check skipped - no streaming devices');
        return;
      }

      // Check motion data heartbeat
      const timeSinceLastData = Date.now() - lastMotionDataTimeRef.current;
      const HEARTBEAT_TIMEOUT = 5000; // 5 seconds

      trace('HEALTH', `Health check: timeSinceLastData=${timeSinceLastData}ms, streamingDevices=${streamingDevices.length}, threshold=${HEARTBEAT_TIMEOUT}ms`);

      if (timeSinceLastData > HEARTBEAT_TIMEOUT) {
        console.error(`⚠️ Motion data heartbeat timeout: ${timeSinceLastData}ms since last data`);
        console.log(`📊 Streaming devices: ${streamingDevices.map(d => d.name).join(', ')}`);
        console.log('🔄 Forcing reconnection to recover data stream...');
        trace('HEALTH', 'FORCING RECONNECTION - heartbeat timeout exceeded');

        // Force reconnection to recover
        if (clientRef.current) {
          clientRef.current.disconnect();
          // The transport will automatically attempt to reconnect
        }
      }
    }, 2000); // Check every 2 seconds

    healthCheckIntervalRef.current = healthCheckInterval;

    return () => {
      trace('HEALTH', 'Health monitor stopped');
      clearInterval(healthCheckInterval);
    };
  }, [state.isConnected, state.devices]);

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

  // Burst scan: perform repeated scans over a duration aggregating unique devices
  const burstScanDevices = useCallback(async (options?: { durationMs?: number; intervalMs?: number; signal?: AbortSignal; scansPerBurst?: number; withinBurstSpacingMs?: number; burstPauseMs?: number }): Promise<Result<DeviceInfo[]>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    if (state.isScanning) {
      return { success: false, error: 'Scan already in progress' };
    }
    const durationMs = options?.durationMs ?? 3000;
    // intervalMs kept for backward compatibility (acts as rest between bursts if burstPauseMs not supplied)
    const legacyInterval = options?.intervalMs ?? 400;
    const scansPerBurst = options?.scansPerBurst ?? 4; // number of rapid scans inside a burst
    const withinBurstSpacingMs = options?.withinBurstSpacingMs ?? 50; // delay between scans in same burst
    const burstPauseMs = options?.burstPauseMs ?? legacyInterval; // rest between bursts
    const signal = options?.signal;

    const start = Date.now();
    setState(prev => ({ ...prev, isScanning: true }));
    const aggregate = new Map<string, DeviceInfo>();
    state.devices.forEach(d => aggregate.set(d.id, d));

    const doOneScan = async () => {
      try {
        const result = await clientRef.current!.scanDevices();
        if (result.success) {
          result.data.devices.forEach(dev => {
            const existing = aggregate.get(dev.id);
            if (!existing) {
              aggregate.set(dev.id, dev);
            } else {
              aggregate.set(dev.id, {
                ...existing,
                ...dev,
                batteryLevel: dev.batteryLevel ?? existing.batteryLevel,
                state: dev.state ?? existing.state,
              });
            }
          });
          setState(prev => ({ ...prev, devices: Array.from(aggregate.values()) }));
        }
      } catch (e) {
        // continue regardless
      }
    };

    while (Date.now() - start < durationMs) {
      if (signal?.aborted) break;

      // Micro-burst: several back-to-back scans
      for (let i = 0; i < scansPerBurst && (Date.now() - start) < durationMs; i++) {
        if (signal?.aborted) break;
        await doOneScan();
        if (signal?.aborted) break;
        if (i < scansPerBurst - 1) {
          const remaining = durationMs - (Date.now() - start);
          if (remaining <= 0) break;
          await new Promise(res => setTimeout(res, Math.min(withinBurstSpacingMs, remaining)));
        }
      }

      if (signal?.aborted) break;
      const elapsed = Date.now() - start;
      const remainingAfterBurst = durationMs - elapsed;
      if (remainingAfterBurst <= 0) break;

      // Pause between bursts
      await new Promise(res => setTimeout(res, Math.min(burstPauseMs, remainingAfterBurst)));
    }

    setState(prev => ({ ...prev, isScanning: false, devices: Array.from(aggregate.values()) }));
    return { success: true, data: Array.from(aggregate.values()) };
  }, [state.devices, state.isScanning]);

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

  // Remove device (cancel reconnect + remove from registry)
  const removeDevice = useCallback(async (id: string): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    const result = await clientRef.current.removeDevice(id);
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Remove device failed' };
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

  // Start locate mode
  const startLocateMode = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    const result = await clientRef.current.startLocateMode();
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Locate mode failed to start' };
  }, []);

  // Stop locate mode
  const stopLocateMode = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    // Clear vibrating devices when stopping locate mode
    setState(prev => ({ ...prev, vibratingDeviceIds: [] }));
    const result = await clientRef.current.stopLocateMode();
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Locate mode failed to stop' };
  }, []);

  // Start burst scan
  const startBurstScan = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    const result = await clientRef.current.startBurstScan();
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Burst scan failed to start' };
  }, []);

  // Stop burst scan
  const stopBurstScan = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    const result = await clientRef.current.stopBurstScan();
    return result.success
      ? { success: true, data: undefined }
      : { success: false, error: result.error || 'Burst scan failed to stop' };
  }, []);

  // Start recording
  const startRecording = useCallback(async (sessionId: string, exerciseId: string, setNumber: number): Promise<Result<string>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' } as any;
    }
    const result = await clientRef.current.startRecording(sessionId, exerciseId, setNumber);
    if (!result.success) {
      return { success: false, error: (result as any).error || 'Failed to start recording' } as any;
    }
    if (!result.data.recordingId) {
      return { success: false, error: 'Recording ID missing' } as any;
    }
    return { success: true, data: result.data.recordingId } as any;
  }, []);

  // Stop recording
  const stopRecording = useCallback(async (): Promise<Result<string>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' } as any;
    }
    const result = await clientRef.current.stopRecording();
    if (!result.success) {
      return { success: false, error: (result as any).error || 'Failed to stop recording' } as any;
    }
    if (!result.data.recordingId) {
      return { success: false, error: 'Recording ID missing' } as any;
    }
    return { success: true, data: result.data.recordingId } as any;
  }, []);

  // Ping server
  const ping = useCallback(async (): Promise<Result<number>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }
    return await clientRef.current.ping();
  }, []);

  // Trigger client action
  const triggerClientAction = useCallback(async (clientId: string, actionId: string): Promise<Result<void>> => {
    if (!clientRef.current) {
      return { success: false, error: 'WebSocket not connected' };
    }

    const message = {
      type: MESSAGE_TYPES.CLIENT_ACTION_TRIGGER,
      timestamp: Date.now(),
      clientId,
      actionId,
    };

    await clientRef.current.sendMessage(message);
    return { success: true, data: undefined };
  }, []);

  return {
    // State
    isConnected: state.isConnected,
    devices: state.devices,
    connectedClients: state.connectedClients,
    leftKneeData: state.leftKneeData,
    rightKneeData: state.rightKneeData,
    isScanning: state.isScanning,
    isSyncing: state.isSyncing,
    syncProgress: state.syncProgress,
    vibratingDeviceIds: state.vibratingDeviceIds,

    // Operations
    scanDevices,
    burstScanDevices,
    connectDevice,
    disconnectDevice,
    removeDevice,
    connectAllDevices,
    syncAllDevices,
    startLocateMode,
    stopLocateMode,
    startBurstScan,
    stopBurstScan,
    startRecording,
    stopRecording,
    ping,
    triggerClientAction,

    // Client reference (for advanced usage)
    client: clientRef.current,
  };
}

