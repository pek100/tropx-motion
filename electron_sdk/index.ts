// electron_sdk/index.ts  
// Public API for the Electron BLE SDK

// Export all types and interfaces
export * from './core/types';
// Ensure DEFAULT_FEATURE_FLAGS is explicitly exported
export { DEFAULT_FEATURE_FLAGS } from './core/types';

// Export all implementations
export { ElectronDeviceRegistry } from './core/ElectronDeviceRegistry';
export { ElectronIPCHandler } from './core/ElectronIPCHandler';
export { ElectronBLEManager } from './core/ElectronBLEManager';