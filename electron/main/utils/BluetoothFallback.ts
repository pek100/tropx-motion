/**
 * Windows Bluetooth Discovery Fallback
 * 
 * When Electron's Web Bluetooth API fails to discover devices (common on Windows),
 * this module uses native Windows APIs to find Bluetooth devices and simulate
 * the select-bluetooth-device event with real device data.
 */

import { spawn } from 'child_process';
import { platform } from 'os';

export interface FallbackBluetoothDevice {
  deviceName: string;
  deviceId: string;
  paired?: boolean;
  deviceType?: string;
  address?: string;
}

export class BluetoothFallback {
  /**
   * Discover Bluetooth devices using native Windows PowerShell
   */
  static async discoverDevicesWindows(): Promise<FallbackBluetoothDevice[]> {
    if (platform() !== 'win32') {
      console.log('🔍 Bluetooth fallback: Not on Windows, skipping native discovery');
      return [];
    }

    console.log('🔍 Starting native Windows Bluetooth discovery...');
    
    return new Promise((resolve) => {
      const devices: FallbackBluetoothDevice[] = [];
      
      // Use PowerShell to get BLE devices specifically
      const powershellScript = `
        # Get BLE devices from multiple sources
        $devices = @()
        
        # Method 1: Get paired Bluetooth devices
        try {
          Get-PnpDevice -Class 'Bluetooth' | Where-Object { 
            $_.Status -eq 'OK' -and 
            $_.Present -eq $true -and
            ($_.FriendlyName -like '*tropx*' -or $_.FriendlyName -like '*muse*' -or $_.InstanceId -like '*BTHENUM*')
          } | ForEach-Object {
            $devices += @{
              Name = $_.FriendlyName
              DeviceID = $_.InstanceId
              Status = $_.Status
              Present = $_.Present
              Source = 'PnP'
            }
          }
        } catch {}
        
        # Method 2: Use WMI for Bluetooth radios
        try {
          Get-WmiObject -Class Win32_PnPEntity | Where-Object {
            ($_.Name -like '*Bluetooth*' -or $_.Name -like '*tropx*' -or $_.Name -like '*muse*') -and
            $_.DeviceID -like '*BTHENUM*'
          } | ForEach-Object {
            $devices += @{
              Name = $_.Name
              DeviceID = $_.DeviceID
              Status = 'OK'
              Present = $true
              Source = 'WMI'
            }
          }
        } catch {}
        
        # Method 3: Get from Bluetooth registry
        try {
          $regPath = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\BTHPORT\\Parameters\\Devices'
          if (Test-Path $regPath) {
            Get-ChildItem $regPath | ForEach-Object {
              $devicePath = $_.PSPath
              try {
                $name = Get-ItemPropertyValue -Path $devicePath -Name 'Name' -ErrorAction SilentlyContinue
                if ($name -and ($name -like '*tropx*' -or $name -like '*muse*')) {
                  $devices += @{
                    Name = $name
                    DeviceID = $_.PSChildName
                    Status = 'Registry'
                    Present = $true
                    Source = 'Registry'
                  }
                }
              } catch {}
            }
          }
        } catch {}
        
        # Output unique devices
        $devices | Sort-Object Name -Unique | ForEach-Object {
          $_ | ConvertTo-Json -Compress
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-Command', powershellScript
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let output = '';
      let errorOutput = '';

      powershell.stdout.on('data', (data) => {
        output += data.toString();
      });

      powershell.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      powershell.on('close', (code) => {
        console.log(`🔍 PowerShell Bluetooth discovery completed with code: ${code}`);
        
        if (errorOutput) {
          console.warn('🔍 PowerShell warnings:', errorOutput);
        }

        try {
          // Parse the JSON output
          const lines = output.trim().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const deviceInfo = JSON.parse(line);
              
              if (deviceInfo.Name && deviceInfo.DeviceID) {
                // Extract address from device ID if possible
                const addressMatch = deviceInfo.DeviceID.match(/([0-9A-F]{12})/i);
                const address = addressMatch ? addressMatch[1] : '';
                
                devices.push({
                  deviceName: deviceInfo.Name,
                  deviceId: deviceInfo.DeviceID,
                  paired: deviceInfo.Status === 'OK',
                  deviceType: 'Bluetooth',
                  address: address
                });
                
                console.log(`🔍 Found device: ${deviceInfo.Name} (${deviceInfo.DeviceID})`);
              }
            } catch (parseError) {
              console.warn('🔍 Error parsing device info:', parseError);
            }
          }
          
          console.log(`🔍 Native Windows discovery found ${devices.length} devices`);
          
        } catch (error) {
          console.error('🔍 Error processing PowerShell output:', error);
        }
        
        resolve(devices);
      });

      powershell.on('error', (error) => {
        console.error('🔍 PowerShell execution error:', error);
        resolve([]);
      });

      // Timeout after 15 seconds
      setTimeout(() => {
        console.log('🔍 PowerShell discovery timeout, killing process');
        powershell.kill();
        resolve(devices);
      }, 15000);
    });
  }

  /**
   * Alternative method using Windows WMI
   */
  static async discoverDevicesWMI(): Promise<FallbackBluetoothDevice[]> {
    if (platform() !== 'win32') {
      console.log('🔍 WMI Bluetooth fallback: Not on Windows, skipping');
      return [];
    }

    console.log('🔍 Starting WMI Bluetooth discovery...');
    
    return new Promise((resolve) => {
      const devices: FallbackBluetoothDevice[] = [];
      
      // WMI query for Bluetooth devices
      const wmiScript = `
        Get-WmiObject -Query "SELECT * FROM Win32_PnPEntity WHERE Service='BTHPORT' OR Service='BthEnum' OR DeviceID LIKE '%BTHENUM%'" | 
        Where-Object { $_.Name -ne $null -and $_.DeviceID -ne $null } |
        ForEach-Object {
          $deviceInfo = @{
            Name = $_.Name
            DeviceID = $_.DeviceID
            Status = $_.Status
            Present = $_.Present
          }
          $deviceInfo | ConvertTo-Json -Compress
        }
      `;

      const powershell = spawn('powershell.exe', [
        '-ExecutionPolicy', 'Bypass',
        '-Command', wmiScript
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      });

      let output = '';

      powershell.stdout.on('data', (data) => {
        output += data.toString();
      });

      powershell.on('close', (code) => {
        console.log(`🔍 WMI Bluetooth discovery completed with code: ${code}`);
        
        try {
          const lines = output.trim().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const deviceInfo = JSON.parse(line);
              
              if (deviceInfo.Name && deviceInfo.DeviceID) {
                devices.push({
                  deviceName: deviceInfo.Name,
                  deviceId: deviceInfo.DeviceID,
                  paired: deviceInfo.Status === 'OK',
                  deviceType: 'Bluetooth'
                });
                
                console.log(`🔍 WMI found device: ${deviceInfo.Name}`);
              }
            } catch (parseError) {
              // Ignore parsing errors for individual lines
            }
          }
          
          console.log(`🔍 WMI discovery found ${devices.length} devices`);
          
        } catch (error) {
          console.error('🔍 Error processing WMI output:', error);
        }
        
        resolve(devices);
      });

      powershell.on('error', (error) => {
        console.error('🔍 WMI execution error:', error);
        resolve([]);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        powershell.kill();
        resolve(devices);
      }, 10000);
    });
  }

  /**
   * Comprehensive device discovery using multiple methods
   */
  static async discoverAllDevices(): Promise<FallbackBluetoothDevice[]> {
    console.log('🔍 Starting comprehensive Bluetooth device discovery...');
    
    try {
      // Try both methods and combine results
      const [pnpDevices, wmiDevices] = await Promise.all([
        this.discoverDevicesWindows(),
        this.discoverDevicesWMI()
      ]);

      // Combine and deduplicate devices
      const allDevices = [...pnpDevices, ...wmiDevices];
      const uniqueDevices = new Map<string, FallbackBluetoothDevice>();
      
      allDevices.forEach(device => {
        const key = device.deviceId || device.deviceName;
        if (!uniqueDevices.has(key)) {
          uniqueDevices.set(key, device);
        }
      });

      const finalDevices = Array.from(uniqueDevices.values());
      console.log(`🔍 Comprehensive discovery found ${finalDevices.length} unique devices`);
      
      return finalDevices;
      
    } catch (error) {
      console.error('🔍 Comprehensive discovery error:', error);
      return [];
    }
  }
}