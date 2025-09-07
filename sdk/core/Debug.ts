/**
 * Debug.ts
 * 
 * Provides utilities for debugging device communication and data processing.
 * This helps track the flow of commands and data between the app and device.
 */

import { IMUData } from './MuseData';

export class DebugLogger {
  /**
   * Logs a command being sent to the device
   */
  static logCommand(name: string, data: Uint8Array) {
    console.log(
      `[Muse Command] ${name}: ${Array.from(data)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')}`
    );
  }

  /**
   * Logs data received from the device
   */
  static logResponse(name: string, data: Uint8Array) {
    console.log(
      `[Muse Response] ${name}: ${Array.from(data)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ')}`
    );
  }

  /**
   * Logs processed IMU data
   */
  static logData(data: IMUData) {
    console.log('[Muse Data]', {
      timestamp: data.timestamp,
      gyr: data.gyr ? {
        x: data.gyr.x.toFixed(3),
        y: data.gyr.y.toFixed(3),
        z: data.gyr.z.toFixed(3)
      } : null,
      axl: data.axl ? {
        x: data.axl.x.toFixed(3),
        y: data.axl.y.toFixed(3),
        z: data.axl.z.toFixed(3)
      } : null,
      mag: data.mag ? {
        x: data.mag.x.toFixed(3),
        y: data.mag.y.toFixed(3),
        z: data.mag.z.toFixed(3)
      } : null
    });
  }

  /**
   * Logs any errors that occur during device communication
   */
  static logError(context: string, error: any) {
    console.error(`[Muse Error] ${context}:`, error);
  }
}