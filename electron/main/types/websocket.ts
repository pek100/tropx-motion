// Re-export types from shared module for backward compatibility
export * from '../../shared/types';
export * from '../../shared/config';

// Legacy enum for backward compatibility
export enum WSMessageType {
    HEARTBEAT = 'heartbeat',
    PONG = 'pong',
    STATUS_UPDATE = 'status_update',
    
    DEVICE_STATUS = 'device_status',
    DEVICE_SCAN_RESULT = 'device_scan_result',
    DEVICE_CONNECTED = 'device_connected',
    SCAN_REQUEST = 'scan_request',
    BLUETOOTH_DEVICES = 'bluetooth_devices',
    BLUETOOTH_DEVICES_FOUND = 'bluetooth_devices_found',
    BLUETOOTH_PAIRING_REQUEST = 'bluetooth_pairing_request',
    BATTERY_UPDATE = 'battery_update',
    
    RECORDING_STATE = 'recording_state',
    
    MOTION_DATA = 'motion_data',
    MOTION_DATA_BATCH = 'motion_data_batch',
    
    ERROR = 'error'
}