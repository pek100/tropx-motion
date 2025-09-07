import React, { useState, useEffect } from 'react';
import { Activity, Zap, Globe, TrendingUp, BarChart3 } from 'lucide-react';

interface PerformanceMonitorProps {
  isConnected: boolean;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  messagesPerSecond: number;
  latency: number;
  getPerformanceStats: () => {
    totalMessages: number;
    binaryMessages: number;
    jsonMessages: number;
    averageLatency: number;
    dataTransferRate: number;
  };
}

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  isConnected,
  connectionQuality,
  messagesPerSecond,
  latency,
  getPerformanceStats
}) => {
  const [stats, setStats] = useState(() => getPerformanceStats());
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setStats(getPerformanceStats());
    }, 1000);
    
    return () => clearInterval(interval);
  }, [getPerformanceStats]);

  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'excellent': return 'text-green-500 bg-green-500/10';
      case 'good': return 'text-blue-500 bg-blue-500/10';
      case 'poor': return 'text-yellow-500 bg-yellow-500/10';
      default: return 'text-red-500 bg-red-500/10';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const binaryEfficiencyPercent = stats.totalMessages > 0 
    ? Math.round((stats.binaryMessages / stats.totalMessages) * 100) 
    : 0;

  return (
    <div className="bg-gray-50 border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Activity className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-medium text-gray-900">WebSocket Performance</h3>
        </div>
        <button 
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          {showDetails ? 'Less' : 'More'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Connection Status */}
        <div className={`px-2 py-1 rounded text-xs font-medium ${getQualityColor(connectionQuality)}`}>
          <div className="flex items-center space-x-1">
            <Globe className="h-3 w-3" />
            <span>{connectionQuality.toUpperCase()}</span>
          </div>
        </div>

        {/* Messages Per Second */}
        <div className="px-2 py-1 rounded text-xs font-medium text-purple-600 bg-purple-50">
          <div className="flex items-center space-x-1">
            <TrendingUp className="h-3 w-3" />
            <span>{messagesPerSecond}/s</span>
          </div>
        </div>

        {/* Latency */}
        <div className="px-2 py-1 rounded text-xs font-medium text-orange-600 bg-orange-50">
          <div className="flex items-center space-x-1">
            <Zap className="h-3 w-3" />
            <span>{latency}ms</span>
          </div>
        </div>

        {/* Binary Efficiency */}
        <div className="px-2 py-1 rounded text-xs font-medium text-green-600 bg-green-50">
          <div className="flex items-center space-x-1">
            <BarChart3 className="h-3 w-3" />
            <span>{binaryEfficiencyPercent}% binary</span>
          </div>
        </div>
      </div>

      {showDetails && (
        <div className="mt-4 pt-3 border-t border-gray-200">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-gray-500">Total Messages:</span>
              <span className="ml-1 font-medium">{stats.totalMessages.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">Binary Messages:</span>
              <span className="ml-1 font-medium text-green-600">{stats.binaryMessages.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">JSON Messages:</span>
              <span className="ml-1 font-medium text-blue-600">{stats.jsonMessages.toLocaleString()}</span>
            </div>
            <div>
              <span className="text-gray-500">Data Transfer:</span>
              <span className="ml-1 font-medium">{formatBytes(stats.dataTransferRate)}</span>
            </div>
            <div>
              <span className="text-gray-500">Avg Latency:</span>
              <span className="ml-1 font-medium">{stats.averageLatency}ms</span>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>
              <span className={`ml-1 font-medium ${isConnected ? 'text-green-600' : 'text-red-600'}`}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          {/* Performance Indicators */}
          <div className="mt-3 space-y-2">
            <div className="text-xs text-gray-600">
              <strong>Performance Indicators:</strong>
            </div>
            
            {messagesPerSecond > 50 && (
              <div className="text-xs text-green-600 flex items-center space-x-1">
                <span>✓</span>
                <span>High-frequency streaming active ({messagesPerSecond}/s)</span>
              </div>
            )}
            
            {binaryEfficiencyPercent > 70 && (
              <div className="text-xs text-green-600 flex items-center space-x-1">
                <span>✓</span>
                <span>Binary optimization enabled ({binaryEfficiencyPercent}% efficient)</span>
              </div>
            )}
            
            {latency < 50 && (
              <div className="text-xs text-green-600 flex items-center space-x-1">
                <span>✓</span>
                <span>Low latency communication ({latency}ms)</span>
              </div>
            )}
            
            {messagesPerSecond < 10 && isConnected && (
              <div className="text-xs text-yellow-600 flex items-center space-x-1">
                <span>⚠</span>
                <span>Low message rate - check streaming status</span>
              </div>
            )}
            
            {latency > 200 && isConnected && (
              <div className="text-xs text-yellow-600 flex items-center space-x-1">
                <span>⚠</span>
                <span>High latency detected - check network</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};