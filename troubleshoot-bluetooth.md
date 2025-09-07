# 🔧 Bluetooth Troubleshooting Guide

## Current Issue: Empty Device Lists in Electron Web Bluetooth

Your logs show that:
- ✅ Web Bluetooth API is working (`bluetoothAvailable: true`)  
- ✅ Loop collection method is working (multiple scan attempts)
- ❌ No BLE devices are being discovered (`Raw device list: []`)

## Root Cause Analysis

Based on comprehensive research, the issue is **NOT** with your Electron app - it's with:
1. **Device advertising status** - Devices must be in BLE advertising/discoverable mode
2. **Windows Bluetooth stack** - Driver or system-level issues
3. **BLE vs Classic Bluetooth** - Web Bluetooth only discovers BLE devices

## Immediate Solutions to Try

### 1. 🔍 Check Device Status
```bash
# Your devices should appear as:
tropx_ln_bottom (00:80:E1:26:2F:E2) ✅ Previously discovered
tropx_ln_top (00:80:E1:27:27:99)    ✅ Previously discovered
```

**Action**: Ensure your Tropx devices are:
- Powered on and charged
- In BLE advertising/pairing mode (check device manual)
- Within 3 feet of your computer
- Not already connected to another device

### 2. 🖥️ Windows Bluetooth System Check

**Option A: Quick System Check**
1. Open **Settings** → **Devices** → **Bluetooth & other devices**
2. Turn Bluetooth OFF and ON again
3. Check if Tropx devices appear in the list
4. If they appear, try removing and re-pairing them

**Option B: Driver Update**
1. Open **Device Manager** (Win+X → Device Manager)
2. Expand **"Bluetooth"** section
3. Right-click your Bluetooth adapter
4. Select **"Update driver"** → **"Search automatically"**
5. Restart your computer after driver update

**Option C: Bluetooth Service Reset**
1. Press **Win+R**, type `services.msc`
2. Find **"Bluetooth Support Service"**
3. Right-click → **"Restart"**
4. Also restart **"Bluetooth Audio Gateway Service"** if present

### 3. 🔧 Chrome Bluetooth Debugger

**Critical Debugging Step:**
1. Open a **regular Chrome browser** (not your Electron app)
2. Navigate to: `chrome://bluetooth-internals/`
3. Click **"Start Discovery"** in the debugger
4. Check if your Tropx devices appear in the **"Devices"** tab

**Expected Results:**
- ✅ If devices appear: Issue is with Electron app configuration
- ❌ If devices DON'T appear: Issue is with Windows Bluetooth or device advertising

### 4. 📱 Device Pairing Mode

**Tropx Device Activation:**
- Check your device manual for "pairing mode" or "discovery mode"
- Usually involves:
  - Holding power button for 3-5 seconds
  - LED should blink rapidly (indicating advertising)
  - Device should remain in pairing mode for 1-2 minutes

### 5. 🔄 Alternative Discovery Method

**Try Manual Windows Pairing:**
1. Go to **Windows Settings** → **Add Bluetooth device**
2. Select **"Bluetooth"**
3. Look for your Tropx devices
4. If they appear, pair them manually
5. Then try your Electron app again

## Advanced Troubleshooting

### Windows Bluetooth Stack Issues
```powershell
# Run as Administrator in PowerShell:
Get-PnpDevice | Where-Object {$_.Class -eq "Bluetooth"}
```

### Registry Check (Advanced Users Only)
```
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\BthServ
```

### Hardware-Level Check
- Try with a different computer to isolate hardware vs software issues
- Use a Bluetooth scanner app on your phone to verify devices are advertising

## Expected Fix Results

After following these steps, you should see:
```
🔵 Found 2 devices in this event
🔵 Raw device list: [
  { name: 'tropx_ln_bottom', id: '00:80:E1:26:2F:E2' },
  { name: 'tropx_ln_top', id: '00:80:E1:27:27:99' }
]
✅ NEW supported device found: "tropx_ln_bottom"
✅ NEW supported device found: "tropx_ln_top"
```

## Contact Support

If none of these steps work:
1. Check with Tropx device manufacturer for BLE advertising specifications
2. Try the app on a different Windows 10/11 machine
3. Consider using USB dongles or alternative Bluetooth adapters

## App Enhancements

Your Electron app now includes:
- ✅ Automatic diagnostics when no devices found
- ✅ Chrome debugging integration
- ✅ Manual pairing instructions
- ✅ Windows-specific troubleshooting
- ✅ Comprehensive logging for technical support