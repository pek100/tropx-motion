import * as React from 'react';
import { useState, useEffect, useCallback, useRef, useReducer } from 'react';
import { Play, Pause, Wifi, WifiOff, Zap, Minimize2, Maximize2, X } from 'lucide-react';
import { MotionProcessingCoordinator } from '../../motionProcessing/MotionProcessingCoordinator';
import { EnhancedMotionDataDisplay } from './components';
import { museManager } from '../../muse_sdk/core/MuseManager';
import { UnifiedBinaryProtocol } from '../shared/BinaryProtocol';
import { WSMessage, DeviceInfo } from '../shared/types';

// Constants
const CONSTANTS = {
  WEBSOCKET: {
    DEFAULT_PORT: 8080,
    RECONNECT_DELAY_BASE: 1000,
    MAX_RECONNECT_DELAY: 10000,
    MAX_RECONNECT_ATTEMPTS: 5,
    CONNECTION_TIMEOUT: 120000
  },
  TIMEOUTS: {
    DEVICE_SELECTION_WAIT: 500,
    CONNECTION_CLEANUP: 1000,
    DEVICE_DISCOVERY_TRIGGER: 1000,
    SCAN_DURATION: 15000,
    FINAL_RESET_WAIT: 2000,
    FAST_CONNECTION_TIMEOUT: 5000
  },
  BATTERY: {
    UPDATE_INTERVAL: 30000,
    LOW_BATTERY_THRESHOLD: 20
  },
  SERVICES: {
    TROPX_SERVICE_UUID: 'c8c0a708-e361-4b5e-a365-98fa6b0a836f'
  },
  UI: {
    COLORS: {
      PRIMARY: '#FF4D35',
      PRIMARY_HOVER: '#e63e2b',
      SUCCESS: 'bg-green-500',
      WARNING: 'bg-yellow-500',
      ERROR: 'bg-red-500',
      STREAMING: 'bg-red-500',
      DISCOVERED: 'bg-blue-500',
      DISCONNECTED: 'bg-gray-400',
      CONNECTING: 'bg-yellow-500'
    }
  }
};

// Create a global instance of MotionProcessingCoordinator
let motionProcessingCoordinator: MotionProcessingCoordinator | null = null;

// Type definitions for Electron API
declare global {
  interface Window {
    electronAPI?: {
      motion: {
        getWebSocketPort(): Promise<number>;
        scanDevices(): Promise<{ success: boolean; message?: string }>;
        connectToDevice(deviceName: string): Promise<{ success: boolean; message?: string }>;
        startRecording(sessionData: any): Promise<{ success: boolean; message?: string }>;
        stopRecording(): Promise<{ success: boolean; message?: string }>;
      };
      bluetooth?: {
        selectDevice(deviceId: string): Promise<any>;
      };
      window: {
        minimize(): void;
        maximize(): void;
        close(): void;
      };
    };
  }
}

// Remove custom Web Bluetooth declarations to avoid conflicts; use lib.dom types

// Device state machine types
type DeviceState = 'discovered' | 'connecting' | 'connected' | 'streaming' | 'disconnected' | 'error';

interface DeviceStateMachine {
  id: string;
  name: string;
  state: DeviceState;
  batteryLevel: number | null;
  lastSeen: Date;
  errorMessage?: string;
}

// Unified App State
interface AppState {
  // WebSocket
  wsPort: number;
  isConnected: boolean;
  
  // Devices - single source of truth
  allDevices: Map<string, DeviceStateMachine>;
  
  // App States
  isRecording: boolean;
  isScanning: boolean;
  
  // Motion Data
  motionData: any; // relaxed type; component handles parsing
  status: any;
  recordingStartTime: Date | null;
}

// Action Types
type AppAction = 
  | { type: 'SET_WS_PORT'; payload: number }
  | { type: 'SET_WS_CONNECTED'; payload: boolean }
  | { type: 'SET_DEVICE_STATE'; payload: { deviceId: string; device: DeviceStateMachine } }
  | { type: 'UPDATE_DEVICE'; payload: { deviceId: string; updates: Partial<DeviceStateMachine> } }
  | { type: 'REMOVE_DEVICE'; payload: string }
  | { type: 'CLEAR_ALL_DEVICES' }
  | { type: 'SET_SCANNING'; payload: boolean }
  | { type: 'SET_RECORDING'; payload: { isRecording: boolean; startTime?: Date | null } }
  | { type: 'SET_MOTION_DATA'; payload: any }
  | { type: 'SET_STATUS'; payload: any }
  | { type: 'TRANSITION_FROM_CONNECTING'; payload: { deviceId: string; newState: DeviceState } }
  | { type: 'CLEAR_NON_CONNECTING_DEVICES' };

// Initial State
const initialState: AppState = {
  wsPort: CONSTANTS.WEBSOCKET.DEFAULT_PORT,
  isConnected: false,
  allDevices: new Map(),
  isRecording: false,
  isScanning: false,
  motionData: null,
  status: null,
  recordingStartTime: null
};

