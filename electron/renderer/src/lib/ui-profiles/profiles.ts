/**
 * UI Profile Definitions
 * Each profile is complete and self-contained - no inheritance.
 */

import type { UIProfile, ProfileId } from './types';

export const DESKTOP: UIProfile = {
  id: 'desktop',
  label: 'Desktop',

  layout: {
    mode: 'centered',
    showHeader: true,
    showBorders: true,
    fullscreen: false,
    showConnectivity: true,
    defaultPage: 'record',
  },

  spacing: {
    buttonPx: 'px-4',
    buttonPy: 'py-2',
    gap: 'gap-3',
    gapSm: 'gap-2',
    cardPadding: 'p-6',
    sectionMargin: 'mb-4',
  },

  sizing: {
    iconSize: 16,
    iconSizeLg: 20,
    touchTarget: 'w-10 h-10',
    touchTargetSm: 'w-8 h-8',
    fontSize: 'text-sm',
    fontSizeLg: 'text-base',
  },

  features: {
    textLabels: true,
    dynamicIsland: false,
    clientLauncher: false,
    animations: true,
    tooltips: true,
  },
};

export const COMPACT: UIProfile = {
  id: 'compact',
  label: 'Compact',

  layout: {
    mode: 'split',
    showHeader: false,
    showBorders: false,
    fullscreen: false,
    showConnectivity: true,
    defaultPage: 'record',
  },

  spacing: {
    buttonPx: 'px-5',
    buttonPy: 'py-3',
    gap: 'gap-2',
    gapSm: 'gap-1',
    cardPadding: 'p-4',
    sectionMargin: 'mb-3',
  },

  sizing: {
    iconSize: 20,
    iconSizeLg: 24,
    touchTarget: 'w-11 h-11',
    touchTargetSm: 'w-10 h-10',
    fontSize: 'text-base',
    fontSizeLg: 'text-lg',
  },

  features: {
    textLabels: false,
    dynamicIsland: false,
    clientLauncher: false,
    animations: true,
    tooltips: true,
  },
};

export const KIOSK: UIProfile = {
  id: 'kiosk',
  label: 'Kiosk (Pi)',

  layout: {
    mode: 'split',
    showHeader: false,
    showBorders: false,
    fullscreen: true,
    showConnectivity: true,
    defaultPage: 'record',
  },

  spacing: {
    buttonPx: 'px-5',
    buttonPy: 'py-3',
    gap: 'gap-2',
    gapSm: 'gap-1',
    cardPadding: 'p-4',
    sectionMargin: 'mb-3',
  },

  sizing: {
    iconSize: 20,
    iconSizeLg: 24,
    touchTarget: 'w-11 h-11',
    touchTargetSm: 'w-10 h-10',
    fontSize: 'text-base',
    fontSizeLg: 'text-lg',
  },

  features: {
    textLabels: false,
    dynamicIsland: true,
    clientLauncher: true,
    animations: false,
    tooltips: false,
  },
};

export const TABLET: UIProfile = {
  id: 'tablet',
  label: 'Tablet',

  layout: {
    mode: 'centered',
    showHeader: true,
    showBorders: true,
    fullscreen: false,
    showConnectivity: true,
    defaultPage: 'record',
  },

  spacing: {
    buttonPx: 'px-4',
    buttonPy: 'py-2',
    gap: 'gap-3',
    gapSm: 'gap-2',
    cardPadding: 'p-5',
    sectionMargin: 'mb-4',
  },

  sizing: {
    iconSize: 18,
    iconSizeLg: 22,
    touchTarget: 'w-11 h-11',
    touchTargetSm: 'w-9 h-9',
    fontSize: 'text-sm',
    fontSizeLg: 'text-base',
  },

  features: {
    textLabels: true,
    dynamicIsland: false,
    clientLauncher: false,
    animations: true,
    tooltips: false,
  },
};

export const WEB: UIProfile = {
  id: 'web',
  label: 'Web',

  layout: {
    mode: 'centered',
    showHeader: true,
    showBorders: true,
    fullscreen: false,
    showConnectivity: false,
    defaultPage: 'dashboard',
  },

  spacing: {
    buttonPx: 'px-4',
    buttonPy: 'py-2',
    gap: 'gap-3',
    gapSm: 'gap-2',
    cardPadding: 'p-6',
    sectionMargin: 'mb-4',
  },

  sizing: {
    iconSize: 16,
    iconSizeLg: 20,
    touchTarget: 'w-10 h-10',
    touchTargetSm: 'w-8 h-8',
    fontSize: 'text-sm',
    fontSizeLg: 'text-base',
  },

  features: {
    textLabels: true,
    dynamicIsland: false,
    clientLauncher: false,
    animations: true,
    tooltips: true,
  },
};

// All profiles indexed by ID
export const PROFILES: Record<ProfileId, UIProfile> = {
  desktop: DESKTOP,
  compact: COMPACT,
  kiosk: KIOSK,
  tablet: TABLET,
  web: WEB,
};

// Default profile when no matcher hits and no override set
export const DEFAULT_PROFILE_ID: ProfileId = 'desktop';

// Get profile by ID with fallback
export function getProfile(id: ProfileId): UIProfile {
  return PROFILES[id] ?? PROFILES[DEFAULT_PROFILE_ID];
}
