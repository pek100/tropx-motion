/**
 * useDevices - Unified Device State Management Hook
 *
 * Single source of truth for all BLE device state.
 * Server owns truth -> broadcasts STATE_UPDATE -> hook reflects -> UI renders
 *
 * Combines: useBLEState + use-websocket functionality
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { TropxWSClient } from '../lib/tropx-ws-client';
import { EVENT_TYPES, MESSAGE_TYPES } from '../lib/tropx-ws-client';
import type { ClientMetadata } from '../lib/tropx-ws-client/types/messages';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export enum DeviceState {
  DISCONNECTED = 'disconnected',
  DISCOVERED = 'discovered',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  SYNCING = 'syncing',
  SYNCED = 'synced',
  STREAMING = 'streaming',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

export enum GlobalState {
  IDLE = 'idle',
  SCANNING = 'scanning',
  SYNCING = 'syncing',
  STREAMING = 'streaming',
}

export enum SyncState {
  NOT_SYNCED = 'not_synced',
  SYNCING = 'syncing',
  SYNCED = 'synced',
  FAILED = 'failed',
}

export interface BLEDevice {
  deviceId: number;
  bleAddress: string;
  bleName: string;
  displayName: string;
  shortName: string;
  joint: string;
  placement: 'shin' | 'thigh';
  state: DeviceState;
  batteryLevel: number | null;
  rssi: number | null;
  syncState: SyncState;
  clockOffset: number;
  reconnectAttempts: number;
  nextReconnectAt: number | null;
  lastError: { type: string; message: string; timestamp: number } | null;
}

export interface KneeData {
  current: number;
  sensorTimestamp: number;
  velocity: number;
  acceleration: number;
  quality: number;
}

export interface SyncProgress {
  deviceName: string;
  offsetMs: number;
  deviceTimestampMs?: number;
}

/**
 * Device IDs from firmware encoding
 * First nibble: side (1=left, 2=right)
 * Second nibble: placement (1=shin, 2=thigh)
 */
export enum DeviceId {
  LEFT_SHIN = 0x11,   // 17
  LEFT_THIGH = 0x12,  // 18
  RIGHT_SHIN = 0x21,  // 33
  RIGHT_THIGH = 0x22, // 34
}

// UI Device type (what App.tsx expects)
export interface UIDevice {
  id: string;             // BLE address
  deviceId: number;       // Device ID (0x11, 0x12, 0x21, 0x22)
  name: string;           // Display name for UI
  bleName: string;        // Original BLE name
  joint: string;          // "left_knee" | "right_knee" | etc.
  placement: string;      // "shin" | "thigh"
  signalStrength: 1 | 2 | 3 | 4;
  batteryPercentage: number | null;
  connectionStatus: 'connected' | 'disconnected' | 'disabled' | 'connecting' | 'synchronizing' | 'reconnecting';
  isReconnecting: boolean;
  reconnectAttempts: number;
}

export interface DeviceCounts {
  discovered: number;
  connecting: number;
  connected: number;
  syncing: number;
  synced: number;
  streaming: number;
  reconnecting: number;
  error: number;
  total: number;
}

interface Result<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers
// ─────────────────────────────────────────────────────────────────────────────

