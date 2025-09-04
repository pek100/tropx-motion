/**
 * High-performance React motion capture application
 * Optimized for 16kHz sensor data with minimal re-renders
 */

import React, { memo, useCallback, useMemo } from 'react';
import { Play, Pause, Wifi, WifiOff, Battery, Zap, X } from 'lucide-react';
import { DeviceState, MotionData, DataQuality } from '../core/types';
import { UI_CONSTANTS, PERFORMANCE_CONSTANTS } from '../core/constants';
import { useDeviceState } from '../hooks/useDeviceState';
import { useMotionData } from '../hooks/useMotionData';
import { useWebRTC } from '../hooks/useWebRTC';

// Memoized device card component
interface DeviceCardProps {
  device: {
    id: string;
    name: string;
    state: DeviceState;
    batteryLevel: number | null;
    connectionAttempts: number;
  };
  onConnect: (deviceId: string) => void;
  onDisconnect: (deviceId: string) => void;
  onStartStreaming: (deviceId: string) => void;
  onStopStreaming: (deviceId: string) => void;
  isRecording: boolean;
}

const DeviceCard = memo<DeviceCardProps>(({
  device,
  onConnect,
  onDisconnect,
  onStartStreaming,
  onStopStreaming,
  isRecording
}) => {
  const handleConnect = useCallback(() => onConnect(device.id), [onConnect, device.id]);
  const handleDisconnect = useCallback(() => onDisconnect(device.id), [onDisconnect, device.id]);
  const handleStartStreaming = useCallback(() => onStartStreaming(device.id), [onStartStreaming, device.id]);
  const handleStopStreaming = useCallback(() => onStopStreaming(device.id), [onStopStreaming, device.id]);

  const getStateColor = useMemo(() => {
    switch (device.state) {
      case DeviceState.CONNECTED_IDLE: return 'border-green-200 bg-green-50';
      case DeviceState.STREAMING: return 'border-blue-200 bg-blue-50';
      case DeviceState.CONNECTING: return 'border-yellow-200 bg-yellow-50';
      case DeviceState.ERROR: return 'border-red-200 bg-red-50';
      default: return 'border-gray-200 bg-gray-50';
    }
  }, [device.state]);

  const getStatusText = useMemo(() => {
    switch (device.state) {
      case DeviceState.CONNECTED_IDLE: return 'Connected';
      case DeviceState.STREAMING: return 'Streaming';
      case DeviceState.CONNECTING: return 'Connecting...';
      case DeviceState.ERROR: return 'Error';
      default: return 'Disconnected';
    }
  }, [device.state]);

  const isLowBattery = useMemo(() => 
    device.batteryLevel !== null && device.batteryLevel < 20, 
    [device.batteryLevel]
  );

  return (
    <div className={`p-4 rounded-lg border transition-colors ${getStateColor}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium text-gray-900">{device.name}</span>
            {device.state === DeviceState.STREAMING && (
              <div className="flex items-center gap-1 text-xs px-2 py-1 bg-red-100 text-red-700 rounded-full">
                <div className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                Live
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded border">{getStatusText}</span>
            
            {device.batteryLevel !== null && (
              <div className="flex items-center gap-1">
                {isLowBattery && <Zap className="w-3 h-3 text-amber-500" />}
                <span className={`text-xs px-2 py-1 rounded border ${
                  isLowBattery 
                    ? 'border-amber-300 text-amber-700 bg-amber-50'
                    : 'border-gray-200 text-gray-600 bg-gray-50'
                }`}>
                  <Battery className="w-3 h-3 inline mr-1" />
                  {Math.round(device.batteryLevel)}%
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          {device.state === DeviceState.DISCONNECTED_AVAILABLE && (
            <button
              onClick={handleConnect}
              className="px-3 py-2 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors"
            >
              Connect
            </button>
          )}

          {device.state === DeviceState.CONNECTED_IDLE && (
            <>
              <button
                onClick={handleStartStreaming}
                className="px-3 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
              >
                Start Stream
              </button>
              <button
                onClick={handleDisconnect}
                disabled={isRecording}
                className="px-3 py-2 text-sm bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
              >
                Disconnect
              </button>
            </>
          )}

          {device.state === DeviceState.STREAMING && (
            <button
              onClick={handleStopStreaming}
              className="px-3 py-2 text-sm bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
            >
              Stop Stream
            </button>
          )}

          {device.state === DeviceState.CONNECTING && (
            <div className="px-3 py-2 text-sm text-gray-600">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

DeviceCard.displayName = 'DeviceCard';

// Memoized device management panel
interface DeviceManagementProps {
  devices: Map<string, any>;
  onScan: () => void;
  onConnect: (deviceId: string) => void;
  onDisconnect: (deviceId: string) => void;
  onStartStreaming: (deviceId: string) => void;
  onStopStreaming: (deviceId: string) => void;
  isScanning: boolean;
  isRecording: boolean;
}

const DeviceManagement = memo<DeviceManagementProps>(({
  devices,
  onScan,
  onConnect,
  onDisconnect,
  onStartStreaming,
  onStopStreaming,
  isScanning,
  isRecording
}) => {
  const deviceArray = useMemo(() => Array.from(devices.values()), [devices]);
  const connectedCount = useMemo(() => 
    deviceArray.filter(d => d.state === DeviceState.CONNECTED_IDLE || d.state === DeviceState.STREAMING).length,
    [deviceArray]
  );

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200">
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Devices</h3>
            <p className="text-sm text-gray-500 mt-1">
              {connectedCount}/{deviceArray.length} connected
            </p>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {connectedCount > 0 ? (
                <Wifi className="w-5 h-5 text-green-500" />
              ) : (
                <WifiOff className="w-5 h-5 text-gray-400" />
              )}
              <span className="text-sm font-medium text-gray-700">
                {connectedCount}/{deviceArray.length}
              </span>
            </div>
            
            <button
              onClick={onScan}
              disabled={isScanning}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                isScanning
                  ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-500 hover:bg-blue-600 text-white shadow-sm'
              }`}
            >
              {isScanning ? (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Scanning...
                </div>
              ) : (
                'Scan Devices'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        {deviceArray.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <WifiOff className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-base font-medium mb-1">No devices found</p>
            <p className="text-sm text-gray-400">Click "Scan Devices" to discover sensors</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deviceArray.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                onConnect={onConnect}
                onDisconnect={onDisconnect}
                onStartStreaming={onStartStreaming}
                onStopStreaming={onStopStreaming}
                isRecording={isRecording}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

DeviceManagement.displayName = 'DeviceManagement';

// Memoized motion data display
interface MotionDataDisplayProps {
  motionData: MotionData | null;
  quality: DataQuality;
  dataRate: number;
}

const MotionDataDisplay = memo<MotionDataDisplayProps>(({ motionData, quality, dataRate }) => {
  const qualityColor = useMemo(() => {
    switch (quality) {
      case DataQuality.EXCELLENT: return 'text-green-600 bg-green-100';
      case DataQuality.GOOD: return 'text-blue-600 bg-blue-100';
      case DataQuality.FAIR: return 'text-yellow-600 bg-yellow-100';
      case DataQuality.POOR: return 'text-orange-600 bg-orange-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  }, [quality]);

  const formattedDataRate = useMemo(() => `${dataRate.toFixed(1)} Hz`, [dataRate]);

  if (!motionData) {
    return (
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Motion Data</h3>
        <div className="text-center py-8 text-gray-500">
          <p>No motion data available</p>
          <p className="text-sm text-gray-400 mt-1">Start streaming from a device to see data</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Motion Data</h3>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded ${qualityColor}`}>
            {quality}
          </span>
          <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
            {formattedDataRate}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="text-center">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Left Knee</h4>
          <div className="text-3xl font-bold text-blue-600 mb-1">
            {motionData.left.current.toFixed(1)}°
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <div>ROM: {motionData.left.rom.toFixed(1)}°</div>
            <div>Max: {motionData.left.max.toFixed(1)}°</div>
            <div>Min: {motionData.left.min.toFixed(1)}°</div>
          </div>
        </div>

        <div className="text-center">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Right Knee</h4>
          <div className="text-3xl font-bold text-green-600 mb-1">
            {motionData.right.current.toFixed(1)}°
          </div>
          <div className="text-xs text-gray-500 space-y-1">
            <div>ROM: {motionData.right.rom.toFixed(1)}°</div>
            <div>Max: {motionData.right.max.toFixed(1)}°</div>
            <div>Min: {motionData.right.min.toFixed(1)}°</div>
          </div>
        </div>
      </div>
    </div>
  );
});

MotionDataDisplay.displayName = 'MotionDataDisplay';

// Main application component
const OptimizedMotionApp = memo(() => {
  // Custom hooks for state management
  const {
    devices,
    scanForDevices,
    connectDevice,
    disconnectDevice,
    startStreaming,
    stopStreaming,
    isScanning,
    error: deviceError
  } = useDeviceState();

  const {
    motionData,
    isStreaming,
    dataRate,
    quality
  } = useMotionData();

  const {
    isConnected: webrtcConnected,
    connectionState: webrtcState,
    sendSensorData
  } = useWebRTC();

  // Memoized handlers
  const handleScanDevices = useCallback(async () => {
    try {
      await scanForDevices();
    } catch (error) {
      console.error('Scan failed:', error);
    }
  }, [scanForDevices]);

  const handleConnectDevice = useCallback(async (deviceId: string) => {
    try {
      await connectDevice(deviceId);
    } catch (error) {
      console.error('Connect failed:', error);
    }
  }, [connectDevice]);

  const handleDisconnectDevice = useCallback(async (deviceId: string) => {
    try {
      await disconnectDevice(deviceId);
    } catch (error) {
      console.error('Disconnect failed:', error);
    }
  }, [disconnectDevice]);

  const handleStartStreaming = useCallback(async (deviceId: string) => {
    try {
      await startStreaming(deviceId);
    } catch (error) {
      console.error('Start streaming failed:', error);
    }
  }, [startStreaming]);

  const handleStopStreaming = useCallback(async (deviceId: string) => {
    try {
      await stopStreaming(deviceId);
    } catch (error) {
      console.error('Stop streaming failed:', error);
    }
  }, [stopStreaming]);

  // Connection status indicator
  const connectionStatus = useMemo(() => {
    if (webrtcConnected && isStreaming) return { color: 'text-green-600', text: 'Connected & Streaming' };
    if (webrtcConnected) return { color: 'text-blue-600', text: 'Connected' };
    return { color: 'text-red-600', text: 'Disconnected' };
  }, [webrtcConnected, isStreaming]);

  // Performance metrics
  const formattedDataRate = useMemo(() => `${dataRate.toFixed(1)} Hz`, [dataRate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Wifi className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">TropX Motion</h1>
            <p className="text-sm text-gray-500">High-Performance Sensor Streaming</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              webrtcConnected ? 'bg-green-500' : 'bg-red-500'
            }`} />
            <span className={connectionStatus.color}>{connectionStatus.text}</span>
          </div>
          
          <button 
            onClick={() => window.close()}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="p-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DeviceManagement
            devices={devices}
            onScan={handleScanDevices}
            onConnect={handleConnectDevice}
            onDisconnect={handleDisconnectDevice}
            onStartStreaming={handleStartStreaming}
            onStopStreaming={handleStopStreaming}
            isScanning={isScanning}
            isRecording={false}
          />

          <MotionDataDisplay
            motionData={motionData}
            quality={quality}
            dataRate={dataRate}
          />
        </div>

        {/* Performance stats */}
        <div className="mt-6 bg-white rounded-xl shadow-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <div>WebRTC: <span className="font-medium">{webrtcState}</span></div>
            <div>Quality: <span className="font-medium">{quality}</span></div>
            <div>Data Rate: <span className="font-medium">{formattedDataRate}</span></div>
            <div>Devices: <span className="font-medium">{devices.size}</span></div>
          </div>
        </div>

        {/* Error display */}
        {deviceError && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-red-700">
              <span className="font-medium">Error:</span>
              <span>{deviceError.message}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

OptimizedMotionApp.displayName = 'OptimizedMotionApp';

export default OptimizedMotionApp;