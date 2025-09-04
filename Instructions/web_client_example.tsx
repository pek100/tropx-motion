import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Wifi, WifiOff, Battery, Zap, Play, Pause, RotateCcw } from 'lucide-react';

// WebSocket Message Types (matching Electron types)
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
}

interface MotionData {
  left: { current: number; max: number; min: number; rom: number };
  right: { current: number; max: number; min: number; rom: number };
  timestamp: number;
  frameId?: number;
}

interface ServiceStatus {
  isInitialized: boolean;
  isRecording: boolean;
  connectedDevices: DeviceInfo[];
  batteryLevels: Record<string, number>;
  recordingStartTime?: string;
  wsPort: number;
  clientCount: number;
}

// Custom hook for WebSocket connection
const useWebSocket = (url: string) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = 2000;

  const connect = useCallback(() => {
    if (ws?.readyState === WebSocket.OPEN) return;
    
    setConnectionStatus('connecting');
    try {
      const websocket = new WebSocket(url);
      
      websocket.onopen = () => {
        console.log('🌐 WebSocket connected to Electron app');
        setIsConnected(true);
        setConnectionStatus('connected');
        setReconnectAttempts(0);
        
        // Request current status
        websocket.send(JSON.stringify({ type: 'request_status' }));
      };

      websocket.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          setLastMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        console.log('🌐 WebSocket disconnected');
        setIsConnected(false);
        setConnectionStatus('disconnected');
        setWs(null);
        
        // Attempt reconnection
        if (reconnectAttempts < maxReconnectAttempts) {
          setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, reconnectDelay);
        }
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus('error');
      };

      setWs(websocket);
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      setConnectionStatus('error');
    }
  }, [url, reconnectAttempts, ws]);

  useEffect(() => {
    connect();
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (ws && isConnected) {
      ws.send(JSON.stringify(message));
    }
  }, [ws, isConnected]);

  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    connect();
  }, [connect]);

  return { 
    isConnected, 
    connectionStatus, 
    lastMessage, 
    sendMessage, 
    reconnect,
    reconnectAttempts,
    maxReconnectAttempts
  };
};

// Connection Status Component
const ConnectionStatus: React.FC<{
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  onReconnect: () => void;
  reconnectAttempts: number;
  maxAttempts: number;
}> = ({ status, onReconnect, reconnectAttempts, maxAttempts }) => {
  const getStatusDisplay = () => {
    switch (status) {
      case 'connected':
        return { icon: Wifi, color: 'text-green-500', bg: 'bg-green-50', text: 'Connected to Electron App' };
      case 'connecting':
        return { icon: Wifi, color: 'text-yellow-500', bg: 'bg-yellow-50', text: 'Connecting...' };
      case 'error':
        return { icon: WifiOff, color: 'text-red-500', bg: 'bg-red-50', text: 'Connection Error' };
      default:
        return { icon: WifiOff, color: 'text-gray-500', bg: 'bg-gray-50', text: 'Disconnected' };
    }
  };

  const statusDisplay = getStatusDisplay();
  const Icon = statusDisplay.icon;

  return (
    <div className={`${statusDisplay.bg} border rounded-lg p-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${statusDisplay.color}`} />
          <div>
            <div className="font-medium text-gray-900">{statusDisplay.text}</div>
            {reconnectAttempts > 0 && (
              <div className="text-sm text-gray-600">
                Attempt {reconnectAttempts}/{maxAttempts}
              </div>
            )}
          </div>
        </div>
        
        {status !== 'connected' && status !== 'connecting' && (
          <button
            onClick={onReconnect}
            className="flex items-center gap-2 px-3 py-1 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Reconnect
          </button>
        )}
      </div>
    </div>
  );
};

