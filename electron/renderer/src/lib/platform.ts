/**
 * Platform detection utilities for TropX Motion
 * Detects whether running in Electron (desktop) or web browser
 */

/**
 * Check if running in Electron environment
 */
export function isElectron(): boolean {
  // Check for electronAPI which is injected by preload script
  return typeof window !== 'undefined' && !!window.electronAPI;
}

/**
 * Check if running in web browser (not Electron)
 */
export function isWeb(): boolean {
  return !isElectron();
}

/**
 * Feature availability flags
 */
export const features = {
  /**
   * BLE device connection and recording
   * Only available in Electron desktop app
   */
  get recording(): boolean {
    return isElectron();
  },

  /**
   * File system access (direct file writes, folder selection)
   * Only available in Electron desktop app
   */
  get fileSystem(): boolean {
    return isElectron();
  },

  /**
   * Window controls (minimize, maximize, close)
   * Only available in Electron desktop app
   */
  get windowControls(): boolean {
    return isElectron();
  },

  /**
   * Local motion server WebSocket connection
   * Only available in Electron desktop app
   */
  get motionServer(): boolean {
    return isElectron();
  },

  /**
   * Cloud sync and authentication
   * Available on both web and Electron
   */
  get cloudSync(): boolean {
    return true;
  },

  /**
   * View recordings (from cloud or imported)
   * Available on both web and Electron
   */
  get viewRecordings(): boolean {
    return true;
  },
};

/**
 * Platform info for display purposes
 */
export const platformInfo = {
  get name(): string {
    return isElectron() ? 'Desktop' : 'Web';
  },

  get downloadUrl(): string {
    // TODO: Update with actual download URL
    return 'https://tropx.ai/download';
  },
};
