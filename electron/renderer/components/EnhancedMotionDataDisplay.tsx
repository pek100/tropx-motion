import React, { useState, useMemo } from 'react';
import KneeAreaChart from './KneeAreaChart';
import { LineChart } from 'lucide-react';

interface KneeData {
  current: number;
  max: number;
  min: number;
  rom: number;
  devices?: string[];
  sensorTimestamp?: number;
  lastUpdate?: number;
}

interface MotionData {
  left: KneeData;
  right: KneeData;
  timestamp: number;
}

interface EnhancedMotionDataDisplayProps {
  data: any;
  isRecording: boolean;
  recordingStartTime?: Date | null;
}

/** Enhanced data parser that converts various motion data formats to standardized knee data */
const parseMotionData = (rawData: any): MotionData | null => {
  // DEBUG: Always log to see actual data structure
  console.log('📊 [CHART_DEBUG] parseMotionData received:', {
    type: typeof rawData,
    keys: Object.keys(rawData || {}),
    sample: rawData,
    hasLeft: rawData?.left,
    hasRight: rawData?.right,
    leftType: typeof rawData?.left,
    rightType: typeof rawData?.right
  });
  
  if (!rawData || typeof rawData !== 'object') {
    return null;
  }

  // Check if it's already in the expected format (from motion processing pipeline)
  if (rawData.left && rawData.right && typeof rawData.left.current === 'number' && typeof rawData.right.current === 'number') {
    return {
      left: {
        current: rawData.left.current,
        max: rawData.left.max || rawData.left.current,
        min: rawData.left.min || rawData.left.current,
        rom: rawData.left.rom || Math.abs((rawData.left.max || rawData.left.current) - (rawData.left.min || rawData.left.current)),
        devices: rawData.left.devices || [],
        sensorTimestamp: rawData.left.sensorTimestamp,
        lastUpdate: rawData.left.lastUpdate
      },
      right: {
        current: rawData.right.current,
        max: rawData.right.max || rawData.right.current,
        min: rawData.right.min || rawData.right.current,
        rom: rawData.right.rom || Math.abs((rawData.right.max || rawData.right.current) - (rawData.right.min || rawData.right.current)),
        devices: rawData.right.devices || [],
        sensorTimestamp: rawData.right.sensorTimestamp,
        lastUpdate: rawData.right.lastUpdate
      },
      timestamp: rawData.timestamp || Date.now()
    };
  }

  // Handle joint angle data from motion processing pipeline
  if (rawData && rawData.jointAngles) {
    console.log('📊 [CHART_DEBUG] Received processed joint angles from motion processing pipeline:', rawData.jointAngles);

    const timestamp = rawData.timestamp || Date.now();

    return {
      left: {
        current: rawData.jointAngles.left.current,
        max: rawData.jointAngles.left.max,
        min: rawData.jointAngles.left.min,
        rom: rawData.jointAngles.left.rom,
        devices: rawData.jointAngles.left.devices || [],
        sensorTimestamp: rawData.jointAngles.left.sensorTimestamp || timestamp,
        lastUpdate: rawData.jointAngles.left.lastUpdate || Date.now()
      },
      right: {
        current: rawData.jointAngles.right.current,
        max: rawData.jointAngles.right.max,
        min: rawData.jointAngles.right.min,
        rom: rawData.jointAngles.right.rom,
        devices: rawData.jointAngles.right.devices || [],
        sensorTimestamp: rawData.jointAngles.right.sensorTimestamp || timestamp,
        lastUpdate: rawData.jointAngles.right.lastUpdate || Date.now()
      },
      timestamp: timestamp
    };
  }

  // Handle quaternion data - should be processed by motion processing pipeline first
  if (rawData && rawData.quaternion) {
    console.log('⚠️ [CHART_DEBUG] Raw quaternion data received in UI - this should be processed by motion processing pipeline first:', rawData);
    console.log('📊 [CHART_DEBUG] Waiting for processed motion data from motion processing pipeline...');
    return null; // Don't process raw quaternions in UI
  }

  // No valid data format found
  console.log('📊 [CHART_DEBUG] No valid motion data format found:', rawData);
  return null;
};