// Real-time Motion Chart Component
const MotionChart: React.FC<{ data: MotionData | null; isRecording: boolean }> = ({ data, isRecording }) => {
  const [history, setHistory] = useState<MotionData[]>([]);
  const maxHistoryPoints = 100;

  useEffect(() => {
    if (data && isRecording) {
      setHistory(prev => {
        const newHistory = [...prev, data];
        return newHistory.slice(-maxHistoryPoints);
      });
    } else if (!isRecording) {
      setHistory([]);
    }
  }, [data, isRecording]);

  if (!data) {
    return (
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-semibold mb-4">Real-time Motion Data</h3>
        <div className="flex items-center justify-center h-64 text-gray-500">
          <div className="text-center">
            <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No motion data available</p>
            <p className="text-sm text-gray-400">Start recording on the Electron app</p>
          </div>
        </div>
      </div>
    );
  }

  const AngleDisplay: React.FC<{ label: string; data: any; color: string }> = ({ label, data, color }) => (
    <div className="bg-gray-50 rounded-lg p-4">
      <h4 className="font-medium text-gray-900 mb-3">{label}</h4>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Current</span>
          <span className={`text-lg font-bold ${color}`}>{data.current.toFixed(1)}°</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${color.replace('text-', 'bg-')}`}
            style={{ width: `${Math.min((Math.abs(data.current) / 90) * 100, 100)}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <div className="text-gray-500">Min</div>
            <div className="font-medium">{data.min.toFixed(1)}°</div>
          </div>
          <div>
            <div className="text-gray-500">ROM</div>
            <div className="font-medium">{data.rom.toFixed(1)}°</div>
          </div>
          <div>
            <div className="text-gray-500">Max</div>
            <div className="font-medium">{data.max.toFixed(1)}°</div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Real-time Motion Data</h3>
        <div className="flex items-center gap-2">
          {isRecording && (
            <>
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm text-gray-600">Recording</span>
            </>
          )}
          <span className="text-xs text-gray-500">
            Frame: {data.frameId || 0}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <AngleDisplay label="Left Knee" data={data.left} color="text-blue-600" />
        <AngleDisplay label="Right Knee" data={data.right} color="text-green-600" />
      </div>

      {/* Simple History Chart */}
      {history.length > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Angle History</h4>
          <div className="h-24 relative bg-gray-50 rounded">
            <svg className="w-full h-full" viewBox="0 0 400 100">
              {/* Left knee line */}
              <polyline
                fill="none"
                stroke="#3B82F6"
                strokeWidth="2"
                points={history.map((point, index) => 
                  `${(index / (maxHistoryPoints - 1)) * 400},${50 - (point.left.current / 90) * 40}`
                ).join(' ')}
              />
              {/* Right knee line */}
              <polyline
                fill="none"
                stroke="#10B981"
                strokeWidth="2"
                points={history.map((point, index) => 
                  `${(index / (maxHistoryPoints - 1)) * 400},${50 - (point.right.current / 90) * 40}`
                ).join(' ')}
              />
              {/* Center line */}
              <line x1="0" y1="50" x2="400" y2="50" stroke="#E5E7EB" strokeWidth="1" />
            </svg>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-blue-600"></div>
              <span>Left Knee</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-green-600"></div>
              <span>Right Knee</span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-gray-500 text-center">
        Last update: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
};

// Device Status Panel
const DeviceStatusPanel: React.FC<{ devices: DeviceInfo[] }> = ({ devices }) => {
  const connectedCount = devices.filter(d => d.connected).length;

  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">Connected Devices</h3>
        <span className="text-sm text-gray-600">{connectedCount} connected</span>
      </div>

      <div className="space-y-2">
        {devices.map((device) => (
          <div key={device.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${device.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-sm font-medium">{device.name}</span>
            </div>
            <div className="flex items-center gap-1">
              {device.batteryLevel !== null && (
                <>
                  {device.batteryLevel < 20 && <Zap className="w-3 h-3 text-amber-500" />}
                  <Battery className={`w-3 h-3 ${device.batteryLevel < 20 ? 'text-amber-500' : 'text-green-500'}`} />
                  <span className="text-xs">{device.batteryLevel}%</span>
                </>
              )}
            </div>
          </div>
        ))}

        {devices.length === 0 && (
          <div className="text-center py-4 text-gray-500 text-sm">
            No devices detected
          </div>
        )}
      </div>
    </div>
  );
};

// Recording Status Panel
const RecordingStatusPanel: React.FC<{ 
  isRecording: boolean; 
  startTime?: string; 
  clientCount: number;
}> = ({ isRecording, startTime, clientCount }) => {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && startTime) {
      interval = setInterval(() => {
        const start = new Date(startTime).getTime();
        const now = Date.now();
        setDuration(Math.floor((now - start) / 1000));
      }, 1000);
    } else {
      setDuration(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, startTime]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-white rounded-lg border p-4">
      <h3 className="font-medium mb-3">Recording Status</h3>
      
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Status</span>
          <div className="flex items-center gap-2">
            {isRecording ? (
              <>
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-red-600">Recording</span>
              </>
            ) : (
              <>
                <div className="w-2 h-2 bg-gray-400 rounded-full" />
                <span className="text-sm text-gray-600">Standby</span>
              </>
            )}
          </div>
        </div>

        {isRecording && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Duration</span>
            <span className="font-mono text-lg font-bold text-[#FF4D35]">
              {formatDuration(duration)}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Connected Clients</span>
          <span className="text-sm font-medium">{clientCount}</span>
        </div>
      </div>
    </div>
  );
};

// Main Web Client Component
const WebClient: React.FC = () => {
  const [wsUrl] = useState('ws://localhost:8080');
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null);
  const [motionData, setMotionData] = useState<MotionData | null>(null);

  const { 
    isConnected, 
    connectionStatus, 
    lastMessage, 
    reconnect,
    reconnectAttempts,
    maxReconnectAttempts
  } = useWebSocket(wsUrl);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'status_update':
        setServiceStatus(lastMessage.data);
        break;
      
      case 'device_status':
        if (serviceStatus) {
          setServiceStatus(prev => prev ? {
            ...prev,
            connectedDevices: lastMessage.data.connectedDevices || []
          } : null);
        }
        break;
      
      case 'motion_data':
        setMotionData(lastMessage.data);
        break;
      
      case 'recording_state':
        if (serviceStatus) {
          setServiceStatus(prev => prev ? {
            ...prev,
            isRecording: lastMessage.data.isRecording || false
          } : null);
        }
        break;

      case 'heartbeat':
        // Keep connection alive
        break;
    }
  }, [lastMessage, serviceStatus]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Motion Capture - Web Dashboard</h1>
          <p className="text-gray-600">Real-time monitoring of motion capture data from Electron application</p>
        </div>

        {/* Connection Status */}
        <div className="mb-6">
          <ConnectionStatus
            status={connectionStatus}
            onReconnect={reconnect}
            reconnectAttempts={reconnectAttempts}
            maxAttempts={maxReconnectAttempts}
          />
        </div>

        {/* Main Content */}
        {isConnected && serviceStatus ? (
          <div className="space-y-6">
            {/* Status Panels Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DeviceStatusPanel devices={serviceStatus.connectedDevices} />
              <RecordingStatusPanel 
                isRecording={serviceStatus.isRecording}
                startTime={serviceStatus.recordingStartTime}
                clientCount={serviceStatus.clientCount}
              />
            </div>

            {/* Motion Data Chart */}
            <MotionChart 
              data={motionData} 
              isRecording={serviceStatus.isRecording}
            />

            {/* System Status */}
            <div className="bg-white rounded-lg border p-4">
              <h3 className="font-medium mb-3">System Information</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Service</div>
                  <div className="font-medium">
                    {serviceStatus.isInitialized ? 'Ready' : 'Initializing'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">WebSocket Port</div>
                  <div className="font-medium">{serviceStatus.wsPort}</div>
                </div>
                <div>
                  <div className="text-gray-500">Connected Devices</div>
                  <div className="font-medium">{serviceStatus.connectedDevices.length}</div>
                </div>
                <div>
                  <div className="text-gray-500">Recording</div>
                  <div className="font-medium">
                    {serviceStatus.isRecording ? 'Active' : 'Inactive'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg border p-12 text-center">
            <div className="text-gray-500">
              {connectionStatus === 'connecting' ? (
                <>
                  <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-4" />
                  <p>Connecting to Electron application...</p>
                </>
              ) : (
                <>
                  <WifiOff className="w-8 h-8 mx-auto mb-4 opacity-50" />
                  <p>Not connected to Electron application</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Make sure the Electron app is running on {wsUrl}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WebClient;