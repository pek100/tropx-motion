/**
 * useBLEState Hook
 * React hook for consuming BLE state from the server
 *
 * Server owns the truth, UI subscribes and reflects
 * Actions send commands to server, never modify state directly
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TropxWSClient } from '../lib/tropx-ws-client';
import { EVENT_TYPES } from '../lib/tropx-ws-client';

// ─────────────────────────────────────────────────────────────────────────────
// Types (mirrored from ble-management for renderer)
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

export interface DeviceError {
  type: string;
  message: string;
  timestamp: number;
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
  lastError: DeviceError | null;
}

export interface SyncResult {
  deviceId: number;
  success: boolean;
  clockOffset?: number;
  error?: string;
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

// ─────────────────────────────────────────────────────────────────────────────
// Hook Options
// ─────────────────────────────────────────────────────────────────────────────

export interface UseBLEStateOptions {
  client: TropxWSClient | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook Return Type
// ─────────────────────────────────────────────────────────────────────────────

export interface UseBLEStateReturn {
  // ─── State (read-only, reflects server) ───────────────────────────
  devices: Map<number, BLEDevice>;
  globalState: GlobalState;
  isConnected: boolean;
  lastUpdate: number;

  // ─── Derived Arrays ───────────────────────────────────────────────
  allDevices: BLEDevice[];
  discoveredDevices: BLEDevice[];
  connectedDevices: BLEDevice[];
  streamingDevices: BLEDevice[];
  errorDevices: BLEDevice[];

  // ─── Derived Counts ───────────────────────────────────────────────
  counts: DeviceCounts;

  // ─── Derived Booleans ─────────────────────────────────────────────
  isScanning: boolean;
  isSyncing: boolean;
  isStreaming: boolean;
  isReadyToSync: boolean;
  isReadyToStream: boolean;
  hasDevices: boolean;
  hasErrors: boolean;

  // ─── Actions (send commands to server) ────────────────────────────
  startScan: () => Promise<boolean>;
  stopScan: () => Promise<boolean>;
  connect: (bleAddress: string, name?: string) => Promise<boolean>;
  connectAll: () => Promise<boolean>;
  disconnect: (deviceId: number) => Promise<boolean>;
  disconnectAll: () => Promise<boolean>;
  remove: (deviceId: number) => Promise<boolean>;
  syncAll: () => Promise<SyncResult[]>;
  startStreaming: () => Promise<boolean>;
  stopStreaming: () => Promise<boolean>;
  retryConnection: (deviceId: number) => Promise<boolean>;
  refreshState: () => Promise<void>;

  // ─── Selectors ────────────────────────────────────────────────────
  getDevice: (deviceId: number) => BLEDevice | undefined;
  getDeviceByAddress: (bleAddress: string) => BLEDevice | undefined;
  getLeftKneeDevices: () => BLEDevice[];
  getRightKneeDevices: () => BLEDevice[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Convert raw device status to BLEDevice
// ─────────────────────────────────────────────────────────────────────────────

function convertToDevice(raw: any): BLEDevice {
  return {
    deviceId: raw.deviceId ?? 0,
    bleAddress: raw.id ?? raw.bleAddress ?? '',
    bleName: raw.name ?? raw.bleName ?? '',
    displayName: raw.displayName ?? raw.name ?? '',
    shortName: raw.shortName ?? raw.name?.substring(0, 10) ?? '',
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

// ─────────────────────────────────────────────────────────────────────────────
// Hook Implementation
// ─────────────────────────────────────────────────────────────────────────────

export function useBLEState({ client }: UseBLEStateOptions): UseBLEStateReturn {
  // ─── State ────────────────────────────────────────────────────────
  const [devices, setDevices] = useState<Map<number, BLEDevice>>(new Map());
  const [globalState, setGlobalState] = useState<GlobalState>(GlobalState.IDLE);
  const [lastUpdate, setLastUpdate] = useState<number>(0);

  // ─── Subscription ─────────────────────────────────────────────────
  useEffect(() => {
    if (!client) return;

    // Handle device status updates
    const handleDeviceStatus = (message: any) => {
      if (!message) return;

      // Extract devices from message
      const deviceList = message.devices || (message.device ? [message.device] : []);

      if (deviceList.length > 0) {
        setDevices(prev => {
          const newMap = new Map(prev);
          for (const rawDevice of deviceList) {
            const device = convertToDevice(rawDevice);
            if (device.deviceId) {
              newMap.set(device.deviceId, device);
            } else if (device.bleAddress) {
              // Find by address
              let found = false;
              for (const [id, d] of newMap) {
                if (d.bleAddress === device.bleAddress) {
                  newMap.set(id, { ...device, deviceId: id });
                  found = true;
                  break;
                }
              }
              if (!found) {
                // Generate an ID
                const newId = newMap.size + 1;
                newMap.set(newId, { ...device, deviceId: newId });
              }
            }
          }
          return newMap;
        });
        setLastUpdate(Date.now());
      }

      // Update global state if provided
      if (message.globalState) {
        setGlobalState(message.globalState);
      }
    };

    // Subscribe to device status events
    client.on(EVENT_TYPES.DEVICE_STATUS, handleDeviceStatus);

    // Request initial state
    client.getDevicesState().then(result => {
      if (result.success && result.data) {
        const newDevices = new Map<number, BLEDevice>();
        for (const rawDevice of result.data) {
          const device = convertToDevice(rawDevice);
          if (device.deviceId) {
            newDevices.set(device.deviceId, device);
          }
        }
        setDevices(newDevices);
        setLastUpdate(Date.now());
      }
    }).catch(console.error);

    return () => {
      client.off(EVENT_TYPES.DEVICE_STATUS, handleDeviceStatus);
    };
  }, [client]);

  // ─── Derived Arrays ───────────────────────────────────────────────
  const allDevices = useMemo(() => Array.from(devices.values()), [devices]);

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

  const errorDevices = useMemo(
    () => allDevices.filter(d => d.state === DeviceState.ERROR),
    [allDevices]
  );

  // ─── Derived Counts ───────────────────────────────────────────────
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
        case DeviceState.DISCOVERED:
          result.discovered++;
          break;
        case DeviceState.CONNECTING:
          result.connecting++;
          break;
        case DeviceState.CONNECTED:
          result.connected++;
          break;
        case DeviceState.SYNCING:
          result.syncing++;
          break;
        case DeviceState.SYNCED:
          result.synced++;
          break;
        case DeviceState.STREAMING:
          result.streaming++;
          break;
        case DeviceState.RECONNECTING:
          result.reconnecting++;
          break;
        case DeviceState.ERROR:
          result.error++;
          break;
      }
    }

    return result;
  }, [allDevices]);

  // ─── Derived Booleans ─────────────────────────────────────────────
  const isScanning = globalState === GlobalState.SCANNING;
  const isSyncing = globalState === GlobalState.SYNCING;
  const isStreaming = globalState === GlobalState.STREAMING;
  const hasDevices = allDevices.length > 0;
  const hasErrors = errorDevices.length > 0;

  const isReadyToSync = useMemo(
    () => connectedDevices.length > 0 && !isSyncing && !isStreaming,
    [connectedDevices.length, isSyncing, isStreaming]
  );

  const isReadyToStream = useMemo(
    () => {
      // Need at least one synced device
      const syncedCount = allDevices.filter(d => d.syncState === SyncState.SYNCED).length;
      return syncedCount > 0 && !isStreaming;
    },
    [allDevices, isStreaming]
  );

  // ─── Actions ──────────────────────────────────────────────────────
  const startScan = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      setGlobalState(GlobalState.SCANNING);
      const result = await client.scanDevices();
      return result.success;
    } catch (error) {
      console.error('[useBLEState] startScan error:', error);
      return false;
    }
  }, [client]);

  const stopScan = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      setGlobalState(GlobalState.IDLE);
      // No explicit stop scan in current API - scanning auto-stops
      return true;
    } catch (error) {
      console.error('[useBLEState] stopScan error:', error);
      return false;
    }
  }, [client]);

  const connect = useCallback(async (bleAddress: string, name?: string): Promise<boolean> => {
    if (!client) return false;
    try {
      const device = allDevices.find(d => d.bleAddress === bleAddress);
      const result = await client.connectDevice(bleAddress, name ?? device?.bleName ?? '');
      return result.success;
    } catch (error) {
      console.error('[useBLEState] connect error:', error);
      return false;
    }
  }, [client, allDevices]);

  const connectAll = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      const devicesToConnect = discoveredDevices.map(d => ({
        id: d.bleAddress,
        name: d.bleName,
      }));
      const result = await client.connectDevices(devicesToConnect);
      return result.success;
    } catch (error) {
      console.error('[useBLEState] connectAll error:', error);
      return false;
    }
  }, [client, discoveredDevices]);

  const disconnect = useCallback(async (deviceId: number): Promise<boolean> => {
    if (!client) return false;
    try {
      const device = devices.get(deviceId);
      if (!device) return false;
      const result = await client.disconnectDevice(device.bleAddress);
      return result.success;
    } catch (error) {
      console.error('[useBLEState] disconnect error:', error);
      return false;
    }
  }, [client, devices]);

  const disconnectAll = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      const results = await Promise.all(
        connectedDevices.map(d => client.disconnectDevice(d.bleAddress))
      );
      return results.every(r => r.success);
    } catch (error) {
      console.error('[useBLEState] disconnectAll error:', error);
      return false;
    }
  }, [client, connectedDevices]);

  const remove = useCallback(async (deviceId: number): Promise<boolean> => {
    if (!client) return false;
    try {
      const device = devices.get(deviceId);
      if (!device) return false;
      const result = await client.removeDevice(device.bleAddress);
      if (result.success) {
        setDevices(prev => {
          const newMap = new Map(prev);
          newMap.delete(deviceId);
          return newMap;
        });
      }
      return result.success;
    } catch (error) {
      console.error('[useBLEState] remove error:', error);
      return false;
    }
  }, [client, devices]);

  const syncAll = useCallback(async (): Promise<SyncResult[]> => {
    if (!client) return [];
    try {
      setGlobalState(GlobalState.SYNCING);
      const result = await client.syncAllDevices();
      setGlobalState(GlobalState.IDLE);
      if (!result.success) return [];
      // Convert results to SyncResult format
      return (result.data.results ?? []).map((r: any) => ({
        deviceId: typeof r.deviceId === 'number' ? r.deviceId : parseInt(r.deviceId, 16) || 0,
        success: r.success,
        clockOffset: r.clockOffset ?? r.clockOffsetMs,
        error: r.error ?? r.message,
      }));
    } catch (error) {
      console.error('[useBLEState] syncAll error:', error);
      setGlobalState(GlobalState.IDLE);
      return [];
    }
  }, [client]);

  const startStreaming = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      const sessionId = `session_${Date.now()}`;
      const result = await client.startRecording(sessionId, 'default', 1);
      if (result.success) {
        setGlobalState(GlobalState.STREAMING);
      }
      return result.success;
    } catch (error) {
      console.error('[useBLEState] startStreaming error:', error);
      return false;
    }
  }, [client]);

  const stopStreaming = useCallback(async (): Promise<boolean> => {
    if (!client) return false;
    try {
      const result = await client.stopRecording();
      if (result.success) {
        setGlobalState(GlobalState.IDLE);
      }
      return result.success;
    } catch (error) {
      console.error('[useBLEState] stopStreaming error:', error);
      return false;
    }
  }, [client]);

  const retryConnection = useCallback(async (deviceId: number): Promise<boolean> => {
    if (!client) return false;
    try {
      const device = devices.get(deviceId);
      if (!device) return false;
      // Retry is just another connect attempt
      const result = await client.connectDevice(device.bleAddress, device.bleName);
      return result.success;
    } catch (error) {
      console.error('[useBLEState] retryConnection error:', error);
      return false;
    }
  }, [client, devices]);

  const refreshState = useCallback(async (): Promise<void> => {
    if (!client) return;
    try {
      const result = await client.getDevicesState();
      if (result.success && result.data) {
        const newDevices = new Map<number, BLEDevice>();
        for (const rawDevice of result.data) {
          const device = convertToDevice(rawDevice);
          if (device.deviceId) {
            newDevices.set(device.deviceId, device);
          }
        }
        setDevices(newDevices);
        setLastUpdate(Date.now());
      }
    } catch (error) {
      console.error('[useBLEState] refreshState error:', error);
    }
  }, [client]);

  // ─── Selectors ────────────────────────────────────────────────────
  const getDevice = useCallback(
    (deviceId: number) => devices.get(deviceId),
    [devices]
  );

  const getDeviceByAddress = useCallback(
    (bleAddress: string) => allDevices.find(d => d.bleAddress === bleAddress),
    [allDevices]
  );

  const getLeftKneeDevices = useCallback(
    () => allDevices.filter(d => d.joint === 'Left Knee'),
    [allDevices]
  );

  const getRightKneeDevices = useCallback(
    () => allDevices.filter(d => d.joint === 'Right Knee'),
    [allDevices]
  );

  // ─── Return ───────────────────────────────────────────────────────
  return {
    // State
    devices,
    globalState,
    isConnected: !!client?.isConnected(),
    lastUpdate,

    // Derived arrays
    allDevices,
    discoveredDevices,
    connectedDevices,
    streamingDevices,
    errorDevices,

    // Derived counts
    counts,

    // Derived booleans
    isScanning,
    isSyncing,
    isStreaming,
    isReadyToSync,
    isReadyToStream,
    hasDevices,
    hasErrors,

    // Actions
    startScan,
    stopScan,
    connect,
    connectAll,
    disconnect,
    disconnectAll,
    remove,
    syncAll,
    startStreaming,
    stopStreaming,
    retryConnection,
    refreshState,

    // Selectors
    getDevice,
    getDeviceByAddress,
    getLeftKneeDevices,
    getRightKneeDevices,
  };
}

export default useBLEState;
