/**
 * Sequential Connection Strategy
 * Connects to devices one at a time with delays between connections
 * Required for BlueZ/node-ble on Linux where parallel connections cause issues
 */

import {
  IConnectionStrategy,
  ConnectionResult,
  StrategyConfig,
  DEFAULT_STRATEGY_CONFIG,
} from '../interfaces/IConnectionStrategy';
import { IPeripheral } from '../interfaces/ITransport';

export class SequentialStrategy implements IConnectionStrategy {
  private config: StrategyConfig;
  private connectionQueue: Array<{
    peripheral: IPeripheral;
    resolve: (result: ConnectionResult) => void;
  }> = [];
  private isProcessing = false;

  constructor(config?: Partial<StrategyConfig>) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
  }

  async connect(peripherals: IPeripheral[]): Promise<ConnectionResult[]> {
    console.log(`[SequentialStrategy] Queueing ${peripherals.length} devices for sequential connection`);

    const results: ConnectionResult[] = [];

    for (const peripheral of peripherals) {
      const result = await this.connectSingle(peripheral);
      results.push(result);

      // Add inter-connection delay only after successful connections
      if (result.success && peripherals.indexOf(peripheral) < peripherals.length - 1) {
        console.log(`[SequentialStrategy] Inter-connection delay: ${this.config.interConnectionDelayMs}ms`);
        await this.delay(this.config.interConnectionDelayMs);
      }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`[SequentialStrategy] Connected ${successful}/${peripherals.length} devices`);

    return results;
  }

  async connectSingle(peripheral: IPeripheral): Promise<ConnectionResult> {
    return new Promise<ConnectionResult>(resolve => {
      this.connectionQueue.push({ peripheral, resolve });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.connectionQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.connectionQueue.length > 0) {
      const item = this.connectionQueue.shift()!;
      const result = await this.executeConnection(item.peripheral);
      item.resolve(result);

      // Small delay between queue items to let BlueZ settle
      if (this.connectionQueue.length > 0) {
        await this.delay(this.config.interConnectionDelayMs);
      }
    }

    this.isProcessing = false;
  }

  private async executeConnection(peripheral: IPeripheral): Promise<ConnectionResult> {
    const deviceId = peripheral.id;
    let lastError: string | undefined;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[SequentialStrategy] Retry ${attempt}/${this.config.maxRetries} for ${peripheral.name}`);
          await this.delay(this.config.retryDelayMs);
        }

        console.log(`[SequentialStrategy] Connecting to ${peripheral.name} (${deviceId})`);
        await peripheral.connect();

        // BlueZ needs extra time to stabilize the connection
        await this.delay(100);

        // Trust the BLE library's connection result - if connect() resolved, we're connected
        if (peripheral.state !== 'connected') {
          lastError = `Unexpected state after connect: ${peripheral.state}`;
          console.warn(`[SequentialStrategy] ${peripheral.name}: ${lastError}`);
          continue;
        }

        console.log(`[SequentialStrategy] Successfully connected to ${peripheral.name}`);
        return {
          deviceId,
          success: true,
          peripheral,
        };

      } catch (error: any) {
        lastError = error?.message || 'Unknown connection error';
        console.warn(`[SequentialStrategy] Connection attempt ${attempt + 1} failed for ${peripheral.name}: ${lastError}`);
      }
    }

    console.error(`[SequentialStrategy] Failed to connect to ${peripheral.name} after ${this.config.maxRetries} attempts`);
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
