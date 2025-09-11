// electron/renderer/config/featureFlags.ts
// Feature flags for ElectronBLE migration - enable one operation at a time

import type { ElectronBLEFeatureFlags } from '../../../electron_sdk';

// Feature flags for safe incremental migration
export const ELECTRON_BLE_FEATURE_FLAGS: ElectronBLEFeatureFlags = {
  // Phase 5.1: Scan operation migration
  USE_ELECTRON_BLE_SCAN: false,  // 🔴 DISABLED - revert to working system
  
  // Phase 5.2: Connect operation migration
  USE_ELECTRON_BLE_CONNECT: false,  // 🔴 DISABLED - revert to working system
  
  // Phase 5.3: Recording operation migration
  USE_ELECTRON_BLE_RECORD: false,  // 🔴 DISABLED by default - can be enabled for testing
};

// Environment-based feature flags (optional - for different deployment stages)
export const getFeatureFlags = (): ElectronBLEFeatureFlags => {
  // Could add environment-based overrides here if needed
  // const isDev = process.env.NODE_ENV === 'development';
  // const isTest = process.env.NODE_ENV === 'test';
  
  return ELECTRON_BLE_FEATURE_FLAGS;
};

// Logging for feature flag changes
console.log('🎛️ ElectronBLE Feature Flags:', JSON.stringify(ELECTRON_BLE_FEATURE_FLAGS, null, 2));

// Quick rollback - set all to false if anything breaks
export const EMERGENCY_DISABLE_ALL: ElectronBLEFeatureFlags = {
  USE_ELECTRON_BLE_SCAN: false,
  USE_ELECTRON_BLE_CONNECT: false,
  USE_ELECTRON_BLE_RECORD: false,
};