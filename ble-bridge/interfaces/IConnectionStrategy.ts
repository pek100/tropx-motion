/**
 * Connection Strategy Interface
 * Defines how multiple device connections are handled (parallel vs sequential)
 */

import { IPeripheral } from './ITransport';

// ─────────────────────────────────────────────────────────────────────────────
// Connection Result
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectionResult {
  deviceId: string;
  success: boolean;
  peripheral: IPeripheral | null;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface StrategyConfig {
  // Sequential strategy settings
  interConnectionDelayMs: number;  // Delay between connections (BlueZ needs 200ms+)
  stateVerificationTimeoutMs: number;  // Max time to wait for connected state
  connectionTimeoutMs: number;  // Overall connection timeout
  maxRetries: number;  // Per-device retry attempts
  retryDelayMs: number;  // Delay between retries
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  interConnectionDelayMs: 200,
  stateVerificationTimeoutMs: 10000,
  connectionTimeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 500,
};

// ─────────────────────────────────────────────────────────────────────────────
// Connection Strategy Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface IConnectionStrategy {
  /**
   * Connect to multiple peripherals
   * Implementation handles parallel vs sequential logic
   * @param peripherals - Array of peripherals to connect
   * @returns Array of connection results (same order as input)
   */
  connect(peripherals: IPeripheral[]): Promise<ConnectionResult[]>;

  /**
   * Connect to a single peripheral
   * @param peripheral - Peripheral to connect
   * @returns Connection result
   */
  connectSingle(peripheral: IPeripheral): Promise<ConnectionResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy Type Enum
// ─────────────────────────────────────────────────────────────────────────────

export enum ConnectionStrategyType {
  PARALLEL = 'parallel',
  SEQUENTIAL = 'sequential',
}
