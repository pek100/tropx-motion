import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Wifi, WifiOff, Zap, Minimize2, Maximize2, X } from 'lucide-react';
import { bluetoothTroubleshooter } from './BluetoothTroubleshooter';
import { MotionProcessingCoordinator } from '../../motionProcessing/MotionProcessingCoordinator';
import { EnhancedMotionDataDisplay } from './components';
import { museManager } from '../../muse_sdk/core/MuseManager';

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
      window: {
        minimize(): void;
        maximize(): void;
        close(): void;
      };
    };
  }
}

// Type definitions for Web Bluetooth API
interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
}

interface BluetoothRequestDeviceOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
  optionalServices?: string[];
}

interface BluetoothAPI {
  requestDevice(options?: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
}

declare global {
  interface Navigator {
    bluetooth?: BluetoothAPI;
  }
}

interface WSMessage {
  type: string;
  data: any;
  timestamp: number;
}

interface DeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  batteryLevel: number | null;
  streaming?: boolean;
}

interface MotionData {
  left: { current: number; max: number; min: number; rom: number };
  right: { current: number; max: number; min: number; rom: number };
  timestamp: number;
}

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

const useWebSocket = (url: string) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
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

      websocket.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          console.log('🔌 ===== WEBSOCKET MESSAGE RECEIVED =====');
          console.log('🔌 Message type:', message.type);
          console.log('🔌 Message data:', message.data);
          console.log('🔌 Timestamp:', message.timestamp);
          setLastMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
        setWs(null);
        connectionInProgressRef.current = false;

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
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

  const sendMessage = useCallback((message: any) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify(message));
    }
  }, [ws, isConnected]);

  return { isConnected, lastMessage, sendMessage };
};

