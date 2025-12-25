/**
 * Device Identification Utilities
 *
 * Generates and manages unique device IDs, parses user-agent strings.
 */

const DEVICE_ID_KEY = "tropx_device_id";

// ─────────────────────────────────────────────────────────────────
// Device ID
// ─────────────────────────────────────────────────────────────────

/** Generate UUID v4 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/** Get existing device ID or create new one */
export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);

  if (!deviceId) {
    deviceId = generateUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }

  return deviceId;
}

/** Check if device ID exists */
export function hasDeviceId(): boolean {
  return localStorage.getItem(DEVICE_ID_KEY) !== null;
}

// ─────────────────────────────────────────────────────────────────
// User Agent Parsing
// ─────────────────────────────────────────────────────────────────

interface DeviceInfo {
  browser: string;
  os: string;
  deviceName: string;
}

const BROWSERS: [RegExp, string][] = [
  [/Electron\//i, "Desktop"], // Check Electron first (before Chrome)
  [/Edg\//i, "Edge"],
  [/OPR\//i, "Opera"],
  [/Chrome\//i, "Chrome"],
  [/Safari\//i, "Safari"],
  [/Firefox\//i, "Firefox"],
];

const OS_PATTERNS: [RegExp, string][] = [
  [/Windows NT 10/i, "Windows"],
  [/Windows NT/i, "Windows"],
  [/Mac OS X/i, "macOS"],
  [/Android/i, "Android"], // Check Android before Linux (Android UA contains "Linux")
  [/iPhone|iPad|iPod/i, "iOS"],
  [/CrOS/i, "ChromeOS"],
  [/Linux/i, "Linux"], // Generic Linux last
];

/** Parse user agent string into device info */
export function parseUserAgent(ua?: string): DeviceInfo {
  const userAgent = ua || navigator.userAgent;

  // Detect browser
  let browser = "Unknown Browser";
  for (const [pattern, name] of BROWSERS) {
    if (pattern.test(userAgent)) {
      browser = name;
      break;
    }
  }

  // Detect OS
  let os = "Unknown OS";
  for (const [pattern, name] of OS_PATTERNS) {
    if (pattern.test(userAgent)) {
      os = name;
      break;
    }
  }

  return {
    browser,
    os,
    deviceName: `${browser} | ${os}`,
  };
}

// ─────────────────────────────────────────────────────────────────
// Platform Detection
// ─────────────────────────────────────────────────────────────────

type Platform = "web" | "electron" | "electron-web";

/** Detect current platform */
export function getPlatform(): Platform {
  // Check if running in Electron
  const isElectron = typeof window !== "undefined" && "electronAPI" in window;

  if (!isElectron) {
    return "web";
  }

  // Check if it's the web view inside Electron or native Electron
  const isElectronWebView =
    window.location.protocol === "http:" ||
    window.location.protocol === "https:";

  return isElectronWebView ? "electron-web" : "electron";
}

/** Get full device registration info */
export function getDeviceInfo(): {
  deviceId: string;
  deviceName: string;
  platform: Platform;
  userAgent: string;
} {
  const { deviceName } = parseUserAgent();

  return {
    deviceId: getDeviceId(),
    deviceName,
    platform: getPlatform(),
    userAgent: navigator.userAgent,
  };
}
