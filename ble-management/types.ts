/**
 * Unified BLE State Types
 * Single source of truth for device identification and state management
 */

// ─────────────────────────────────────────────────────────────────────────────
// Device ID Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Device ID encoding scheme (single byte):
 * Upper nibble (bits 4-7): Joint identifier (1=left, 2=right)
 * Lower nibble (bits 0-3): Position identifier (1=shin, 2=thigh)
 */
export enum DeviceID {
  LEFT_SHIN = 0x11,
  LEFT_THIGH = 0x12,
  RIGHT_SHIN = 0x21,
  RIGHT_THIGH = 0x22,
}

export const ALL_DEVICE_IDS = [
  DeviceID.LEFT_SHIN,
  DeviceID.LEFT_THIGH,
  DeviceID.RIGHT_SHIN,
  DeviceID.RIGHT_THIGH,
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// State Machine Enums
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Device connection/operational state
 * Forms a state machine with defined transitions
 */
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

/**
 * Global BLE system state
 * Determines what operations are allowed
 */
export enum GlobalState {
  IDLE = 'idle',
  SCANNING = 'scanning',
  CONNECTING = 'connecting',
  SYNCING = 'syncing',
  LOCATING = 'locating',
  STREAMING = 'streaming',
}

/**
 * Time sync state for a device
 */
export enum SyncState {
  NOT_SYNCED = 'not_synced',
  SYNCING = 'syncing',
  SYNCED = 'synced',
  FAILED = 'failed',
}

/**
 * Disconnect reason for reconnection handling
 */
export enum DisconnectReason {
  USER_REQUESTED = 'user_requested',
  CONNECTION_LOST = 'connection_lost',
  WATCHDOG_TIMEOUT = 'watchdog_timeout',
  BLE_ERROR = 'ble_error',
  DEVICE_POWERED_OFF = 'device_powered_off',
  UNKNOWN = 'unknown',
}

/**
 * Error types for error state handling
 */
export enum DeviceErrorType {
  CONNECTION_FAILED = 'connection_failed',
  SYNC_FAILED = 'sync_failed',
  STREAMING_FAILED = 'streaming_failed',
  MAX_RECONNECT_EXCEEDED = 'max_reconnect_exceeded',
  UNKNOWN = 'unknown',
}

// ─────────────────────────────────────────────────────────────────────────────
// State Machine Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valid state transitions
 * Any transition not in this map is invalid and will throw
 */
export const TRANSITION_RULES: Record<DeviceState, DeviceState[]> = {
  [DeviceState.DISCONNECTED]: [
    DeviceState.DISCOVERED,
    DeviceState.CONNECTING,
    DeviceState.ERROR,  // For unavailable device detection
  ],
  [DeviceState.DISCOVERED]: [
    DeviceState.CONNECTING,
    DeviceState.DISCONNECTED,
    DeviceState.ERROR,  // For device not found during connection attempt
  ],
  [DeviceState.CONNECTING]: [
    DeviceState.CONNECTED,
    DeviceState.RECONNECTING,
    DeviceState.ERROR,
    DeviceState.DISCONNECTED,
  ],
  [DeviceState.CONNECTED]: [
    DeviceState.SYNCING,
    DeviceState.STREAMING,
    DeviceState.RECONNECTING,
    DeviceState.DISCONNECTED,
  ],
  [DeviceState.SYNCING]: [
    DeviceState.SYNCED,
    DeviceState.CONNECTED,
    DeviceState.ERROR,
    DeviceState.RECONNECTING,
    DeviceState.DISCONNECTED,
  ],
  [DeviceState.SYNCED]: [
    DeviceState.STREAMING,
    DeviceState.SYNCING,
    DeviceState.CONNECTED,
    DeviceState.RECONNECTING,
    DeviceState.DISCONNECTED,
  ],
  [DeviceState.STREAMING]: [
    DeviceState.SYNCED,
    DeviceState.SYNCING,  // Allow re-sync from streaming state
    DeviceState.CONNECTED,
    DeviceState.RECONNECTING,
    DeviceState.ERROR,
    DeviceState.DISCONNECTED,
  ],
  [DeviceState.RECONNECTING]: [
    DeviceState.CONNECTING,
    DeviceState.DISCONNECTED,
    DeviceState.ERROR,
  ],
  [DeviceState.ERROR]: [
    DeviceState.DISCOVERED,  // Recovery when device is rediscovered during scan
    DeviceState.DISCONNECTED,
    DeviceState.CONNECTING,
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Constants
// ─────────────────────────────────────────────────────────────────────────────

export const BLE_CONFIG = {
  // Polling intervals (ms)
  polling: {
    battery: 30000,
    rssi: 10000,
    firmwareState: 5000,
  },

  // Reconnection settings (aggressive speed)
  reconnect: {
    baseDelayMs: 500,       // 0.5 second - very fast first retry
    maxDelayMs: 15000,      // 15 seconds max
    maxAttempts: 5,
    backoffMultiplier: 1.5,
  },

  // Watchdog settings (balanced detection - verifies BLE state before disconnect)
  watchdog: {
    checkIntervalMs: 1000,       // Check every 1 second
    timeoutMs: 10000,            // 10 second timeout - only triggers if BLE also disconnected
    streamingRecoveryMs: 3000,   // Try streaming recovery after 3 seconds of no data
  },

  // Broadcast settings
  broadcast: {
    debounceMs: 50,
  },
} as const;

/**
 * States where polling is allowed
 */
export const POLLING_ALLOWED_STATES: DeviceState[] = [
  DeviceState.CONNECTED,
  DeviceState.SYNCED,
];

/**
 * Global states that block polling
 */
export const POLLING_BLOCKED_GLOBAL_STATES: GlobalState[] = [
  GlobalState.CONNECTING,
  GlobalState.SYNCING,
  GlobalState.LOCATING,
  GlobalState.STREAMING,
];

// ─────────────────────────────────────────────────────────────────────────────
// Device State Interfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error information for devices in ERROR state
 */
export interface DeviceError {
  type: DeviceErrorType;
  message: string;
  timestamp: number;
}

/**
 * Complete device state (stored in UnifiedBLEStateStore)
 */
export interface UnifiedDeviceState {
  // Identity (set on registration, immutable)
  deviceId: DeviceID;
  bleAddress: string;
  bleName: string;

  // State machine
  state: DeviceState;
  previousState: DeviceState | null;
  stateChangedAt: number;

  // Device health (from polling/notifications)
  batteryLevel: number | null;
  rssi: number | null;
  firmwareState: number | null;
  lastSeen: number;

  // Time sync
  clockOffset: number;
  syncState: SyncState;
  lastSyncAt: number | null;

  // Reconnection tracking
  reconnectAttempts: number;
  nextReconnectAt: number | null;
  disconnectReason: DisconnectReason | null;

  // Error tracking
  lastError: DeviceError | null;

  // Sync progress (0-100 during sync, null when not syncing)
  syncProgress: number | null;

  // Locate mode (true when device is vibrating/shaking)
  isVibrating: boolean;
}

/**
 * Global BLE system state
 */
export interface GlobalBLEState {
  state: GlobalState;
  scanningStartedAt: number | null;
  syncingStartedAt: number | null;
  streamingStartedAt: number | null;
}

/**
 * Default values for new device state
 */
export const DEFAULT_DEVICE_STATE: Omit<UnifiedDeviceState, 'deviceId' | 'bleAddress' | 'bleName'> = {
  state: DeviceState.DISCOVERED,
  previousState: null,
  stateChangedAt: 0,
  batteryLevel: null,
  rssi: null,
  firmwareState: null,
  lastSeen: 0,
  clockOffset: 0,
  syncState: SyncState.NOT_SYNCED,
  lastSyncAt: null,
  reconnectAttempts: 0,
  nextReconnectAt: null,
  disconnectReason: null,
  lastError: null,
  syncProgress: null,
  isVibrating: false,
};

/**
 * Default global state
 */
export const DEFAULT_GLOBAL_STATE: GlobalBLEState = {
  state: GlobalState.IDLE,
  scanningStartedAt: null,
  syncingStartedAt: null,
  streamingStartedAt: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Streaming & Motion Data
// ─────────────────────────────────────────────────────────────────────────────

export interface MotionData {
  timestamp: number;
  quaternion: { w: number; x: number; y: number; z: number };
}

export interface StreamingHook {
  onMotionData: (data: MotionData) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Events & Callbacks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * State change event (emitted on device state transitions)
 */
export interface DeviceStateChange {
  deviceId: DeviceID;
  previousState: DeviceState;
  newState: DeviceState;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Global state change event
 */
export interface GlobalStateChange {
  previousState: GlobalState;
  newState: GlobalState;
  timestamp: number;
}

export type DeviceStateChangeCallback = (change: DeviceStateChange) => void;
export type GlobalStateChangeCallback = (change: GlobalStateChange) => void;

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Message Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STATE_UPDATE message (0x40)
 * Single message type for all device state updates
 */
export interface StateUpdateMessage {
  type: 0x40;
  timestamp: number;
  globalState: GlobalState;
  devices: StateUpdateDevice[];
}

/**
 * Device data within STATE_UPDATE message
 */
export interface StateUpdateDevice {
  deviceId: DeviceID;
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
  syncProgress: number | null;
  isVibrating: boolean;
}