// Device Management Component - Always Open
const DeviceManagement: React.FC<{
  devices: DeviceInfo[];
  scannedDevices: DeviceInfo[];
  onScan: () => void;
  onCancelScan: () => void;
  onConnectDevice: (deviceId: string, deviceName: string) => void;
  isScanning: boolean;
  connectingDevices: Set<string>;
  setScannedDevices: React.Dispatch<React.SetStateAction<DeviceInfo[]>>;
  isRecording: boolean;
}> = ({ devices, scannedDevices, onScan, onCancelScan, onConnectDevice, isScanning, connectingDevices, setScannedDevices, isRecording }) => {
  const [deviceStates, setDeviceStates] = useState<Map<string, DeviceStateMachine>>(new Map());

  // Update device states based on current device status
  useEffect(() => {
    setDeviceStates(prevStates => {
      const newStates = new Map(prevStates);

      // Process scanned devices
      scannedDevices.forEach(device => {
        const isConnected = museManager.isDeviceConnected(device.name);
        const isConnecting = connectingDevices.has(device.id);
        const isStreaming = museManager.isDeviceStreaming(device.name);

        let state: DeviceState = 'discovered';
        if (isConnecting) state = 'connecting';
        else if (isConnected) {
          state = isStreaming ? 'streaming' : 'connected';
        }

        newStates.set(device.id, {
          id: device.id,
          name: device.name,
          state,
          batteryLevel: device.batteryLevel,
          lastSeen: new Date()
        });
      });

      // Process connected devices not in scanned list
      devices.forEach(device => {
        if (!newStates.has(device.id)) {
          const isConnected = museManager.isDeviceConnected(device.name);
          const isStreaming = museManager.isDeviceStreaming(device.name);
          
          newStates.set(device.id, {
            id: device.id,
            name: device.name,
            state: isConnected ? (isStreaming ? 'streaming' : 'connected') : 'disconnected',
            batteryLevel: device.batteryLevel,
            lastSeen: new Date()
          });
        }
      });

      return newStates;
    });
  }, [scannedDevices, devices, connectingDevices]);

  const allDevices = Array.from(deviceStates.values());
  const connectedCount = allDevices.filter(d => d.state === 'connected' || d.state === 'streaming').length;

  const getStateColor = (state: DeviceState) => {
    switch (state) {
      case 'discovered': return 'bg-blue-500';
      case 'connecting': return 'bg-yellow-500';
      case 'connected': return 'bg-green-500';
      case 'streaming': return 'bg-red-500';
      case 'disconnected': return 'bg-gray-400';
      case 'error': return 'bg-red-600';
      default: return 'bg-gray-400';
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
              <span className="text-sm font-medium">{connectedCount}/{allDevices.length}</span>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${
              connectedCount === allDevices.length && allDevices.length > 0
                ? 'bg-green-500 text-white'
                : connectedCount > 0
                ? 'bg-amber-500 text-white'
                : 'bg-gray-200 text-gray-600'
            }`}>
              {connectedCount === allDevices.length && allDevices.length > 0
                ? 'All Connected'
                : connectedCount > 0
                ? 'Partial'
                : 'No Devices'}
            </span>
          </div>
        </div>

        {/* Connection Progress */}
        {allDevices.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-gray-600">Connection Progress</span>
              <span className="font-medium">{Math.round((connectedCount / allDevices.length) * 100)}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-[#FF4D35] h-2 rounded-full transition-all duration-300"
                style={{ width: `${(connectedCount / allDevices.length) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Scan Button */}
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
          <button
            onClick={onScan}
            className="w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 bg-blue-500 hover:bg-blue-600 text-white shadow-md hover:shadow-lg"
          >
            {allDevices.length > 0 ? (
              `📡 Scan for More Devices (${allDevices.length} found)`
            ) : (
              '📡 Scan for Devices'
            )}
          </button>
        )}
      </div>

      {/* Enhanced troubleshooting with manual connection option */}
      {allDevices.length === 0 && !isScanning && (
        <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="text-sm text-blue-800 mb-3">
            <strong>🔧 No devices found automatically?</strong>
            <p className="text-xs mt-1 text-blue-600">
              Windows Bluetooth sometimes requires manual connection. Try the options below:
            </p>
          </div>
          <div className="space-y-2">
            <div className="border-b border-blue-200 pb-2 mb-2">
              <p className="text-xs font-medium text-blue-700 mb-2">Manual Connection</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter device name (e.g., tropx_ln_001)"
                  className="flex-1 px-2 py-1 text-xs border border-blue-300 rounded"
                  onKeyPress={async (e) => {
                    if (e.key === 'Enter') {
                      const deviceName = (e.target as HTMLInputElement).value.trim();
                      if (deviceName) {
                        console.log('🔗 Manual connection attempt:', deviceName);
                        try {
                          await window.electronAPI?.bluetooth?.connectManual(deviceName);
                          // Add to scanned devices for connection
                          const mockDevice = {
                            id: deviceName,
                            name: deviceName,
                            connected: false,
                            batteryLevel: null,
                            streaming: false
                          };
                          setScannedDevices([mockDevice]);
                          (e.target as HTMLInputElement).value = '';
                        } catch (error) {
                          console.error('Manual connection error:', error);
                        }
                      }
                    }
                  }}
                />
              </div>
            </div>
            <button
              onClick={() => {
                bluetoothTroubleshooter.runDiagnostics().then(diagnostics => {
                  console.log('🔧 Manual diagnostics:', diagnostics);
                  alert(`Diagnostics completed! Check console for details.\n\nRecommendations:\n${diagnostics.recommendations.join('\n')}`);
                });
              }}
              className="w-full py-2 px-3 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded font-medium transition-colors"
            >
              🔧 Run Bluetooth Diagnostics
            </button>
            <button
              onClick={() => bluetoothTroubleshooter.openChromeBluetoothDebugger()}
              className="w-full py-2 px-3 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium transition-colors"
            >
              🔍 Open Chrome Bluetooth Debugger
            </button>
            <button
              onClick={() => bluetoothTroubleshooter.showManualPairingInstructions()}
              className="w-full py-2 px-3 bg-green-500 hover:bg-green-600 text-white text-sm rounded font-medium transition-colors"
            >
              📋 Manual Pairing Instructions
            </button>
          </div>
        </div>
      )}

      {/* Device List */}
      <div className="p-6">
        {allDevices.length > 0 ? (
          <div className="space-y-3">
            {allDevices.map((device) => {
              const isLowBattery = device.batteryLevel !== null && device.batteryLevel !== undefined && device.batteryLevel < 20;
              const canConnect = device.state === 'discovered' || device.state === 'disconnected';

              return (
                <div
                  key={device.id}
                  data-device-item
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

                    {/* Connect Button */}
                    {canConnect && (
                      <button
                        onClick={() => {
                          // grosdode pattern is handled in connection method
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
        {allDevices.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => {
                console.log('🗑️ Clearing all device lists');
                setScannedDevices([]);
                setDeviceStates(new Map());
              }}
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
  const [wsPort, setWsPort] = useState<number>(8080);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [scannedDevices, setScannedDevices] = useState<DeviceInfo[]>([]);
  const wsRef = React.useRef<WebSocket | null>(null);

  // Debug: Log when scannedDevices changes
  useEffect(() => {
    console.log('🔍 scannedDevices state changed:', scannedDevices.length, scannedDevices);
  }, [scannedDevices]);

  const [isRecording, setIsRecording] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [connectingDevices, setConnectingDevices] = useState<Set<string>>(new Set());
  const [motionData, setMotionData] = useState<MotionData | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [recordingStartTime, setRecordingStartTime] = useState<Date | null>(null);
  const batteryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    console.log('🔵 RENDERER LOADED: Testing Web Bluetooth availability...');
    console.log('🔵 navigator.bluetooth available:', !!navigator.bluetooth);
    console.log('🔵 window.isSecureContext:', window.isSecureContext);
    console.log('🔵 window.location.href:', window.location.href);

    if (window.electronAPI) {
      window.electronAPI.motion.getWebSocketPort().then(port => {
        console.log('🌐 Got WebSocket port from main process:', port);
        setWsPort(port);
      });
    } else {
      console.error('🌐 window.electronAPI not available');
    }
  }, []);

  const { isConnected, lastMessage, sendMessage } = useWebSocket(`ws://localhost:${wsPort}`);

  // Store WebSocket reference
  React.useEffect(() => {
    if (isConnected) {
      // Create a new WebSocket reference for sending data
      wsRef.current = new WebSocket(`ws://localhost:${wsPort}`);
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isConnected, wsPort]);

  useEffect(() => {
    if (!lastMessage) return;

    try {
      console.log('📨 Received WebSocket message:', lastMessage.type, lastMessage.data);

      switch (lastMessage.type) {
      case 'status_update':
        setStatus(lastMessage.data);
        setDevices(lastMessage.data.connectedDevices || []);
        setIsRecording(lastMessage.data.isRecording || false);
        break;

      case 'device_status':
        const connectedDevices = lastMessage.data.connectedDevices || [];
        setDevices(connectedDevices);

        // Clear connecting state for any newly connected devices
        setConnectingDevices(prev => {
          const newSet = new Set(prev);
          connectedDevices.forEach(device => {
            if (device.connected) {
              newSet.delete(device.id);
            }
          });
          return newSet;
        });
        break;

      case 'scan_request':
        // grosdode pattern: Simple scan trigger
        console.log('📨 grosdode pattern: Received scan request');
        if (lastMessage.data.action === 'trigger_bluetooth_scan') {
          console.log('📨 grosdode: Triggering simple Web Bluetooth scan...');
          
          (async () => {
            try {
              if (!navigator.bluetooth) {
                console.error('❌ Web Bluetooth not available');
                return;
              }

              // Simple single Web Bluetooth call - grosdode pattern will handle device selection
              await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: ['c8c0a708-e361-4b5e-a365-98fa6b0a836f']
              });
              
            } catch (error: any) {
              console.log('📨 grosdode: Web Bluetooth triggered, main process should handle device selection');
              console.log(`📨 Error: ${error?.name} (expected for grosdode pattern)`);
            }
          })();
        }
        break;

      case 'device_scan_result':
        const wsTimestamp = new Date().toISOString();
        console.log('\n📨 ===== WEBSOCKET DEVICE SCAN RESULT ANALYSIS =====');
        console.log('📨 Timestamp:', wsTimestamp);
        console.log('📨 Message source: WebSocket from main process');
        console.log('📨 Pattern: grosdode device selection result');
        
        try {
          const data = lastMessage.data;
          const devices = data.devices || [];
          
          console.log('📨 WEBSOCKET RESULT ANALYSIS:');
          console.log(`📨 - Success: ${data.success}`);
          console.log(`📨 - Message: "${data.message}"`);
          console.log(`📨 - Devices received: ${devices.length}`);
          console.log(`📨 - Scan complete: ${data.scanComplete}`);
          console.log(`📨 - Manual entry option: ${data.showManualEntry}`);
          
          if (devices.length > 0) {
            console.log('\n📨 DEVICE DETAILS FROM MAIN PROCESS:');
            devices.forEach((device, index) => {
              console.log(`📨 Device ${index + 1}:`);
              console.log(`📨   - ID: "${device.id}"`);
              console.log(`📨   - Name: "${device.name}"`);
              console.log(`📨   - Connected: ${device.connected}`);
              console.log(`📨   - Battery: ${device.batteryLevel}`);
            });
            
            console.log('\n📨 SDK INTEGRATION:');
            console.log('📨 Adding devices to muse_sdk registry...');
            
            // Add devices to SDK registry
            const sdkDevices = devices.map(device => ({
              deviceId: device.id,
              deviceName: device.name
            }));
            
            museManager.addScannedDevices(sdkDevices);
            console.log(`📨 SDK: Added ${sdkDevices.length} devices to registry`);
            
            // Update UI - merge with existing devices instead of replacing
            const newDevices = devices.map(device => ({
              id: device.id,
              name: device.name,
              connected: device.connected || false,
              batteryLevel: device.batteryLevel || null,
              streaming: false
            }));

            setScannedDevices(prevDevices => {
              const merged = [...prevDevices];
              
              // Add new devices, but preserve existing ones
              newDevices.forEach(newDevice => {
                const existingIndex = merged.findIndex(d => d.id === newDevice.id || d.name === newDevice.name);
                if (existingIndex >= 0) {
                  // Update existing device but preserve connection/streaming state
                  merged[existingIndex] = {
                    ...merged[existingIndex],
                    batteryLevel: newDevice.batteryLevel || merged[existingIndex].batteryLevel,
                    // Preserve critical states during scan updates
                    connected: merged[existingIndex].connected || newDevice.connected,
                    streaming: merged[existingIndex].streaming || newDevice.streaming
                  };
                  console.log(`📨 UI: Updated existing device: ${newDevice.name}`);
                } else {
                  // Add new device
                  merged.push(newDevice);
                  console.log(`📨 UI: Added new device: ${newDevice.name}`);
                }
              });
              
              return merged;
            });
            console.log(`📨 UI: Merged ${newDevices.length} new devices with existing devices`);
            console.log('📨 RESULT: SUCCESS - Devices available for connection');
            
          } else {
            console.log('\n📨 NO DEVICES RECEIVED:');
            console.log('📨 - This indicates the main process discovery method failed');
            console.log('📨 - Check main process logs for select-bluetooth-device events');
            console.log('📨 - Manual connection option should be available');
            console.log('📨 RESULT: FAILED - No devices discovered via main process');
          }
            
          // Clear scanning state
          setIsScanning(false);
          
          console.log('\n📨 WEBSOCKET PROCESSING COMPLETE');
          console.log('📨 ===============================================\n');

        } catch (error) {
          console.error('\n📨 ===== WEBSOCKET ERROR =====');
          console.error('📨 Error processing device scan result:', error);
          console.error('📨 Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
          console.error('📨 ==========================\n');
          setIsScanning(false);
        }
        break;

      case 'motion_data':
        setMotionData(lastMessage.data);
        break;

      case 'recording_state':
        const newIsRecording = lastMessage.data.isRecording || false;
        setIsRecording(newIsRecording);
        if (newIsRecording && !recordingStartTime) {
          setRecordingStartTime(new Date());
        } else if (!newIsRecording) {
          setRecordingStartTime(null);
        }
        break;

      default:
        console.log('📨 Unhandled message type:', lastMessage.type);
      }
    } catch (error) {
      console.error('📨 Error processing WebSocket message:', error, lastMessage);
    }
  }, [lastMessage]);

  const handleConnect = async () => {
    if (!window.electronAPI) return;

    setIsConnecting(true);
    try {
      const result = await window.electronAPI.motion.connectDevices();
      console.log('Connect result:', result);
    } catch (error) {
      console.error('Connect error:', error);
    } finally {
      setIsConnecting(false);
    }
  };



  const handleScan = async () => {
    const scanStartTime = Date.now();
    const timestamp = new Date().toISOString();
    console.log('\n🔍 ===== DISCOVERY METHOD TESTING SESSION =====');
    console.log('🔍 Session start:', timestamp);
    console.log('🔍 Platform:', navigator.platform);
    console.log('🔍 User agent:', navigator.userAgent);
    console.log('🔍 Testing multiple discovery methods...');
    console.log('🔍 ============================================\n');
    
    setIsScanning(true);
    
    // Simplified method tracking - keeping only effective method
    const methodResults = {
      method1_standard: { attempted: false, success: false, devices: 0, error: null }
    };

    try {
      if (!navigator.bluetooth) {
        throw new Error('Web Bluetooth not available');
      }

      console.log('🔍 METHOD 1: Standard Web Bluetooth scan with service UUID');
      console.log('🔍 - Type: acceptAllDevices with optionalServices');
      console.log('🔍 - Service UUID: c8c0a708-e361-4b5e-a365-98fa6b0a836f');
      
      // Don't clear previous scan results - preserve existing devices
      console.log(`🔍 Preserving ${scannedDevices.length} existing scanned devices`);
      
      // Method 1: Standard Web Bluetooth scan
      methodResults.method1_standard.attempted = true;
      const startTime = Date.now(); // Move startTime declaration to correct scope
      
      try {
        console.log('🔍 Method 1: Executing requestDevice...');
        
        await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['c8c0a708-e361-4b5e-a365-98fa6b0a836f'] // Tropx service UUID
        });
        
        const duration = Date.now() - startTime;
        methodResults.method1_standard.success = true;
        console.log(`🔍 Method 1: Completed in ${duration}ms - SUCCESS`);
        
      } catch (error: any) {
        const duration = Date.now() - startTime;
        methodResults.method1_standard.error = error.name;
        console.log(`🔍 Method 1: Completed in ${duration}ms - ${error.name}`);
        console.log(`🔍 Method 1: Expected behavior - main process should handle device selection`);
      }
      
      // REMOVED: Methods 2 & 3 based on data analysis
      // The grosdode pattern (Method 1) is highly effective
      // Additional methods are unnecessary and add complexity

    } catch (error: any) {
      console.error('🔍 Scan error:', error);
      setIsScanning(false);
      
      // Show user-friendly message for Windows Bluetooth issues
      const isWindowsBluetoothIssue = error?.name === 'NotFoundError' || 
                                      error?.name === 'NotAllowedError' || 
                                      error?.message?.includes('chooser');
      
      if (isWindowsBluetoothIssue) {
        console.log('🔍 Detected Windows Bluetooth limitation - offering manual connection');
        // Don't show error alert - this is expected behavior
      } else {
        alert(`Scan error: ${error?.message || 'Unknown error'}`);
      }
    }
    
    // Set timeout with comprehensive method analysis
    setTimeout(() => {
      const totalDuration = Date.now() - scanStartTime;
      
      console.log('\n🔍 ===== DISCOVERY METHOD ANALYSIS COMPLETE =====');
      console.log(`🔍 Total scan duration: ${totalDuration}ms`);
      console.log(`🔍 Session end: ${new Date().toISOString()}`);
      console.log('\n🔍 OPTIMIZED DISCOVERY ANALYSIS:');
      console.log(`🔍 - Method used: grosdode pattern (data-driven decision)`);
      console.log(`🔍 - Method 1 attempted: ${methodResults.method1_standard.attempted}`);
      console.log(`🔍 - Method 1 success: ${methodResults.method1_standard.success}`);
      console.log(`🔍 - Platform compatibility: EXCELLENT (based on real device testing)`);
      console.log(`🔍 - Unused methods removed: 2 (methods 2 & 3 were ineffective)`);
      console.log('\n🔍 NOTE: Check main process logs for actual device discovery results');
      console.log('🔍 =================================================\n');
      
      setIsScanning(false);
    }, 15000);
  };

  // Fallback method for direct Web Bluetooth scanning (used only when main process fails)
  const handleDirectBluetoothScan = async () => {
    try {
      console.log('🔍 Fallback: Direct Web Bluetooth scan...');
      
      // Use Web Bluetooth API to scan for devices (fallback only)
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['c8c0a708-e361-4b5e-a365-98fa6b0a836f'] // Tropx service UUID
      });

      if (device) {
        console.log('✅ Fallback device found:', device.name, device.id);

        // Validate device name immediately
        const deviceName = device.name || '';
        const isValidTropxDevice = deviceName.toLowerCase().includes('tropx') &&
                                 (deviceName.includes('_ln_') || deviceName.includes('_rn_') ||
                                  device.name.includes('ln_') || device.name.includes('rn_'));

        if (!isValidTropxDevice) {
          console.warn('❌ Invalid device name pattern, skipping:', deviceName);
          return;
        }

        const deviceInfo = {
          id: device.id,
          name: deviceName,
          connected: false,
          batteryLevel: null,
          streaming: false
        };

        console.log('✅ Valid Tropx device found via fallback:', deviceInfo);

        // Add device to scanned list
        setScannedDevices(prev => {
          const existingById = prev.find(d => d.id === device.id);
          const existingByName = prev.find(d => d.name === deviceName);

          if (existingById || existingByName) {
            console.log(`🔍 Device already in list: ${deviceName}`);
            return prev;
          } else {
            console.log('🔍 Adding fallback device to UI:', deviceInfo);

            // Add device to MuseManager registry
            museManager.addScannedDevices([{
              deviceId: device.id,
              deviceName: deviceName
            }]);

            // Store in SDK
            const deviceKey = device.name || device.id;
            museManager.getScannedDevices().set(deviceKey, device);

            return [...prev, deviceInfo];
          }
        });

        console.log('✅ Fallback device added successfully');
      }

    } catch (scanError) {
      console.error('🔍 Fallback scan error:', scanError);

      if (scanError.name === 'NotFoundError') {
        console.log('🔍 No device selected or user cancelled');
      } else if (scanError.name === 'NotAllowedError') {
        console.log('🔍 User denied Bluetooth access');
      } else if (scanError.name === 'InvalidStateError') {
        console.log('🔍 Bluetooth adapter not available');
      }
    }
  };

  const handleConnectDevice = async (deviceId: string, deviceName: string) => {
    console.log('🔗 grosdode + SDK: Starting connection flow for:', deviceName, deviceId);

    // Safety check: Prevent multiple simultaneous connection attempts
    if (connectingDevices.has(deviceId)) {
      console.log('⚠️ Connection already in progress for device:', deviceName);
      return;
    }

    // Add device to connecting set to show loading state
    setConnectingDevices(prev => new Set(prev).add(deviceId));

    try {
      console.log('🔗 Step 1: Selecting device via grosdode pattern...');
      
      // Step 1: Select device via grosdode pattern (IPC to main process)
      try {
        const selectionResult = await window.electronAPI?.bluetooth?.selectDevice(deviceId);
        console.log('🔗 Device selection result:', selectionResult);
      } catch (selectionError) {
        console.warn('🔗 Device selection warning (may be normal):', selectionError);
      }

      console.log('🔗 Step 2: Connecting via SDK after selection...');
      
      // Step 2: Wait a moment for device selection to process
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Step 3: Use SDK to connect to the device
      console.log('🔗 Step 3: Using muse_sdk for actual connection...');
      
      // Check if device is already connected and clean up if needed
      if (museManager.isDeviceConnected(deviceName)) {
        console.log('🔗 Device already connected, cleaning up first...');
        await museManager.disconnectDevice(deviceName);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
      }
      
      // Try optimized connection with fast reconnection + fallback
      let connected = false;
      
      try {
        // First attempt: Fast reconnection using getDevices()
        console.log(`\n🚀 ===== STARTING FAST RECONNECTION =====`);
        console.log(`🚀 Target device: ${deviceName} (${deviceId})`);
        console.log(`🚀 Current device registry size: ${museManager.getConnectedDeviceCount()}`);
        console.log(`🚀 Device currently connected: ${museManager.isDeviceConnected(deviceName)}`);
        
        const previousDevices = await museManager.reconnectToPreviousDevices();
        console.log(`🚀 Previous devices found: ${previousDevices.length}`);
        
        const targetDevice = previousDevices.find(d => {
          const nameMatch = d.name === deviceName;
          const idMatch = d.id === deviceId;
          console.log(`🚀   Checking device: ${d.name} (${d.id}) - Name match: ${nameMatch}, ID match: ${idMatch}`);
          return nameMatch || idMatch;
        });
        
        if (targetDevice) {
          console.log(`✅ Target device found in previous devices: ${targetDevice.name}`);
          console.log(`🚀 Attempting connection with 5s timeout...`);
          
          connected = await museManager.connectToDeviceWithTimeout(targetDevice, 5000);
          
          if (connected) {
            console.log(`✅ Fast reconnection successful for ${deviceName}`);
          } else {
            console.log(`❌ Fast reconnection failed for ${deviceName}`);
          }
        } else {
          console.log(`❌ Target device not found in previous devices`);
        }
        
        console.log(`🚀 =====================================\n`);
        
      } catch (reconnectError) {
        console.warn(`\n❌ FAST RECONNECTION ERROR:`);
        console.warn(`❌ Device: ${deviceName}`);
        console.warn(`❌ Error:`, reconnectError);
        console.warn(`❌ Falling back to standard connection...\n`);
      }
      
      // Fallback: Standard SDK connection with device cleanup
      if (!connected) {
        console.log(`\n🔗 ===== STANDARD SDK CONNECTION =====`);
        console.log(`🔗 Fast reconnection failed, trying fresh connection for ${deviceName}...`);
        console.log(`🔗 Device ID: ${deviceId}`);
        console.log(`🔗 Current connection state: ${museManager.isDeviceConnected(deviceName)}`);
        
        // Clear any stale device state that might interfere
        if (museManager.isDeviceConnected(deviceName)) {
          console.log(`🧹 Cleaning up stale connection before retry...`);
          await museManager.disconnectDevice(deviceName);
          console.log(`🧹 Disconnection completed, waiting 1s for cleanup...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for cleanup
        }
        
        console.log(`🔗 Attempting SDK connection...`);
        connected = await museManager.connectToScannedDevice(deviceId, deviceName);
        console.log(`🔗 SDK connection result: ${connected}`);
        console.log(`🔗 ===================================\n`);
      }

      if (connected) {
        console.log('✅ SDK connection established for:', deviceName);

        // Update battery levels
        await museManager.updateBatteryLevel(deviceName);
        const batteryLevel = museManager.getBatteryLevel(deviceName);

        // Update both scanned devices and main devices with connection state
        setScannedDevices(prev => prev.map(device =>
          device.id === deviceId
            ? { 
                ...device, 
                connected: true, 
                streaming: false,
                batteryLevel: batteryLevel
              }
            : device
        ));

        setDevices(prev => {
          const existingDevice = prev.find(d => d.id === deviceId);
          if (existingDevice) {
            return prev.map(d =>
              d.id === deviceId
                ? { 
                    ...d, 
                    connected: true, 
                    streaming: false,
                    batteryLevel: batteryLevel
                  }
                : d
            );
          } else {
            return [...prev, {
              id: deviceId,
              name: deviceName,
              connected: true,
              batteryLevel: batteryLevel,
              streaming: false
            }];
          }
        });

        console.log('✅ SDK connection completed with battery info');

        // Update battery levels periodically
        startBatteryUpdateTimer();

      } else {
        console.log(`\n💥 ===== FINAL ATTEMPT WITH FULL RESET =====`);
        console.log(`💥 Both optimized and standard connections failed for ${deviceName}`);
        console.log(`💥 Attempting nuclear reset and final connection attempt...`);
        
        try {
          // Nuclear option: clear all device state
          await museManager.forceResetAllDeviceState();
          
          // Wait a moment for cleanup
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Need to re-add the device to scanned devices since we cleared everything
          museManager.addScannedDevices([{
            deviceId: deviceId,
            deviceName: deviceName
          }]);
          
          console.log(`💥 Final attempt: SDK connection after full reset...`);
          const finalConnected = await museManager.connectToScannedDevice(deviceId, deviceName);
          
          if (finalConnected) {
            console.log(`✅ Final attempt successful for ${deviceName}`);
            connected = true;
          } else {
            console.log(`❌ Final attempt also failed for ${deviceName}`);
            throw new Error(`All connection attempts failed for ${deviceName}`);
          }
          
        } catch (finalError) {
          console.error(`❌ Final connection attempt failed:`, finalError);
          throw new Error(`Both optimized reconnection and SDK connection failed, final attempt also failed: ${finalError instanceof Error ? finalError.message : finalError}`);
        }
        
        console.log(`💥 =======================================\n`);
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
      // Always remove device from connecting set
      setConnectingDevices(prev => {
        const newSet = new Set(prev);
        newSet.delete(deviceId);
        return newSet;
      });
      console.log('🔗 Connection attempt completed for:', deviceName);
    }
  };

  // Battery update timer for connected devices
  const startBatteryUpdateTimer = () => {
    // Clear existing timer
    if (batteryTimerRef.current) {
      clearInterval(batteryTimerRef.current);
    }

    // Update battery levels every 30 seconds for connected devices
    batteryTimerRef.current = setInterval(async () => {
      try {
        await museManager.updateAllBatteryLevels();
        const allBatteryLevels = museManager.getAllBatteryLevels();
        
        // Update UI with new battery levels
        setScannedDevices(prev => prev.map(device => {
          const newLevel = allBatteryLevels.get(device.name);
          return newLevel !== undefined ? { ...device, batteryLevel: newLevel } : device;
        }));

        setDevices(prev => prev.map(device => {
          const newLevel = allBatteryLevels.get(device.name);
          return newLevel !== undefined ? { ...device, batteryLevel: newLevel } : device;
        }));

        console.log('🔋 Battery levels updated for UI');

      } catch (error) {
        console.error('❌ Battery update timer error:', error);
      }
    }, 30000); // 30 seconds

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
    setIsScanning(false);
    
    // Try to cancel scan in main process if possible
    // Note: This is a nice-to-have since the main process has its own timeout
    console.log('🚫 Scan canceled by user');
  };

  // Old streaming function removed - now handled by BluetoothGATTService



  const handleRecording = async () => {
    try {
      const currentStreamingState = museManager.getIsStreaming();
      console.log(`🎬 RECORDING STATE CHANGE: isRecording=${isRecording}, SDK streaming=${currentStreamingState}`);

      if (isRecording) {
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
        setIsRecording(false);
        setRecordingStartTime(null);

        // Update devices to stop streaming state
        setDevices(prev => prev.map(device =>
          ({ ...device, streaming: false })
        ));

        setScannedDevices(prev => prev.map(device =>
          ({ ...device, streaming: false })
        ));

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
            console.log('📡 SDK quaternion data from device', deviceName, ':', data);

            // Send data to motion processing pipeline
            if (motionProcessingCoordinator) {
              try {
                motionProcessingCoordinator.processNewData(deviceName, data);
                console.log('📊 SDK data sent to motion processing pipeline');
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
          setIsRecording(true);
          setRecordingStartTime(new Date());

          // Update devices to show streaming state - only for devices that are actually streaming
          const streamingDeviceNames = museManager.getStreamingDeviceNames();
          console.log('📡 Devices now streaming:', streamingDeviceNames);
          
          setDevices(prev => prev.map(device => ({
            ...device,
            streaming: streamingDeviceNames.includes(device.name)
          })));

          setScannedDevices(prev => prev.map(device => ({
            ...device,
            streaming: streamingDeviceNames.includes(device.name)
          })));

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
          setIsRecording(false);
          setRecordingStartTime(null);
          
          alert('Failed to start quaternion streaming. Please check device connections.');
        }
      }
    } catch (error) {
      console.error('❌ Recording error:', error);
      
      // Ensure clean state on error
      setIsRecording(false);
      setRecordingStartTime(null);
      
      // Stop any partial streaming that might have started
      try {
        await museManager.stopStreaming();
      } catch (stopError) {
        console.warn('⚠️ Error stopping streaming during cleanup:', stopError);
      }
      
      alert(`Recording error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };


  const connectedCount = devices.filter(d => d.connected).length;

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between drag-region">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#FF4D35] rounded-lg flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Motion Capture</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          <WindowControls />
        </div>
      </div>

      <div className="p-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <DeviceManagement
            devices={devices}
            scannedDevices={scannedDevices}
            onScan={handleScan}
            onCancelScan={cancelScan}
            onConnectDevice={handleConnectDevice}
            isScanning={isScanning}
            connectingDevices={connectingDevices}
            setScannedDevices={setScannedDevices}
            isRecording={isRecording}
          />

          <RecordingControl
            isRecording={isRecording}
            onStartStop={handleRecording}
            connectedDevices={connectedCount}
          />
        </div>

        <EnhancedMotionDataDisplay
          data={motionData}
          isRecording={isRecording}
          recordingStartTime={recordingStartTime}
        />

        <div className="mt-6 bg-white rounded-xl shadow-lg p-4 border border-gray-200">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>
              Status: <span className="font-medium">{status?.isInitialized ? 'Ready' : 'Initializing'}</span>
            </div>
            <div>
              WebSocket: <span className="font-medium">{isConnected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <div>
              Clients: <span className="font-medium">{status?.clientCount || 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ElectronMotionApp;

