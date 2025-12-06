/**
 * UI Profile Persistence - Override storage
 */

import type { ProfileId } from './types';
import { PROFILES } from './profiles';

const STORAGE_KEY = 'tropx_ui_profile_override';

// Valid profile IDs derived from PROFILES
const VALID_PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];

// Get stored profile override (null means auto-detect)
export function getStoredOverride(): ProfileId | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored);
    if (typeof parsed === 'string' && isValidProfileId(parsed)) {
      return parsed as ProfileId;
    }
    return null;
  } catch {
    return null;
  }
}

// Set profile override (null clears override)
export function setStoredOverride(profileId: ProfileId | null): void {
  try {
    if (profileId === null) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profileId));
    }
  } catch {
    // localStorage may be unavailable
  }
}

// Clear override (alias for setStoredOverride(null))
export function clearOverride(): void {
  setStoredOverride(null);
}

// Validate profile ID against actual PROFILES
function isValidProfileId(value: string): value is ProfileId {
  return VALID_PROFILE_IDS.includes(value as ProfileId);
}
