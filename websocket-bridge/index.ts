// Unified WebSocket Bridge - Current Architecture
export { UnifiedWebSocketBridge, UnifiedBridgeConfig, UnifiedServices } from './UnifiedWebSocketBridge';

// Core Components
export { WebSocketServer } from './core/WebSocketServer';
export { ConnectionManager } from './core/ConnectionManager';
export { UnifiedMessageRouter } from './core/UnifiedMessageRouter';

// Domain Processors
export { BLEDomainProcessor } from './processors/BLEDomainProcessor';
export { StreamingDomainProcessor } from './processors/StreamingDomainProcessor';
export { SystemDomainProcessor } from './processors/SystemDomainProcessor';

// Protocol
export { BinaryProtocol } from './protocol/BinaryProtocol';
export { MessageValidator } from './protocol/MessageValidator';

// Transport
export { ReliableTransport } from './transport/ReliableTransport';
export { UnreliableTransport } from './transport/UnreliableTransport';
export { StreamingTransport } from './transport/StreamingTransport';

// Types
export * from './types/MessageTypes';
export * from './types/Interfaces';

// Utils
export { PortDiscovery } from './utils/PortDiscovery';

// Testing
export { PerformanceValidator, validatePerformance } from './test/PerformanceValidation';

// Unified bridge creation function
export async function createUnifiedWebSocketBridge(
  services: import('./UnifiedWebSocketBridge').UnifiedServices,
  config?: Partial<import('./UnifiedWebSocketBridge').UnifiedBridgeConfig>
): Promise<{ bridge: import('./UnifiedWebSocketBridge').UnifiedWebSocketBridge; port: number }> {
  const { UnifiedWebSocketBridge } = require('./UnifiedWebSocketBridge');
  const bridge = new UnifiedWebSocketBridge(config);
  const port = await bridge.initialize(services);

  return { bridge, port };
}