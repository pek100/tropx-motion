/**
 * Platform Configuration
 * Detects the current platform and provides appropriate BLE configuration
 */

import { ConnectionStrategyType } from './interfaces/IConnectionStrategy';

// ─────────────────────────────────────────────────────────────────────────────
// Platform Detection
// ─────────────────────────────────────────────────────────────────────────────

export type PlatformType = 'windows' | 'macos' | 'linux' | 'unknown';
export type TransportType = 'noble' | 'node-ble';

export function detectPlatform(): PlatformType {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return 'unknown';
  }
}

export function isRaspberryPi(): boolean {
  // Check for Raspberry Pi by looking at CPU info or device tree
  try {
    const fs = require('fs');

    // Check device tree model
    if (fs.existsSync('/proc/device-tree/model')) {
      const model = fs.readFileSync('/proc/device-tree/model', 'utf8');
      if (model.toLowerCase().includes('raspberry pi')) {
        return true;
      }
    }

    // Check CPU info
    if (fs.existsSync('/proc/cpuinfo')) {
      const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
      if (cpuinfo.includes('BCM') || cpuinfo.includes('Raspberry')) {
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface BLEPlatformConfig {
  platform: PlatformType;
  transportType: TransportType;
  strategyType: ConnectionStrategyType;

  // Timing configuration (varies by platform)
  timing: {
    interConnectionDelayMs: number;
    gattStabilizationMs: number;
    gattRetryAttempts: number;
    gattRetryDelayMs: number;
    stateVerificationTimeoutMs: number;
    connectionTimeoutMs: number;
  };

  // Features
  features: {
    supportsParallelConnections: boolean;
    supportsParallelScanning: boolean;
    requiresZombieCleanup: boolean;
    requiresSequentialGatt: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Configurations
// ─────────────────────────────────────────────────────────────────────────────

const NOBLE_CONFIG: BLEPlatformConfig = {
  platform: 'windows',
  transportType: 'noble',
  strategyType: ConnectionStrategyType.PARALLEL,
  timing: {
    interConnectionDelayMs: 0,      // No delay needed for parallel
    gattStabilizationMs: 100,
    gattRetryAttempts: 2,
    gattRetryDelayMs: 300,
    stateVerificationTimeoutMs: 5000,
    connectionTimeoutMs: 30000,
  },
  features: {
    supportsParallelConnections: true,
    supportsParallelScanning: true,
    requiresZombieCleanup: false,
    requiresSequentialGatt: false,
  },
};

const NODEBLE_CONFIG: BLEPlatformConfig = {
  platform: 'linux',
  transportType: 'node-ble',
  strategyType: ConnectionStrategyType.SEQUENTIAL,
  timing: {
    interConnectionDelayMs: 200,    // BlueZ needs delay between connections
    gattStabilizationMs: 200,       // Wait for GATT to be ready
    gattRetryAttempts: 3,           // More retries for flaky BlueZ
    gattRetryDelayMs: 500,
    stateVerificationTimeoutMs: 10000,  // Longer timeout for BlueZ
    connectionTimeoutMs: 60000,     // Pi connections can be slow
  },
  features: {
    supportsParallelConnections: false,
    supportsParallelScanning: true,
    requiresZombieCleanup: true,
    requiresSequentialGatt: true,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Get Platform Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the BLE configuration for the current platform
 */
export function getPlatformConfig(): BLEPlatformConfig {
  const platform = detectPlatform();

  switch (platform) {
    case 'windows':
    case 'macos':
      // Use Noble on Windows/macOS
      return {
        ...NOBLE_CONFIG,
        platform,
      };

    case 'linux':
      // Use node-ble on Linux (especially Raspberry Pi)
      // Could also check isRaspberryPi() for Pi-specific tweaks
      if (isRaspberryPi()) {
        console.log('[PlatformConfig] Detected Raspberry Pi - using node-ble with Pi-optimized settings');
        return {
          ...NODEBLE_CONFIG,
          platform: 'linux',
          timing: {
            ...NODEBLE_CONFIG.timing,
            // Pi-specific tweaks
            connectionTimeoutMs: 60000,  // Pi 5 can take 45-50 seconds
            gattStabilizationMs: 250,    // Slightly longer for Pi
          },
        };
      }

      // Generic Linux - also use node-ble (BlueZ)
      console.log('[PlatformConfig] Detected Linux - using node-ble');
      return {
        ...NODEBLE_CONFIG,
        platform: 'linux',
      };

    default:
      // Unknown platform - try Noble as default
      console.warn('[PlatformConfig] Unknown platform - defaulting to Noble');
      return {
        ...NOBLE_CONFIG,
        platform: 'unknown',
      };
  }
}

/**
 * Force a specific transport type (for testing or override)
 */
export function getConfigForTransport(transportType: TransportType): BLEPlatformConfig {
  const platform = detectPlatform();

  if (transportType === 'noble') {
    return {
      ...NOBLE_CONFIG,
      platform,
    };
  } else {
    return {
      ...NODEBLE_CONFIG,
      platform,
    };
  }
}

/**
 * Check if Noble is available on this system
 */
export function isNobleAvailable(): boolean {
  try {
    require('@abandonware/noble');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if node-ble is available on this system
 */
export function isNodeBleAvailable(): boolean {
  try {
    require('node-ble');
    return true;
  } catch {
    return false;
  }
}
