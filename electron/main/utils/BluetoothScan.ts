/**
 * Simple Bluetooth scanner using PowerShell to find active connections
 * This is a lightweight alternative when Web Bluetooth API fails
 */

import { spawn } from 'child_process';
import { platform } from 'os';

export interface SimpleBluetoothDevice {
  name: string;
  address?: string;
  connected: boolean;
  type: 'BLE' | 'Classic' | 'Unknown';
}

export class BluetoothScan {
  /**
   * Quick scan for any Bluetooth devices using simple PowerShell
   */
  static async quickScan(): Promise<SimpleBluetoothDevice[]> {
    if (platform() !== 'win32') {
      console.log('🔍 Quick Bluetooth scan: Not on Windows, skipping');
      return [];
    }

    console.log('🔍 Running quick Bluetooth scan...');
    
    return new Promise((resolve) => {
      const devices: SimpleBluetoothDevice[] = [];
      
      // Simple PowerShell command to find Bluetooth devices
      const simpleScript = `
        # Quick scan for Bluetooth devices
        Write-Host "Scanning for Bluetooth devices..."
        
        # Get all devices with Bluetooth in the name or Tropx/Muse
        Get-PnpDevice | Where-Object {
          $_.Class -eq 'Bluetooth' -or
          $_.FriendlyName -like '*Bluetooth*' -or
          $_.FriendlyName -like '*tropx*' -or
          $_.FriendlyName -like '*muse*' -or
          $_.FriendlyName -like '*BLE*'
        } | Select-Object FriendlyName, InstanceId, Status | ForEach-Object {
          if ($_.FriendlyName) {
            Write-Output "$($_.FriendlyName)|$($_.InstanceId)|$($_.Status)"
          }
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass', 
        '-Command', simpleScript
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let output = '';
      
      powershell.stdout.on('data', (data) => {
        output += data.toString();
      });

      powershell.on('close', (code) => {
        console.log(`🔍 Quick Bluetooth scan completed with code: ${code}`);
        
        try {
          const lines = output.split('\n').filter(line => line.trim() && line.includes('|'));
          
          for (const line of lines) {
            const parts = line.trim().split('|');
            if (parts.length >= 3) {
              const [name, instanceId, status] = parts;
              
              if (name && name !== 'FriendlyName') {
                const device: SimpleBluetoothDevice = {
                  name: name.trim(),
                  address: this.extractAddress(instanceId),
                  connected: status.trim() === 'OK',
                  type: this.determineType(name, instanceId)
                };
                
                devices.push(device);
                console.log(`🔍 Quick scan found: ${device.name} (${device.type})`);
              }
            }
          }
          
          console.log(`🔍 Quick scan found ${devices.length} devices total`);
          
        } catch (error) {
          console.error('🔍 Error processing quick scan output:', error);
        }
        
        resolve(devices);
      });

      powershell.on('error', (error) => {
        console.error('🔍 Quick scan PowerShell error:', error);
        resolve([]);
      });

      // Quick timeout
      setTimeout(() => {
        powershell.kill();
        resolve(devices);
      }, 8000);
    });
  }

  /**
   * Extract MAC address from Windows instance ID
   */
  private static extractAddress(instanceId: string): string | undefined {
    if (!instanceId) return undefined;
    
    // Try to extract MAC-like pattern
    const macMatch = instanceId.match(/([0-9A-F]{2}[:-]?){5}[0-9A-F]{2}/i);
    if (macMatch) {
      return macMatch[0].replace(/[:-]/g, '').toUpperCase();
    }
    
    // Try to extract from BTHENUM pattern
    const bthMatch = instanceId.match(/BTHENUM.*?([0-9A-F]{12})/i);
    if (bthMatch) {
      const addr = bthMatch[1];
      return `${addr.slice(0,2)}:${addr.slice(2,4)}:${addr.slice(4,6)}:${addr.slice(6,8)}:${addr.slice(8,10)}:${addr.slice(10,12)}`;
    }
    
    return undefined;
  }

  /**
   * Determine if device is BLE or Classic based on name and instance ID
   */
  private static determineType(name: string, instanceId: string): 'BLE' | 'Classic' | 'Unknown' {
    const lowerName = name.toLowerCase();
    const lowerInstanceId = instanceId.toLowerCase();
    
    // BLE indicators
    if (lowerName.includes('ble') || 
        lowerName.includes('low energy') ||
        lowerName.includes('tropx') ||
        lowerName.includes('muse')) {
      return 'BLE';
    }
    
    // Classic Bluetooth indicators
    if (lowerName.includes('headset') || 
        lowerName.includes('mouse') || 
        lowerName.includes('keyboard') ||
        lowerInstanceId.includes('rfcomm')) {
      return 'Classic';
    }
    
    return 'Unknown';
  }

  /**
   * Get currently connected devices only
   */
  static async getConnectedDevices(): Promise<SimpleBluetoothDevice[]> {
    const allDevices = await this.quickScan();
    return allDevices.filter(device => device.connected);
  }

  /**
   * Find Tropx/Muse devices specifically
   */
  static async findTropxDevices(): Promise<SimpleBluetoothDevice[]> {
    const allDevices = await this.quickScan();
    return allDevices.filter(device => {
      const name = device.name.toLowerCase();
      return name.includes('tropx') || name.includes('muse');
    });
  }
}