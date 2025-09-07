/**
 * useOptimizedBinaryWebSocket.tsx
 * 
 * React hook for ultra-fast binary WebSocket communication
 * Eliminates JSON parsing bottlenecks on the client side
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { OptimizedBinaryProtocol, MESSAGE_TYPES } from '../utils/OptimizedBinaryProtocol';

interface MotionData {
  left: { current: number; max: number; min: number; rom: number };
  right: { current: number; max: number; min: number; rom: number };
  timestamp: number;
}

interface BinaryWebSocketHook {
  isConnected: boolean;
  motionData: MotionData | null;
  performanceStats: {
    messagesReceived: number;
    avgProcessingTime: number;
    binaryProtocolActive: boolean;
  };
  reconnect: () => void;
}

export const useOptimizedBinaryWebSocket = (url: string): BinaryWebSocketHook => {
  const [isConnected, setIsConnected] = useState(false);
  const [motionData, setMotionData] = useState<MotionData | null>(null);
  const [performanceStats, setPerformanceStats] = useState({
    messagesReceived: 0,
    avgProcessingTime: 0,
    binaryProtocolActive: false
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const connectionInProgressRef = useRef(false);

  // Performance tracking
  const totalProcessingTimeRef = useRef(0);
  const messageCountRef = useRef(0);

  const connect = useCallback(() => {
    if (connectionInProgressRef.current) {
      console.log('🔌 Binary WebSocket connection already in progress');
      return;
    }

    try {
      connectionInProgressRef.current = true;
      console.log('⚡ Attempting optimized binary WebSocket connection to:', url);
      
      const websocket = new WebSocket(url);
      websocket.binaryType = 'arraybuffer'; // CRITICAL: Enable binary data reception

      websocket.onopen = () => {
        console.log('⚡ Optimized binary WebSocket connected to:', url);
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
        connectionInProgressRef.current = false;
        
        setPerformanceStats(prev => ({ ...prev, binaryProtocolActive: true }));

        // Send initial status request (fallback to JSON for control messages)
        websocket.send(JSON.stringify({ type: 'request_status' }));
      };

      websocket.onmessage = (event) => {
        const startTime = performance.now();

        try {
          // Check if message is binary data
          if (event.data instanceof ArrayBuffer) {
            handleBinaryMessage(event.data);
          } else {
            // Fallback to JSON for control messages
            handleJsonMessage(event.data);
          }

          // Track performance
          const processingTime = performance.now() - startTime;
          totalProcessingTimeRef.current += processingTime;
          messageCountRef.current++;

          // Update performance stats every 100 messages
          if (messageCountRef.current % 100 === 0) {
            const avgTime = totalProcessingTimeRef.current / messageCountRef.current;
            setPerformanceStats(prev => ({
              messagesReceived: messageCountRef.current,
              avgProcessingTime: avgTime,
              binaryProtocolActive: prev.binaryProtocolActive
            }));
          }

        } catch (error) {
          console.error('Failed to process WebSocket message:', error);
        }
      };

      websocket.onclose = () => {
        console.log('⚡ Optimized binary WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;
        connectionInProgressRef.current = false;
        setPerformanceStats(prev => ({ ...prev, binaryProtocolActive: false }));

        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        }
      };

      websocket.onerror = (error) => {
        console.error('Optimized binary WebSocket error:', error);
        connectionInProgressRef.current = false;
      };

      wsRef.current = websocket;
    } catch (error) {
      console.error('Failed to create optimized binary WebSocket connection:', error);
      connectionInProgressRef.current = false;
    }
  }, [url]);

  const handleBinaryMessage = (buffer: ArrayBuffer) => {
    const messageType = OptimizedBinaryProtocol.getMessageType(buffer);

    switch (messageType) {
      case MESSAGE_TYPES.MOTION_DATA:
        const motionMessage = OptimizedBinaryProtocol.deserializeMotionData(buffer);
        const deviceName = OptimizedBinaryProtocol.getDeviceNameFromMessage(motionMessage);
        
        // Convert quaternion back to joint angle (simplified)
        const angle = Math.atan2(motionMessage.quaternion.y, motionMessage.quaternion.w) * 2 * 180 / Math.PI;
        
        // Update motion data based on device
        setMotionData(prev => {
          const updated = prev ? { ...prev } : {
            left: { current: 0, max: 0, min: 0, rom: 0 },
            right: { current: 0, max: 0, min: 0, rom: 0 },
            timestamp: Date.now()
          };

          if (deviceName.includes('left')) {
            updated.left = { ...updated.left, current: angle };
          } else if (deviceName.includes('right')) {
            updated.right = { ...updated.right, current: angle };
          }

          updated.timestamp = motionMessage.timestamp;
          return updated;
        });
        break;

      case MESSAGE_TYPES.DEVICE_STATUS:
        const statusMessage = OptimizedBinaryProtocol.deserializeDeviceStatus(buffer);
        console.log('📊 Binary device status received:', statusMessage.devices.length, 'devices');
        break;

      case MESSAGE_TYPES.HEARTBEAT:
        // Handle heartbeat - no action needed
        break;

      default:
        console.warn(`Unknown binary message type: ${messageType}`);
    }
  };

  const handleJsonMessage = (data: string) => {
    // Fallback for control messages that still use JSON
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'status_update':
          // Handle status updates
          break;
        case 'device_status':
          // Handle device status
          break;
        default:
          console.log('📨 JSON control message:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse JSON control message:', error);
    }
  };

  const reconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    connect();
  }, [connect]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    isConnected,
    motionData,
    performanceStats,
    reconnect
  };
};

export default useOptimizedBinaryWebSocket;