#!/bin/bash

#############################################################################
# ZRAM Setup Script for Raspberry Pi
# Reduces SD card wear by using compressed RAM for swap and logs
#
# This script:
# 1. Disables default swap on SD card
# 2. Installs zram-config tool (ecdye/zram-config)
# 3. Configures optimal settings for Electron app workloads
# 4. Sets up kernel parameters for best performance
#
# Usage: sudo bash scripts/setup-zram.sh
#############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  TropXMotion - ZRAM Setup Script${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}ERROR: Please run as root (sudo)${NC}"
    exit 1
fi

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ] || ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
    echo -e "${YELLOW}WARNING: This doesn't appear to be a Raspberry Pi${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo -e "${GREEN}Step 1: Checking system requirements...${NC}"
echo ""

# Check if zram module is available
if ! modprobe zram 2>/dev/null; then
    echo -e "${RED}ERROR: zram kernel module not available${NC}"
    echo "Your kernel may not support zram."
    exit 1
fi

echo -e "${GREEN}✓ zram kernel module is available${NC}"

# Check if zram-config is already installed
if systemctl is-active --quiet zram-config.service 2>/dev/null; then
    echo -e "${YELLOW}⚠ zram-config is already installed and running${NC}"
    read -p "Reinstall/reconfigure? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}Keeping existing installation. Exiting.${NC}"
        exit 0
    fi
    echo -e "${YELLOW}Stopping and removing existing zram-config...${NC}"
    systemctl stop zram-config.service 2>/dev/null || true
    systemctl disable zram-config.service 2>/dev/null || true
fi

echo ""
echo -e "${GREEN}Step 2: Disabling default swap on SD card...${NC}"
echo ""

# Disable and remove default swap
if [ -f /etc/dphys-swapfile ]; then
    echo -e "${YELLOW}Disabling dphys-swapfile...${NC}"
    dphys-swapfile swapoff 2>/dev/null || true
    systemctl stop dphys-swapfile.service 2>/dev/null || true
    systemctl disable dphys-swapfile.service 2>/dev/null || true
    echo -e "${GREEN}✓ Default swap disabled${NC}"
else
    echo -e "${BLUE}No dphys-swapfile found (already disabled or not present)${NC}"
fi

# Disable any other swap
swapoff -a 2>/dev/null || true
echo -e "${GREEN}✓ All swap disabled${NC}"

echo ""
echo -e "${GREEN}Step 3: Installing dependencies...${NC}"
echo ""

# Install required packages
apt-get update
apt-get install -y lzip util-linux git

echo -e "${GREEN}✓ Dependencies installed${NC}"

echo ""
echo -e "${GREEN}Step 4: Downloading zram-config...${NC}"
echo ""

# Create temp directory for installation
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Download latest release
LATEST_VERSION="v1.7.0"
echo -e "${BLUE}Downloading zram-config ${LATEST_VERSION}...${NC}"

wget -q --show-progress "https://github.com/ecdye/zram-config/releases/download/${LATEST_VERSION}/zram-config-${LATEST_VERSION}.tar.lz"

echo -e "${GREEN}✓ Downloaded zram-config${NC}"

echo ""
echo -e "${GREEN}Step 5: Extracting and installing...${NC}"
echo ""

# Extract
tar xf "zram-config-${LATEST_VERSION}.tar.lz"
cd "zram-config-${LATEST_VERSION}"

# Install
bash install.bash

echo -e "${GREEN}✓ zram-config installed${NC}"

# Return to original directory
cd - > /dev/null

# Clean up temp directory
rm -rf "$TEMP_DIR"

echo ""
echo -e "${GREEN}Step 6: Configuring optimal settings...${NC}"
echo ""

# Create optimized configuration for Electron app workloads
# /etc/ztab is the main configuration file
cat > /etc/ztab << 'EOF'
# zram-config configuration
#
# Optimized for TropXMotion Electron application on Raspberry Pi
# Reduces SD card wear by using compressed RAM
#
# Format: <type> <parameters separated by tabs>
# Types: swap, dir, log
#
# Compression: lz4 (best performance on ARM)
# Target dir size: 50% of available RAM (compressed to ~20% actual RAM usage)
#
# For more info: https://github.com/ecdye/zram-config

# ZRAM Swap (compressed swap in RAM instead of SD card)
# Syntax: swap <size> <algorithm>
# Size can be in MB or as percentage of RAM
# Recommended: 50% of total RAM with lz4 compression
swap	50%	lz4

