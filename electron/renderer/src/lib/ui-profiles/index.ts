/**
 * UI Profile System - Public API
 */

// Types
export type {
  ProfileId,
  UIProfile,
  ProfileMatcher,
  MatcherCondition,
  DetectionContext,
  UIProfileContextValue,
} from './types';

// Profiles
export {
  DESKTOP,
  COMPACT,
  KIOSK,
  TABLET,
  PROFILES,
  DEFAULT_PROFILE_ID,
  getProfile,
} from './profiles';

// Matchers
export {
  PROFILE_MATCHERS,
  detectProfile,
  resolveProfile,
  buildDetectionContext,
} from './matchers';

// Persistence
export {
  getStoredOverride,
  setStoredOverride,
  clearOverride,
} from './persistence';

// React
export {
  UIProfileProvider,
  useUIProfile,
  getAllProfiles,
} from './UIProfileContext';
