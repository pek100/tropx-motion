/**
 * Profile Matchers - Auto-detection logic
 */

import type { ProfileMatcher, DetectionContext, ProfileId, MatcherCondition } from './types';
import { DEFAULT_PROFILE_ID } from './profiles';

// Matchers ordered by priority (highest first)
export const PROFILE_MATCHERS: ProfileMatcher[] = [
  {
    profile: 'kiosk',
    conditions: { isRaspberryPi: true },
    priority: 100,
  },
  {
    profile: 'compact',
    conditions: { maxWidth: 480 },
    priority: 50,
  },
  {
    profile: 'tablet',
    conditions: { minWidth: 481, maxWidth: 1024 },
    priority: 25,
  },
  // No fallback matcher needed - DEFAULT_PROFILE_ID handles it
];

// Fetch platform info from main process
export async function getPlatformInfo(): Promise<{ platform: string; isRaspberryPi: boolean }> {
  try {
    const result = await window.electronAPI?.system?.getPlatformInfo();
    return {
      platform: result?.info?.platform ?? 'unknown',
      isRaspberryPi: result?.info?.isRaspberryPi ?? false,
    };
  } catch {
    return { platform: 'unknown', isRaspberryPi: false };
  }
}

// Get current window dimensions
export function getWindowDimensions(): { width: number; height: number } {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

// Evaluate a single matcher condition against context
export function evaluateMatcher(matcher: ProfileMatcher, context: DetectionContext): boolean {
  const { conditions } = matcher;

  if (conditions.platform !== undefined && conditions.platform !== context.platform) {
    return false;
  }

  if (conditions.isRaspberryPi !== undefined && conditions.isRaspberryPi !== context.isRaspberryPi) {
    return false;
  }

  if (conditions.maxWidth !== undefined && context.windowWidth > conditions.maxWidth) {
    return false;
  }

  if (conditions.minWidth !== undefined && context.windowWidth < conditions.minWidth) {
    return false;
  }

  if (conditions.maxHeight !== undefined && context.windowHeight > conditions.maxHeight) {
    return false;
  }

  if (conditions.minHeight !== undefined && context.windowHeight < conditions.minHeight) {
    return false;
  }

  return true;
}

// Resolve profile from context - returns highest priority match or default
export function resolveProfile(context: DetectionContext): ProfileId {
  // Sort by priority descending
  const sorted = [...PROFILE_MATCHERS].sort((a, b) => b.priority - a.priority);

  for (const matcher of sorted) {
    if (evaluateMatcher(matcher, context)) {
      return matcher.profile;
    }
  }

  return DEFAULT_PROFILE_ID;
}

// Build detection context from current environment
export async function buildDetectionContext(): Promise<DetectionContext> {
  const platformInfo = await getPlatformInfo();
  const dimensions = getWindowDimensions();

  return {
    platform: platformInfo.platform,
    isRaspberryPi: platformInfo.isRaspberryPi,
    windowWidth: dimensions.width,
    windowHeight: dimensions.height,
  };
}

// Resolve profile from current environment
export async function detectProfile(): Promise<ProfileId> {
  const context = await buildDetectionContext();
  return resolveProfile(context);
}