# ZRAM for /tmp (temporary files in compressed RAM)
# Syntax: dir <target_dir> <size> <algorithm>
# This keeps temporary files in RAM instead of writing to SD card
dir	/tmp	50%	lz4

# ZRAM for logs (compressed log storage in RAM)
# Syntax: log <log_dir> <size> <algorithm>
# Logs are synced to disk periodically but stored in RAM
# IMPORTANT: Logs may be lost on unexpected power loss
log	/var/log	40M	lz4
EOF

echo -e "${GREEN}✓ Created optimized /etc/ztab configuration${NC}"

echo ""
echo -e "${GREEN}Step 7: Configuring kernel parameters...${NC}"
echo ""

# Optimize kernel parameters for zram performance
# These settings improve performance when using zram
SYSCTL_CONF="/etc/sysctl.d/99-zram.conf"

cat > "$SYSCTL_CONF" << 'EOF'
# Kernel parameters optimized for zram on Raspberry Pi
# Added by TropXMotion zram setup script

# vm.swappiness: How aggressively kernel swaps to zram
# Default: 60, Recommended for zram: 100
# Higher values are OK since zram is in RAM (fast)
vm.swappiness=100

# vm.vfs_cache_pressure: How aggressively kernel reclaims cache
# Default: 100, Recommended for zram: 500
# Higher value = more aggressive cache reclaim (good with zram)
vm.vfs_cache_pressure=500

# vm.dirty_background_ratio: When background writeback starts
# Default: 10, Recommended for SD card: 1
# Start writing earlier to reduce burst writes
vm.dirty_background_ratio=1

# vm.dirty_ratio: When foreground writeback is forced
# Default: 20, Recommended for SD card: 50
# Higher value allows more dirty pages before forcing sync
vm.dirty_ratio=50

# vm.page-cluster: Number of pages to read/write in single swap I/O
# Default: 3 (8 pages), Recommended for zram: 0 (1 page)
# Lower value reduces latency with compressed swap
vm.page-cluster=0
EOF

echo -e "${GREEN}✓ Created kernel parameter configuration${NC}"

# Apply sysctl settings immediately
sysctl -p "$SYSCTL_CONF" > /dev/null 2>&1

echo -e "${GREEN}✓ Applied kernel parameters${NC}"

echo ""
echo -e "${GREEN}Step 8: Starting zram-config service...${NC}"
echo ""

# Reload systemd and enable service
systemctl daemon-reload
systemctl enable zram-config.service
systemctl start zram-config.service

# Wait a moment for zram devices to be created
sleep 2

echo -e "${GREEN}✓ zram-config service started${NC}"

echo ""
echo -e "${GREEN}Step 9: Verifying installation...${NC}"
echo ""

# Check if zram devices were created
if zramctl | grep -q zram; then
    echo -e "${GREEN}✓ ZRAM devices created successfully:${NC}"
    echo ""
    zramctl
    echo ""
else
    echo -e "${RED}ERROR: No zram devices found${NC}"
    echo "Check service status: sudo systemctl status zram-config.service"
    exit 1
fi

# Show memory stats
echo ""
echo -e "${BLUE}Memory Status:${NC}"
free -h

echo ""
echo -e "${BLUE}Swap Status:${NC}"
swapon --show

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ZRAM Installation Complete! ✓${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}What was configured:${NC}"
echo "  • Disabled default SD card swap"
echo "  • Installed zram-config (compressed RAM swap)"
echo "  • Configured zram for swap, /tmp, and /var/log"
echo "  • Optimized kernel parameters for SD card longevity"
echo "  • Enabled zram-config service (starts on boot)"
echo ""
echo -e "${BLUE}Benefits:${NC}"
echo "  • Reduced SD card wear (fewer write cycles)"
echo "  • Faster swap performance (RAM vs SD card)"
echo "  • Compressed storage saves RAM (~2-3x compression)"
echo "  • Logs written to RAM (synced periodically)"
echo ""
echo -e "${YELLOW}Important Notes:${NC}"
echo "  • Logs in /var/log may be lost on unexpected power loss"
echo "  • Monitor RAM usage: free -h"
echo "  • Check zram status: zramctl"
echo "  • Check service: sudo systemctl status zram-config"
echo "  • View config: cat /etc/ztab"
echo ""
echo -e "${GREEN}No reboot required - zram is active now!${NC}"
echo ""
