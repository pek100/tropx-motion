/**
 * BLE Connection Logger
 * Logs all BLE operations to file for debugging connection issues on Raspberry Pi
 */

import * as fs from 'fs';
import * as path from 'path';

class BleLogger {
  private logFilePath: string;
  private logStream: fs.WriteStream | null = null;

  constructor() {
    const logDir = path.join(__dirname, '../../logs');

    // Ensure logs directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFilePath = path.join(logDir, `ble-connection-${timestamp}.log`);

    try {
      this.logStream = fs.createWriteStream(this.logFilePath, { flags: 'a' });
      this.log('INFO', 'BLE Logger initialized');
      this.log('INFO', `Log file: ${this.logFilePath}`);
    } catch (error) {
      console.error('Failed to create log file:', error);
    }
  }

  private formatMessage(level: string, category: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    let logLine = `[${timestamp}] [${level}] [${category}] ${message}`;

    if (data !== undefined) {
      try {
        logLine += ` | ${JSON.stringify(data, null, 2)}`;
      } catch (err) {
        logLine += ` | [Unserializable data]`;
      }
    }

    return logLine;
  }

  log(level: string, message: string, data?: any, category: string = 'BLE'): void {
    const formattedMessage = this.formatMessage(level, category, message, data);

    // Always log to console
    console.log(formattedMessage);

    // Write to file
    if (this.logStream) {
      this.logStream.write(formattedMessage + '\n');
    }
  }

  info(message: string, data?: any, category: string = 'BLE'): void {
    this.log('INFO', message, data, category);
  }

  warn(message: string, data?: any, category: string = 'BLE'): void {
    this.log('WARN', message, data, category);
  }

  error(message: string, data?: any, category: string = 'BLE'): void {
    this.log('ERROR', message, data, category);
  }

  debug(message: string, data?: any, category: string = 'BLE'): void {
    this.log('DEBUG', message, data, category);
  }

  // Connection-specific logging
  logConnection(deviceId: string, deviceName: string, phase: string, details?: any): void {
    this.info(`${phase} - ${deviceName} (${deviceId})`, details, 'CONNECTION');
  }

  logConnectionError(deviceId: string, deviceName: string, phase: string, error: any): void {
    this.error(`${phase} FAILED - ${deviceName} (${deviceId})`, {
      error: error?.message || String(error),
      stack: error?.stack
    }, 'CONNECTION');
  }

  // Noble event logging
  logNobleEvent(eventName: string, details?: any): void {
    this.info(`Noble event: ${eventName}`, details, 'NOBLE');
  }

  // Peripheral state logging
  logPeripheralState(deviceId: string, state: string, details?: any): void {
    this.info(`Peripheral state: ${state}`, { deviceId, ...details }, 'PERIPHERAL');
  }

  close(): void {
    if (this.logStream) {
      this.log('INFO', 'Closing BLE logger');
      this.logStream.end();
      this.logStream = null;
    }
  }

  getLogPath(): string {
    return this.logFilePath;
  }
}

// Singleton instance
export const bleLogger = new BleLogger();