function rssiToSignal(rssi: number | null): 1 | 2 | 3 | 4 {
  if (rssi === null) return 1;
  if (rssi >= -50) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

function mapStateToConnectionStatus(state: DeviceState): UIDevice['connectionStatus'] {
  switch (state) {
    case DeviceState.CONNECTED:
    case DeviceState.SYNCED:
    case DeviceState.STREAMING:
      return 'connected';
    case DeviceState.CONNECTING:
      return 'connecting';
    case DeviceState.SYNCING:
      return 'synchronizing';
    case DeviceState.RECONNECTING:
      return 'reconnecting';
    case DeviceState.ERROR:
      return 'disabled';
    default:
      return 'disconnected';
  }
}

function convertRawToDevice(raw: any): BLEDevice {
  return {
    deviceId: raw.deviceId ?? 0,
    bleAddress: raw.bleAddress ?? raw.id ?? '',
    bleName: raw.bleName ?? raw.name ?? '',
    displayName: raw.displayName ?? raw.bleName ?? raw.name ?? '',
    shortName: raw.shortName ?? '',
    joint: raw.joint ?? 'Unknown',
    placement: raw.placement ?? 'shin',
    state: raw.state ?? DeviceState.DISCONNECTED,
    batteryLevel: raw.batteryLevel ?? null,
    rssi: raw.rssi ?? null,
    syncState: raw.syncState ?? SyncState.NOT_SYNCED,
    clockOffset: raw.clockOffset ?? 0,
    reconnectAttempts: raw.reconnectAttempts ?? 0,
    nextReconnectAt: raw.nextReconnectAt ?? null,
    lastError: raw.lastError ?? null,
  };
}

export function mapToUIDevice(device: BLEDevice): UIDevice {
  // Enhanced reconnection detection:
  // - reconnectAttempts > 0 means this is a reconnection flow (not initial connect)
  // - Show reconnection UI for both RECONNECTING (searching) and CONNECTING (found, reconnecting)
  const isInReconnectionFlow = device.reconnectAttempts > 0 &&
    (device.state === DeviceState.RECONNECTING || device.state === DeviceState.CONNECTING);

  return {
    id: device.bleAddress,
    deviceId: device.deviceId,
    name: device.displayName || device.bleName,
    bleName: device.bleName,
    joint: device.joint,
    placement: device.placement,
    signalStrength: rssiToSignal(device.rssi),
    batteryPercentage: device.batteryLevel,
    connectionStatus: mapStateToConnectionStatus(device.state),
    isReconnecting: isInReconnectionFlow,
    reconnectAttempts: device.reconnectAttempts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useDevices() {
  // Refs
  const clientRef = useRef<TropxWSClient | null>(null);
  const hasConnectedOnceRef = useRef(false);
  const lastMotionDataTimeRef = useRef<number>(Date.now());
  const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastHealthReconnectRef = useRef<number>(0); // Fix #6: Cooldown for health reconnects

  // ─── Core State ───────────────────────────────────────────────────────
  const [devices, setDevices] = useState<Map<number, BLEDevice>>(new Map());
  const [globalState, setGlobalState] = useState<GlobalState>(GlobalState.IDLE);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  // ─── Motion Data ──────────────────────────────────────────────────────
  const [leftKneeData, setLeftKneeData] = useState<KneeData>({
    current: 0,
    sensorTimestamp: Date.now(),
    velocity: 0,
    acceleration: 0,
    quality: 100,
  });
  const [rightKneeData, setRightKneeData] = useState<KneeData>({
    current: 0,
    sensorTimestamp: Date.now(),
    velocity: 0,
    acceleration: 0,
    quality: 100,
  });

  // ─── Locate Mode ──────────────────────────────────────────────────────
  const [vibratingDeviceIds, setVibratingDeviceIds] = useState<string[]>([]);

  // ─── Sync Progress ────────────────────────────────────────────────────
  const [syncProgress, setSyncProgress] = useState<Record<string, SyncProgress>>({});

  // ─── Connected Clients ────────────────────────────────────────────────
  const [connectedClients, setConnectedClients] = useState<ClientMetadata[]>([]);

  // ─────────────────────────────────────────────────────────────────────────
  // WebSocket Client Setup
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const initClient = async () => {
      try {
        const client = new TropxWSClient({
          reconnectDelay: 2000,
          maxReconnectAttempts: 5,
        });
        clientRef.current = client;

        // ─── Connection Events ─────────────────────────────────────────
        client.on(EVENT_TYPES.CONNECTED, async () => {
          const isReconnection = hasConnectedOnceRef.current;
          setIsConnected(true);
          console.log(isReconnection ? '✅ WebSocket reconnected' : '✅ WebSocket connected');

          if (isReconnection) {
            console.log('🔄 Reconnection detected - re-querying backend state...');
            try {
              const stateResult = await client.getDevicesState();
              if (stateResult.success && stateResult.data.length > 0) {
                console.log(`✅ Re-synced ${stateResult.data.length} devices from backend`);
                const newDevices = new Map<number, BLEDevice>();
                for (const raw of stateResult.data) {
                  const device = convertRawToDevice(raw);
                  if (device.deviceId) {
                    newDevices.set(device.deviceId, device);
                  }
                }
                setDevices(newDevices);
                setLastUpdate(Date.now());
              }
            } catch (error) {
              console.error('❌ Failed to re-sync state on reconnection:', error);
            }
          }
          hasConnectedOnceRef.current = true;
        });

        client.on(EVENT_TYPES.DISCONNECTED, ({ code, reason }) => {
          setIsConnected(false);
          console.log('❌ WebSocket disconnected:', code, reason);
        });

        client.on(EVENT_TYPES.RECONNECTING, ({ attempt, delay }) => {
          console.log(`🔄 Reconnecting (attempt ${attempt}, delay ${delay}ms)`);
        });

        client.on(EVENT_TYPES.ERROR, (error) => {
          console.error('WebSocket error:', error);
        });

        // ─── STATE_UPDATE Handler (0x40) - Single Source of Truth ──────
        client.on(EVENT_TYPES.DEVICE_STATUS, (status: any) => {
          if (!status) return;

          // STATE_UPDATE format (array of devices)
          if (status.devices && Array.isArray(status.devices)) {
            const newDevices = new Map<number, BLEDevice>();
            for (const raw of status.devices) {
              const device = convertRawToDevice(raw);
              if (device.deviceId) {
                newDevices.set(device.deviceId, device);
              }
            }
            setDevices(newDevices);
            setLastUpdate(Date.now());

            if (status.globalState) {
              // Reset health check cooldown when transitioning TO IDLE
              // This ensures each streaming session has its own fresh cooldown
              if (status.globalState === GlobalState.IDLE) {
                lastHealthReconnectRef.current = 0;
              }
              setGlobalState(status.globalState);
            }
            return;
          }

          // Single device status (legacy 0x31 format)
          if (status.deviceId) {
            setDevices(prev => {
              const newMap = new Map(prev);
              const existing = Array.from(prev.values()).find(
                d => d.bleAddress === status.deviceId || d.deviceId === status.deviceId
              );

              if (existing) {
                newMap.set(existing.deviceId, {
                  ...existing,
                  state: status.state ?? existing.state,
                  batteryLevel: status.batteryLevel ?? existing.batteryLevel,
                  rssi: status.rssi ?? existing.rssi,
                  reconnectAttempts: status.reconnectAttempts ?? existing.reconnectAttempts,
                });
              }
              return newMap;
            });
            setLastUpdate(Date.now());
          }
        });

        // ─── Motion Data Handler ───────────────────────────────────────
        client.on(EVENT_TYPES.MOTION_DATA, (message: any) => {
          lastMotionDataTimeRef.current = Date.now();

          const raw = message?.data;
          let leftCurrent = 0;
          let rightCurrent = 0;

          if (raw instanceof Float32Array) {
            leftCurrent = raw[0] || 0;
            rightCurrent = raw[1] || 0;
          } else if (Array.isArray(raw)) {
            leftCurrent = raw[0] || 0;
            rightCurrent = raw[1] || 0;
          } else if (raw && typeof raw === 'object' && 'left' in raw && 'right' in raw) {
            leftCurrent = raw.left?.current ?? 0;
            rightCurrent = raw.right?.current ?? 0;
          }

          const timestamp = message?.timestamp || Date.now();

          setLeftKneeData({
            current: leftCurrent,
            sensorTimestamp: timestamp,
            velocity: 0,
            acceleration: 0,
            quality: 100,
          });

          setRightKneeData({
            current: rightCurrent,
            sensorTimestamp: timestamp,
            velocity: 0,
            acceleration: 0,
            quality: 100,
          });
        });

        // ─── Battery Update Handler ────────────────────────────────────
        client.on(EVENT_TYPES.BATTERY_UPDATE, (battery: any) => {
          setDevices(prev => {
            const newMap = new Map(prev);
            for (const [id, device] of newMap) {
              if (device.bleAddress === battery.deviceId) {
                newMap.set(id, { ...device, batteryLevel: battery.batteryLevel });
                break;
              }
            }
            return newMap;
          });
        });

        // ─── Sync Event Handlers ───────────────────────────────────────
        client.on(EVENT_TYPES.SYNC_STARTED, () => {
          setGlobalState(GlobalState.SYNCING);
        });

        client.on(EVENT_TYPES.SYNC_PROGRESS, (progress: any) => {
          setSyncProgress(prev => ({
            ...prev,
            [progress.deviceId]: {
              deviceName: progress.deviceName,
              offsetMs: progress.clockOffsetMs,
              deviceTimestampMs: progress.deviceTimestampMs,
            },
          }));
        });

        client.on(EVENT_TYPES.SYNC_COMPLETE, () => {
          setGlobalState(GlobalState.IDLE);
          // Reset health check cooldown when returning to IDLE
          lastHealthReconnectRef.current = 0;
        });

        // ─── Locate Mode Handler ───────────────────────────────────────
        client.on(EVENT_TYPES.DEVICE_VIBRATING, (vibrating: any) => {
          setVibratingDeviceIds(vibrating.vibratingDeviceIds || []);
        });

        // ─── Client List Handler ───────────────────────────────────────
        client.on(EVENT_TYPES.CLIENT_LIST_UPDATE, (update: any) => {
          setConnectedClients(update.clients || []);
        });

        // ─── Connect to Server ─────────────────────────────────────────
        const port = await window.electron.getWSPort();
        console.log(`🔌 Connecting to WebSocket on port ${port}`);

        const result = await client.connect(`ws://localhost:${port}`);
        if (!result.success) {
          console.error('Failed to connect:', result.error);
          return;
        }

        // Query initial state
        const stateResult = await client.getDevicesState();
        if (stateResult.success && stateResult.data.length > 0) {
          console.log(`✅ Restored ${stateResult.data.length} devices from backend`);
          const newDevices = new Map<number, BLEDevice>();
          for (const raw of stateResult.data) {
            const device = convertRawToDevice(raw);
            if (device.deviceId) {
              newDevices.set(device.deviceId, device);
            }
          }
          setDevices(newDevices);
          setLastUpdate(Date.now());
        }

      } catch (error) {
        console.error('Failed to initialize WebSocket client:', error);
      }
    };

    initClient();

    return () => {
      if (healthCheckIntervalRef.current) {
        clearInterval(healthCheckIntervalRef.current);
      }
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Health Monitoring
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected) return;

    const healthCheckInterval = setInterval(() => {
      if (!clientRef.current?.isConnected()) return;

      const streamingDevices = Array.from(devices.values()).filter(
        d => d.state === DeviceState.STREAMING
      );
      if (streamingDevices.length === 0) return;

      const timeSinceLastData = Date.now() - lastMotionDataTimeRef.current;
      const HEARTBEAT_TIMEOUT = 5000;
      const HEALTH_RECONNECT_COOLDOWN = 30000; // Fix #6: 30s cooldown between health reconnects

      if (timeSinceLastData > HEARTBEAT_TIMEOUT) {
        const now = Date.now();
        const timeSinceLastHealthReconnect = now - lastHealthReconnectRef.current;

        if (timeSinceLastHealthReconnect > HEALTH_RECONNECT_COOLDOWN) {
          console.error(`⚠️ Motion data heartbeat timeout: ${timeSinceLastData}ms`);
          console.log('🔄 Forcing reconnection to recover data stream...');
          lastHealthReconnectRef.current = now;
          clientRef.current?.disconnect();
        } else {
          console.warn(`⚠️ Motion data timeout but skipping reconnect (cooldown: ${Math.round((HEALTH_RECONNECT_COOLDOWN - timeSinceLastHealthReconnect) / 1000)}s remaining)`);
        }
      }
    }, 2000);

    healthCheckIntervalRef.current = healthCheckInterval;

    return () => clearInterval(healthCheckInterval);
  }, [isConnected, devices]);

  // ─────────────────────────────────────────────────────────────────────────
  // Derived State
  // ─────────────────────────────────────────────────────────────────────────

  const allDevices = useMemo(() => Array.from(devices.values()), [devices]);

  const uiDevices = useMemo(() => allDevices.map(mapToUIDevice), [allDevices]);

  const discoveredDevices = useMemo(
    () => allDevices.filter(d => d.state === DeviceState.DISCOVERED),
    [allDevices]
  );

  const connectedDevices = useMemo(
    () => allDevices.filter(d => [
      DeviceState.CONNECTED,
      DeviceState.SYNCING,
      DeviceState.SYNCED,
      DeviceState.STREAMING,
    ].includes(d.state)),
    [allDevices]
  );

  const streamingDevices = useMemo(
    () => allDevices.filter(d => d.state === DeviceState.STREAMING),
    [allDevices]
  );

  const counts = useMemo((): DeviceCounts => {
    const result: DeviceCounts = {
      discovered: 0,
      connecting: 0,
      connected: 0,
      syncing: 0,
      synced: 0,
      streaming: 0,
      reconnecting: 0,
      error: 0,
      total: allDevices.length,
    };

    for (const device of allDevices) {
      switch (device.state) {
        case DeviceState.DISCOVERED: result.discovered++; break;
        case DeviceState.CONNECTING: result.connecting++; break;
        case DeviceState.CONNECTED: result.connected++; break;
        case DeviceState.SYNCING: result.syncing++; break;
        case DeviceState.SYNCED: result.synced++; break;
        case DeviceState.STREAMING: result.streaming++; break;
        case DeviceState.RECONNECTING: result.reconnecting++; break;
        case DeviceState.ERROR: result.error++; break;
      }
    }
    return result;
  }, [allDevices]);

  const isScanning = globalState === GlobalState.SCANNING;
  const isSyncing = globalState === GlobalState.SYNCING;
  const isStreaming = globalState === GlobalState.STREAMING;

  // ─────────────────────────────────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────────────────────────────────

  const scanDevices = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.scanDevices();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const startBurstScan = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.startBurstScan();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const stopBurstScan = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.stopBurstScan();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const connectDevice = useCallback(async (id: string, name: string): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.connectDevice(id, name);
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const connectAllDevices = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const deviceList = allDevices
      .filter(d => d.state === DeviceState.DISCOVERED || d.state === DeviceState.DISCONNECTED)
      .map(d => ({ id: d.bleAddress, name: d.bleName }));
    const result = await clientRef.current.connectDevices(deviceList);
    return result.success ? { success: true } : { success: false, error: result.error };
  }, [allDevices]);

  const disconnectDevice = useCallback(async (id: string): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.disconnectDevice(id);
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const removeDevice = useCallback(async (id: string): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.removeDevice(id);
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const syncAllDevices = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.syncAllDevices();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const startStreaming = useCallback(async (sessionId: string, exerciseId: string, setNumber: number): Promise<Result<string>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.startRecording(sessionId, exerciseId, setNumber);
    if (result.success) {
      setGlobalState(GlobalState.STREAMING);
      return { success: true, data: result.data.recordingId };
    }
    return { success: false, error: (result as any).error || 'Failed to start streaming' };
  }, []);

  const stopStreaming = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.stopRecording();
    if (result.success) {
      setGlobalState(GlobalState.IDLE);
      // Reset health check cooldown - new session should have fresh cooldown
      lastHealthReconnectRef.current = 0;
    }
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const startLocateMode = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    const result = await clientRef.current.startLocateMode();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const stopLocateMode = useCallback(async (): Promise<Result<void>> => {
    if (!clientRef.current) return { success: false, error: 'Not connected' };
    setVibratingDeviceIds([]);
    const result = await clientRef.current.stopLocateMode();
    return result.success ? { success: true } : { success: false, error: result.error };
  }, []);

  const getDeviceByAddress = useCallback(
    (bleAddress: string) => allDevices.find(d => d.bleAddress === bleAddress),
    [allDevices]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Return
  // ─────────────────────────────────────────────────────────────────────────

  return {
    // Connection
    isConnected,
    lastUpdate,

    // Device State (BLEDevice format)
    devices,
    allDevices,
    discoveredDevices,
    connectedDevices,
    streamingDevices,
    counts,

    // UI Device State (mapped format for App.tsx)
    uiDevices,

    // Global State
    globalState,
    isScanning,
    isSyncing,
    isStreaming,

    // Motion Data
    leftKneeData,
    rightKneeData,

    // Locate Mode
    vibratingDeviceIds,

    // Sync Progress
    syncProgress,

    // Connected Clients
    connectedClients,

    // Actions
    scanDevices,
    startBurstScan,
    stopBurstScan,
    connectDevice,
    connectAllDevices,
    disconnectDevice,
    removeDevice,
    syncAllDevices,
    startStreaming,
    stopStreaming,
    startLocateMode,
    stopLocateMode,

    // Selectors
    getDeviceByAddress,

    // Client reference (advanced usage)
    client: clientRef.current,
  };
}

export default useDevices;
