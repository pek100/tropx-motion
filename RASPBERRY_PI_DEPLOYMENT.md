# Raspberry Pi Deployment Guide

## Overview

TropX Motion is fully compatible with Raspberry Pi (tested on Pi 3B with 3.5" LCD). The app automatically adapts to small screens and includes native BLE support for ARM64.

## Hardware Requirements

- **Raspberry Pi**: Pi 3B or newer (Pi 4/5 recommended for better performance)
- **Display**: Any display (HDMI, GPIO LCD, or touchscreen)
- **OS**: Raspberry Pi OS (Debian Trixie or newer)
- **RAM**: 1GB minimum (Pi 3B: 1GB, Pi 4: 2-8GB)
- **Storage**: 8GB SD card minimum (16GB+ recommended)
- **BLE**: Built-in Bluetooth or USB BLE dongle

## Tested Configurations

### Raspberry Pi 3 Model B + 3.5" SPI LCD
- **Screen**: 480x320 resolution
- **Performance**: Functional but limited due to low RAM
- **BLE**: Works with @abandonware/noble
- **Display**: X11 with fbdev driver

## Automatic Features

The app includes several automatic adaptations for Raspberry Pi:

### 1. **Screen Size Detection** (`electron/main/window-size-override.ts`)
- Detects screen dimensions at runtime
- Small screens (≤480px): Uses full screen dimensions
- Large screens: Uses desktop dimensions (1600x800)

### 2. **Responsive Layout** (`electron/renderer/src/App.tsx`)
- Automatically switches to compact mode when screen < 350px
- Optimized UI for small displays
- Touch-friendly controls

### 3. **Platform Optimization** (`shared/PlatformDetector.ts`)
- Detects Pi model by reading `/proc/device-tree/model`
- Sets memory limits based on available RAM:
  - Pi 3B: 400MB Node.js heap
  - Pi 4/5: 1024MB Node.js heap
  - Desktop: 2048MB Node.js heap

### 4. **ARM64 BLE Compatibility** (`package.json`)
- Overrides `bluetooth-hci-socket` with ARM64-compatible version
- Uses `@abandonware/noble` for BLE support
- Native modules compile correctly on ARM64

## Deployment Methods

### Method 1: Build on Raspberry Pi (Recommended)

Building natively on the Pi ensures full compatibility with native BLE modules.

#### Prerequisites
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y git curl build-essential bluetooth bluez libbluetooth-dev libudev-dev

# Install Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be v22.x.x
npm --version   # Should be 10.x.x or higher
```

#### Clone and Build
```bash
# Clone the repository
cd ~
git clone <repository-url> tropxmotion
cd tropxmotion

# Set memory limit for Pi 3B (skip for Pi 4/5)
export NODE_OPTIONS="--max-old-space-size=400"

# Install dependencies (20-30 min on Pi 3B, 10-15 min on Pi 4/5)
# Use --ignore-scripts to skip phantomjs (fails on ARM64)
npm install --ignore-scripts

# Rebuild native modules for Electron/ARM64
npx electron-builder install-app-deps

# Build the application (5-10 minutes)
npm run build

# Test the app
npm start
```

### Method 2: Deploy from PC (Cross-Platform)

Use WinSCP or rsync to transfer built files to Pi, then build native modules on Pi.

#### On Your PC
```bash
# Build the TypeScript/React code
npm run build:main
npm run build:renderer

# Create tarball
tar czf tropxmotion-deploy.tar.gz \
  --exclude='node_modules' \
  --exclude='build' \
  --exclude='.git' \
  --exclude='electron-cache' \
  package.json package-lock.json electron/ sdk/ motionProcessing/ \
  dist/ tsconfig*.json vite.config.ts tailwind.config.js postcss.config.js
```

#### On Raspberry Pi
```bash
# Extract and install
mkdir -p ~/tropxmotion
cd ~/tropxmotion
tar xzf /path/to/tropxmotion-deploy.tar.gz

# Set memory limit for Pi 3B
export NODE_OPTIONS="--max-old-space-size=400"

# Install dependencies (skip problematic install scripts)
npm install --ignore-scripts

# Rebuild native modules for Electron/ARM64
npx electron-builder install-app-deps

# The app is ready
npm start
```

## Running the App

### Desktop Mode (with GUI)
```bash
cd ~/tropxmotion
npm start
```

### Kiosk Mode (Fullscreen)
Perfect for dedicated Pi displays or touchscreens.

#### Setup Auto-Start with Kiosk Mode

1. **Create kiosk script:**
```bash
cat > ~/start-tropx-kiosk.sh << 'EOF'
#!/bin/bash

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Set memory limit based on Pi model
TOTAL_MEM=$(free -m | grep Mem | awk '{print $2}')
if [ "$TOTAL_MEM" -lt 2048 ]; then
    export NODE_OPTIONS="--max-old-space-size=400"
else
    export NODE_OPTIONS="--max-old-space-size=1024"
fi

cd ~/tropxmotion

# Launch in kiosk mode
npx electron . --kiosk --no-sandbox --disable-gpu
EOF

chmod +x ~/start-tropx-kiosk.sh
```

2. **Enable auto-login and auto-start:**
```bash
# Enable desktop auto-login
sudo raspi-config
# Go to: System Options → Boot / Auto Login → Desktop Autologin

# Add to .profile for auto-start
echo '
# Auto-start TropX Motion in kiosk mode
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
    startx ~/start-tropx-kiosk.sh
fi' >> ~/.profile

# Reboot to test
sudo reboot
```

## Display Configuration

### HDMI Displays
Works out of the box. The app detects screen size automatically.

### GPIO/SPI LCD Displays (3.5", 5", etc.)

For small SPI displays, X11 needs to be configured to use the framebuffer.

1. **Check framebuffer devices:**
```bash
ls -la /dev/fb*
# fb0 = HDMI, fb1 = SPI LCD
```

2. **Configure X11 for SPI display:**
```bash
sudo tee /etc/X11/xorg.conf.d/99-fbtft.conf > /dev/null << 'EOF'
Section "Device"
    Identifier "PiTFT"
    Driver "fbdev"
    Option "fbdev" "/dev/fb1"
EndSection

Section "Screen"
    Identifier "PiScreen"
    Device "PiTFT"
EndSection

Section "ServerLayout"
    Identifier "TFTLayout"
    Screen 0 "PiScreen" 0 0
EndSection
EOF
```

3. **Reboot and test:**
```bash
sudo reboot
```

### Touchscreen Calibration

If you have a touchscreen that's not responding correctly:

```bash
# Install calibration tool
sudo apt install -y xinput-calibrator

# Run calibration (on the Pi with display)
DISPLAY=:0 xinput_calibrator

# Follow on-screen instructions
# Copy the output configuration to:
sudo nano /etc/X11/xorg.conf.d/99-calibration.conf
```

## Performance Optimization

### Pi 3B (1GB RAM)
- **Memory Limit**: 400MB Node.js heap
- **Build Time**: 20-30 minutes for dependencies, 5-10 min for build
- **Performance**: Functional but limited; avoid heavy animations
- **Recommendation**: Use compact/mobile layout

### Pi 4 (2-8GB RAM)
- **Memory Limit**: 1024MB Node.js heap
- **Build Time**: 10-15 minutes for dependencies, 3-5 min for build
- **Performance**: Smooth operation
- **Recommendation**: Desktop or compact layout works well

### Pi 5 (4-8GB RAM)
- **Memory Limit**: 1024MB+ Node.js heap
- **Build Time**: 5-10 minutes for dependencies, 2-3 min for build
- **Performance**: Excellent
- **Recommendation**: Desktop layout recommended

## Troubleshooting

### Build Fails with Memory Error
```bash
# Increase Node.js heap size for Pi 4/5
export NODE_OPTIONS="--max-old-space-size=1024"

# Or reduce for Pi 3B if build OOMs
export NODE_OPTIONS="--max-old-space-size=300"

# Retry build
npm run build
```

### phantomjs-prebuilt Fails on ARM64
**Error**: `phantomjs-prebuilt` installation fails during `npm install`

**Solution**: Use `--ignore-scripts` to skip phantomjs installation (not needed for Pi):
```bash
# Always use --ignore-scripts on Pi
npm install --ignore-scripts

# Then rebuild only the native modules we need
npx electron-builder install-app-deps
```

**Why**: `phantomjs-prebuilt` doesn't support ARM64 and is only used for icon building (not needed at runtime).

### BLE Module Compilation Fails
```bash
# Install BLE development libraries
sudo apt install -y bluetooth bluez libbluetooth-dev libudev-dev build-essential

# Rebuild native modules
npm rebuild

# Or rebuild specific modules
npx electron-builder install-app-deps
```

### App Doesn't Scale to Small Screen
The app should automatically detect screens ≤480px and scale appropriately. Check logs:
```bash
# Look for "Screen detected: WIDTHxHEIGHT" in logs
npm start 2>&1 | grep "Screen detected"

# If detection fails, the app falls back to 480x320
```

### X Server Won't Start
```bash
# Check if X config is correct
cat /etc/X11/xorg.conf.d/99-fbtft.conf

# Test X manually
startx

# Check X logs
cat ~/.local/share/xorg/Xorg.0.log
```

### Touchscreen Not Working
```bash
# Check if touchscreen is detected
DISPLAY=:0 xinput list

# Add user to input group
sudo usermod -a -G input $USER

# Reboot for group changes to take effect
sudo reboot
```

### "Module not found" Errors
```bash
# Ensure all dependencies are installed
npm install

# Rebuild native modules for Electron
npx electron-builder install-app-deps
```

## BLE Device Connection

### Enable Bluetooth
```bash
# Check Bluetooth status
sudo systemctl status bluetooth

# Enable if disabled
sudo systemctl enable bluetooth
sudo systemctl start bluetooth

# Check Bluetooth adapter
hciconfig

# Scan for devices
sudo hcitool lescan
```

### Grant BLE Permissions
```bash
# Add user to bluetooth group
sudo usermod -a -G bluetooth $USER

# Allow Bluetooth without root (create udev rule)
sudo tee /etc/udev/rules.d/99-bluetooth.rules > /dev/null << 'EOF'
KERNEL=="rfkill", GROUP="bluetooth", MODE="0660"
SUBSYSTEM=="bluetooth", GROUP="bluetooth", MODE="0660"
EOF

# Reload udev rules
sudo udevadm control --reload-rules
sudo udevadm trigger

# Reboot
sudo reboot
```

## Development on Pi

You can develop directly on the Pi using VS Code Remote SSH:

```bash
# On your PC, connect to Pi via VS Code Remote SSH
# Extension: ms-vscode-remote.remote-ssh

# In VS Code terminal on Pi:
npm run dev

# Access at http://pi.local:3000
```

## Updating the App

### Quick Update (code changes only)
```bash
cd ~/tropxmotion
git pull
npm run build
```

### Full Update (dependency changes)
```bash
cd ~/tropxmotion
git pull
npm install --ignore-scripts
npx electron-builder install-app-deps
npm run build
```

## Performance Monitoring

The app includes a built-in system monitor:

```bash
# Enable monitoring
export TROPX_MONITOR=1
export TROPX_MONITOR_INTERVAL=5000  # 5 seconds

npm start
```

Monitor will show:
- CPU usage
- Memory usage
- Heap statistics
- Event loop lag

## Network Configuration

### SSH Access
```bash
# Enable SSH
sudo raspi-config
# Interface Options → SSH → Enable

# Connect from PC
ssh pi@pi.local
# or
ssh pi@<IP_ADDRESS>
```

### VNC for Remote Desktop
```bash
# Enable VNC
sudo raspi-config
# Interface Options → VNC → Enable

# Start VNC server
vncserver :1

# Connect with VNC client (e.g., RealVNC Viewer)
# Address: pi.local:5901
```

## File Locations

- **App Directory**: `~/tropxmotion`
- **User Data**: `~/.config/motion-capture-electron`
- **Logs**: `~/.config/motion-capture-electron/logs/`
- **Device Registry**: `~/.config/motion-capture-electron/device-registry.json`
- **X Server Logs**: `~/.local/share/xorg/Xorg.0.log`

## Known Limitations

### Raspberry Pi 3B
- ⚠️ **Limited RAM**: Only 1GB, can struggle with heavy loads
- ⚠️ **Slow Builds**: Native module compilation takes 20-30 minutes
- ⚠️ **Touchscreen**: May not work reliably due to driver issues
- ✅ **BLE**: Works well with native modules
- ✅ **Display**: Properly scales to small screens

### Small SPI Displays (3.5", 5")
- ⚠️ **Slow Refresh**: SPI bandwidth limitations cause lag
- ⚠️ **Touch Calibration**: May require manual calibration
- ✅ **Scaling**: App automatically adapts to small resolutions
- ✅ **Kiosk Mode**: Works well for dedicated displays

## Best Practices

1. **Use Pi 4 or 5** for better performance
2. **Use HDMI displays** for better responsiveness (SPI is slow)
3. **Build on Pi** rather than cross-compiling for BLE support
4. **Set memory limits** appropriate for your Pi model
5. **Enable desktop auto-login** for kiosk mode
6. **Use wired Ethernet** for better network stability
7. **Keep system updated**: `sudo apt update && sudo apt upgrade`

## Additional Resources

- **Raspberry Pi Documentation**: https://www.raspberrypi.com/documentation/
- **Node.js on ARM**: https://nodejs.org/en/download/
- **Electron ARM Support**: https://www.electronjs.org/docs/latest/tutorial/arm
- **Web Bluetooth on Linux**: https://github.com/abandonware/noble

## Support

For issues specific to Raspberry Pi deployment:
1. Check logs in `~/.config/motion-capture-electron/logs/`
2. Verify Node.js version: `node --version` (should be 22.x)
3. Check memory usage: `free -h`
4. Check disk space: `df -h`
5. Review X server logs if display issues occur

---

**Last Updated**: October 2025
**Tested On**: Raspberry Pi OS (Debian Trixie), Raspberry Pi 3 Model B
