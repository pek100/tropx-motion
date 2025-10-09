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

# Use Node.js smart launcher
node scripts/start-smart.js
