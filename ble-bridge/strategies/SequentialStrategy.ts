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

        // Verify connection state with longer timeout for BlueZ
        const verified = await this.verifyConnectedState(peripheral);
        if (!verified) {
          lastError = 'Connection state verification failed';
          console.warn(`[SequentialStrategy] State verification failed for ${peripheral.name}`);
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

  private async verifyConnectedState(peripheral: IPeripheral): Promise<boolean> {
    const startTime = Date.now();
    const timeout = this.config.stateVerificationTimeoutMs;

    while (Date.now() - startTime < timeout) {
      if (peripheral.state === 'connected') {
        return true;
      }

      // For BlueZ, also check if we can get services as a secondary verification
      if (peripheral.state === 'connecting') {
        // Still in progress, wait a bit longer
        await this.delay(100);
        continue;
      }

      if (peripheral.state === 'disconnected') {
        // Connection failed
        return false;
      }

      await this.delay(50);
    }

    console.warn(`[SequentialStrategy] State verification timeout. Final state: ${peripheral.state}`);
    return peripheral.state === 'connected';
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