const KneeDisplay: React.FC<{ side: 'Left' | 'Right'; data: KneeData }> = ({ side, data }) => {
  const colorClass = side === 'Left' ? 'text-blue-700' : 'text-red-700';
  const bgClass = side === 'Left' ? 'bg-blue-50' : 'bg-red-50';
  
  return (
    <div className={`${bgClass} rounded-lg p-4 border border-opacity-20 ${side === 'Left' ? 'border-blue-300' : 'border-red-300'}`}>
      <h4 className={`font-medium mb-3 ${colorClass}`}>{side} Knee</h4>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Current:</span>
          <span className={`font-bold ${colorClass}`}>{data.current.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Range of Motion:</span>
          <span className="font-medium">{data.rom.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Max Flexion:</span>
          <span className="font-medium">{data.max.toFixed(1)}°</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Max Extension:</span>
          <span className="font-medium">{data.min.toFixed(1)}°</span>
        </div>
        {data.devices && data.devices.length > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Devices:</span>
            <span className="text-xs font-medium">{data.devices.join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const EnhancedMotionDataDisplay: React.FC<EnhancedMotionDataDisplayProps> = ({ 
  data, 
  isRecording, 
  recordingStartTime 
}) => {
  const [showRawData, setShowRawData] = useState(false);
  const [showChart, setShowChart] = useState(true);
  
  // Parse and memoize the motion data
  const motionData = useMemo(() => parseMotionData(data), [data]);
  
  // Show test data if no motion data available and we're recording
  const shouldShowTestData = (!data || Object.keys(data).length === 0) && isRecording;
  
  if (!data || Object.keys(data).length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-lg border border-gray-200">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Motion Analysis</h3>
          
          {shouldShowTestData ? (
            <div className="text-center text-blue-600 py-12">
              <div className="text-6xl mb-4">⚙️</div>
              <div className="text-lg font-medium mb-2">Initializing Motion Processing</div>
              <div className="text-sm text-blue-500">
                Sensor data received, processing joint angles...
                <br />
                <span className="text-xs text-gray-500 mt-2 inline-block">
                  Check console for detailed processing logs
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center text-gray-500 py-12">
              <div className="flex justify-center">
                <LineChart size={86} className="text-[#FF4D35] mb-6" />
              </div>
              <div className="text-lg font-medium mb-2">No Motion Data</div>
              <div className="text-sm text-gray-400">Connect devices and start recording to see real-time knee angle analysis</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200">
      {/* Header with controls */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Motion Analysis</h3>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowChart(!showChart)}
              className={`text-sm px-3 py-1 rounded-md transition-colors ${
                showChart 
                  ? 'bg-[#FF4D35] text-white hover:bg-[#e63e2b]' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {showChart ? '📊 Chart View' : '📋 Data View'}
            </button>
            <button
              onClick={() => setShowRawData(!showRawData)}
              className="text-sm px-3 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 transition-colors"
            >
              {showRawData ? 'UI Display' : 'JSON Output'}
            </button>
          </div>
        </div>

        {/* Status indicators */}
        {motionData && (
          <div className="flex items-center gap-4 text-sm">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
              isRecording 
                ? 'bg-red-100 text-red-700' 
                : 'bg-green-100 text-green-700'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isRecording ? 'bg-red-500 animate-pulse' : 'bg-green-500'
              }`} />
              {isRecording ? 'Recording' : 'Live Data'}
            </div>
            <div className="text-gray-500">
              Last update: {new Date(motionData.timestamp).toLocaleTimeString()}
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Processed motion data display */}
        {motionData && !showRawData && (
          <>
            {showChart ? (
              <div className="h-96 mb-6">
                <KneeAreaChart
                  leftKnee={motionData.left}
                  rightKnee={motionData.right}
                  isRecording={isRecording}
                  recordingStartTime={recordingStartTime}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <KneeDisplay side="Left" data={motionData.left} />
                <KneeDisplay side="Right" data={motionData.right} />
              </div>
            )}
            
            {/* Summary stats */}
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-3">Session Summary</h4>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div className="text-center">
                  <div className="font-bold text-blue-600">{motionData.left.current.toFixed(1)}°</div>
                  <div className="text-gray-500">Left Current</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-red-600">{motionData.right.current.toFixed(1)}°</div>
                  <div className="text-gray-500">Right Current</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-green-600">{motionData.left.rom.toFixed(1)}°</div>
                  <div className="text-gray-500">Left ROM</div>
                </div>
                <div className="text-center">
                  <div className="font-bold text-green-600">{motionData.right.rom.toFixed(1)}°</div>
                  <div className="text-gray-500">Right ROM</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* JSON output when requested */}
        {showRawData && (
          <div className="bg-gray-50 rounded-lg p-4 overflow-auto max-h-96">
            <div className="text-sm font-medium text-gray-700 mb-2">Raw Data JSON:</div>
            <pre className="text-xs text-gray-800 whitespace-pre-wrap">
              {JSON.stringify(data, null, 2)}
            </pre>
            {motionData && (
              <>
                <div className="text-sm font-medium text-gray-700 mt-4 mb-2">Parsed Motion Data:</div>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap">
                  {JSON.stringify(motionData, null, 2)}
                </pre>
              </>
            )}
          </div>
        )}

        {/* Show message when no processed data available */}
        {!motionData && (
          <div className="text-center text-gray-500 py-8">
            <div className="text-lg font-medium mb-2">Processing Motion Data...</div>
            <div className="text-sm text-gray-400">
              Raw sensor data received but not yet processed into knee angles.
              <br />
              Make sure motion processing pipeline is running.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default EnhancedMotionDataDisplay;