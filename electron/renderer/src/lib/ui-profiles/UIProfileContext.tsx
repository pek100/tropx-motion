/**
 * UI Profile Context - React provider and hook
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { UIProfile, ProfileId, UIProfileContextValue, DetectionContext } from './types';
import { getProfile, DEFAULT_PROFILE_ID, PROFILES } from './profiles';
import { detectProfile, getWindowDimensions, resolveProfile, buildDetectionContext } from './matchers';
import { getStoredOverride, setStoredOverride, clearOverride as clearStoredOverride } from './persistence';

// Context with undefined default (requires provider)
const UIProfileContext = createContext<UIProfileContextValue | undefined>(undefined);

// Debounce delay for resize events (ms)
const RESIZE_DEBOUNCE_MS = 150;

interface UIProfileProviderProps {
  children: ReactNode;
}

export function UIProfileProvider({ children }: UIProfileProviderProps) {
  // Current profile ID (either override or auto-detected)
  const [profileId, setProfileId] = useState<ProfileId>(DEFAULT_PROFILE_ID);

  // Override set by user (null = auto-detect)
  const [override, setOverrideState] = useState<ProfileId | null>(null);

  // Auto-detected profile (for display in selector)
  const [detectedProfileId, setDetectedProfileId] = useState<ProfileId>(DEFAULT_PROFILE_ID);

  // Detection context for resize handling
  const [context, setContext] = useState<DetectionContext | null>(null);

  // Debounce timer ref
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial detection on mount
  useEffect(() => {
    const init = async () => {
      // Load stored override
      const storedOverride = getStoredOverride();
      setOverrideState(storedOverride);

      // Detect profile from environment
      const detectionContext = await buildDetectionContext();
      setContext(detectionContext);

      const detected = resolveProfile(detectionContext);
      setDetectedProfileId(detected);

      // Use override if set, otherwise use detected
      setProfileId(storedOverride ?? detected);
    };

    init();
  }, []);

  // Re-detect on window resize (debounced)
  useEffect(() => {
    const handleResize = () => {
      // Clear existing timer
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }

      // Debounce: only process after resize stops
      resizeTimerRef.current = setTimeout(() => {
        if (!context) return;

        const dimensions = getWindowDimensions();
        const newContext: DetectionContext = {
          ...context,
          windowWidth: dimensions.width,
          windowHeight: dimensions.height,
        };

        const detected = resolveProfile(newContext);
        setDetectedProfileId(detected);

        // Only update profileId if no override is set
        if (override === null) {
          setProfileId(detected);
        }
      }, RESIZE_DEBOUNCE_MS);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
    };
  }, [context, override]);

  // Set override handler
  const setOverride = useCallback((newOverride: ProfileId | null) => {
    setOverrideState(newOverride);
    setStoredOverride(newOverride);

    if (newOverride === null) {
      // Revert to detected profile
      setProfileId(detectedProfileId);
    } else {
      setProfileId(newOverride);
    }

    // Emit custom event for external listeners
    window.dispatchEvent(new CustomEvent('uiprofilechange', {
      detail: { profileId: newOverride ?? detectedProfileId, isAutoDetected: newOverride === null }
    }));
  }, [detectedProfileId]);

  // Clear override handler
  const clearOverride = useCallback(() => {
    setOverride(null);
  }, [setOverride]);

  const value: UIProfileContextValue = {
    profile: getProfile(profileId),
    profileId,
    isAutoDetected: override === null,
    detectedProfileId,
    setOverride,
    clearOverride,
  };

  return (
    <UIProfileContext.Provider value={value}>
      {children}
    </UIProfileContext.Provider>
  );
}

// Hook to access profile context
export function useUIProfile(): UIProfileContextValue {
  const context = useContext(UIProfileContext);

  if (context === undefined) {
    throw new Error('useUIProfile must be used within a UIProfileProvider');
  }

  return context;
}

// Get all available profiles (for selector UI)
export function getAllProfiles(): UIProfile[] {
  return Object.values(PROFILES);
}
