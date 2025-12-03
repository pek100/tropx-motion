/**
 * useSensorMap React Hook
 * Provides sensor state in the renderer process
 *
 * Uses static definitions from ble-management and syncs runtime state via WebSocket events
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { TropxWSClient } from '../lib/tropx-ws-client';
import { EVENT_TYPES } from '../lib/tropx-ws-client';
import type { DeviceStatusMessage, BatteryUpdateMessage, SyncProgressMessage } from '../lib/tropx-ws-client/types/messages';

// Import from ble-management (single source of truth)
import {
  DeviceID,
  ALL_DEVICE_IDS,
  SENSOR_DEFINITIONS,
  JOINT_DEFINITIONS,
  DEFAULT_SENSOR_STATE,
  isValidDeviceID,
  identifyDevice,
} from '../../../../ble-management';
import type {
  JointId,
  Sensor,
  SensorState,
  ConnectionState,
} from '../../../../ble-management';

// SensorId is an alias for DeviceID
type SensorId = DeviceID;

// Local sensor state type (what we track in the hook)
type SensorStates = Record<SensorId, SensorState>;

// Initialize default states
function createInitialStates(): SensorStates {
  const states: Partial<SensorStates> = {};
  for (const id of ALL_DEVICE_IDS) {
    states[id] = { ...DEFAULT_SENSOR_STATE };
  }
  return states as SensorStates;
}

// Hook options
interface UseSensorMapOptions {
  client: TropxWSClient | null;
}

// Hook return type
interface UseSensorMapReturn {
  // All sensors with definitions + state
  sensors: Sensor[];

  // Get single sensor
  getSensor: (id: SensorId) => Sensor;

  // Get joint pair [proximal, distal]
  getJointPair: (joint: JointId) => [Sensor, Sensor];

  // Get sensors by joint
  byJoint: (joint: JointId) => Sensor[];

  // Identify sensor from BLE name
  identifySensor: (bleName: string) => SensorId | null;

  // State queries
  getStreamingSensors: () => Sensor[];
  getConnectedSensors: () => Sensor[];
  isJointStreaming: (joint: JointId) => boolean;
  hasStreamingSensors: boolean;
  activeSensorCount: number;
}

export function useSensorMap({ client }: UseSensorMapOptions): UseSensorMapReturn {
  const [states, setStates] = useState<SensorStates>(createInitialStates);
  const statesRef = useRef(states);
  statesRef.current = states;

  // Map deviceId string to SensorId (DeviceID)
  const resolveSensorId = useCallback((deviceId: string, deviceName?: string): SensorId | null => {
    // First try direct numeric parse (if it's already a hex string like "0x11" or "17")
    if (deviceId.startsWith('0x')) {
      const numeric = parseInt(deviceId, 16);
      if (isValidDeviceID(numeric)) return numeric;
    }

    // Try parsing as decimal
    const decimal = parseInt(deviceId, 10);
    if (isValidDeviceID(decimal)) return decimal;

    // Fall back to BLE name identification
    if (deviceName) {
      return identifyDevice(deviceName);
    }

    return null;
  }, []);

  // Handle device status updates
  useEffect(() => {
    if (!client) return;

    const handleDeviceStatus = (status: DeviceStatusMessage) => {
      const sensorId = resolveSensorId(status.deviceId, status.deviceName);
      if (!sensorId) {
        console.warn('[useSensorMap] Unknown device:', status.deviceId, status.deviceName);
        return;
      }

      setStates(prev => ({
        ...prev,
        [sensorId]: {
          ...prev[sensorId],
          connectionState: status.state as ConnectionState,
          bleName: status.deviceName,
          batteryLevel: status.batteryLevel ?? prev[sensorId].batteryLevel,
          lastSeen: Date.now(),
          // Clear reconnecting when connected/streaming
          isReconnecting: status.state === 'connected' || status.state === 'streaming'
            ? false
            : prev[sensorId].isReconnecting,
          reconnectAttempts: status.state === 'connected' || status.state === 'streaming'
            ? 0
            : prev[sensorId].reconnectAttempts,
        },
      }));
    };

    const handleBatteryUpdate = (update: BatteryUpdateMessage) => {
      const sensorId = resolveSensorId(update.deviceId, update.deviceName);
      if (!sensorId) return;

      setStates(prev => ({
        ...prev,
        [sensorId]: {
          ...prev[sensorId],
          batteryLevel: update.batteryLevel,
          lastSeen: Date.now(),
        },
      }));
    };

    const handleSyncProgress = (progress: SyncProgressMessage) => {
      const sensorId = resolveSensorId(progress.deviceId, progress.deviceName);
      if (!sensorId) return;

      setStates(prev => ({
        ...prev,
        [sensorId]: {
          ...prev[sensorId],
          clockOffset: progress.clockOffsetMs,
        },
      }));
    };

    // Subscribe to events
    client.on(EVENT_TYPES.DEVICE_STATUS, handleDeviceStatus);
    client.on(EVENT_TYPES.BATTERY_UPDATE, handleBatteryUpdate);
    client.on(EVENT_TYPES.SYNC_PROGRESS, handleSyncProgress);

    return () => {
      client.off(EVENT_TYPES.DEVICE_STATUS, handleDeviceStatus);
      client.off(EVENT_TYPES.BATTERY_UPDATE, handleBatteryUpdate);
      client.off(EVENT_TYPES.SYNC_PROGRESS, handleSyncProgress);
    };
  }, [client, resolveSensorId]);

  // Build sensor (definition + state)
  const buildSensor = useCallback((id: SensorId): Sensor => {
    return {
      ...SENSOR_DEFINITIONS[id],
      state: statesRef.current[id],
    };
  }, []);

  // All sensors
  const sensors = useMemo((): Sensor[] => {
    return ALL_DEVICE_IDS.map(id => ({
      ...SENSOR_DEFINITIONS[id],
      state: states[id],
    }));
  }, [states]);

  // Get single sensor
  const getSensor = useCallback((id: SensorId): Sensor => {
    return {
      ...SENSOR_DEFINITIONS[id],
      state: statesRef.current[id],
    };
  }, []);

  // Get joint pair
  const getJointPair = useCallback((joint: JointId): [Sensor, Sensor] => {
    const [proximalId, distalId] = JOINT_DEFINITIONS[joint].sensors;
    return [
      buildSensor(proximalId),
      buildSensor(distalId),
    ];
  }, [buildSensor]);

  // Get by joint
  const byJoint = useCallback((joint: JointId): Sensor[] => {
    const [proximal, distal] = getJointPair(joint);
    return [proximal, distal];
  }, [getJointPair]);

  // Get streaming sensors
  const getStreamingSensors = useCallback((): Sensor[] => {
    return sensors.filter(s => s.state.connectionState === 'streaming');
  }, [sensors]);

  // Get connected sensors
  const getConnectedSensors = useCallback((): Sensor[] => {
    return sensors.filter(s =>
      s.state.connectionState === 'connected' ||
      s.state.connectionState === 'streaming'
    );
  }, [sensors]);

  // Check if joint is streaming
  const isJointStreaming = useCallback((joint: JointId): boolean => {
    const [proximal, distal] = getJointPair(joint);
    return (
      proximal.state.connectionState === 'streaming' &&
      distal.state.connectionState === 'streaming'
    );
  }, [getJointPair]);

  // Derived state
  const hasStreamingSensors = useMemo(() => {
    return sensors.some(s => s.state.connectionState === 'streaming');
  }, [sensors]);

  const activeSensorCount = useMemo(() => {
    return sensors.filter(s =>
      s.state.connectionState === 'connected' ||
      s.state.connectionState === 'streaming'
    ).length;
  }, [sensors]);

  // Identify sensor from BLE name
  const identifySensor = useCallback((bleName: string): SensorId | null => {
    return identifyDevice(bleName);
  }, []);

  return {
    sensors,
    getSensor,
    getJointPair,
    byJoint,
    identifySensor,
    getStreamingSensors,
    getConnectedSensors,
    isJointStreaming,
    hasStreamingSensors,
    activeSensorCount,
  };
}
