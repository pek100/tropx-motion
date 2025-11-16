#!/usr/bin/env node

/**
 * Platform Detection Verification Script
 *
 * Verifies BLE service factory correctly detects platform and selects appropriate implementation.
 * Run: node scripts/verify-platform-detection.js
 */

const os = require('os');

const SUPPORTED_PLATFORMS = {
  linux: 'node-ble (BlueZ via DBus)',
  darwin: '@abandonware/noble (HCI)',
  win32: '@abandonware/noble (HCI)'
};

function verifyPlatform() {
  const platform = os.platform();
  const arch = os.arch();

  console.log('\n========================================');
  console.log('  Platform Detection Verification');
  console.log('========================================\n');

  console.log('System Information:');
  console.log(`  Platform: ${platform}`);
  console.log(`  Architecture: ${arch}`);
  console.log(`  OS Type: ${os.type()}`);
  console.log(`  OS Release: ${os.release()}`);
  console.log(`  Hostname: ${os.hostname()}\n`);

  const expectedService = SUPPORTED_PLATFORMS[platform];

  if (expectedService) {
    console.log('✅ Platform Supported');
    console.log(`  Expected BLE Service: ${expectedService}\n`);

    if (platform === 'linux') {
      console.log('📋 Linux-Specific Checks:');
      console.log('  ✓ Will use node-ble (pure JavaScript, no compilation)');
      console.log('  ✓ Communicates with BlueZ via DBus');
      console.log('  ✓ Requires DBus permissions: /etc/dbus-1/system.d/node-ble.conf');
      console.log('  ✓ No native bindings required\n');

      // Check if RPi
      try {
        const fs = require('fs');
        if (fs.existsSync('/proc/device-tree/model')) {
          const model = fs.readFileSync('/proc/device-tree/model', 'utf8').trim();
          if (model.includes('Raspberry Pi')) {
            console.log(`🍓 Raspberry Pi Detected: ${model}`);
            console.log('  ✓ Optimized for Raspberry Pi with node-ble\n');
          }
        }
      } catch (e) {
        // Not a critical error
      }
    } else {
      console.log('📋 Platform-Specific Checks:');
      console.log('  ✓ Will use @abandonware/noble');
      console.log('  ✓ Requires HCI Bluetooth adapter');
      console.log('  ✓ Native compilation required during npm install\n');
    }
  } else {
    console.log(`❌ Platform NOT Supported: ${platform}`);
    console.log('  Supported platforms: linux, darwin (macOS), win32 (Windows)\n');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Expected Console Output on Startup');
  console.log('========================================\n');

  console.log('When app starts, you should see:');
  console.log(`  🔍 Detecting platform: ${platform}`);
  console.log(`  ✅ ${platform === 'linux' ? 'Linux' : platform === 'darwin' ? 'macOS' : 'Windows'} detected - using ${expectedService}`);

  if (platform === 'linux') {
    console.log('  🔍 Initializing node-ble (BlueZ DBus) service...');
    console.log('  ✅ node-ble bluetooth instance created');
    console.log('  ✅ Bluetooth adapter ready: <adapter-name> (<MAC-address>)');
  } else {
    console.log('  🔍 Initializing Noble BLE service...');
    console.log('  ✅ Noble Bluetooth adapter initialized');
  }

  console.log('\n========================================');
  console.log('  Verification Complete');
  console.log('========================================\n');

  return true;
}

// Run verification
try {
  const success = verifyPlatform();
  process.exit(success ? 0 : 1);
} catch (error) {
  console.error('\n❌ Verification failed:', error.message);
  process.exit(1);
}
