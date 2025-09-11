// electron/renderer/config/featureFlags.ts
// Feature flags for ElectronBLE architecture - fully migrated and operational

import type { ElectronBLEFeatureFlags } from '../../../electron_sdk';

// Feature flags - ElectronBLE architecture fully migrated and enabled
export const ELECTRON_BLE_FEATURE_FLAGS: ElectronBLEFeatureFlags = {
  // Phase 5.1: Scan operation migration - COMPLETED ✅
  USE_ELECTRON_BLE_SCAN: true,  // 🟢 ENABLED - ElectronBLE scan system active
  
  // Phase 5.2: Connect operation migration - COMPLETED ✅  
  USE_ELECTRON_BLE_CONNECT: true,  // 🟢 ENABLED - ElectronBLE connect system active
  
  // Phase 5.3: Recording operation migration - COMPLETED ✅
  USE_ELECTRON_BLE_RECORD: true,  // 🟢 ENABLED - ElectronBLE recording system active
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

// Emergency disable option - use only if critical issues arise
export const EMERGENCY_DISABLE_ALL: ElectronBLEFeatureFlags = {
  USE_ELECTRON_BLE_SCAN: false,
  USE_ELECTRON_BLE_CONNECT: false,
  USE_ELECTRON_BLE_RECORD: false,
};