// WebSocket Bridge - Main Export
export { WebSocketBridge, BridgeConfig, ExistingServices } from './WebSocketBridge';

// Core Components
export { WebSocketServer } from './core/WebSocketServer';
export { ConnectionManager } from './core/ConnectionManager';
export { MessageRouter } from './core/MessageRouter';

// Protocol
export { BinaryProtocol } from './protocol/BinaryProtocol';
export { MessageValidator } from './protocol/MessageValidator';

// Transport
export { ReliableTransport } from './transport/ReliableTransport';
export { UnreliableTransport } from './transport/UnreliableTransport';
export { StreamingTransport } from './transport/StreamingTransport';

// Handlers
export { BLEHandler } from './handlers/BLEHandler';
export { StreamingHandler } from './handlers/StreamingHandler';
export { SystemHandler } from './handlers/SystemHandler';

// Types
export * from './types/MessageTypes';
export * from './types/Interfaces';

// Utils
export { PortDiscovery } from './utils/PortDiscovery';

// Testing
export { PerformanceValidator, validatePerformance } from './test/PerformanceValidation';

// Quick start function for integration
export async function createWebSocketBridge(
  services: import('./WebSocketBridge').ExistingServices,
  config?: Partial<import('./WebSocketBridge').BridgeConfig>
): Promise<{ bridge: import('./WebSocketBridge').WebSocketBridge; port: number }> {
  const { WebSocketBridge } = require('./WebSocketBridge');
  const bridge = new WebSocketBridge(config);
  const port = await bridge.initialize(services);

  return { bridge, port };
}