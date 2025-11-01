#!/bin/bash

# TropX Motion - Deploy to Raspberry Pi
# This script deploys the app to a Raspberry Pi and builds it there natively

set -e  # Exit on error

# Configuration
# Accept PI_HOST as first argument, or from env, or default to pi.local
PI_HOST="${1:-${PI_HOST:-pi.local}}"
PI_DIR="${PI_DIR:-~/tropxmotion}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}TropX Motion - Deploy to Raspberry Pi${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Prompt for username
echo -e "${YELLOW}Enter Pi username (default: pek):${NC}"
read -r PI_USER
PI_USER="${PI_USER:-pek}"

PI_SSH="$PI_USER@$PI_HOST"

echo ""
echo -e "${YELLOW}📡 Testing connection to $PI_HOST...${NC}"
echo "You will be prompted for the SSH password..."
echo ""

# Test connection (will prompt for password)
if ! ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$PI_SSH" "echo ''" 2>/dev/null; then
    echo -e "${RED}❌ Cannot connect to $PI_SSH${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check Pi is powered on"
    echo "  2. Check Pi is on network"
    echo "  3. Try: ping $PI_HOST"
    echo "  4. Use IP directly: bash scripts/deploy-to-pi.sh 192.168.1.X"
    exit 1
fi

echo -e "${GREEN}✅ Connection successful${NC}"
echo ""

# Ask for confirmation
echo -e "${YELLOW}Deployment details:${NC}"
echo "  Target: $PI_SSH"
echo "  Directory: $PI_DIR"
echo ""
read -p "Continue deployment? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 0
fi
echo ""

# Transfer files via rsync (will prompt for password)
echo -e "${YELLOW}📦 Transferring files to Pi...${NC}"
echo "You may be prompted for password again..."
rsync -avz \
    -e "ssh -o StrictHostKeyChecking=no" \
    --delete \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'build' \
    --exclude '.git' \
    --exclude 'electron-cache' \
    --exclude '*.log' \
    ./ "$PI_SSH:$PI_DIR/"

echo -e "${GREEN}✅ Files transferred${NC}"
echo ""

# Build on Pi
echo -e "${YELLOW}🔨 Building on Raspberry Pi (this may take 20-45 minutes)...${NC}"
echo "You may be prompted for password one more time..."
ssh -o StrictHostKeyChecking=no "$PI_SSH" bash << 'REMOTE_SCRIPT'
set -e

cd ~/tropxmotion

echo ""
echo "=== System Information ==="
cat /proc/device-tree/model 2>/dev/null || echo "Not a Raspberry Pi"
echo "RAM: $(free -h | grep Mem | awk '{print $2}')"
echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo ""

# Detect Pi model and set memory limits
TOTAL_MEM=$(free -m | grep Mem | awk '{print $2}')
if [ "$TOTAL_MEM" -lt 2048 ]; then
    echo "⚠️  Low memory detected (${TOTAL_MEM}MB) - using conservative limits"
    export NODE_OPTIONS="--max-old-space-size=400"
    MEM_LIMIT=400
elif [ "$TOTAL_MEM" -lt 4096 ]; then
    echo "📊 Medium memory detected (${TOTAL_MEM}MB)"
    export NODE_OPTIONS="--max-old-space-size=1024"
    MEM_LIMIT=1024
else
    echo "📊 Good memory detected (${TOTAL_MEM}MB)"
    export NODE_OPTIONS="--max-old-space-size=1024"
    MEM_LIMIT=1024
fi

echo ""
echo "=== Installing dependencies ==="
echo "⏳ This will take 20-30 minutes on Pi 3B, 10-15 minutes on Pi 4/5..."
echo "    Native modules (@abandonware/noble) will compile for ARM64"
echo ""

npm ci --production

echo ""
echo "=== Building application ==="
echo "⏳ This will take 5-10 minutes..."
echo ""

npm run build:main
npm run build:renderer

echo ""
echo "=== Verifying build ==="
if [ -f "dist/main/electron/main/main.js" ] && [ -d "dist/renderer" ]; then
    echo "✅ Build successful!"
else
    echo "❌ Build failed - missing output files"
    exit 1
fi

echo ""
echo "=== Creating launch script ==="
cat > ~/start-tropx.sh << 'LAUNCH_SCRIPT'
#!/bin/bash

cd ~/tropxmotion

# Detect Pi model and apply optimizations
TOTAL_MEM=$(free -m | grep Mem | awk '{print $2}')
if [ "$TOTAL_MEM" -lt 2048 ]; then
    export NODE_OPTIONS="--max-old-space-size=400"
else
    export NODE_OPTIONS="--max-old-space-size=1024"
fi

# Ensure display is set
if [ -z "$DISPLAY" ]; then
    export DISPLAY=:0
fi

echo "🚀 Starting TropX Motion..."
node scripts/start-smart.js
LAUNCH_SCRIPT

chmod +x ~/start-tropx.sh

echo ""
echo "✅ Build complete!"
echo ""
echo "To run the app:"
echo "  ./start-tropx.sh"
echo ""
echo "Or with npm:"
echo "  cd ~/tropxmotion && npm start"
echo ""

REMOTE_SCRIPT

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "To run the app on your Pi:"
echo "  1. SSH in: ssh $PI_SSH"
echo "  2. Start X server (if using HDMI): startx &"
echo "  3. Run app: ./start-tropx.sh"
echo ""
echo "Or use VNC to connect remotely"
echo ""
