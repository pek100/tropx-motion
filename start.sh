#!/bin/bash

# Smart Launch Script for Linux/Mac
# Automatically detects platform and applies optimal settings

echo "🚀 TropX Motion - Smart Launcher"
echo ""

# Change to script directory
cd "$(dirname "$0")"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    echo "Please install Node.js 22 or higher"
    exit 1
fi

# Check if app is built
if [ ! -f "dist/main/electron/main/main.js" ]; then
    echo "❌ Application not built"
    echo "Please run: npm run build"
    exit 1
fi

# On Raspberry Pi: Apply display and touch rotation before starting app
if [ -f "/proc/device-tree/model" ] && grep -q "Raspberry Pi" /proc/device-tree/model; then
    echo "🔄 Applying display rotation for Raspberry Pi..."
    export DISPLAY=:0
    xrandr --output DSI-2 --rotate right 2>/dev/null || true
    echo "🔄 Applying touchscreen rotation..."
    xinput --map-to-output "11-005d Goodix Capacitive TouchScreen" DSI-2 2>/dev/null || true
    sleep 1

    # On Raspberry Pi, run with sudo to allow Bluetooth access
    # Preserve DISPLAY and XAUTHORITY for GUI
    export XAUTHORITY=/run/user/1000/gdm/Xauthority
    [ -f "/var/run/lightdm/$USER/:0" ] && export XAUTHORITY="/var/run/lightdm/$USER/:0"
    echo "🔐 Running with Bluetooth privileges..."
    sudo -E node scripts/start-smart.js
else
    # Use Node.js smart launcher
    node scripts/start-smart.js
fi