// App State Reducer
function appStateReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_WS_PORT':
      return { ...state, wsPort: action.payload };
      
    case 'SET_WS_CONNECTED':
      return { ...state, isConnected: action.payload };
      
    case 'SET_DEVICE_STATE': {
      const newDevices = new Map(state.allDevices);
      newDevices.set(action.payload.deviceId, action.payload.device);
      return { ...state, allDevices: newDevices };
    }
    
    case 'UPDATE_DEVICE': {
      const newDevices = new Map(state.allDevices);
      const existing = newDevices.get(action.payload.deviceId);
      if (existing) {
        newDevices.set(action.payload.deviceId, { ...existing, ...action.payload.updates });
      }
      return { ...state, allDevices: newDevices };
    }
    
    case 'REMOVE_DEVICE': {
      const newDevices = new Map(state.allDevices);
      newDevices.delete(action.payload);
      return { ...state, allDevices: newDevices };
    }
    
    case 'CLEAR_ALL_DEVICES':
      return { ...state, allDevices: new Map() };
      
    case 'SET_SCANNING':
      return { ...state, isScanning: action.payload };
      
    case 'SET_RECORDING':
      return { 
        ...state, 
        isRecording: action.payload.isRecording,
        recordingStartTime: action.payload.startTime ?? state.recordingStartTime
      };
      
    case 'SET_MOTION_DATA':
      return { ...state, motionData: action.payload };
      
    case 'SET_STATUS':
      return { ...state, status: action.payload };
      
    case 'TRANSITION_FROM_CONNECTING': {
      const newDevices = new Map(state.allDevices);
      const device = newDevices.get(action.payload.deviceId);
      if (device && device.state === 'connecting') {
        newDevices.set(action.payload.deviceId, {
          ...device,
          state: action.payload.newState,
          lastSeen: new Date()
        });
      }
      return { ...state, allDevices: newDevices };
    }
    
    case 'CLEAR_NON_CONNECTING_DEVICES': {
      const newDevices = new Map();
      state.allDevices.forEach((device, id) => {
        // Preserve connecting, connected, and streaming devices - only remove discovered/disconnected
        if (device.state === 'connecting' || device.state === 'connected' || device.state === 'streaming') {
          newDevices.set(id, device);
        }
      });
      return { ...state, allDevices: newDevices };
    }
    
    default:
      return state;
  }
}

const useWebSocket = (url: string) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const connectionInProgressRef = useRef(false);

  const connect = useCallback(() => {
    if (connectionInProgressRef.current) {
      console.log('🔌 Connection already in progress, skipping duplicate connection attempt');
      return;
    }

    try {
      connectionInProgressRef.current = true;
      console.log('🔌 Attempting WebSocket connection to:', url);
      const websocket = new WebSocket(url);

      websocket.onopen = () => {
        console.log('🔌 WebSocket connected to:', url);
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        connectionInProgressRef.current = false;

        websocket.send(JSON.stringify({ type: 'request_status' }));
      };

      websocket.onmessage = async (event) => {
        try {
          let message: WSMessage;

          // Handle binary data using unified binary protocol
          if (event.data instanceof Blob) {
            const arrayBuffer = await event.data.arrayBuffer();
            const parsedMessage = UnifiedBinaryProtocol.deserialize(arrayBuffer);
            
            if (parsedMessage) {
              message = {
                type: parsedMessage.type as any,
                data: parsedMessage.data,
                timestamp: parsedMessage.timestamp
              };
            } else {
              console.warn('Failed to parse binary message');
              return;
            }
          } else if (event.data instanceof ArrayBuffer) {
            // Handle direct ArrayBuffer
            const parsedMessage = UnifiedBinaryProtocol.deserialize(event.data);
            
            if (parsedMessage) {
              message = {
                type: parsedMessage.type as any,
                data: parsedMessage.data,
                timestamp: parsedMessage.timestamp
              };
            } else {
              console.warn('Failed to parse ArrayBuffer message');
              return;
            }
          } else if (typeof event.data === 'string') {
            // Fallback: Handle JSON data for backward compatibility
            message = JSON.parse(event.data);
          } else {
            console.warn('Received unknown message format:', typeof event.data);
            return;
          }

          setLastMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
          console.error('Message data type:', typeof event.data);
          console.error('Message data preview:', event.data instanceof ArrayBuffer ? 
            `ArrayBuffer(${event.data.byteLength} bytes)` : event.data);
        }
      };

      websocket.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
        setWs(null);
        connectionInProgressRef.current = false;

        if (reconnectAttemptsRef.current < CONSTANTS.WEBSOCKET.MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(CONSTANTS.WEBSOCKET.RECONNECT_DELAY_BASE * Math.pow(2, reconnectAttemptsRef.current), CONSTANTS.WEBSOCKET.MAX_RECONNECT_DELAY);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        connectionInProgressRef.current = false;
      };

      setWs(websocket);
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      connectionInProgressRef.current = false;
    }
  }, [url]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws) {
        ws.close();
      }
    };
  }, [connect]);

  return { isConnected, lastMessage };
};

