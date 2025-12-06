/**
 * UI Profile System - Type Definitions
 */

// Available profile identifiers
export type ProfileId = 'desktop' | 'compact' | 'kiosk' | 'tablet';

// Complete UI profile specification
export interface UIProfile {
  id: ProfileId;
  label: string;

  layout: {
    mode: 'centered' | 'split';
    showHeader: boolean;
    showBorders: boolean;
    fullscreen: boolean;
  };

  spacing: {
    buttonPx: string;
    buttonPy: string;
    gap: string;
    gapSm: string;
    cardPadding: string;
    sectionMargin: string;
  };

  sizing: {
    iconSize: number;
    iconSizeLg: number;
    touchTarget: string;
    touchTargetSm: string;
    fontSize: string;
    fontSizeLg: string;
  };

  features: {
    textLabels: boolean;
    dynamicIsland: boolean;
    clientLauncher: boolean;
    animations: boolean;
    tooltips: boolean;
  };
}

// Matcher condition for auto-detection
export interface MatcherCondition {
  platform?: 'linux' | 'darwin' | 'win32';
  isRaspberryPi?: boolean;
  maxWidth?: number;
  minWidth?: number;
  maxHeight?: number;
  minHeight?: number;
}

// Profile matcher with priority
export interface ProfileMatcher {
  profile: ProfileId;
  conditions: MatcherCondition;
  priority: number;
}

// Detection context passed to matchers
export interface DetectionContext {
  platform: string;
  isRaspberryPi: boolean;
  windowWidth: number;
  windowHeight: number;
}

// Profile context value exposed by hook
export interface UIProfileContextValue {
  profile: UIProfile;
  profileId: ProfileId;
  isAutoDetected: boolean;
  detectedProfileId: ProfileId;
  setOverride: (profileId: ProfileId | null) => void;
  clearOverride: () => void;
}
