import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Wifi, WifiOff, Battery, Zap, RotateCcw, Minimize2, Maximize2, X, CheckCircle, AlertCircle } from 'lucide-react';
import { MuseManager } from '../../sdk/core/MuseManager';
import { EnhancedMotionDataDisplay } from './components';

// Create a global instance of MuseManager
const museManager = new MuseManager();

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

interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

interface MotionData {
  left: { current: number; max: number; min: number; rom: number };
  right: { current: number; max: number; min: number; rom: number };
  timestamp: number;
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
          console.log('🔌 Raw WebSocket message received:', message);
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

// Device Management Component matching navbar design exactly
const DeviceStatus: React.FC<{
  devices: DeviceInfo[];
  scannedDevices: DeviceInfo[];
  onScan: () => void;
  onConnectDevice: (deviceId: string, deviceName: string) => void;
  isScanning: boolean;
  connectingDevices: Set<string>;
  setScannedDevices: React.Dispatch<React.SetStateAction<DeviceInfo[]>>;
  isRecording: boolean;
}> = ({ devices, scannedDevices, onScan, onConnectDevice, isScanning, connectingDevices, setScannedDevices, isRecording }) => {
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [autoConnect, setAutoConnect] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Get all devices combining scanned and connected devices (like navbar pattern)
  const allSDKDevices = React.useMemo(() => {
    try {
      console.log('📱 Building comprehensive device list...');
      console.log('📱 Scanned devices:', scannedDevices);
      console.log('📱 Connected devices:', devices);

      // Start with scanned devices as the primary list (these persist like in navbar)
      const deviceMap = new Map<string, DeviceInfo>();

      // Add all scanned devices first
      scannedDevices.forEach(device => {
        deviceMap.set(device.id, { ...device });
      });

      // Update with connection status and battery from connected devices
      devices.forEach(device => {
        const existing = deviceMap.get(device.id);
        if (existing) {
          // Update existing scanned device with connection info
          deviceMap.set(device.id, {
            ...existing,
            connected: device.connected,
            batteryLevel: device.batteryLevel !== null ? device.batteryLevel : existing.batteryLevel,
            streaming: device.streaming || existing.streaming || false
          });
        } else {
          // Add device that was connected but not in scanned list
          deviceMap.set(device.id, { ...device });
        }
      });

      // Also get devices from SDK for additional info
      try {
        const allDevicesFromSDK = museManager.getAllDevices();
        allDevicesFromSDK.forEach(sdkDevice => {
          const existing = deviceMap.get(sdkDevice.id);
          if (existing) {
            // Update with SDK battery info if available
            if (sdkDevice.batteryLevel !== null) {
              deviceMap.set(sdkDevice.id, {
                ...existing,
                batteryLevel: sdkDevice.batteryLevel
              });
            }
          } else {
            // Add SDK device that wasn't in other lists
            deviceMap.set(sdkDevice.id, {
              id: sdkDevice.id,
              name: sdkDevice.name,
              connected: sdkDevice.connected,
              batteryLevel: sdkDevice.batteryLevel,
              streaming: false
            });
          }
        });
      } catch (error) {
        console.warn('Could not get SDK devices:', error);
      }

      const finalDeviceList = Array.from(deviceMap.values());
      console.log('📱 Final combined device list for navbar:', finalDeviceList);
      return finalDeviceList;

    } catch (error) {
      console.error('Error building device list:', error);
      // Simple fallback - combine and deduplicate
      const combined = [...scannedDevices, ...devices];
      return combined.filter((device, index, arr) =>
        arr.findIndex(d => d.id === device.id) === index
      );
    }
  }, [scannedDevices, devices]);

  // Calculate connection progress based on allSDKDevices
  const connectedCount = allSDKDevices.filter(d => d.connected).length;
  const totalDevices = Math.max(allSDKDevices.length, 1);
  const connectionPercentage = allSDKDevices.length > 0 ? (connectedCount / allSDKDevices.length) * 100 : 0;
  const isFullyConnected = allSDKDevices.length > 0 && connectedCount === allSDKDevices.length;

  const handleConnectAll = async () => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      // Connect to all scanned devices
      for (const device of allSDKDevices) {
        if (!devices.some(d => d.id === device.id && d.connected)) {
          await onConnectDevice(device.id, device.name);
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Device Management</h3>
          {scannedDevices.length === 0 && (
            <p className="text-sm text-gray-500 mt-1">Click scan multiple times to find all your sensors</p>
          )}
        </div>

        {/* Navbar-style device status popover trigger */}
        <div className="relative">
          <button
            onClick={() => setIsPopoverOpen(!isPopoverOpen)}
            className="flex items-center gap-3 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors bg-transparent"
          >
            <div className="flex items-center gap-2">
              {isFullyConnected ? (
                <Wifi className="w-4 h-4 text-green-500" />
              ) : connectedCount > 0 ? (
                <Wifi className="w-4 h-4 text-amber-500" />
              ) : (
                <WifiOff className="w-4 h-4 text-gray-400" />
              )}
              <span className="text-sm font-medium">
                {connectedCount}/{allSDKDevices.length}
              </span>
            </div>
            <span className={`text-xs px-2 py-1 rounded ${
              isFullyConnected
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : connectedCount > 0
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-gray-200 text-gray-600'
            }`}>
              {isFullyConnected ? 'Connected' : connectedCount > 0 ? 'Partial' : 'Disconnected'}
            </span>
          </button>

          {/* Exact navbar-style popover */}
          {isPopoverOpen && (
            <div className="absolute top-full right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-200 z-50">
              <div className="p-0">
                {/* Card Header */}
                <div className="p-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">Device Management</h3>
                      <p className="text-sm text-gray-500">Monitor and control your devices</p>
                    </div>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded">
                      {connectedCount}/{allSDKDevices.length}
                    </span>
                  </div>

                  {/* Connection Progress */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span className="text-gray-600">Connection Progress</span>
                      <span className="font-medium">{Math.round(connectionPercentage)}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-[#FF4D35] h-2 rounded-full transition-all duration-300"
                        style={{ width: `${connectionPercentage}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Content */}
                <div className="px-4 pb-4">
                  {/* Auto-connect toggle */}
                  <div className="flex items-center justify-between mb-4">
                    <label className="text-sm font-medium text-gray-700">Auto-connect devices</label>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={autoConnect}
                        onChange={(e) => setAutoConnect(e.target.checked)}
                        className="sr-only"
                      />
                      <div
                        onClick={() => setAutoConnect(!autoConnect)}
                        className={`w-10 h-6 rounded-full cursor-pointer transition-colors relative ${
                          autoConnect ? 'bg-[#FF4D35]' : 'bg-gray-300'
                        }`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                          autoConnect ? 'translate-x-4' : 'translate-x-1'
                        }`} />
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 my-4"></div>

                  {/* Device list header */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-gray-700">Connected Devices</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          console.log('🔋 Manual battery refresh requested');
                          try {
                            await museManager.updateAllBatteryLevels();
                            console.log('🔋 Manual battery refresh complete');
                          } catch (error) {
                            console.error('🔋 Manual battery refresh failed:', error);
                          }
                        }}
                        className="h-7 text-xs px-2 py-1 bg-green-100 hover:bg-green-200 text-green-700 rounded-md"
                      >
                        🔋
                      </button>
                      <button
                        onClick={handleConnectAll}
                        disabled={isLoading || allSDKDevices.length === 0}
                        className="h-7 text-xs px-3 py-1 bg-[#FF4D35] hover:bg-[#e63e2b] text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isLoading ? (
                          <div className="flex items-center gap-1">
                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Connecting...
                          </div>
                        ) : (
                          'Connect All'
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Device list - exact navbar style */}
                  <div className="space-y-2">
                    {allSDKDevices.length > 0 ? (
                      allSDKDevices.map((device) => {
                        const isConnecting = connectingDevices.has(device.id);
                        const isConnected = device.connected;
                        const batteryLevel = device.batteryLevel;
                        const isLowBattery = batteryLevel !== null && batteryLevel !== undefined && batteryLevel < 20;

                        return (
                          <div
                            key={device.id}
                            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 bg-green-500 rounded-full ${isConnected ? '' : 'bg-gray-400'}`} />
                              <div>
                                <span className="text-sm font-medium text-gray-900">{device.name}</span>
                                <div className="text-xs text-gray-500">{isConnected ? 'Connected' : 'Disconnected'}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {isLowBattery && (
                                <Zap className="h-3 w-3 text-amber-500" />
                              )}
                              <span className={`text-xs px-2 py-1 rounded border ${
                                isConnected 
                                  ? isLowBattery 
                                    ? 'border-amber-500 text-amber-700 bg-amber-50' 
                                    : 'border-green-500 text-green-700 bg-green-50'
                                  : 'border-gray-300 text-gray-600 bg-white'
                              }`}>
                                {batteryLevel !== null && batteryLevel !== undefined ? `${Math.round(batteryLevel)}%` : '--'}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center py-6 text-gray-500">
                        <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No devices connected</p>
                        <p className="text-xs text-gray-400">Click "Connect All" to start</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scan Button */}
      <div className="mb-4 space-y-2">
        <button
          onClick={onScan}
          disabled={isScanning}
          className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
            isScanning
              ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
              : 'bg-blue-500 hover:bg-blue-600 text-white shadow-md hover:shadow-lg'
          }`}
        >
          {isScanning ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Scanning...
            </div>
          ) : scannedDevices.length > 0 ? (
            `📡 Scan for More (${scannedDevices.length} found)`
          ) : (
            '📡 Scan for Devices'
          )}
        </button>

        {scannedDevices.length === 0 && (
          <div className="text-xs text-gray-500 text-center px-2">
            Uses Web Bluetooth API - select each device individually
          </div>
        )}

        {scannedDevices.length > 0 && (
          <>
            <button
              onClick={() => {
                console.log('🗑️ Clearing scanned devices list');
                setScannedDevices([]);
              }}
              className="w-full py-2 px-4 rounded-lg text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            >
              🗑️ Clear Device List
            </button>
            <button
              onClick={() => {
                console.log('🔍 Cleaning up invalid devices from lists');

                // Remove devices that don't match valid Tropx patterns
                const cleanValidDevices = (deviceList: DeviceInfo[]) => {
                  return deviceList.filter(device => {
                    const isValid = device.name.toLowerCase().includes('tropx') &&
                                   (device.name.includes('_ln_') || device.name.includes('_rn_') ||
                                    device.name.includes('ln_') || device.name.includes('rn_'));

                    if (!isValid) {
                      console.log(`🗑️ Removing invalid device: "${device.name}"`);
                    }
                    return isValid;
                  });
                };

                setScannedDevices(prev => cleanValidDevices(prev));
                setDevices(prev => cleanValidDevices(prev));

                console.log('✅ Invalid devices cleaned up');
              }}
              className="w-full py-1 px-4 rounded-lg text-xs text-orange-600 hover:text-orange-800 hover:bg-orange-50 transition-colors"
            >
              🧹 Clean Invalid Devices
            </button>
          </>
        )}
      </div>

      {/* Found Devices Section - separate from popover */}
      {scannedDevices.length > 0 && (
        <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">📡 Found Devices ({scannedDevices.length})</h4>
          <div className="space-y-2">
            {scannedDevices.map((device) => {
              const isConnecting = connectingDevices.has(device.id);
              const isConnected = devices.some(d => d.id === device.id && d.connected);

              return (
                <div
                  key={device.id}
                  className="flex items-center justify-between p-3 bg-white rounded border"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-blue-500'}`} />
                    <div>
                      <span className="text-sm font-medium text-gray-900">{device.name}</span>
                      <div className="text-xs text-gray-500">{device.id}</div>
                    </div>
                  </div>

                  {isConnected ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded">Connected</span>
                      {isRecording && (
                        <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded flex items-center gap-1">
                          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          Recording
                        </span>
                      )}
                    </div>
                  ) : (
                    <button
                      className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                        isConnecting
                          ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                          : 'bg-[#FF4D35] hover:bg-[#e63e2b] text-white'
                      }`}
                      onClick={() => onConnectDevice(device.id, device.name)}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
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
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const RecordingControl: React.FC<{
  isRecording: boolean;
  onStartStop: () => void;
  connectedDevices: number;
  recordingDuration?: number;
}> = ({ isRecording, onStartStop, connectedDevices, recordingDuration = 0 }) => {
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
  const [scannedBluetoothDevices, setScannedBluetoothDevices] = useState<Map<string, BluetoothDevice>>(new Map());
  const [isConnecting, setIsConnecting] = useState(false);
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
        // Handle scan request from main process
        console.log('📨 Received scan_request from main process:', lastMessage.data);
        if (lastMessage.data.action === 'trigger_main_process_scan') {
          console.log('📨 Triggering Web Bluetooth scan to activate main process handler...');
          
          // UPDATED: Use a simple Web Bluetooth call to trigger main process scan
          // This will activate select-bluetooth-device event but won't show device picker
          (async () => {
            try {
              // Simple scan trigger - this will immediately be handled by main process
              await navigator.bluetooth?.requestDevice({
                acceptAllDevices: true,
                optionalServices: ['c8c0a708-e361-4b5e-a365-98fa6b0a836f']
              });
            } catch (error) {
              // This is expected - main process handles everything via select-bluetooth-device event
              console.log('📨 Web Bluetooth scan triggered, main process handling device selection:', error?.name);
            }
          })();
        }
        break;

      case 'device_connected':
        // Handle device connection success from main process
        console.log('📨 Received device_connected from main process:', lastMessage.data);
        const { deviceId, deviceName } = lastMessage.data;
        
        // Now use SDK to actually connect to the device that was made available
        (async () => {
          try {
            console.log('🔗 Using SDK to connect to device made available by main process:', deviceName);
            
            // Use connectToScannedDevice since the device should now be available
            const success = await museManager.connectToScannedDevice(deviceId, deviceName);
            
            if (success) {
              console.log('✅ SDK successfully connected to device:', deviceName);
              
              // Update UI to show connected state
              setScannedDevices(prev => prev.map(device =>
                device.id === deviceId
                  ? { ...device, connected: true, streaming: false }
                  : device
              ));

              setDevices(prev => {
                const existingDevice = prev.find(d => d.id === deviceId);
                if (existingDevice) {
                  return prev.map(d =>
                    d.id === deviceId
                      ? { ...d, connected: true, streaming: false }
                      : d
                  );
                } else {
                  return [...prev, {
                    id: deviceId,
                    name: deviceName,
                    connected: true,
                    batteryLevel: null,
                    streaming: false
                  }];
                }
              });
              
              // Clear connecting state
              setConnectingDevices(prev => {
                const newSet = new Set(prev);
                newSet.delete(deviceId);
                return newSet;
              });
              
            } else {
              console.error('❌ SDK failed to connect to device:', deviceName);
              // Clear connecting state on failure
              setConnectingDevices(prev => {
                const newSet = new Set(prev);
                newSet.delete(deviceId);
                return newSet;
              });
            }
            
          } catch (error) {
            console.error('❌ SDK connection error:', error);
            // Clear connecting state on error
            setConnectingDevices(prev => {
              const newSet = new Set(prev);
              newSet.delete(deviceId);
              return newSet;
            });
          }
        })();
        break;

      case 'device_scan_result':
        console.log('📨 Received device_scan_result from main process:', lastMessage.data);
        console.log('📨 Raw devices array:', lastMessage.data.devices);
        try {
          const devices = lastMessage.data.devices || [];
          console.log('📨 Processing devices for UI display:', devices);

          if (devices.length > 0) {
            // CRITICAL FIX: Register devices with MuseManager BEFORE adding to UI
            console.log('📋 Registering Electron-discovered devices with MuseManager...');
            museManager.addScannedDevices(devices.map(device => ({
              deviceId: device.id,
              deviceName: device.name
            })));

            // Use main process device discovery for display
            const processedDevices = devices.map(device => {
              console.log('📨 Processing device:', device);
              return {
                ...device,
                streaming: false
              };
            });
            console.log('📨 Setting scanned devices:', processedDevices);
            setScannedDevices(processedDevices);
          } else {
            console.log('📨 No devices in scan result');
            setScannedDevices([]);
          }

          setIsScanning(false);
          console.log('📨 Scan complete, isScanning set to false');

        } catch (error) {
          console.error('📨 Error processing device_scan_result:', error);
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
    console.log('🔍 handleScan called - triggering device discovery via main process');

    setIsScanning(true);

    try {
      console.log('🔍 System diagnostics:');
      console.log('🔍 - User agent:', navigator.userAgent);
      console.log('🔍 - Platform:', navigator.platform);
      console.log('🔍 - Web Bluetooth available:', !!navigator.bluetooth);
      console.log('🔍 - electronAPI available:', !!window.electronAPI);

      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      console.log('🔍 Starting device discovery via main process...');

      // UPDATED: Use IPC to trigger main process scanning instead of direct Web Bluetooth
      const result = await window.electronAPI.motion.scanDevices();
      console.log('🔍 Scan result from main process:', result);

      if (!result.success) {
        console.warn('⚠️ Main process scan failed:', result.message);
      }

      // The actual device list will come via WebSocket message 'device_scan_result'
      // which is handled in the useEffect hook for WebSocket messages
      console.log('🔍 Waiting for device list via WebSocket...');

    } catch (error) {
      console.error('🔍 Scan error:', error);
      
      // Fallback: try the old direct Web Bluetooth approach as last resort
      // but only if we're in a supported environment
      if (navigator.bluetooth && error.message !== 'Electron API not available') {
        console.log('🔍 Falling back to direct Web Bluetooth scan...');
        await handleDirectBluetoothScan();
      }
    } finally {
      // Note: Don't set setIsScanning(false) here immediately
      // Let the WebSocket response handler do it when devices are received
      // or set a timeout as fallback
      setTimeout(() => {
        setIsScanning(false);
      }, 10000); // 10 second fallback timeout
    }
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
                                  deviceName.includes('ln_') || deviceName.includes('rn_'));

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
    console.log('🔗 Connecting to device via main process:', deviceName, deviceId);

    // Safety check: Prevent multiple simultaneous connection attempts
    if (connectingDevices.has(deviceId)) {
      console.log('⚠️ Connection already in progress for device:', deviceName);
      return;
    }

    // Add device to connecting set to show loading state
    setConnectingDevices(prev => new Set(prev).add(deviceId));

    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }

      console.log('🔗 Using main process device connection...');

      // UPDATED: Use new IPC method to connect via main process
      const result = await window.electronAPI.motion.connectToDevice(deviceName);
      console.log('🔗 Device connection result from main process:', result);

      if (result.success) {
        console.log('✅ Device connected successfully via main process');

        // Update both scanned devices and main devices to show connected state
        setScannedDevices(prev => prev.map(device =>
          device.id === deviceId
            ? { ...device, connected: true, streaming: false }
            : device
        ));

        setDevices(prev => {
          const existingDevice = prev.find(d => d.id === deviceId);
          if (existingDevice) {
            return prev.map(d =>
              d.id === deviceId
                ? { ...d, connected: true, streaming: false }
                : d
            );
          } else {
            return [...prev, {
              id: deviceId,
              name: deviceName,
              connected: true,
              batteryLevel: null,
              streaming: false
            }];
          }
        });

        console.log('✅ Device connection completed via main process');

      } else {
        throw new Error(`Main process connection failed: ${result.message}`);
      }

    } catch (error) {
      console.error('❌ Device connection error:', error);
      // Show error to user (could add toast/notification here)
    } finally {
      // Remove device from connecting set
      setConnectingDevices(prev => {
        const newSet = new Set(prev);
        newSet.delete(deviceId);
        return newSet;
      });
    }
  };

  // Streaming will be handled automatically by the motion processing pipeline when recording starts



  const handleRecording = async () => {
    if (!window.electronAPI) return;

    try {
      if (isRecording) {
        // Stop recording and streaming
        console.log('🛑 Stopping recording and streaming...');

        // Stop SDK streaming
        await museManager.stopStreaming();

        // Stop recording in main process
        const result = await window.electronAPI.motion.stopRecording();
        console.log('✅ Stop recording result:', result);

        // Clear recording start time
        setRecordingStartTime(null);

        // Update devices to stop streaming state
        setDevices(prev => prev.map(device =>
          ({ ...device, streaming: false })
        ));

        // Also update scanned devices list to stop streaming state
        setScannedDevices(prev => prev.map(device =>
          ({ ...device, streaming: false })
        ));

      } else {
        // Start recording and streaming
        console.log('🎬 Starting recording and streaming...');

        // Debug: Check how many devices are actually connected before streaming
        const allDevicesFromSDK = museManager.getAllDevices();
        console.log('🔍 All devices before starting streaming:', allDevicesFromSDK);
        console.log('🔍 Connected device count:', devices.filter(d => d.connected).length);
        console.log('🔍 Connected devices:', devices.filter(d => d.connected));

        // Start SDK streaming with quaternion mode for motion processing
        const streamingSuccess = await museManager.startStreaming((deviceName: string, data: any) => {
          console.log('📊 Motion data from', deviceName, ':', data);

          // Validate that we have quaternion data (essential for motion processing)
          // Based on SDK interface: IMUData has optional quaternion?: Quaternion
          if (data && typeof data === "object" && "quaternion" in data && data.quaternion) {
            const quaternionData = data.quaternion;
            
            // Validate quaternion structure (w, x, y, z components)
            if (quaternionData.w !== undefined && quaternionData.x !== undefined && 
                quaternionData.y !== undefined && quaternionData.z !== undefined) {
              
              console.log('✅ Valid quaternion data received from', deviceName, quaternionData);

              // Send ONLY quaternion data to main process motion processing pipeline
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({
                  type: 'motion_data',
                  data: {
                    deviceName,
                    timestamp: data.timestamp || Date.now(),
                    // Send ONLY quaternion data for motion processing (as per SDK interface)
                    quaternion: {
                      w: quaternionData.w,
                      x: quaternionData.x,
                      y: quaternionData.y,
                      z: quaternionData.z
                    }
                    // NOTE: Intentionally NOT sending axl, gyr, mag as motion processing only needs quaternions
                  },
                  timestamp: Date.now()
                }));
              }
            } else {
              console.warn('⚠️ Received invalid quaternion structure from', deviceName, '- missing w/x/y/z components');
              console.log('⚠️ Quaternion data:', quaternionData);
            }
          } else {
            console.warn('⚠️ Received sensor data without quaternion from', deviceName, '- motion processing requires quaternions');
            console.log('⚠️ Available data fields:', Object.keys(data || {}));
            console.log('⚠️ Raw data structure:', data);
          }
        });

        if (streamingSuccess) {
          console.log('✅ Streaming started successfully');

          // Set recording start time
          setRecordingStartTime(new Date());

          // Update devices to show streaming state
          setDevices(prev => prev.map(device =>
            device.connected
              ? { ...device, streaming: true }
              : device
          ));

          // Also update scanned devices list to show streaming state
          setScannedDevices(prev => prev.map(device =>
            device.connected
              ? { ...device, streaming: true }
              : device
          ));

          // Start recording in main process
          const sessionData = {
            sessionId: `session_${Date.now()}`,
            exerciseId: `exercise_${Date.now()}`,
            setNumber: 1
          };
          const result = await window.electronAPI.motion.startRecording(sessionData);
          console.log('✅ Start recording result:', result);
        } else {
          console.error('❌ Failed to start streaming, recording not started');
        }
      }
    } catch (error) {
      console.error('❌ Recording error:', error);
    }
  };


  const connectedCount = devices.filter(d => d.connected).length;

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
          <DeviceStatus
            devices={devices}
            scannedDevices={scannedDevices}
            onScan={handleScan}
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
