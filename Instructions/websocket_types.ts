// electron/main/types/websocket.ts

// WebSocket message types
export enum WSMessageType {
    // Connection management
    HEARTBEAT = 'heartbeat',
    PONG = 'pong',
    STATUS_UPDATE = 'status_update',
    
    // Device management
    DEVICE_STATUS = 'device_status',
    BLUETOOTH_DEVICES = 'bluetooth_devices',
    BATTERY_UPDATE = 'battery_update',
    
    // Recording management
    RECORDING_STATE = 'recording_state',
    
    // Data streaming
    MOTION_DATA = 'motion_data',
    MOTION_DATA_BATCH = 'motion_data_batch',
    
    // Error handling
    ERROR = 'error'
}

// Base WebSocket message structure
export interface WSMessage {
    type: WSMessageType;
    data: any;
    timestamp: number;
    clientId?: string;
}

// Device information structure
export interface DeviceInfo {
    id: string;
    name: string;
    connected: boolean;
    batteryLevel: number | null;
    lastUpdate?: number;
}

// Motion data for real-time streaming
export interface MotionDataPoint {
    current: number;
    max: number;
    min: number;
    rom: number;
    devices?: string[];
}

export interface MotionDataUpdate {
    left: MotionDataPoint;
    right: MotionDataPoint;
    timestamp: number;
    frameId?: number;
}

// Recording session information
export interface RecordingSession {
    sessionId: string;
    exerciseId: string;
    setNumber: number;
    patientId?: string;
    exerciseName?: string;
}

// Bluetooth device selection
export interface BluetoothDevice {
    deviceId: string;
    deviceName: string;
    paired: boolean;
    available: boolean;
}

// Service status information
export interface ServiceStatus {
    isInitialized: boolean;
    isRecording: boolean;
    connectedDevices: DeviceInfo[];
    batteryLevels: Record<string, number>;
    recordingStartTime?: string;
    wsPort: number;
    clientCount: number;
    motionProcessingReady?: boolean;
    deviceManagerReady?: boolean;
}

// Specific message payloads
export interface HeartbeatMessage extends WSMessage {
    type: WSMessageType.HEARTBEAT;
    data: {
        timestamp: number;
        serverUptime?: number;
    };
}

export interface DeviceStatusMessage extends WSMessage {
    type: WSMessageType.DEVICE_STATUS;
    data: {
        connectedDevices: DeviceInfo[];
        batteryLevels: Record<string, number>;
        totalDevices?: number;
    };
}

export interface MotionDataMessage extends WSMessage {
    type: WSMessageType.MOTION_DATA;
    data: MotionDataUpdate;
}

export interface RecordingStateMessage extends WSMessage {
    type: WSMessageType.RECORDING_STATE;
    data: {
        isRecording: boolean;
        startTime?: string;
        sessionId?: string;
        duration?: number;
    };
}

export interface BluetoothDevicesMessage extends WSMessage {
    type: WSMessageType.BLUETOOTH_DEVICES;
    data: {
        devices: BluetoothDevice[];
        requestId?: string;
    };
}

export interface ErrorMessage extends WSMessage {
    type: WSMessageType.ERROR;
    data: {
        code: string;
        message: string;
        details?: any;
    };
}

// Client-to-server message types
export interface ClientMessage {
    type: string;
    data?: any;
    timestamp?: number;
}

export interface PingMessage extends ClientMessage {
    type: 'ping';
}

export interface BluetoothSelectionMessage extends ClientMessage {
    type: 'select_bluetooth_device';
    data: {
        deviceId: string;
    };
}

export interface StatusRequestMessage extends ClientMessage {
    type: 'request_status';
}

export interface ConnectDevicesMessage extends ClientMessage {
    type: 'connect_devices';
}

export interface StartRecordingMessage extends ClientMessage {
    type: 'start_recording';
    data: RecordingSession;
}

export interface StopRecordingMessage extends ClientMessage {
    type: 'stop_recording';
}