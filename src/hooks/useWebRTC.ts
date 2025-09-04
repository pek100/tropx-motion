/**
 * High-performance React hook for WebRTC data channel management
 * Handles real-time sensor data transmission with ordered delivery
 */

import { useRef, useCallback, useMemo, useEffect } from 'react';
import { 
  WebRTCMessage, 
  MessageType, 
  UseWebRTCReturn,
  Callback,
  UnsubscribeFn 
} from '../core/types';
import { webRTCManager } from '../core/WebRTCManager';
import { PERFORMANCE_CONSTANTS } from '../core/constants';
import { useForceUpdate } from './useForceUpdate';

/**
 * Custom hook for WebRTC peer-to-peer communication
 */
export const useWebRTC = (connectionId?: string): UseWebRTCReturn => {
  const forceUpdate = useForceUpdate();
  const connectionIdRef = useRef<string>(connectionId || `conn_${Date.now()}`);
  const isConnectedRef = useRef<boolean>(false);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const connectionStateRef = useRef<RTCPeerConnectionState>('new');
  const messageSubscribersRef = useRef<Set<Callback<WebRTCMessage>>>(new Set());
  
  // Message queue for when connection is not ready
  const messageQueueRef = useRef<WebRTCMessage[]>([]);
  const maxQueueSizeRef = useRef<number>(PERFORMANCE_CONSTANTS.WEBRTC_BUFFER_SIZE / 1000);

  // Initialize connection
  const initializeConnection = useCallback(async () => {
    try {
      const connId = connectionIdRef.current;
      console.log(`Initializing WebRTC connection: ${connId}`);
      
      await webRTCManager.createConnection(connId);
      const dataChannel = webRTCManager.createDataChannel(connId, 'sensor-data');
      
      dataChannelRef.current = dataChannel;
      
      // Set up data channel event handlers
      dataChannel.onopen = () => {
        console.log(`WebRTC data channel opened: ${connId}`);
        isConnectedRef.current = true;
        
        // Flush queued messages
        if (messageQueueRef.current.length > 0) {
          console.log(`Flushing ${messageQueueRef.current.length} queued messages`);
          messageQueueRef.current.forEach(message => {
            webRTCManager.sendMessage(connId, message);
          });
          messageQueueRef.current.length = 0;
        }
        
        forceUpdate();
      };

      dataChannel.onclose = () => {
        console.log(`WebRTC data channel closed: ${connId}`);
        isConnectedRef.current = false;
        forceUpdate();
      };

      dataChannel.onerror = (error) => {
        console.error(`WebRTC data channel error: ${connId}`, error);
        isConnectedRef.current = false;
        forceUpdate();
      };

      console.log(`WebRTC connection initialized: ${connId}`);
      
    } catch (error) {
      console.error('Failed to initialize WebRTC connection:', error);
      isConnectedRef.current = false;
      forceUpdate();
    }
  }, [forceUpdate]);

  // Send data with queuing for reliability
  const sendData = useCallback((message: WebRTCMessage) => {
    const connId = connectionIdRef.current;
    
    if (!isConnectedRef.current || !dataChannelRef.current) {
      // Queue message if not connected
      if (messageQueueRef.current.length < maxQueueSizeRef.current) {
        messageQueueRef.current.push(message);
      } else {
        // Remove oldest message to make room
        messageQueueRef.current.shift();
        messageQueueRef.current.push(message);
        console.warn(`Message queue full for ${connId}, dropping oldest message`);
      }
      return;
    }

    try {
      webRTCManager.sendMessage(connId, message);
    } catch (error) {
      console.error(`Failed to send WebRTC message: ${connId}`, error);
      
      // Queue message for retry if send fails
      if (messageQueueRef.current.length < maxQueueSizeRef.current) {
        messageQueueRef.current.push(message);
      }
    }
  }, []);

  // Send high-frequency sensor data
  const sendSensorData = useCallback((deviceId: string, data: any) => {
    const message: WebRTCMessage = {
      type: MessageType.IMU_DATA,
      deviceId,
      timestamp: performance.now(),
      data,
    };
    
    sendData(message);
  }, [sendData]);

  // Send control messages
  const sendControlMessage = useCallback((deviceId: string, command: string, data?: any) => {
    const message: WebRTCMessage = {
      type: MessageType.CONTROL,
      deviceId,
      timestamp: performance.now(),
      data: { command, ...data },
    };
    
    sendData(message);
  }, [sendData]);

  // Subscribe to incoming messages
  const subscribe = useCallback((callback: Callback<WebRTCMessage>): UnsubscribeFn => {
    messageSubscribersRef.current.add(callback);
    
    return () => {
      messageSubscribersRef.current.delete(callback);
    };
  }, []);

  // Get connection statistics
  const getConnectionStats = useCallback(async () => {
    try {
      const stats = await webRTCManager.getConnectionStats(connectionIdRef.current);
      return stats;
    } catch (error) {
      console.error('Failed to get connection stats:', error);
      return null;
    }
  }, []);

  // Get performance metrics
  const getPerformanceMetrics = useCallback(() => {
    return webRTCManager.getPerformanceMetrics();
  }, []);

  // Set up WebRTC manager subscriptions
  useEffect(() => {
    const messageUnsubscribe = webRTCManager.onMessage((message) => {
      // Notify all subscribers
      messageSubscribersRef.current.forEach(callback => {
        try {
          callback(message);
        } catch (error) {
          console.error('WebRTC message subscriber error:', error);
        }
      });
    });

    const stateUnsubscribe = webRTCManager.onStateChange((state) => {
      const wasConnected = isConnectedRef.current;
      connectionStateRef.current = state;
      isConnectedRef.current = state === 'connected';
      
      if (wasConnected !== isConnectedRef.current) {
        forceUpdate();
      }
    });

    return () => {
      messageUnsubscribe();
      stateUnsubscribe();
    };
  }, [forceUpdate]);

  // Initialize connection on mount
  useEffect(() => {
    initializeConnection().catch(error => {
      console.error('Connection initialization failed:', error);
    });

    // Cleanup on unmount
    return () => {
      if (connectionIdRef.current) {
        webRTCManager.closeConnection(connectionIdRef.current);
      }
    };
  }, [initializeConnection]);

  // Connection health monitoring
  useEffect(() => {
    if (!isConnectedRef.current) return;

    const healthCheck = async () => {
      try {
        // Send heartbeat message
        const heartbeat: WebRTCMessage = {
          type: MessageType.HEARTBEAT,
          deviceId: 'system',
          timestamp: performance.now(),
          data: { connectionId: connectionIdRef.current },
        };
        
        sendData(heartbeat);
      } catch (error) {
        console.warn('Health check failed:', error);
      }
    };

    const interval = setInterval(healthCheck, PERFORMANCE_CONSTANTS.HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sendData]);

  // Memoized return value
  const returnValue = useMemo((): UseWebRTCReturn => ({
    isConnected: isConnectedRef.current,
    dataChannel: dataChannelRef.current,
    connectionState: connectionStateRef.current,
    sendData,
    subscribe,
    // Additional utility methods
    sendSensorData,
    sendControlMessage,
    getConnectionStats,
    getPerformanceMetrics,
    reinitialize: initializeConnection,
  }), [
    sendData,
    subscribe,
    sendSensorData,
    sendControlMessage,
    getConnectionStats,
    getPerformanceMetrics,
    initializeConnection,
    // Note: refs not included as they don't cause re-renders
  ]);

  return returnValue;
};