/**
 * Platform Detection Utility
 * Detects hardware platform and provides optimization recommendations
 */

import * as os from 'os';
import * as fs from 'fs';

export interface PlatformInfo {
  isRaspberryPi: boolean;
  model?: string;
  architecture: string;
  totalMemoryMB: number;
  cpuCount: number;
  platform: 'linux' | 'darwin' | 'win32' | 'unknown';
}

export interface OptimizationConfig {
  maxOldSpaceSize: number;
  useGPU: boolean;
  useAnimations: boolean;
  useSmoothScrolling: boolean;
  use2DCanvas: boolean;
  maxDevices: number;
  chartUpdateInterval: number;
}

export class PlatformDetector {
  private static _platformInfo: PlatformInfo | null = null;

  /**
   * Detect platform information
   */
  static detect(): PlatformInfo {
    if (this._platformInfo) {
      return this._platformInfo;
    }

    const platform = os.platform();
    const arch = os.arch();
    const totalMemoryMB = Math.round(os.totalmem() / (1024 * 1024));
    const cpuCount = os.cpus().length;

    let isRaspberryPi = false;
    let model: string | undefined;

    // Check if running on Raspberry Pi (Linux only)
    if (platform === 'linux') {
      try {
        // Check for Raspberry Pi device tree model
        if (fs.existsSync('/proc/device-tree/model')) {
          const modelBuffer = fs.readFileSync('/proc/device-tree/model');
          const modelString = modelBuffer.toString().replace(/\0/g, '');

          if (modelString.includes('Raspberry Pi')) {
            isRaspberryPi = true;
            model = modelString.trim();
          }
        }

        // Fallback: Check /proc/cpuinfo
        if (!isRaspberryPi && fs.existsSync('/proc/cpuinfo')) {
          const cpuInfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
          if (cpuInfo.includes('BCM') || cpuInfo.includes('Raspberry')) {
            isRaspberryPi = true;
            model = 'Raspberry Pi (detected from cpuinfo)';
          }
        }
      } catch (error) {
        console.warn('Could not detect Raspberry Pi:', error);
      }
    }

    this._platformInfo = {
      isRaspberryPi,
      model,
      architecture: arch,
      totalMemoryMB,
      cpuCount,
      platform: platform as any,
    };

    return this._platformInfo;
  }

  /**
   * Get optimization configuration based on platform
   */
  static getOptimizationConfig(): OptimizationConfig {
    const info = this.detect();

    // Desktop systems (>= 4GB RAM)
    if (!info.isRaspberryPi && info.totalMemoryMB >= 4096) {
      return {
        maxOldSpaceSize: 2048,
        useGPU: true,
        useAnimations: true,
        useSmoothScrolling: true,
        use2DCanvas: true,
        maxDevices: 8,
        chartUpdateInterval: 16, // 60fps
      };
    }

    // Raspberry Pi 4/5 (4GB+)
    if (info.isRaspberryPi && info.totalMemoryMB >= 3584) { // ~3.5GB usable
      return {
        maxOldSpaceSize: 1024,
        useGPU: false,
        useAnimations: false,
        useSmoothScrolling: false,
        use2DCanvas: true,
        maxDevices: 4,
        chartUpdateInterval: 33, // 30fps
      };
    }

    // Raspberry Pi 3B or low-memory systems (< 2GB)
    if (info.isRaspberryPi || info.totalMemoryMB < 2048) {
      return {
        maxOldSpaceSize: 400,
        useGPU: false,
        useAnimations: false,
        useSmoothScrolling: false,
        use2DCanvas: false,
        maxDevices: 2,
        chartUpdateInterval: 100, // 10fps
      };
    }

    // Desktop with 2-4GB RAM
    return {
      maxOldSpaceSize: 1024,
      useGPU: true,
      useAnimations: true,
      useSmoothScrolling: true,
      use2DCanvas: true,
      maxDevices: 4,
      chartUpdateInterval: 33, // 30fps
    };
  }

  /**
   * Get Electron command-line flags based on platform
   */
  static getElectronFlags(): string[] {
    const config = this.getOptimizationConfig();
    const flags: string[] = [];

    // Always use no-sandbox (required for some Linux environments)
    flags.push('--no-sandbox');

    // Memory optimization
    flags.push(`--js-flags=--max-old-space-size=${config.maxOldSpaceSize}`);

    // Disable features on low-end systems
    if (!config.useGPU) {
      flags.push('--disable-gpu');
      flags.push('--disable-software-rasterizer');
    }

    if (!config.useAnimations) {
      flags.push('--disable-animations');
    }

    if (!config.useSmoothScrolling) {
      flags.push('--disable-smooth-scrolling');
    }

    if (!config.use2DCanvas) {
      flags.push('--disable-accelerated-2d-canvas');
    }

    // Always disable shared memory on Linux (prevents crashes)
    if (os.platform() === 'linux') {
      flags.push('--disable-dev-shm-usage');
    }

    // Enable low-end device mode on constrained systems
    if (config.maxOldSpaceSize <= 400) {
      flags.push('--enable-low-end-device-mode');
      flags.push('--js-flags=--gc-interval=100');
    }

    return flags;
  }

  /**
   * Log platform information
   */
  static logPlatformInfo(): void {
    const info = this.detect();
    const config = this.getOptimizationConfig();

    console.log('');
    console.log('=== Platform Information ===');
    console.log(`Platform: ${info.platform}`);
    console.log(`Architecture: ${info.architecture}`);
    console.log(`CPU Cores: ${info.cpuCount}`);
    console.log(`Total Memory: ${info.totalMemoryMB} MB`);

    if (info.isRaspberryPi) {
      console.log(`🍓 Raspberry Pi detected: ${info.model}`);
    } else {
      console.log(`🖥️  Desktop/Laptop system`);
    }

    console.log('');
    console.log('=== Optimization Settings ===');
    console.log(`Max Heap Size: ${config.maxOldSpaceSize} MB`);
    console.log(`GPU Acceleration: ${config.useGPU ? 'Enabled' : 'Disabled'}`);
    console.log(`Animations: ${config.useAnimations ? 'Enabled' : 'Disabled'}`);
    console.log(`Max Devices: ${config.maxDevices}`);
    console.log(`Chart Update Rate: ${Math.round(1000 / config.chartUpdateInterval)} fps`);
    console.log('');
  }

  /**
   * Check if system has sufficient resources
   */
  static checkSystemRequirements(): { ok: boolean; warnings: string[] } {
    const info = this.detect();
    const warnings: string[] = [];

    // Minimum memory check
    if (info.totalMemoryMB < 512) {
      warnings.push(`⚠️  Very low memory: ${info.totalMemoryMB}MB (minimum 512MB recommended)`);
    } else if (info.totalMemoryMB < 1024) {
      warnings.push(`⚠️  Low memory: ${info.totalMemoryMB}MB (may experience performance issues)`);
    }

    // CPU check
    if (info.cpuCount < 2) {
      warnings.push(`⚠️  Single-core CPU detected (multi-core recommended)`);
    }

    // Raspberry Pi 3B specific warnings
    if (info.isRaspberryPi && info.model?.includes('Raspberry Pi 3') && info.totalMemoryMB < 1024) {
      warnings.push(`⚠️  Raspberry Pi 3B detected - expect slower performance`);
      warnings.push(`💡 Recommendation: Upgrade to Raspberry Pi 4 or 5 for better experience`);
    }

    return {
      ok: warnings.length === 0,
      warnings,
    };
  }
}
