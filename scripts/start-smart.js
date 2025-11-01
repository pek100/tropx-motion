#!/usr/bin/env node

/**
 * Smart Launch Script
 * Automatically detects platform and applies optimal Electron flags
 */

const { spawn } = require('child_process');
const path = require('path');

// Import platform detector (compile from TypeScript first if needed)
let PlatformDetector;
try {
  // Try to load compiled version
  const { PlatformDetector: PD } = require('../dist/main/shared/PlatformDetector');
  PlatformDetector = PD;
} catch (err) {
  // Fallback: compile on-the-fly using ts-node if available
  console.log('⚠️  Platform detector not compiled, using fallback...');
  try {
    require('ts-node/register');
    const { PlatformDetector: PD } = require('../shared/PlatformDetector.ts');
    PlatformDetector = PD;
  } catch (tsErr) {
    console.error('❌ Could not load platform detector. Please run: npm run build');
    process.exit(1);
  }
}

// Detect platform and get optimization config
console.log('🔍 Detecting platform...');
const info = PlatformDetector.detect();
const flags = PlatformDetector.getElectronFlags();

// Log platform information
PlatformDetector.logPlatformInfo();

// Check system requirements
const { ok, warnings } = PlatformDetector.checkSystemRequirements();
if (!ok) {
  console.log('⚠️  System Warnings:');
  warnings.forEach(warning => console.log(warning));
  console.log('');
}

// Set NODE_OPTIONS environment variable
const config = PlatformDetector.getOptimizationConfig();
process.env.NODE_OPTIONS = `--max-old-space-size=${config.maxOldSpaceSize}`;

// Determine Electron path
const electronPath = require('electron');

// Build command
const appPath = path.join(__dirname, '..');
const args = [appPath, ...flags];

console.log('🚀 Launching Electron...');
if (info.isRaspberryPi && config.maxOldSpaceSize <= 400) {
  console.log('⏳ Raspberry Pi 3B detected - please wait 60-90 seconds for startup...');
}
console.log('');

// Spawn Electron process
const electronProcess = spawn(electronPath, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: `--max-old-space-size=${config.maxOldSpaceSize}`,
  },
});

// Handle exit
electronProcess.on('close', (code) => {
  console.log('');
  console.log(`👋 Application closed with code ${code}`);
  process.exit(code || 0);
});

// Handle errors
electronProcess.on('error', (err) => {
  console.error('❌ Failed to start Electron:', err);
  process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, stopping...');
  electronProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, stopping...');
  electronProcess.kill('SIGTERM');
});
