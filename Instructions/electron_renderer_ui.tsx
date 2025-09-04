import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, Wifi, WifiOff, Battery, Zap, RotateCcw, Minimize2, Maximize2, X } from 'lucide-react';

// Type definitions for WebSocket messages
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
}

// Custom hook for WebSocket connection
const useWebSocket = (url: string) => {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    try {
      const websocket = new WebSocket(url);
      
      websocket.onopen = () => {
        console.log('🔌 WebSocket connected');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        
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
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
        setWs(null);
        
        // Attempt reconnection
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
      };

      setWs(websocket);
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
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

// Device Status Component
const DeviceStatus: React.FC<{
  devices: DeviceInfo[];
  onConnect: () => void;
  isConnecting: boolean;
}> = ({ devices, onConnect, isConnecting }) => {
  const connectedCount = devices.filter(d => d.connected).length;
  const totalDevices = Math.max(devices.length, 4); // Assume 4 total devices

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Device Status</h3>
        <div className="flex items-center gap-2">
          {connectedCount > 0 ? (
            <Wifi className="w-5 h-5 text-green-500" />
          ) : (
            <WifiOff className="w-5 h-5 text-gray-400" />
          )}
          <span className="text-sm font-medium">
            {connectedCount}/{totalDevices}
          </span>
        </div>
      </div>

      {/* Connection Progress */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>Connection Progress</span>
          <span>{Math.round((connectedCount / totalDevices) * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${
              connectedCount === totalDevices ? 'bg-green-500' : 'bg-blue-500'
            }`}
            style={{ width: `${(connectedCount / totalDevices) * 100}%` }}
          />
        </div>
      </div>

      {/* Device List */}
      <div className="space-y-3 mb-4">
        {devices.map((device) => (
          <div key={device.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${device.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
              <span className="text-sm font-medium text-gray-900">{device.name}</span>
            </div>
            <div className="flex items-center gap-2">
              {device.batteryLevel !== null && (
                <>
                  {device.batteryLevel < 20 && <Zap className="w-4 h-4 text-amber-500" />}
                  <Battery className={`w-4 h-4 ${device.batteryLevel < 20 ? 'text-amber-500' : 'text-green-500'}`} />
                  <span className="text-xs text-gray-600">{device.batteryLevel}%</span>
                </>
              )}
            </div>
          </div>
        ))}
        
        {devices.length === 0 && (
          <div className="text-center py-6 text-gray-500">
            <WifiOff className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No devices connected</p>
          </div>
        )}
      </div>

      {/* Connect Button */}
      <button
        onClick={onConnect}
        disabled={isConnecting}
        className={`w-full py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
          isConnecting
            ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
            : 'bg-[#FF4D35] hover:bg-[#e63e2b] text-white shadow-md hover:shadow-lg'
        }`}
      >
        {isConnecting ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Connecting...
          </div>
        ) : (
          'Connect All Devices'
        )}
      </button>
    </div>
  );
};

// Recording Control Component
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
          
          {/* Glow effect */}
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

// Motion Data Display Component
const MotionDataDisplay: React.FC<{ data: MotionData | null }> = ({ data }) => {
  if (!data) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Motion Data</h3>
        <div className="text-center text-gray-500 py-8">
          <div className="text-sm">No motion data available</div>
          <div className="text-xs text-gray-400 mt-1">Start recording to see real-time data</div>
        </div>
      </div>
    );
  }

  const KneeDisplay = ({ side, data }: { side: 'Left' | 'Right'; data: any }) => (
    <div className="bg-gray-50 rounded-lg p-4">
      <h4 className="font-medium text-gray-900 mb-3">{side} Knee</h4>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Current:</span>
          <span className="font-medium">{data.current.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Range:</span>
          <span className="font-medium">{data.rom.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Max:</span>
          <span className="font-medium">{data.max.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Min:</span>
          <span className="font-medium">{data.min.toFixed(1)}°</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Motion Data</h3>
      <div className="grid grid-cols-2 gap-4">
        <KneeDisplay side="Left" data={data.left} />
        <KneeDisplay side="Right" data={data.right} />
      </div>
      <div className="mt-4 text-xs text-gray-500 text-center">
        Last update: {new Date(data.timestamp).toLocaleTimeString()}
      </div>
    </div>
  );
};

// Window Controls Component
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

// Main Application Component
const ElectronMotionApp: React.FC = () => {
  const [wsPort, setWsPort] = useState<number>(8080);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [motionData, setMotionData] = useState<MotionData | null>(null);
  const [status, setStatus] = useState<any>(null);

  // Get WebSocket port from Electron
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.motion.getWebSocketPort().then(port => {
        setWsPort(port);
      });
    }
  }, []);

  // WebSocket connection
  const { isConnected, lastMessage } = useWebSocket(`ws://localhost:${wsPort}`);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    switch (lastMessage.type) {
      case 'status_update':
        setStatus(lastMessage.data);
        setDevices(lastMessage.data.connectedDevices || []);
        setIsRecording(lastMessage.data.isRecording || false);
        break;
      
      case 'device_status':
        setDevices(lastMessage.data.connectedDevices || []);
        break;
      
      case 'motion_data':
        setMotionData(lastMessage.data);
        break;
      
      case 'recording_state':
        setIsRecording(lastMessage.data.isRecording || false);
        break;
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

  const handleRecording = async () => {
    if (!window.electronAPI) return;

    try {
      if (isRecording) {
        const result = await window.electronAPI.motion.stopRecording();
        console.log('Stop recording result:', result);
      } else {
        const sessionData = {
          sessionId: `session_${Date.now()}`,
          exerciseId: `exercise_${Date.now()}`,
          setNumber: 1
        };
        const result = await window.electronAPI.motion.startRecording(sessionData);
        console.log('Start recording result:', result);
      }
    } catch (error) {
      console.error('Recording error:', error);
    }
  };

  const connectedCount = devices.filter(d => d.connected).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Custom Title Bar */}
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

      {/* Main Content */}
      <div className="p-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Device Status */}
          <DeviceStatus
            devices={devices}
            onConnect={handleConnect}
            isConnecting={isConnecting}
          />

          {/* Recording Control */}
          <RecordingControl
            isRecording={isRecording}
            onStartStop={handleRecording}
            connectedDevices={connectedCount}
          />
        </div>

        {/* Motion Data Display */}
        <MotionDataDisplay data={motionData} />

        {/* Status Bar */}
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