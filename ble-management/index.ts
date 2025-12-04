/**
 * BLE Management Module
 * Single source of truth for device identification and state
 */

// ─────────────────────────────────────────────────────────────────
// Core Types & Enums
// ─────────────────────────────────────────────────────────────────

export {
  // Device ID
  DeviceID,
  ALL_DEVICE_IDS,

  // State Machine Enums
  DeviceState,
  GlobalState,
  SyncState,
  DisconnectReason,
  DeviceErrorType,

  // Transition Rules
  TRANSITION_RULES,

  // Configuration
  BLE_CONFIG,
  POLLING_ALLOWED_STATES,
  POLLING_BLOCKED_GLOBAL_STATES,

  // Default Values
  DEFAULT_DEVICE_STATE,
  DEFAULT_GLOBAL_STATE,
} from './types';

export type {
  // Device State
  DeviceError,
  UnifiedDeviceState,
  GlobalBLEState,

  // Streaming
  MotionData,
  StreamingHook,

  // Events
  DeviceStateChange,
  GlobalStateChange,
  DeviceStateChangeCallback,
  GlobalStateChangeCallback,

  // WebSocket Messages
  StateUpdateMessage,
  StateUpdateDevice,
} from './types';

// ─────────────────────────────────────────────────────────────────
// Operations (bit manipulation, identification)
// ─────────────────────────────────────────────────────────────────

export {
  isLeftJoint,
  isRightJoint,
  isShin,
  isThigh,
  getJointPair,
  getPartnerDevice,
  getJointName,
  getSortOrder,
  isValidDeviceID,
  identifyDevice,
  isTropXDevice,
} from './operations';

// ─────────────────────────────────────────────────────────────────
// Display (UI strings, definitions)
// ─────────────────────────────────────────────────────────────────

export {
  getDeviceDisplayName,
  getDeviceShortName,
  getJointDisplayName,
  getPositionDisplayName,
  formatDeviceID,
  buildSensorDefinition,
  SENSOR_DEFINITIONS,
  JOINT_DEFINITIONS,
  JOINT_IDS,
  DEFAULT_SENSOR_STATE,
} from './display';

export type {
  JointId,
  Placement,
  AnatomicalRole,
  ConnectionState,
  SensorDefinition,
  SensorState,
  Sensor,
} from './display';

// ─────────────────────────────────────────────────────────────────
// Unified BLE State Store (NEW - use this)
// ─────────────────────────────────────────────────────────────────

export {
  UnifiedBLEStateStore,
  UnifiedBLEStateStoreImpl,
  InvalidTransitionError,
  DeviceNotFoundError,
} from './UnifiedBLEStateStore';

export type { StoreEvents } from './UnifiedBLEStateStore';

// ─────────────────────────────────────────────────────────────────
// Managers
// ─────────────────────────────────────────────────────────────────

export { PollingManager, PollingManagerImpl } from './PollingManager';
export type { PollType, PollResult, PollFunction } from './PollingManager';

export { ReconnectionManager, ReconnectionManagerImpl } from './ReconnectionManager';
export type { ConnectFunction, StartStreamingFunction, ReconnectState } from './ReconnectionManager';

export { Watchdog, WatchdogImpl } from './Watchdog';
export type { WatchdogStatus, StreamingRecoveryCallback, BLEConnectionCheckCallback } from './Watchdog';


