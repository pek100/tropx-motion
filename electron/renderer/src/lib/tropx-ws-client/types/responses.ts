// Result type for operation responses
export type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

// Helper functions for Result type
export const Ok = <T>(data: T): Result<T> => ({ success: true, data });
export const Err = <T>(error: string, code?: string): Result<T> => ({
  success: false,
  error,
  code
});

// Device information
export interface DeviceInfo {
  id: string;
  name: string;
  address: string;
  rssi: number;
  state: 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';
  batteryLevel: number | null;
  lastSeen: Date;
  isReconnecting?: boolean;
  reconnectAttempts?: number;
}

// Scan response
export interface ScanResponse {
  devices: DeviceInfo[];
  message?: string;
}

// Connection response
export interface ConnectionResponse {
  deviceId: string;
  message?: string;
}

// Recording response
export interface RecordingResponse {
  sessionId?: string;
  recordingId?: string;
  message?: string;
}

// Sync response
export interface SyncResponse {
  results: Array<{ deviceId: string; success: boolean; message?: string }>;
  message?: string;
}

// Status response
export interface StatusResponse {
  isRunning: boolean;
  port: number;
  connections: number;
  domains: Record<string, any>;
  performance: any;
}

// Stats
export interface ClientStats {
  messagesSent: number;
  messagesReceived: number;
  errors: number;
  uptime: number;
  latency: number;
}
