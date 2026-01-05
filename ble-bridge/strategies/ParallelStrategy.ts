/**
 * Parallel Connection Strategy
 * Connects to multiple devices simultaneously using Promise.all
 * Suitable for Noble on Windows/macOS where parallel connections are supported
 */

import {
  IConnectionStrategy,
  ConnectionResult,
  StrategyConfig,
  DEFAULT_STRATEGY_CONFIG,
} from '../interfaces/IConnectionStrategy';
import { IPeripheral } from '../interfaces/ITransport';

export class ParallelStrategy implements IConnectionStrategy {
  private config: StrategyConfig;

  constructor(config?: Partial<StrategyConfig>) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
  }

  async connect(peripherals: IPeripheral[]): Promise<ConnectionResult[]> {
    console.log(`[ParallelStrategy] Connecting to ${peripherals.length} devices in parallel`);

    const connectionPromises = peripherals.map(p => this.connectSingle(p));
    const results = await Promise.all(connectionPromises);

    const successful = results.filter(r => r.success).length;
    console.log(`[ParallelStrategy] Connected ${successful}/${peripherals.length} devices`);

    return results;
  }

  async connectSingle(peripheral: IPeripheral): Promise<ConnectionResult> {
    const deviceId = peripheral.id;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[ParallelStrategy] Retry ${attempt}/${this.config.maxRetries} for ${peripheral.name}`);
          await this.delay(this.config.retryDelayMs);
        }

        console.log(`[ParallelStrategy] Connecting to ${peripheral.name} (${deviceId})`);
        await peripheral.connect();

        // Trust the BLE library's connection result - if connect() resolved, we're connected
        if (peripheral.state !== 'connected') {
          lastError = `Unexpected state after connect: ${peripheral.state}`;
          console.warn(`[ParallelStrategy] ${peripheral.name}: ${lastError}`);
          continue;
        }

        console.log(`[ParallelStrategy] Successfully connected to ${peripheral.name}`);
        return {
          deviceId,
          success: true,
          peripheral,
        };

      } catch (error: any) {
        lastError = error?.message || 'Unknown connection error';
        console.warn(`[ParallelStrategy] Connection attempt ${attempt + 1} failed for ${peripheral.name}: ${lastError}`);
      }
    }

    console.error(`[ParallelStrategy] Failed to connect to ${peripheral.name} after ${this.config.maxRetries} attempts`);
    return {
      deviceId,
      success: false,
      peripheral: null,
      error: lastError,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
