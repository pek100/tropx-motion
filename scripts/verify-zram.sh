#!/bin/bash

#############################################################################
# ZRAM Verification Script
# Checks if zram is properly configured and working
#
# Usage: bash scripts/verify-zram.sh
#############################################################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  ZRAM Verification Report${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

ISSUES_FOUND=0

# Check 1: zram kernel module
echo -e "${BLUE}[1] Checking zram kernel module...${NC}"
if lsmod | grep -q "^zram"; then
    echo -e "${GREEN}✓ zram kernel module is loaded${NC}"
else
    echo -e "${RED}✗ zram kernel module is NOT loaded${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# Check 2: zram-config service
echo -e "${BLUE}[2] Checking zram-config service...${NC}"
if systemctl is-active --quiet zram-config.service 2>/dev/null; then
    echo -e "${GREEN}✓ zram-config service is active${NC}"
    if systemctl is-enabled --quiet zram-config.service 2>/dev/null; then
        echo -e "${GREEN}✓ zram-config service is enabled (starts on boot)${NC}"
    else
        echo -e "${YELLOW}⚠ zram-config service is NOT enabled for boot${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
else
    echo -e "${RED}✗ zram-config service is NOT active${NC}"
    echo "  Run: sudo systemctl status zram-config.service"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# Check 3: zram devices
echo -e "${BLUE}[3] Checking zram devices...${NC}"
if command -v zramctl &> /dev/null; then
    if zramctl 2>/dev/null | grep -q zram; then
        echo -e "${GREEN}✓ zram devices found:${NC}"
        echo ""
        zramctl
        echo ""
    else
        echo -e "${RED}✗ No zram devices found${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
else
    echo -e "${YELLOW}⚠ zramctl command not found (install util-linux)${NC}"
    # Try alternative check
    if ls /dev/zram* &> /dev/null; then
        echo -e "${GREEN}✓ zram device files exist in /dev/${NC}"
    else
        echo -e "${RED}✗ No zram devices found${NC}"
        ISSUES_FOUND=$((ISSUES_FOUND + 1))
    fi
fi
echo ""

# Check 4: Swap status
echo -e "${BLUE}[4] Checking swap configuration...${NC}"
SWAP_OUTPUT=$(swapon --show 2>/dev/null)
if echo "$SWAP_OUTPUT" | grep -q "zram"; then
    echo -e "${GREEN}✓ zram swap is active:${NC}"
    echo ""
    swapon --show
    echo ""
else
    echo -e "${YELLOW}⚠ No zram swap found${NC}"
    if [ -n "$SWAP_OUTPUT" ]; then
        echo "Current swap:"
        echo "$SWAP_OUTPUT"
    else
        echo "No swap active"
    fi
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# Check 5: Old swap disabled
echo -e "${BLUE}[5] Checking if SD card swap is disabled...${NC}"
if swapon --show 2>/dev/null | grep -qE "mmcblk|sd[a-z]"; then
    echo -e "${YELLOW}⚠ SD card swap is still active (should be disabled)${NC}"
    swapon --show | grep -E "mmcblk|sd[a-z]"
    echo "  Run: sudo dphys-swapfile swapoff"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✓ No SD card swap active (good!)${NC}"
fi
echo ""

# Check 6: Configuration file
echo -e "${BLUE}[6] Checking zram configuration...${NC}"
if [ -f /etc/ztab ]; then
    echo -e "${GREEN}✓ /etc/ztab exists${NC}"
    echo ""
    echo "Active configuration:"
    grep -v "^#" /etc/ztab | grep -v "^[[:space:]]*$" || echo "  (empty configuration)"
    echo ""
else
    echo -e "${RED}✗ /etc/ztab not found${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi
echo ""

# Check 7: Kernel parameters
echo -e "${BLUE}[7] Checking kernel parameters...${NC}"
if [ -f /etc/sysctl.d/99-zram.conf ]; then
    echo -e "${GREEN}✓ Kernel parameter configuration exists${NC}"

    # Check if parameters are applied
    SWAPPINESS=$(sysctl -n vm.swappiness 2>/dev/null)
    DIRTY_BG=$(sysctl -n vm.dirty_background_ratio 2>/dev/null)
    DIRTY=$(sysctl -n vm.dirty_ratio 2>/dev/null)

    echo ""
    echo "Current values:"
    echo "  vm.swappiness = $SWAPPINESS (recommended: 100)"
    echo "  vm.dirty_background_ratio = $DIRTY_BG (recommended: 1)"
    echo "  vm.dirty_ratio = $DIRTY (recommended: 50)"
    echo ""

    if [ "$SWAPPINESS" != "100" ] || [ "$DIRTY_BG" != "1" ] || [ "$DIRTY" != "50" ]; then
        echo -e "${YELLOW}⚠ Some parameters may not be optimal${NC}"
        echo "  Run: sudo sysctl -p /etc/sysctl.d/99-zram.conf"
    else
        echo -e "${GREEN}✓ All parameters are optimal${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Kernel parameter configuration not found${NC}"
fi
echo ""

# Check 8: Memory usage
echo -e "${BLUE}[8] Memory status:${NC}"
echo ""
free -h
echo ""

# Check 9: Compression stats (if available)
echo -e "${BLUE}[9] Checking compression statistics...${NC}"
ZRAM_STATS_FOUND=0
for device in /sys/block/zram*/mm_stat; do
    if [ -f "$device" ]; then
        ZRAM_STATS_FOUND=1
        DEVICE_NAME=$(echo "$device" | sed 's/\/sys\/block\/\(zram[0-9]*\).*/\1/')
        echo ""
        echo "Device: $DEVICE_NAME"

        # Read mm_stat file
        read -r orig_size compr_size mem_used mem_limit mem_used_max same_pages pages_compacted huge_pages <<< $(cat "$device")

        # Convert to human readable (approximate)
        ORIG_MB=$((orig_size / 1024 / 1024))
        COMPR_MB=$((compr_size / 1024 / 1024))
        MEM_MB=$((mem_used / 1024 / 1024))

        # Calculate compression ratio
        if [ "$compr_size" -gt 0 ]; then
            RATIO=$(echo "scale=2; $orig_size / $compr_size" | bc 2>/dev/null || echo "N/A")
        else
            RATIO="N/A"
        fi

        echo "  Original data: ${ORIG_MB}MB"
        echo "  Compressed: ${COMPR_MB}MB"
        echo "  Memory used: ${MEM_MB}MB"
        echo "  Compression ratio: ${RATIO}x"
    fi
done

if [ "$ZRAM_STATS_FOUND" -eq 0 ]; then
    echo -e "${YELLOW}⚠ No zram statistics available${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}============================================${NC}"
if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}  ✓ All checks passed!${NC}"
    echo -e "${GREEN}  ZRAM is working correctly${NC}"
else
    echo -e "${YELLOW}  ⚠ Found $ISSUES_FOUND issue(s)${NC}"
    echo -e "${YELLOW}  Check the details above${NC}"
fi
echo -e "${BLUE}============================================${NC}"
echo ""

exit $ISSUES_FOUND