// Device Management Component - Always Open
const DeviceManagement: React.FC<{
  allDevices: Map<string, DeviceStateMachine>;
  onScan: () => void;
  onCancelScan: () => void;
  onConnectDevice: (deviceId: string, deviceName: string) => void;
  onDisconnectDevice: (deviceId: string, deviceName: string) => void;
  onConnectAll: () => void;
  isScanning: boolean;
  onClearDevices: () => void;
  isRecording: boolean;
}> = ({ allDevices, onScan, onCancelScan, onConnectDevice, onDisconnectDevice, onConnectAll, isScanning, onClearDevices, isRecording }) => {

  const allDevicesArray = Array.from(allDevices.values());
  const connectedCount = allDevicesArray.filter(d => d.state === 'connected' || d.state === 'streaming').length;

  const getStateColor = (state: DeviceState) => {
    switch (state) {
      case 'discovered': return CONSTANTS.UI.COLORS.DISCOVERED;
      case 'connecting': return CONSTANTS.UI.COLORS.CONNECTING;
      case 'connected': return CONSTANTS.UI.COLORS.SUCCESS;
      case 'streaming': return CONSTANTS.UI.COLORS.STREAMING;
      case 'disconnected': return CONSTANTS.UI.COLORS.DISCONNECTED;
      case 'error': return CONSTANTS.UI.COLORS.ERROR;
      default: return CONSTANTS.UI.COLORS.DISCONNECTED;
    }
  };

  const getStateText = (state: DeviceState) => {
    switch (state) {
      case 'discovered': return 'Discovered';
      case 'connecting': return 'Connecting...';
      case 'connected': return 'Connected';
      case 'streaming': return 'Streaming';
      case 'disconnected': return 'Disconnected';
      case 'error': return 'Error';
      default: return 'Unknown';
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Device Management</h3>
            <p className="text-sm text-gray-500">Monitor and control your sensors</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {connectedCount > 0 ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-gray-400" />
              )}
              <span className="text-sm font-medium">{connectedCount}/{allDevicesArray.length}</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${
              connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                ? 'bg-green-500 text-white'
                : connectedCount > 0
                ? 'bg-amber-500 text-white'
                : 'bg-gray-200 text-gray-600'
            }`}>
              {connectedCount === allDevicesArray.length && allDevicesArray.length > 0
                ? 'All Connected'
                : connectedCount > 0
                ? 'Partial'
                : 'No Devices'}
            </span>
          </div>
        </div>

        {/* Connection Progress */}
        {allDevicesArray.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-600">Connection Progress</span>
              <span className="font-medium">{Math.round((connectedCount / allDevicesArray.length) * 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="h-2 rounded-full transition-all duration-300"
                style={{ 
                  width: `${(connectedCount / allDevicesArray.length) * 100}%`,
                  backgroundColor: CONSTANTS.UI.COLORS.PRIMARY
                }}
              />
            </div>
          </div>
        )}

        {/* Scan and Connect All Buttons */}
        {isScanning ? (
          <div className="space-y-2">
            <div className="w-full py-3 px-4 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              Scanning for Devices...
            </div>
            <button
              onClick={onCancelScan}
              className="w-full py-2 px-4 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors"
            >
              Cancel Scan
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={onScan}
              className="w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 bg-blue-500 hover:bg-blue-600 text-white shadow-md hover:shadow-lg"
            >
              {allDevicesArray.length > 0 ? (
                `📡 Scan for More Devices (${allDevicesArray.length} found)`
              ) : (
                '📡 Scan for Devices'
              )}
            </button>
            
            {/* Connect All Button */}
            {allDevicesArray.filter(d => d.state === 'discovered').length > 0 && (
              <button
                onClick={onConnectAll}
                className="w-full py-2 px-4 rounded-lg font-medium transition-all duration-200 bg-green-500 hover:bg-green-600 text-white shadow-md hover:shadow-lg text-sm"
              >
                🔗 Connect All ({allDevicesArray.filter(d => d.state === 'discovered').length} devices)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Device List */}
      <div className="p-6">
        {allDevicesArray.length > 0 ? (
          <div className="space-y-3">
            {allDevicesArray.map((device) => {
              const isLowBattery = device.batteryLevel !== null && device.batteryLevel !== undefined && device.batteryLevel < CONSTANTS.BATTERY.LOW_BATTERY_THRESHOLD;
              const canConnect = device.state === 'discovered' || device.state === 'disconnected';

              return (
                <div
                  key={device.id}
                  data-device-item="1"
                  className="flex items-center justify-between p-4 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors border"
                >
                  <div className="flex items-center gap-3">
                    {/* State Indicator */}
                    <div className={`w-3 h-3 rounded-full ${getStateColor(device.state)} ${
                      device.state === 'streaming' ? 'animate-pulse' : ''
                    }`} />

                    {/* Device Info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{device.name}</span>
                        {isRecording && device.state === 'streaming' && (
                          <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded flex items-center gap-1">
                            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                            REC
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span>{getStateText(device.state)}</span>
                        <span>•</span>
                        <span className="truncate">{device.id}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Battery Level */}
                    <div className="flex items-center gap-1">
                      {isLowBattery && (
                        <Zap className="h-3 w-3 text-amber-500" />
                      )}
                      <span className={`text-xs px-2 py-1 rounded border ${
                        device.state === 'connected' || device.state === 'streaming'
                          ? isLowBattery 
                            ? 'border-amber-500 text-amber-700 bg-amber-50' 
                            : 'border-green-500 text-green-700 bg-green-50'
                          : 'border-gray-300 text-gray-600 bg-white'
                      }`}>
                        {device.batteryLevel !== null && device.batteryLevel !== undefined
                          ? `${Math.round(device.batteryLevel)}%`
                          : '--'}
                      </span>
                    </div>

                    {/* Connect/Disconnect Buttons */}
                    {canConnect && (
                      <button
                        onClick={() => {
                          console.log('grosdode: Connecting to device:', device.name, device.id);
                          onConnectDevice(device.id, device.name);
                        }}
                        disabled={device.state === 'connecting'}
                        className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                          device.state === 'connecting'
                            ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                            : 'bg-[#FF4D35] hover:bg-[#e63e2b] text-white'
                        }`}
                      >
                        {device.state === 'connecting' ? (
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                            Connecting...
                          </div>
                        ) : (
                          'Connect'
                        )}
                      </button>
                    )}

                    {/* Disconnect Button */}
                    {(device.state === 'connected' || device.state === 'streaming') && (
                      <button
                        onClick={() => {
                          console.log('Disconnecting device:', device.name, device.id);
                          onDisconnectDevice(device.id, device.name);
                        }}
                        className="text-sm font-medium px-4 py-2 rounded-lg transition-colors bg-gray-500 hover:bg-gray-600 text-white"
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <WifiOff className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <h4 className="text-lg font-medium text-gray-900 mb-2">No Devices Found</h4>
            <p className="text-sm text-gray-500 mb-4">Click "Scan for Devices" to discover available sensors</p>
            <p className="text-xs text-gray-400">
              Make sure your Bluetooth is enabled and sensors are in pairing mode
            </p>
          </div>
        )}

        {/* Clear Devices Button */}
        {allDevicesArray.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={onClearDevices}
              className="w-full py-2 px-4 rounded-lg text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            >
              🗑️ Clear All Devices
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const RecordingControl: React.FC<{
  isRecording: boolean;
  onStartStop: () => void;
  connectedDevices: number;
}> = ({ isRecording, onStartStop, connectedDevices }) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const canRecord = connectedDevices > 0;

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Recording Control</h3>

      {isRecording && (
        <div className="mb-4 text-center">
          <div className="text-2xl font-mono font-bold text-[#FF4D35] mb-1">
            {formatDuration(duration)}
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            Recording in progress
          </div>
        </div>
      )}

      <div className="flex justify-center">
        <button
          onClick={onStartStop}
          disabled={!canRecord}
          className={`relative rounded-full h-16 w-16 transition-all duration-300 shadow-lg hover:shadow-xl ${
            isRecording
              ? 'bg-[#FF4D35] hover:bg-[#e63e2b] scale-110'
              : canRecord
                ? 'bg-[#FF4D35] hover:bg-green-500 hover:scale-105'
                : 'bg-gray-300 cursor-not-allowed opacity-50'
          }`}
        >
          {isRecording ? (
            <Pause className="h-6 w-6 text-white mx-auto" />
          ) : (
            <Play className="h-6 w-6 text-white mx-auto ml-1" />
          )}

          <div className="absolute inset-0 rounded-full bg-white opacity-0 hover:opacity-20 transition-opacity duration-300" />
        </button>
      </div>

      {!canRecord && (
        <p className="text-center text-sm text-gray-500 mt-3">
          Connect devices to start recording
        </p>
      )}
    </div>
  );
};

