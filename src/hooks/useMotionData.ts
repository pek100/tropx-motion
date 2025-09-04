/**
 * High-performance React hook for real-time motion data
 * Optimized for 16kHz sensor data with minimal re-renders
 */

import { useRef, useCallback, useMemo, useEffect } from 'react';
import { 
  MotionData, 
  DataQuality, 
  UseMotionDataReturn,
  Callback,
  UnsubscribeFn 
} from '../core/types';
import { streamDataManager } from '../core/StreamDataManager';
import { webRTCManager } from '../core/WebRTCManager';
import { PERFORMANCE_CONSTANTS } from '../core/constants';
import { useForceUpdate } from './useForceUpdate';

/**
 * Custom hook for managing real-time motion data with WebRTC streaming
 */
export const useMotionData = (): UseMotionDataReturn => {
  const forceUpdate = useForceUpdate();
  const motionDataRef = useRef<MotionData | null>(null);
  const isStreamingRef = useRef<boolean>(false);
  const dataRateRef = useRef<number>(0);
  const qualityRef = useRef<DataQuality>(DataQuality.NO_DATA);
  const subscribersRef = useRef<Set<Callback<MotionData>>>(new Set());
  
  // Throttled update for UI responsiveness
  const lastUIUpdateRef = useRef<number>(0);
  const uiUpdateThrottleMs = PERFORMANCE_CONSTANTS.UI_UPDATE_THROTTLE_MS;

  // Data rate calculation
  const dataTimestampsRef = useRef<number[]>([]);

  const updateDataRate = useCallback(() => {
    const now = performance.now();
    dataTimestampsRef.current.push(now);
    
    // Keep only recent timestamps (last second)
    const cutoff = now - 1000;
    dataTimestampsRef.current = dataTimestampsRef.current.filter(time => time > cutoff);
    
    dataRateRef.current = dataTimestampsRef.current.length;
  }, []);

  const handleMotionData = useCallback((data: MotionData) => {
    // Always update the ref immediately for subscribers
    motionDataRef.current = data;
    updateDataRate();
    
    // Notify all subscribers immediately (for data processing)
    subscribersRef.current.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Motion data subscriber error:', error);
      }
    });

    // Throttle UI updates to prevent overwhelming React
    const now = performance.now();
    if (now - lastUIUpdateRef.current >= uiUpdateThrottleMs) {
      lastUIUpdateRef.current = now;
      forceUpdate();
    }
  }, [updateDataRate, forceUpdate, uiUpdateThrottleMs]);

  const handleQualityChange = useCallback((quality: DataQuality) => {
    if (qualityRef.current !== quality) {
      qualityRef.current = quality;
      forceUpdate();
    }
  }, [forceUpdate]);

  // Subscribe to data updates
  useEffect(() => {
    console.log('Setting up motion data subscriptions...');
    
    const motionDataUnsubscribe = streamDataManager.onMotionData(handleMotionData);
    const qualityUnsubscribe = streamDataManager.onQualityChange(handleQualityChange);
    
    return () => {
      motionDataUnsubscribe();
      qualityUnsubscribe();
    };
  }, [handleMotionData, handleQualityChange]);

  // WebRTC connection monitoring
  useEffect(() => {
    const connectionUnsubscribe = webRTCManager.onStateChange((state) => {
      const wasStreaming = isStreamingRef.current;
      isStreamingRef.current = state === 'connected';
      
      if (wasStreaming !== isStreamingRef.current) {
        forceUpdate();
      }
    });

    return connectionUnsubscribe;
  }, [forceUpdate]);

  // Data quality monitoring based on data rate
  useEffect(() => {
    const monitorQuality = () => {
      const currentRate = dataRateRef.current;
      let newQuality: DataQuality;

      if (currentRate === 0) {
        newQuality = DataQuality.NO_DATA;
      } else if (currentRate >= 50) {
        newQuality = DataQuality.EXCELLENT;
      } else if (currentRate >= 20) {
        newQuality = DataQuality.GOOD;
      } else if (currentRate >= 10) {
        newQuality = DataQuality.FAIR;
      } else {
        newQuality = DataQuality.POOR;
      }

      if (qualityRef.current !== newQuality) {
        qualityRef.current = newQuality;
        forceUpdate();
      }
    };

    const interval = setInterval(monitorQuality, 1000);
    return () => clearInterval(interval);
  }, [forceUpdate]);

  // Subscription management for external consumers
  const subscribe = useCallback((callback: Callback<MotionData>): UnsubscribeFn => {
    subscribersRef.current.add(callback);
    
    // Immediately call with current data if available
    if (motionDataRef.current) {
      try {
        callback(motionDataRef.current);
      } catch (error) {
        console.error('Initial motion data callback error:', error);
      }
    }
    
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  // Performance monitoring
  const getPerformanceStats = useCallback(() => {
    return {
      dataRate: dataRateRef.current,
      quality: qualityRef.current,
      isStreaming: isStreamingRef.current,
      subscriberCount: subscribersRef.current.size,
      bufferSize: dataTimestampsRef.current.length,
    };
  }, []);

  // Memoized return value to prevent unnecessary re-renders of consuming components
  const returnValue = useMemo((): UseMotionDataReturn => ({
    motionData: motionDataRef.current,
    isStreaming: isStreamingRef.current,
    dataRate: dataRateRef.current,
    quality: qualityRef.current,
    subscribe,
    // Additional performance methods
    getPerformanceStats,
  }), [
    subscribe,
    getPerformanceStats,
    // Note: refs are not included in deps because they don't trigger re-renders
    // The forceUpdate calls handle triggering re-renders when needed
  ]);

  return returnValue;
};