// Removed old MotionDataDisplay - now using EnhancedMotionDataDisplay component

const WindowControls: React.FC = () => {
  const handleMinimize = () => window.electronAPI?.window.minimize();
  const handleMaximize = () => window.electronAPI?.window.maximize();
  const handleClose = () => window.electronAPI?.window.close();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleMinimize}
        className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
      >
        <Minimize2 className="w-4 h-4 text-gray-600" />
      </button>
      <button
        onClick={handleMaximize}
        className="p-1.5 rounded-md hover:bg-gray-100 transition-colors"
      >
        <Maximize2 className="w-4 h-4 text-gray-600" />
      </button>
      <button
        onClick={handleClose}
        className="p-1.5 rounded-md hover:bg-red-100 transition-colors"
      >
        <X className="w-4 h-4 text-gray-600 hover:text-red-600" />
      </button>
    </div>
  );
};

const ElectronMotionApp: React.FC = () => {
  const [state, dispatch] = useReducer(appStateReducer, initialState);
  const wsRef = React.useRef<WebSocket | null>(null);
  const batteryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_COOLDOWN = 3000; // 3 seconds between scans

  useEffect(() => {
    console.log('🔵 RENDERER LOADED: Testing Web Bluetooth availability...');
    console.log('🔵 navigator.bluetooth available:', !!navigator.bluetooth);
    console.log('🔵 window.isSecureContext:', window.isSecureContext);
    console.log('🔵 window.location.href:', window.location.href);

    if (window.electronAPI) {
      window.electronAPI.motion.getWebSocketPort().then(port => {
        console.log('🌐 Got WebSocket port from main process:', port);
        dispatch({ type: 'SET_WS_PORT', payload: port });
      });
    } else {
      console.error('🌐 window.electronAPI not available');
    }
  }, []);

  const { isConnected, lastMessage } = useWebSocket(`ws://localhost:${state.wsPort}`);

  // Store WebSocket reference
  React.useEffect(() => {
    if (isConnected) {
      // Create a new WebSocket reference for sending data
      wsRef.current = new WebSocket(`ws://localhost:${state.wsPort}`);
      dispatch({ type: 'SET_WS_CONNECTED', payload: true });
    } else {
      dispatch({ type: 'SET_WS_CONNECTED', payload: false });
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isConnected, state.wsPort]);

  useEffect(() => {
    if (!lastMessage) return;

    try {
      switch (lastMessage.type) {
      case 'status_update': {
        const statusData: any = lastMessage.data as any;
        dispatch({ type: 'SET_STATUS', payload: statusData });
        const statusDevices = statusData.connectedDevices || [];
        statusDevices.forEach((device: DeviceInfo) => {
          const streaming = (device as any).streaming ? true : false;
          const deviceState: DeviceStateMachine = {
            id: device.id,
            name: device.name,
            state: device.connected ? (streaming ? 'streaming' : 'connected') : 'disconnected',
            batteryLevel: device.batteryLevel,
            lastSeen: new Date()
          };
          dispatch({ type: 'SET_DEVICE_STATE', payload: { deviceId: device.id, device: deviceState } });
        });
        dispatch({ type: 'SET_RECORDING', payload: { isRecording: !!statusData.isRecording } });
        break;
      }

      case 'device_status': {
        const devStatusData: any = lastMessage.data as any;
        const connectedDevices = devStatusData.connectedDevices || [];
        connectedDevices.forEach((device: DeviceInfo) => {
          const streaming = (device as any).streaming ? true : false;
          const deviceState: DeviceStateMachine = {
            id: device.id,
            name: device.name,
            state: device.connected ? (streaming ? 'streaming' : 'connected') : 'disconnected',
            batteryLevel: device.batteryLevel,
            lastSeen: new Date()
          };
          dispatch({ type: 'SET_DEVICE_STATE', payload: { deviceId: device.id, device: deviceState } });
          if (device.connected) {
            dispatch({ type: 'TRANSITION_FROM_CONNECTING', payload: { deviceId: device.id, newState: streaming ? 'streaming' : 'connected' } });
          }
        });
        break;
      }

      case 'scan_request': {
        const scanReq: any = lastMessage.data as any;
        console.log('📨 grosdode pattern: Received scan request');
        if (scanReq.action === 'trigger_bluetooth_scan') {
          console.log('📨 grosdode: Triggering simple Web Bluetooth scan...');
          (async () => {
            try {
              if (!navigator.bluetooth) {
                console.error('❌ Web Bluetooth not available');
                return;
              }
              await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID]
              });
            } catch (error: any) {
              console.log('📨 grosdode: Web Bluetooth triggered, main process should handle device selection');
              console.log(`📨 Error: ${error?.name} (expected for grosdode pattern)`);
            }
          })();
        }
        break;
      }

      case 'device_scan_result': {
        const data: any = lastMessage.data as any;
        try {
          const devices = data.devices || [];
          console.log(`📡 Scan result: ${data.success ? 'SUCCESS' : 'FAILED'} - ${devices.length} device(s) found`);
          if (devices.length > 0) {
            const newDevices = devices.filter((device: DeviceInfo) => !state.allDevices.has(device.id));
            if (newDevices.length > 0) {
              const sdkDevices = newDevices.map((device: DeviceInfo) => ({
                deviceId: device.id,
                deviceName: device.name
              }));
              museManager.addScannedDevices(sdkDevices);
            }
            devices.forEach((device: DeviceInfo) => {
              const existingDevice = state.allDevices.get(device.id);
              let deviceState: DeviceState = 'discovered';
              if (existingDevice) {
                if (existingDevice.state === 'connected' || existingDevice.state === 'streaming') {
                  const isActuallyConnected = museManager.isDeviceConnected(device.name);
                  const isActuallyStreaming = museManager.isDeviceStreaming(device.name);
                  if (isActuallyStreaming) deviceState = 'streaming';
                  else if (isActuallyConnected) deviceState = 'connected';
                  else deviceState = 'discovered';
                } else if (existingDevice.state === 'connecting') {
                  deviceState = 'connecting';
                } else {
                  deviceState = 'discovered';
                }
              }
              const newDeviceState: DeviceStateMachine = {
                id: device.id,
                name: device.name,
                state: deviceState,
                batteryLevel: device.batteryLevel || existingDevice?.batteryLevel || null,
                lastSeen: new Date()
              };
              dispatch({ type: 'SET_DEVICE_STATE', payload: { deviceId: device.id, device: newDeviceState } });
              console.log(`📱 ${existingDevice ? 'Updated' : 'Added'} device: ${device.name} (${deviceState})`);
            });
          } else {
            console.log('⚠️ No devices discovered - check Bluetooth settings');
          }
          dispatch({ type: 'SET_SCANNING', payload: false });
        } catch (error) {
          console.error('❌ Error processing scan result:', error);
          dispatch({ type: 'SET_SCANNING', payload: false });
        }
        break;
      }

      case 'motion_data':
        dispatch({ type: 'SET_MOTION_DATA', payload: lastMessage.data as any });
        break;

      case 'recording_state': {
        const recData: any = lastMessage.data as any;
        const newIsRecording = !!recData.isRecording;
        const startTime = newIsRecording && !state.recordingStartTime ? new Date() : (!newIsRecording ? null : undefined);
        dispatch({ type: 'SET_RECORDING', payload: { isRecording: newIsRecording, startTime } });
        break;
      }

      default:
        console.log('📨 Unhandled message type:', lastMessage.type);
      }
    } catch (error) {
      console.error('📨 Error processing WebSocket message:', error, lastMessage);
    }
  }, [lastMessage, state.recordingStartTime]);

  const handleScan = async () => {
    // Prevent multiple simultaneous scans
    if (state.isScanning) {
      console.log('⚠️ Scan already in progress, skipping...');
      return;
    }

    // Enforce cooldown period
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_COOLDOWN) {
      console.log(`⏳ Scan cooldown active (${Math.ceil((SCAN_COOLDOWN - (now - lastScanTimeRef.current)) / 1000)}s remaining)`);
      return;
    }

    lastScanTimeRef.current = now;
    console.log(`🔍 Starting device scan... (${state.allDevices.size} existing devices)`);
    
    dispatch({ type: 'SET_SCANNING', payload: true });

    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth not available');
      }

      // Create a timeout promise to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Scan timeout')), 5000);
      });

      // Race between Bluetooth scan and timeout
      await Promise.race([
        navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID]
        }),
        timeoutPromise
      ]);
      
      console.log('✅ Scan request completed - main process will handle device selection');
      
    } catch (error: any) {
      console.log(`🔍 Scan trigger: ${error.name} (expected for grosdode pattern)`);
      
      // Handle timeout specifically
      if (error.message === 'Scan timeout') {
        console.log('⏰ Scan timed out - this may be normal for auto-scans');
        dispatch({ type: 'SET_SCANNING', payload: false });
        return;
      }
      
      // Show user-friendly message for Windows Bluetooth issues
      const isWindowsBluetoothIssue = error?.name === 'NotFoundError' || 
                                      error?.name === 'NotAllowedError' || 
                                      error?.name === 'SecurityError' ||
                                      error?.message?.includes('chooser') ||
                                      error?.message?.includes('user gesture');
      
      if (!isWindowsBluetoothIssue) {
        console.error('❌ Unexpected scan error:', error);
        dispatch({ type: 'SET_SCANNING', payload: false });
        alert(`Scan error: ${error?.message || 'Unknown error'}`);
        return;
      }
    }
    
    // Timeout to stop scanning if no results
    setTimeout(() => {
      dispatch({ type: 'SET_SCANNING', payload: false });
    }, CONSTANTS.TIMEOUTS.SCAN_DURATION);
  };

  // Removed handleDirectBluetoothScan - only using Method 1 (grosdode pattern)

  const handleConnectDevice = async (deviceId: string, deviceName: string) => {
    console.log('🔗 grosdode + SDK: Starting connection flow for:', deviceName, deviceId);

    // Safety check: Prevent multiple simultaneous connection attempts
    const currentDevice = state.allDevices.get(deviceId);
    if (currentDevice?.state === 'connecting') {
      console.log('⚠️ Connection already in progress for device:', deviceName);
      return;
    }

    // Set device to connecting state
    dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { state: 'connecting' } } });

    try {
      console.log('🔗 Step 1: Acquire Web Bluetooth device via programmatic selection...');

      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth not available');
      }

      // Kick off requestDevice FIRST to trigger select-bluetooth-device event in main
      const requestPromise = navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [CONSTANTS.SERVICES.TROPX_SERVICE_UUID]
      });

      // Immediately instruct main process to select our target deviceId
      try {
        await window.electronAPI?.bluetooth?.selectDevice(deviceId);
      } catch (selectionError) {
        console.warn('🔗 Device selection warning (may be normal):', selectionError);
      }

      // Await the actual BluetoothDevice returned from requestDevice
      let webBtDevice: any = null;
      try {
        webBtDevice = await requestPromise as any;
        console.log('🔗 Web Bluetooth device acquired:', webBtDevice?.name, webBtDevice?.id);
      } catch (reqErr: any) {
        console.error('❌ requestDevice failed:', reqErr?.name || reqErr);
        // Fallbacks will handle pairing status below
      }

      console.log('🔗 Step 2: Connecting via SDK...');

      // If device already connected, clean up first
      if (museManager.isDeviceConnected(deviceName)) {
        console.log('🔗 Device already connected, cleaning up first...');
        await museManager.disconnectDevice(deviceName);
        await new Promise(resolve => setTimeout(resolve, CONSTANTS.TIMEOUTS.CONNECTION_CLEANUP));
      }

      let connected = false;

      // Preferred: If we obtained a Web Bluetooth device from requestDevice, connect with it directly
      if (webBtDevice) {
        try {
          connected = await museManager.connectWebBluetoothDevice(webBtDevice, CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT);
          console.log(`${connected ? '✅' : '❌'} Direct SDK connection via Web Bluetooth ${connected ? 'successful' : 'failed'}`);
        } catch (directErr) {
          console.warn('⚠️ Direct SDK connection via Web Bluetooth failed, will try fallbacks:', directErr);
        }
      }

      // Fallback 1: Fast reconnection using previously authorized devices
      if (!connected) {
        try {
          const previousDevices = await museManager.reconnectToPreviousDevices();
          const targetDevice = previousDevices.find(d => d.name === deviceName || d.id === deviceId);
          if (targetDevice) {
            console.log(`🚀 Attempting fast reconnection to ${deviceName}...`);
            connected = await museManager.connectWebBluetoothDevice(targetDevice as any, CONSTANTS.TIMEOUTS.FAST_CONNECTION_TIMEOUT);
            console.log(`${connected ? '✅' : '❌'} Fast reconnection ${connected ? 'successful' : 'failed'}`);
          }
        } catch (reconnectError) {
          console.log('⚠️ Fast reconnection failed:', reconnectError);
        }
      }

      // Fallback 2: Standard SDK connection via registry + getDevices
      if (!connected) {
        console.log(`🔗 Trying standard SDK connection for ${deviceName}...`);

        // Clear any stale device state that might interfere
        if (museManager.isDeviceConnected(deviceName)) {
          await museManager.disconnectDevice(deviceName);
          await new Promise(resolve => setTimeout(resolve, CONSTANTS.TIMEOUTS.CONNECTION_CLEANUP));
        }

        connected = await museManager.connectToScannedDevice(deviceId, deviceName);
        console.log(`${connected ? '✅' : '❌'} Standard SDK connection ${connected ? 'successful' : 'failed'}`);
      }

      if (connected) {
        console.log('✅ SDK connection established for:', deviceName);

        // Trigger device discovery after successful connection
        setTimeout(async () => {
          try {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'trigger_device_discovery',
                data: {
                  action: 'post_connection_scan',
                  message: 'Device discovery after successful connection',
                  deviceName: deviceName,
                  deviceId: deviceId
                },
                timestamp: Date.now()
              }));
              console.log('🔄 Triggered post-connection device discovery');
            }
          } catch (error: any) {
            console.error('❌ Failed to trigger device discovery:', error);
          }
        }, CONSTANTS.TIMEOUTS.DEVICE_DISCOVERY_TRIGGER);

        // Update battery levels
        await museManager.updateBatteryLevel(deviceName);
        const batteryLevel = museManager.getBatteryLevel(deviceName);

        // Update unified device state with successful connection
        dispatch({ type: 'TRANSITION_FROM_CONNECTING', payload: { deviceId, newState: 'connected' } });
        dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { batteryLevel } } });

        console.log('✅ SDK connection completed with battery info');

        // Update battery levels periodically
        startBatteryUpdateTimer();

      } else {
        console.log(`💥 Attempting final connection with full reset for ${deviceName}...`);

        try {
          // Nuclear option: clear all device state
          await museManager.forceResetAllDeviceState();
          await new Promise(resolve => setTimeout(resolve, CONSTANTS.TIMEOUTS.FINAL_RESET_WAIT));

          // Re-add the device to scanned devices since we cleared everything
          museManager.addScannedDevices([{
            deviceId: deviceId,
            deviceName: deviceName
          }]);

          const finalConnected = await museManager.connectToScannedDevice(deviceId, deviceName);
          if (finalConnected) {
            console.log(`✅ Final attempt successful for ${deviceName}`);
          } else {
            throw new Error(`All connection attempts failed for ${deviceName}`);
          }

        } catch (finalError) {
          throw new Error(`All connection attempts failed: ${finalError instanceof Error ? finalError.message : finalError}`);
        }
      }

    } catch (error) {
      console.error('❌ grosdode + SDK connection error:', error);

      // Clean up any partial state
      try {
        await museManager.disconnectDevice(deviceName);
      } catch (cleanupError) {
        console.warn('⚠️ Cleanup error:', cleanupError);
      }
      
      // More specific error handling
      if (error instanceof Error) {
        if (error.message.includes('not found in paired devices')) {
          // Special handling for unpaired devices
          const shouldPair = confirm(`${deviceName} needs to be paired first.\n\nClick OK to pair this device now, or Cancel to pair it manually through system Bluetooth settings.`);

          if (shouldPair) {
            try {
              console.log('🔗 User chose to pair device, starting pairing process...');
              const pairResult = await museManager.pairNewDevice();

              if (pairResult.success) {
                alert(`Success! ${pairResult.deviceName} is now paired. You can connect to it.`);
                // Refresh the scanned devices list
                window.location.reload();
              } else {
                alert(`Pairing failed: ${pairResult.message}`);
              }
            } catch (pairError) {
              alert(`Pairing error: ${pairError instanceof Error ? pairError.message : 'Unknown error'}`);
            }
          } else {
            alert(`Please pair ${deviceName} through Windows Bluetooth settings, then scan again.`);
          }
        } else if (error.message.includes('No device selected') || error.name === 'AbortError') {
          alert(`Device selection cancelled for ${deviceName}. Please try again.`);
        } else if (error.message.includes('GATT') || error.name === 'NetworkError') {
          alert(`Connection failed for ${deviceName}. Please ensure the device is powered on and in range.`);
        } else if (error.name === 'NotFoundError') {
          alert(`Device ${deviceName} not found. Please ensure it's powered on and try scanning again.`);
        } else {
          alert(`Failed to connect to ${deviceName}: ${error.message}`);
        }
      } else {
        alert(`Failed to connect to ${deviceName}. Please try again.`);
      }
    } finally {
      // Always reset device from connecting state if not actually connected
      const isConnectedNow = museManager.isDeviceConnected(deviceName);
      if (!isConnectedNow) {
        dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { state: 'discovered' } } });
      }
      console.log('🔗 Connection attempt completed for:', deviceName);
      
      // Auto-scan removed - was causing issues and not working properly
    }
  };

  // Battery update timer for connected devices
  const startBatteryUpdateTimer = () => {
    // Clear existing timer
    if (batteryTimerRef.current) {
      clearInterval(batteryTimerRef.current);
    }

    // Update battery levels periodically for connected devices
    batteryTimerRef.current = setInterval(async () => {
      try {
        await museManager.updateAllBatteryLevels();
        const allBatteryLevels = museManager.getAllBatteryLevels();

        // Update unified device state with new battery levels
        allBatteryLevels.forEach((batteryLevel, deviceName) => {
          // Find device by name and update its battery level
          const deviceEntry = Array.from(state.allDevices.entries()).find(([_, device]) => device.name === deviceName);
          if (deviceEntry) {
            const [deviceId] = deviceEntry;
            dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { batteryLevel } } });
          }
        });

        console.log(`🔋 Updated battery levels for ${allBatteryLevels.size} devices`);

      } catch (error) {
        console.error('❌ Battery update timer error:', error);
      }
    }, CONSTANTS.BATTERY.UPDATE_INTERVAL);

    console.log('✅ Battery update timer started');
  };

  // Cancel current scan
  const cancelScan = () => {
    console.log('🚫 Canceling current scan...');
    
    // Clear scan timeout
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    
    // Set scanning to false
    dispatch({ type: 'SET_SCANNING', payload: false });
    
    // Try to cancel scan in main process if possible
    // Note: This is a nice-to-have since the main process has its own timeout
    console.log('🚫 Scan canceled by user');
  };

  // Old streaming function removed - now handled by BluetoothGATTService



  const handleRecording = async () => {
    try {
      const currentStreamingState = museManager.getIsStreaming();
      console.log(`🎬 RECORDING STATE CHANGE: isRecording=${state.isRecording}, SDK streaming=${currentStreamingState}`);

      if (state.isRecording) {
        // Stop recording and streaming
        console.log('🛑 Stopping recording and real quaternion streaming...');

        // 1. Stop real quaternion streaming via GATT service - check state first
        if (currentStreamingState) {
          console.log('🛑 SDK streaming is active, stopping...');
          await museManager.stopStreaming();
          console.log('✅ SDK streaming stopped');
        } else {
          console.log('⚠️ SDK streaming was already stopped');
        }

        // 2. Stop motion processing coordinator recording
        if (motionProcessingCoordinator) {
          await motionProcessingCoordinator.stopRecording();
          console.log('✅ Motion processing recording stopped');
        }

        // 3. Stop recording in main process (if available)
        if (window.electronAPI) {
          const result = await window.electronAPI.motion.stopRecording();
          console.log('✅ Stop recording result:', result);
        }

        // Update recording state immediately
        dispatch({ type: 'SET_RECORDING', payload: { isRecording: false, startTime: null } });

        // Update all devices to stop streaming state
        state.allDevices.forEach((device, deviceId) => {
          if (device.state === 'streaming') {
            dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { state: 'connected' } } });
          }
        });

        console.log('✅ Recording and streaming stopped successfully');

      } else {
        // Start recording and streaming
        console.log('🎬 Starting recording with real quaternion streaming...');

        // Check connected devices
        const connectedDevices = museManager.getConnectedDevices();
        console.log('🔍 Connected devices for recording:', connectedDevices);

        if (connectedDevices.size === 0) {
          console.error('❌ No connected devices found for recording');
          alert('Please connect at least one device before recording');
          return;
        }

        // 1. Initialize motion processing coordinator if not already done
        if (!motionProcessingCoordinator) {
          console.log('🧠 Initializing MotionProcessingCoordinator...');
          motionProcessingCoordinator = MotionProcessingCoordinator.getInstance();
          console.log('✅ MotionProcessingCoordinator initialized successfully');
        }

        // 2. Start motion processing recording session
        const sessionData = {
          sessionId: `session_${Date.now()}`,
          exerciseId: `exercise_${Date.now()}`,
          setNumber: 1
        };

        const motionRecordingStarted = motionProcessingCoordinator.startRecording(
          sessionData.sessionId,
          sessionData.exerciseId,
          sessionData.setNumber
        );

        if (!motionRecordingStarted) {
          console.error('❌ Failed to start motion processing recording');
          return;
        }

        console.log('✅ Motion processing recording started');

        // 3. Start real quaternion streaming via GATT service
        const streamingSuccess = await museManager.startStreaming(
          (deviceName: string, data: any) => {
            // Send data to motion processing pipeline
            if (motionProcessingCoordinator) {
              try {
                motionProcessingCoordinator.processNewData(deviceName, data);
              } catch (error) {
                console.error('❌ Error processing SDK motion data:', error);
              }
            }

            // Also send to main process via WebSocket for recording/storage
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'motion_data',
                data: {
                  deviceName: deviceName,
                  timestamp: data.timestamp,
                  quaternion: data.quaternion
                },
                timestamp: Date.now()
              }));
            }
          }
        );

        if (streamingSuccess) {
          console.log('✅ SDK quaternion streaming started successfully');

          // Update recording state immediately
          dispatch({ type: 'SET_RECORDING', payload: { isRecording: true, startTime: new Date() } });

          // Update devices to show streaming state - only for devices that are actually streaming
          const streamingDeviceNames = museManager.getStreamingDeviceNames();
          console.log('📡 Devices now streaming:', streamingDeviceNames);
          
          // Update unified device state for streaming devices
          state.allDevices.forEach((device, deviceId) => {
            if (streamingDeviceNames.includes(device.name) && device.state === 'connected') {
              dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { state: 'streaming' } } });
            }
          });

          // 4. Start recording in main process (for storage/backup)
          if (window.electronAPI) {
            const result = await window.electronAPI.motion.startRecording(sessionData);
            console.log('✅ Main process recording result:', result);
          }

          console.log('✅ SDK: Recording with quaternion streaming started successfully');

        } else {
          console.error('❌ Failed to start SDK quaternion streaming');

          // Clean up motion processing recording if streaming failed
          if (motionProcessingCoordinator) {
            await motionProcessingCoordinator.stopRecording();
          }

          // Ensure recording state remains false on failure
          dispatch({ type: 'SET_RECORDING', payload: { isRecording: false, startTime: null } });
          
          alert('Failed to start quaternion streaming. Please check device connections.');
        }
      }
    } catch (error) {
      console.error('❌ Recording error:', error);
      
      // Ensure clean state on error
      dispatch({ type: 'SET_RECORDING', payload: { isRecording: false, startTime: null } });
      
      // Stop any partial streaming that might have started
      try {
        await museManager.stopStreaming();
      } catch (stopError) {
        console.warn('⚠️ Error stopping streaming during cleanup:', stopError);
      }
      
      alert(`Recording error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };


  const connectedCount = Array.from(state.allDevices.values()).filter(d => d.state === 'connected' || d.state === 'streaming').length;

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup battery timer
      if (batteryTimerRef.current) {
        clearInterval(batteryTimerRef.current);
      }
      // Cleanup scan timeout
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
      
      // Stop streaming if active on component unmount
      if (museManager.getIsStreaming()) {
        console.log('🧹 Component unmounting, stopping active streaming...');
        museManager.stopStreaming().catch(error =>
          console.warn('⚠️ Error stopping streaming during unmount:', error)
        );
      }
    };
  }, []);

  // Helper function to clear all devices
  const handleClearDevices = () => {
    console.log('🗑️ Clearing all device lists');
    dispatch({ type: 'CLEAR_ALL_DEVICES' });
  };

  // Function to disconnect a device
  const handleDisconnectDevice = async (deviceId: string, deviceName: string) => {
    console.log('🔌 Disconnecting device:', deviceName, deviceId);
    
    try {
      // Disconnect via SDK
      await museManager.disconnectDevice(deviceName);
      
      // Update device state
      dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId, updates: { state: 'discovered' } } });
      
      console.log('✅ Device disconnected successfully:', deviceName);
    } catch (error) {
      console.error('❌ Failed to disconnect device:', error);
      alert(`Failed to disconnect ${deviceName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Function to connect all discovered devices
  const handleConnectAll = async () => {
    const discoveredDevices = Array.from(state.allDevices.values()).filter(d => d.state === 'discovered');
    if (discoveredDevices.length === 0) {
      alert('No devices available to connect');
      return;
    }
    console.log(`🔗 Connecting to ${discoveredDevices.length} devices...`);
    // Connect sequentially to avoid concurrent Web Bluetooth chooser conflicts
    for (const device of discoveredDevices) {
      // Update UI state to connecting
      dispatch({ type: 'UPDATE_DEVICE', payload: { deviceId: device.id, updates: { state: 'connecting' } } });
      try {
        await handleConnectDevice(device.id, device.name);
      } catch (error) {
        console.error(`❌ Connection failed for ${device.name}:`, error);
      }
    }
    console.log('✅ All connection attempts completed');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between drag-region">
        <div className="flex items-center gap-3">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: CONSTANTS.UI.COLORS.PRIMARY }}
          >
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Motion Capture</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className={`w-2 h-2 rounded-full ${state.isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {state.isConnected ? 'Connected' : 'Disconnected'}
          </div>
          <WindowControls />
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <DeviceManagement
            allDevices={state.allDevices}
            onScan={handleScan}
            onCancelScan={cancelScan}
            onConnectDevice={handleConnectDevice}
            onDisconnectDevice={handleDisconnectDevice}
            onConnectAll={handleConnectAll}
            isScanning={state.isScanning}
            onClearDevices={handleClearDevices}
            isRecording={state.isRecording}
          />

          <RecordingControl
            isRecording={state.isRecording}
            onStartStop={handleRecording}
            connectedDevices={connectedCount}
          />
        </div>

        <EnhancedMotionDataDisplay
          data={state.motionData}
          isRecording={state.isRecording}
          recordingStartTime={state.recordingStartTime}
        />

        <div className="mt-6 bg-white rounded-xl shadow-lg p-4 border border-gray-200">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>
              Status: <span className="font-medium">{state.status?.isInitialized ? 'Ready' : 'Initializing'}</span>
            </div>
            <div>
              WebSocket: <span className="font-medium">{state.isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div>
              Clients: <span className="font-medium">{state.status?.clientCount || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ElectronMotionApp;

